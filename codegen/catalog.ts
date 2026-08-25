export const sourceFormats = [
  "openapi",
  "asyncapi",
  "json-schema",
  "discovery",
  "service-model",
  "typespec",
] as const;

export type SourceFormat = (typeof sourceFormats)[number];

export interface Source {
  readonly id: string;
  readonly format: SourceFormat;
  readonly path: string;
}

export interface Catalog {
  readonly sources: readonly Source[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], name: string): void {
  const unknown = Object.keys(value).find((key) => !expected.includes(key));
  if (unknown) throw new TypeError(`${name} contains unknown field: ${unknown}`);
}

export function parseCatalog(value: unknown): Catalog {
  if (!isRecord(value)) throw new TypeError("Catalog must be an object");
  exactKeys(value, ["sources"], "Catalog");
  if (!Array.isArray(value.sources)) throw new TypeError("Catalog sources must be an array");
  const ids = new Set<string>();
  const sources = value.sources.map((source, index): Source => {
    if (!isRecord(source)) throw new TypeError(`Catalog source ${index} must be an object`);
    exactKeys(source, ["id", "format", "path"], `Catalog source ${index}`);
    if (typeof source.id !== "string" || !source.id) throw new TypeError(`Catalog source ${index} requires an id`);
    if (typeof source.path !== "string" || !source.path) throw new TypeError(`Catalog source ${index} requires a path`);
    if (typeof source.format !== "string" || !(sourceFormats as readonly string[]).includes(source.format)) {
      throw new TypeError(`Catalog source ${index} has an unsupported format`);
    }
    if (ids.has(source.id)) throw new TypeError(`Duplicate source id: ${source.id}`);
    ids.add(source.id);
    return { id: source.id, format: source.format as SourceFormat, path: source.path };
  });
  return { sources };
}
