export type Fetch = (input: URL | RequestInfo, init?: RequestInit) => Promise<Response>;
export type Credential = string | (() => string | Promise<string>);

export type SecurityScheme =
  | { readonly kind: "bearer"; readonly name: string }
  | { readonly kind: "basic"; readonly name: string }
  | {
      readonly kind: "apiKey";
      readonly name: string;
      readonly location: "header" | "query" | "cookie";
      readonly parameterName: string;
    };

export interface BasicCredentials {
  readonly username: string;
  readonly password: string;
}

export interface HttpOptions {
  readonly baseUrl: string;
  readonly fetch?: Fetch;
  readonly headers?: HeadersInit | (() => HeadersInit | Promise<HeadersInit>);
  readonly signal?: AbortSignal;
  readonly auth?: Readonly<Record<string, Credential | BasicCredentials>>;
}

export interface HttpRequest {
  readonly method: string;
  readonly path: string;
  readonly pathParameters?: Readonly<Record<string, unknown>>;
  readonly query?: Readonly<Record<string, unknown>>;
  readonly headers?: HeadersInit;
  readonly body?: unknown;
  readonly contentType?: string;
  readonly security?: readonly SecurityScheme[];
  readonly signal?: AbortSignal;
}

export interface HttpResult<Data> {
  readonly data: Data;
  readonly response: Response;
}

export interface ByteStream {
  readonly response: Response;
  readonly bytes: AsyncIterableIterator<Uint8Array>;
}

export class HttpError<Data = unknown> extends Error {
  override readonly name = "HttpError";

  constructor(readonly response: Response, readonly data: Data) {
    super(`HTTP ${response.status} ${response.statusText}`);
  }
}

function appendValues(target: URLSearchParams, values: Readonly<Record<string, unknown>>): void {
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined || value === null) continue;
    for (const item of Array.isArray(value) ? value : [value]) target.append(name, String(item));
  }
}

async function credential(value: Credential | BasicCredentials): Promise<string | BasicCredentials> {
  return typeof value === "function" ? value() : value;
}

async function applySecurity(
  url: URL,
  headers: Headers,
  schemes: readonly SecurityScheme[],
  auth: HttpOptions["auth"],
): Promise<void> {
  for (const scheme of schemes) {
    const configured = auth?.[scheme.name];
    if (configured === undefined) continue;
    const value = await credential(configured);
    if (scheme.kind === "basic") {
      if (typeof value === "string") throw new TypeError(`${scheme.name} requires basic credentials`);
      headers.set("authorization", `Basic ${encodeBase64(`${value.username}:${value.password}`)}`);
      continue;
    }
    if (typeof value !== "string") throw new TypeError(`${scheme.name} requires a string credential`);
    if (scheme.kind === "bearer") headers.set("authorization", `Bearer ${value}`);
    else if (scheme.location === "header") headers.set(scheme.parameterName, value);
    else if (scheme.location === "query") url.searchParams.set(scheme.parameterName, value);
    else headers.set("cookie", `${headers.get("cookie") ? `${headers.get("cookie")}; ` : ""}${scheme.parameterName}=${encodeURIComponent(value)}`);
  }
}

function encodeBase64(value: string): string {
  if (typeof Buffer !== "undefined") return Buffer.from(value).toString("base64");
  return btoa(value);
}

function encodeBody(body: unknown, contentType: string | undefined, headers: Headers): BodyInit | undefined {
  if (body === undefined) return undefined;
  if (typeof body === "string" || body instanceof Blob || body instanceof FormData || body instanceof URLSearchParams || body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
    return body as BodyInit;
  }
  headers.set("content-type", contentType ?? "application/json");
  return JSON.stringify(body);
}

async function prepare(options: HttpOptions, request: HttpRequest): Promise<[URL, RequestInit]> {
  let path = request.path;
  for (const [name, value] of Object.entries(request.pathParameters ?? {})) {
    path = path.replaceAll(`{${name}}`, encodeURIComponent(String(value)));
  }
  if (/\{[^}]+\}/.test(path)) throw new TypeError(`Missing path parameter for ${path}`);
  const url = new URL(path, options.baseUrl.endsWith("/") ? options.baseUrl : `${options.baseUrl}/`);
  appendValues(url.searchParams, request.query ?? {});
  const defaults = typeof options.headers === "function" ? await options.headers() : options.headers;
  const headers = new Headers(defaults);
  new Headers(request.headers).forEach((value, name) => headers.set(name, value));
  await applySecurity(url, headers, request.security ?? [], options.auth);
  return [url, {
    method: request.method,
    headers,
    body: encodeBody(request.body, request.contentType, headers),
    signal: request.signal ?? options.signal,
  }];
}

async function decode(response: Response): Promise<unknown> {
  if (response.status === 204 || response.status === 205) return undefined;
  const type = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (type === "application/json" || type?.endsWith("+json")) return response.json();
  if (type?.startsWith("text/") || type === "application/xml") return response.text();
  return new Uint8Array(await response.arrayBuffer());
}

async function execute(options: HttpOptions, request: HttpRequest): Promise<Response> {
  const [url, init] = await prepare(options, request);
  return (options.fetch ?? globalThis.fetch)(url, init);
}

export async function request<Data = unknown>(options: HttpOptions, input: HttpRequest): Promise<HttpResult<Data>> {
  const response = await execute(options, input);
  const data = await decode(response) as Data;
  if (!response.ok) throw new HttpError(response, data);
  return { data, response };
}

export async function requestBytes(options: HttpOptions, input: HttpRequest): Promise<HttpResult<Uint8Array>> {
  const response = await execute(options, input);
  const data = new Uint8Array(await response.arrayBuffer());
  if (!response.ok) throw new HttpError(response, data);
  return { data, response };
}

async function* chunks(stream: ReadableStream<Uint8Array>): AsyncIterableIterator<Uint8Array> {
  const reader = stream.getReader();
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) return;
      if (next.value.byteLength) yield next.value;
    }
  } finally {
    reader.releaseLock();
  }
}

export async function streamBytes(options: HttpOptions, input: HttpRequest): Promise<ByteStream> {
  const response = await execute(options, input);
  if (!response.ok) throw new HttpError(response, await decode(response));
  if (!response.body) throw new TypeError("Response has no body stream");
  return { response, bytes: chunks(response.body) };
}
