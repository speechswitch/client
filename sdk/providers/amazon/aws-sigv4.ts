import { createHash, createHmac } from "node:crypto";
import type { Fetch } from "../../fetch.ts";

export interface AwsCredentials {
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly sessionToken?: string;
}

interface AwsSigningOptions extends AwsCredentials {
  readonly region: string;
  readonly service: string;
}

export interface AwsSigV4Options extends AwsSigningOptions {
  readonly fetch: Fetch;
}

export interface AwsRequestSignature {
  readonly headers: Readonly<Record<string, string>>;
  readonly signature: string;
}

const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const hmac = (key: string | Buffer, value: string) => createHmac("sha256", key).update(value).digest();
const encode = (value: string) => encodeURIComponent(value).replace(/[!'()*]/g, (character) =>
  `%${character.charCodeAt(0).toString(16).toUpperCase()}`
);

function canonicalQuery(url: URL): string {
  return [...url.searchParams.entries()]
    .map(([key, value]) => [encode(key), encode(value)] as const)
    .sort(([leftKey, leftValue], [rightKey, rightValue]) =>
      leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue)
    )
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
}

function signingKey(secret: string, date: string, region: string, service: string): Buffer {
  const dateKey = hmac(`AWS4${secret}`, date);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, service);
  return hmac(serviceKey, "aws4_request");
}

function timestamp(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

export function signAwsRequest(
  method: string,
  url: URL,
  headers: Readonly<Record<string, string>>,
  payloadHash: string,
  options: AwsSigningOptions,
  date = new Date(),
): AwsRequestSignature {
  const amzDate = timestamp(date);
  const shortDate = amzDate.slice(0, 8);
  const canonicalHeaders = {
    ...Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value.trim().replace(/\s+/g, " ")])),
    host: url.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    ...(options.sessionToken ? { "x-amz-security-token": options.sessionToken } : {}),
  };
  const signedHeaderNames = Object.keys(canonicalHeaders).sort();
  const canonicalRequest = [
    method.toUpperCase(),
    url.pathname || "/",
    canonicalQuery(url),
    signedHeaderNames.map((name) => `${name}:${canonicalHeaders[name as keyof typeof canonicalHeaders]}\n`).join(""),
    signedHeaderNames.join(";"),
    payloadHash,
  ].join("\n");
  const scope = `${shortDate}/${options.region}/${options.service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, hash(canonicalRequest)].join("\n");
  const signature = createHmac(
    "sha256",
    signingKey(options.secretAccessKey, shortDate, options.region, options.service),
  ).update(stringToSign).digest("hex");
  return {
    signature,
    headers: {
      ...canonicalHeaders,
      authorization: [
        `AWS4-HMAC-SHA256 Credential=${options.accessKeyId}/${scope}`,
        `SignedHeaders=${signedHeaderNames.join(";")}`,
        `Signature=${signature}`,
      ].join(", "),
    },
  };
}

export function signAwsEvent(
  headers: Uint8Array,
  payload: Uint8Array,
  priorSignature: string,
  options: AwsSigningOptions,
  date: Date,
): string {
  const amzDate = timestamp(date);
  const shortDate = amzDate.slice(0, 8);
  const scope = `${shortDate}/${options.region}/${options.service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256-PAYLOAD",
    amzDate,
    scope,
    priorSignature,
    hash(headers),
    hash(payload),
  ].join("\n");
  return createHmac(
    "sha256",
    signingKey(options.secretAccessKey, shortDate, options.region, options.service),
  ).update(stringToSign).digest("hex");
}

export function createAwsSigV4Fetch(options: AwsSigV4Options): Fetch {
  return async (input, init): Promise<Response> => {
    const request = input instanceof Request
      ? new Request(input, init)
      : new Request(input instanceof URL ? input.href : input, init);
    const url = new URL(request.url);
    const body = request.body ? new Uint8Array(await request.clone().arrayBuffer()) : new Uint8Array();
    const headers = Object.fromEntries(new Headers(request.headers));
    const signed = signAwsRequest(request.method, url, headers, hash(body), options);
    const outgoing = new Headers(signed.headers);
    outgoing.delete("host");
    return options.fetch(url, {
      method: request.method,
      headers: outgoing,
      body: body.byteLength ? body : undefined,
      signal: request.signal,
    });
  };
}
