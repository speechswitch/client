export const sourceFormats = [
  "openapi",
  "asyncapi",
  "json-schema",
  "discovery",
  "botocore-service-model",
  "typespec",
  "embedded-json-schema",
  "llms-txt",
  "markdown",
  "source-code",
] as const;

export type SourceFormat = (typeof sourceFormats)[number];

export interface Source {
  readonly provider: string;
  readonly name: string;
  readonly format: SourceFormat;
  readonly path: string;
  readonly url: string;
  readonly sha256: string;
  readonly method?: "GET" | "POST";
  readonly body?: string;
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

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value) throw new TypeError(`${name} is required`);
  return value;
}

export function parseCatalog(value: unknown): Catalog {
  if (!isRecord(value)) throw new TypeError("Catalog must be an object");
  exactKeys(value, ["sources"], "Catalog");
  if (!Array.isArray(value.sources)) throw new TypeError("Catalog sources must be an array");
  const ids = new Set<string>();
  const sources = value.sources.map((source, index): Source => {
    if (!isRecord(source)) throw new TypeError(`Catalog source ${index} must be an object`);
    exactKeys(source, ["provider", "name", "format", "path", "url", "sha256", "method", "body"], `Catalog source ${index}`);
    if (source.method !== undefined && source.method !== "GET" && source.method !== "POST") {
      throw new TypeError(`Catalog source ${index} has an unsupported method`);
    }
    if (source.body !== undefined && (source.method !== "POST" || typeof source.body !== "string")) {
      throw new TypeError(`Catalog source ${index} body requires POST and a string payload`);
    }
    const provider = requiredString(source.provider, `Catalog source ${index} provider`);
    const name = requiredString(source.name, `Catalog source ${index} name`);
    const sourcePath = requiredString(source.path, `Catalog source ${index} path`);
    const url = requiredString(source.url, `Catalog source ${index} url`);
    const sha256 = requiredString(source.sha256, `Catalog source ${index} sha256`);
    if (!/^[a-f0-9]{64}$/.test(sha256)) throw new TypeError(`Catalog source ${index} has an invalid sha256`);
    if (typeof source.format !== "string" || !(sourceFormats as readonly string[]).includes(source.format)) {
      throw new TypeError(`Catalog source ${index} has an unsupported format`);
    }
    const id = `${provider}/${name}`;
    if (ids.has(id)) throw new TypeError(`Duplicate source: ${id}`);
    ids.add(id);
    return {
      provider,
      name,
      format: source.format as SourceFormat,
      path: sourcePath,
      url,
      sha256,
      ...(source.method === undefined ? {} : { method: source.method }),
      ...(source.body === undefined ? {} : { body: source.body as string }),
    };
  });
  return { sources };
}
