import { dirname } from "node:path"
import { mkdirSync } from "node:fs"

import type { JsonValue } from "./provider-schema"

export interface PlaygroundSample {
  readonly id: number
  readonly provider: string
  readonly operation: string
  readonly name: string
  readonly request: JsonValue
  readonly createdAt: string
  readonly updatedAt: string
}

export interface PlaygroundProviderState {
  readonly lastRequest: JsonValue | null
  readonly samples: PlaygroundSample[]
}

interface RequestRow {
  readonly requestJson: string
}

interface SampleRow extends RequestRow {
  readonly id: number
  readonly provider: string
  readonly operation: string
  readonly name: string
  readonly createdAt: string
  readonly updatedAt: string
}

interface Statement {
  get(...bindings: string[]): unknown
  all(...bindings: string[]): unknown[]
  run(...bindings: string[]): unknown
}

interface Database {
  exec(sql: string): unknown
  close(): void
  query?: (sql: string) => Statement
  prepare?: (sql: string) => Statement
}

let openDatabase: (filename: string) => Database
if ("bun" in process.versions) {
  const { Database: BunDatabase } = await import("bun:sqlite")
  openDatabase = (filename) => new BunDatabase(filename, { create: true }) as Database
} else {
  const { DatabaseSync } = await import("node:sqlite")
  openDatabase = (filename) => new DatabaseSync(filename) as unknown as Database
}

function statement(database: Database, sql: string): Statement {
  if (database.query) return database.query(sql)
  if (database.prepare) return database.prepare(sql)
  throw new TypeError("The SQLite runtime provides neither query nor prepare")
}

function parseRequest(value: string): JsonValue {
  return JSON.parse(value) as JsonValue
}

function stringifyRequest(request: JsonValue): string {
  const value = JSON.stringify(request)
  if (value === undefined) throw new TypeError("Playground settings must be JSON serializable")
  return value
}

function sample(row: SampleRow): PlaygroundSample {
  return {
    id: row.id,
    provider: row.provider,
    operation: row.operation,
    name: row.name,
    request: parseRequest(row.requestJson),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export class PlaygroundSampleStore {
  readonly #database: Database

  constructor(filename: string) {
    if (filename !== ":memory:") mkdirSync(dirname(filename), { recursive: true })
    this.#database = openDatabase(filename)
    this.#database.exec("PRAGMA journal_mode = WAL")
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS playground_last_settings (
        provider TEXT NOT NULL,
        operation TEXT NOT NULL,
        request_json TEXT NOT NULL CHECK (json_valid(request_json)),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        PRIMARY KEY (provider, operation)
      );

      CREATE TABLE IF NOT EXISTS playground_samples (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider TEXT NOT NULL,
        operation TEXT NOT NULL,
        sample_name TEXT NOT NULL,
        request_json TEXT NOT NULL CHECK (json_valid(request_json)),
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        UNIQUE (provider, operation, sample_name)
      );
    `)
  }

  close(): void {
    this.#database.close()
  }

  providerState(provider: string, operation: string): PlaygroundProviderState {
    const last = statement(this.#database, `
      SELECT request_json AS requestJson
      FROM playground_last_settings
      WHERE provider = ?1 AND operation = ?2
    `).get(provider, operation) as RequestRow | null
    const rows = statement(this.#database, `
      SELECT
        id,
        provider,
        operation,
        sample_name AS name,
        request_json AS requestJson,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM playground_samples
      WHERE provider = ?1 AND operation = ?2
      ORDER BY updated_at DESC, id DESC
    `).all(provider, operation) as SampleRow[]
    return {
      lastRequest: last ? parseRequest(last.requestJson) : null,
      samples: rows.map(sample),
    }
  }

  saveLastSettings(provider: string, operation: string, request: JsonValue): void {
    statement(this.#database, `
      INSERT INTO playground_last_settings (provider, operation, request_json)
      VALUES (?1, ?2, ?3)
      ON CONFLICT (provider, operation) DO UPDATE SET
        request_json = excluded.request_json,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    `).run(provider, operation, stringifyRequest(request))
  }

  saveSample(provider: string, operation: string, name: string, request: JsonValue): PlaygroundSample {
    const row = statement(this.#database, `
      INSERT INTO playground_samples (provider, operation, sample_name, request_json)
      VALUES (?1, ?2, ?3, ?4)
      ON CONFLICT (provider, operation, sample_name) DO UPDATE SET
        request_json = excluded.request_json,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      RETURNING
        id,
        provider,
        operation,
        sample_name AS name,
        request_json AS requestJson,
        created_at AS createdAt,
        updated_at AS updatedAt
    `).get(provider, operation, name, stringifyRequest(request)) as SampleRow | null
    if (!row) throw new TypeError("SQLite did not return the saved playground sample")
    return sample(row)
  }
}
