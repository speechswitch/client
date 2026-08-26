import { createHash, createHmac } from "node:crypto";
import type { Fetch } from "../../fetch.ts";

export interface AwsCredentials {
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly sessionToken?: string;
}

export interface AwsSigV4Options extends AwsCredentials {
  readonly region: string;
  readonly service: string;
  readonly fetch: Fetch;
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

export function createAwsSigV4Fetch(options: AwsSigV4Options): Fetch {
  return async (input, init): Promise<Response> => {
    const request = input instanceof Request
      ? new Request(input, init)
      : new Request(input instanceof URL ? input.href : input, init);
    const url = new URL(request.url);
    const body = request.body ? new Uint8Array(await request.clone().arrayBuffer()) : new Uint8Array();
    const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
    const shortDate = amzDate.slice(0, 8);
    const payloadHash = hash(body);
    const headers = new Headers(request.headers);
    headers.set("x-amz-content-sha256", payloadHash);
    headers.set("x-amz-date", amzDate);
    if (options.sessionToken) headers.set("x-amz-security-token", options.sessionToken);

    const signedHeaderNames = [
      ...(headers.has("content-type") ? ["content-type"] : []),
      "host",
      "x-amz-content-sha256",
      "x-amz-date",
      ...(options.sessionToken ? ["x-amz-security-token"] : []),
    ];
    const canonicalHeaders = signedHeaderNames.map((name) => {
      const value = name === "host" ? url.host : headers.get(name)!;
      return `${name}:${value.trim().replace(/\s+/g, " ")}\n`;
    }).join("");
    const canonicalRequest = [
      request.method.toUpperCase(),
      url.pathname || "/",
      canonicalQuery(url),
      canonicalHeaders,
      signedHeaderNames.join(";"),
      payloadHash,
    ].join("\n");
    const scope = `${shortDate}/${options.region}/${options.service}/aws4_request`;
    const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, hash(canonicalRequest)].join("\n");
    const signature = createHmac("sha256", signingKey(
      options.secretAccessKey,
      shortDate,
      options.region,
      options.service,
    )).update(stringToSign).digest("hex");
    headers.set("authorization", [
      `AWS4-HMAC-SHA256 Credential=${options.accessKeyId}/${scope}`,
      `SignedHeaders=${signedHeaderNames.join(";")}`,
      `Signature=${signature}`,
    ].join(", "));

    return options.fetch(url, {
      method: request.method,
      headers,
      body: body.byteLength ? body : undefined,
      signal: request.signal,
    });
  };
}
