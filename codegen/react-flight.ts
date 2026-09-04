export interface ReactFlightRecord {
  readonly id: string;
  readonly kind: "json" | "hint" | "import" | "text";
  readonly value: unknown;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

function flightChunks(html: string): readonly string[] {
  const chunks: string[] = [];
  const pushes = /self\.__next_f\.push\((\[.*?\])\)<\/script>/gs;
  for (const match of html.matchAll(pushes)) {
    const payload = JSON.parse(match[1]!) as unknown;
    if (!Array.isArray(payload) || payload.length !== 2 || payload[0] !== 1 || typeof payload[1] !== "string") {
      throw new TypeError("React Flight page contains an unsupported chunk");
    }
    chunks.push(payload[1]);
  }
  if (chunks.length === 0) throw new TypeError("Page has no React Flight chunks");
  return chunks;
}

function colon(bytes: Uint8Array, start: number): number {
  let cursor = start;
  while (cursor < bytes.length && bytes[cursor] !== 0x3a) cursor++;
  if (cursor === bytes.length) throw new TypeError("React Flight record has no header terminator");
  return cursor;
}

function lineEnd(bytes: Uint8Array, start: number): number {
  let cursor = start;
  while (cursor < bytes.length && bytes[cursor] !== 0x0a) cursor++;
  if (cursor === bytes.length) throw new TypeError("React Flight record is truncated");
  return cursor;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    throw new TypeError("React Flight JSON record is invalid", { cause: error });
  }
}

/** Decodes the byte-framed record stream embedded in a Next.js React Flight page. */
export function reactFlightRecords(html: string): readonly ReactFlightRecord[] {
  const bytes = encoder.encode(flightChunks(html).join(""));
  const records: ReactFlightRecord[] = [];
  let cursor = 0;
  while (cursor < bytes.length) {
    if (bytes[cursor] === 0x0a) {
      cursor++;
      continue;
    }
    const separator = colon(bytes, cursor);
    const id = decoder.decode(bytes.subarray(cursor, separator));
    if (!/^[0-9a-f]*$/.test(id)) throw new TypeError(`Unknown React Flight record id: ${id}`);
    cursor = separator + 1;
    const marker = bytes[cursor];
    if (marker === undefined) throw new TypeError("React Flight record has no payload");
    if (marker === 0x54) {
      let comma = cursor + 1;
      while (comma < bytes.length && bytes[comma] !== 0x2c) comma++;
      if (comma === bytes.length) throw new TypeError("React Flight text record has no length terminator");
      const hexadecimalLength = decoder.decode(bytes.subarray(cursor + 1, comma));
      if (!/^[0-9a-f]+$/.test(hexadecimalLength)) throw new TypeError("React Flight text record has an invalid length");
      const length = Number.parseInt(hexadecimalLength, 16);
      const end = comma + 1 + length;
      if (end > bytes.length) throw new TypeError("React Flight text record is truncated");
      records.push({ id, kind: "text", value: decoder.decode(bytes.subarray(comma + 1, end)) });
      cursor = end;
      continue;
    }
    const end = lineEnd(bytes, cursor);
    const payload = decoder.decode(bytes.subarray(cursor, end));
    const discriminator = payload[0];
    if (discriminator === "H") records.push({ id, kind: "hint", value: payload.slice(1) });
    else if (discriminator === "I") records.push({ id, kind: "import", value: parseJson(payload.slice(1)) });
    else if (discriminator !== undefined && '[{"n'.includes(discriminator)) {
      records.push({ id, kind: "json", value: parseJson(payload) });
    } else {
      throw new TypeError(`Unknown React Flight record type: ${discriminator ?? "empty"}`);
    }
    cursor = end + 1;
  }
  return records;
}

function reference(records: ReadonlyMap<string, unknown>, value: string): unknown {
  if (value === "$") return value;
  if (value === "$undefined") return undefined;
  if (value.startsWith("$$")) return value.slice(1);
  const match = /^\$([0-9a-f]+)(?::(.*))?$/.exec(value);
  if (!match) throw new TypeError(`Unsupported React Flight reference: ${value}`);
  let resolved = records.get(match[1]!);
  if (resolved === undefined && !records.has(match[1]!)) {
    throw new TypeError(`React Flight reference targets missing record: ${match[1]}`);
  }
  for (const component of match[2]?.split(":") ?? []) {
    while (typeof resolved === "string" && resolved.startsWith("$") && resolved !== value) {
      resolved = reference(records, resolved);
    }
    if (!resolved || typeof resolved !== "object") {
      throw new TypeError(`React Flight reference has invalid path: ${value}`);
    }
    resolved = Array.isArray(resolved) && resolved[0] === "$" && component === "props"
      ? resolved[3]
      : (resolved as Record<string, unknown>)[component];
  }
  return resolved;
}

/** Resolves record and path references inside a provider-specific Flight value. */
export function resolveReactFlightValue(records: readonly ReactFlightRecord[], value: unknown): unknown {
  const indexed = new Map(records.map((record) => [record.id, record.value]));
  const active = new Set<unknown>();
  const resolve = (current: unknown): unknown => {
    if (typeof current === "string" && current.startsWith("$$")) return current.slice(1);
    if (typeof current === "string" && current.startsWith("$") && current !== "$") {
      return resolve(reference(indexed, current));
    }
    if (!current || typeof current !== "object") return current;
    if (active.has(current)) throw new TypeError("React Flight reference graph contains a cycle");
    active.add(current);
    const result = Array.isArray(current)
      ? current.map(resolve)
      : Object.fromEntries(Object.entries(current).map(([key, item]) => [key, resolve(item)]));
    active.delete(current);
    return result;
  };
  return resolve(value);
}
