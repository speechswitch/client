export interface GoogleDiscoverySchema {
  readonly $ref?: string;
  readonly type?: string;
  readonly format?: string;
  readonly enum?: readonly string[];
  readonly items?: GoogleDiscoverySchema;
  readonly properties?: Readonly<Record<string, GoogleDiscoverySchema>>;
  readonly required?: readonly string[];
  readonly additionalProperties?: GoogleDiscoverySchema;
  readonly description?: string;
}
interface Method {
  readonly httpMethod: string;
  readonly path: string;
  readonly request?: GoogleDiscoverySchema;
  readonly response: GoogleDiscoverySchema;
  readonly parameters?: Readonly<Record<string, Parameter>>;
  readonly supportsMediaDownload?: boolean;
  readonly supportsMediaUpload?: boolean;
}
interface Parameter {
  readonly type: string;
  readonly enum?: readonly string[];
  readonly location: string;
  readonly required?: boolean;
}
interface Resource { readonly methods?: Readonly<Record<string, Method>>; readonly resources?: Readonly<Record<string, Resource>> }
interface Discovery extends Resource { readonly schemas: Readonly<Record<string, GoogleDiscoverySchema>>; readonly rootUrl: string }

/** Select the same cataloged REST operations for every language target. */
export function parseGoogleDiscovery(raw: unknown) {
  if (!raw || typeof raw !== "object" || !("schemas" in raw) || !("resources" in raw)) throw new TypeError("Invalid Google Discovery document");
  const document = raw as Discovery;
  if (typeof document.rootUrl !== "string" || !URL.canParse(document.rootUrl)) throw new TypeError("Invalid Google Discovery root URL");
  const methods = [{ resource: "text", method: "synthesize", name: "synthesizeSpeech" }, { resource: "voices", method: "list", name: "listVoices" }].map(selection => {
    const method = document.resources?.[selection.resource]?.methods?.[selection.method];
    if (!method) throw new TypeError(`Missing Google Discovery method: ${selection.resource}.${selection.method}`);
    if (method.supportsMediaDownload || method.supportsMediaUpload) throw new TypeError("Google TTS media semantics require a generator update");
    if (!/^[A-Za-z0-9/_.:-]+$/.test(method.path) || !["GET", "POST"].includes(method.httpMethod)) throw new TypeError("Unsupported Google Discovery method transport");
    for (const [name, field] of Object.entries(method.parameters ?? {})) {
      if (field.location !== "query" || !["string", "boolean", "integer", "number"].includes(field.type ?? "")) throw new TypeError(`Unsupported Google Discovery parameter: ${name}`);
      if (method.request) throw new TypeError("Google Discovery body plus query requires an explicit generated input shape");
    }
    return { ...selection, wire: method };
  });
  return { document, methods };
}

/** Resolve the selected Discovery method/schema graphs into concrete REST code. */
export function renderGoogleDiscovery(raw: unknown, sourceUrl: string): string {
  const { document, methods } = parseGoogleDiscovery(raw);
  const referenced = new Set<string>();
  const schema = (value: GoogleDiscoverySchema): string => {
    if (value.$ref) {
      if (!/^[A-Za-z][A-Za-z0-9]*$/.test(value.$ref) || !document.schemas[value.$ref]) throw new TypeError(`Unresolved Google Discovery reference: ${value.$ref}`);
      referenced.add(value.$ref); return value.$ref;
    }
    if (value.enum) {
      if (!value.enum.length || !value.enum.every(item => typeof item === "string")) throw new TypeError("Invalid Google Discovery enum");
      return value.enum.map(item => JSON.stringify(item)).join(" | ");
    }
    switch (value.type) {
      case "string": return "string";
      case "boolean": return "boolean";
      case "integer": case "number": return "number";
      case "array":
        if (!value.items) throw new TypeError("Google Discovery array lacks item schema");
        return `readonly (${schema(value.items)})[]`;
      case "object": {
        if (value.additionalProperties) {
          if (value.properties) throw new TypeError("Google Discovery mixed map/object schemas need explicit support");
          return `Readonly<Record<string, ${schema(value.additionalProperties)}>>`;
        }
        if (!value.properties) throw new TypeError("Google Discovery object lacks properties");
        return `{\n${Object.entries(value.properties).sort(([a], [b]) => a.localeCompare(b)).map(([name, field]) => `  readonly ${JSON.stringify(name)}${value.required?.includes(name) ? "" : "?"}: ${schema(field)};`).join("\n")}\n}`;
      }
      default: throw new TypeError(`Unsupported Google Discovery type: ${value.type}`);
    }
  };
  for (const method of methods) {
    if (method.wire.request) schema(method.wire.request);
    schema(method.wire.response);
  }
  const declarations: string[] = [];
  for (const name of referenced) declarations.push(`export type ${name} = ${schema(document.schemas[name]!)};\n`);
  const out = [
    `// Generated from ${sourceUrl}. Do not edit.`,
    'import type { Fetch } from "../../runtime/fetch.ts";', "",
    ...declarations,
    "export interface ClientOptions {",
    "  readonly fetch: Fetch;",
    "  readonly baseUrl: string;",
    "  readonly headers: Readonly<Record<string, string>>;",
    "  readonly signal: AbortSignal;",
    "}", "",
    `export const defaultBaseUrl = ${JSON.stringify(document.rootUrl)};`, "",
  ];
  for (const method of methods) {
    const parameters = Object.entries(method.wire.parameters ?? {}).sort(([a], [b]) => a.localeCompare(b));
    const input = method.wire.request ? schema(method.wire.request) : `{ ${parameters.map(([name, field]) => `readonly ${JSON.stringify(name)}${field.required ? "" : "?"}: ${schema({ type: field.type, enum: field.enum })};`).join(" ")} }`;
    out.push(`export function ${method.name}(input: ${input}, options: ClientOptions): Promise<Response> {`, "  const url = new URL(options.baseUrl);", `  url.pathname = (url.pathname.endsWith("/") ? url.pathname.slice(0, -1) : url.pathname) + ${JSON.stringify("/" + method.wire.path)};`);
    for (const [name, field] of parameters) {
      if (field.required) out.push(`  if (input[${JSON.stringify(name)}] === undefined) throw new TypeError(${JSON.stringify(`Missing Google query parameter: ${name}`)});`);
      out.push(`  if (input[${JSON.stringify(name)}] !== undefined) url.searchParams.set(${JSON.stringify(name)}, String(input[${JSON.stringify(name)}]));`);
    }
    out.push("  return options.fetch(url, {", `    method: ${JSON.stringify(method.wire.httpMethod)},`, `    headers: ${method.wire.request ? '{ ...options.headers, "content-type": "application/json" }' : "options.headers"},`, ...(method.wire.request ? ["    body: JSON.stringify(input),"] : []), "    signal: options.signal,", "  });", "}", "");
  }
  return out.join("\n");
}
