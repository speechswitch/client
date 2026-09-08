import type { ClientHttp2Session, ClientHttp2Stream, IncomingHttpHeaders, IncomingHttpStatusHeader } from "node:http2";

export interface GrpcOptions {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly signal: AbortSignal;
}
/** An injectable byte-native gRPC stream; generated codecs live above this boundary. */
export interface GrpcDuplex {
  readonly responses: AsyncIterable<Uint8Array>;
  write(message: Uint8Array): Promise<void>;
  end(): void;
  close(): void;
}
export type GrpcConnect = (options: GrpcOptions) => Promise<GrpcDuplex>;

export class GrpcError extends Error {
  readonly statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message); this.name = "GrpcError"; this.statusCode = statusCode;
  }
}

/** HTTP/2 is a native Node dependency; browser consumers inject a gRPC transport. */
export async function connectGrpc(options: GrpcOptions): Promise<GrpcDuplex> {
  options.signal.throwIfAborted();
  if (typeof process === "undefined" || !process.versions?.node) throw new TypeError("Native gRPC requires Node or Bun; inject a gRPC transport in browsers");
  // Keep the Node builtin out of browser bundles and load it only for native gRPC.
  const moduleName = "node:http2";
  const http2: typeof import("node:http2") = await import(moduleName);
  options.signal.throwIfAborted();
  const url = new URL(options.url);
  const session: ClientHttp2Session = http2.connect(url.origin);
  let stream: ClientHttp2Stream;
  try {
    stream = session.request({ ...options.headers, ":method": "POST", ":path": url.pathname + url.search,
      "content-type": "application/grpc", "te": "trailers", "grpc-accept-encoding": "identity" });
  } catch (error) { session.destroy(); throw error; }
  let closed = false; let ended = false; let failure: unknown;
  let trailers: IncomingHttpHeaders | undefined;
  let resolveHeaders!: (headers: IncomingHttpHeaders & IncomingHttpStatusHeader) => void; let rejectHeaders!: (error: unknown) => void;
  const headers = new Promise<IncomingHttpHeaders & IncomingHttpStatusHeader>((resolve, reject) => { resolveHeaders = resolve; rejectHeaders = reject; });
  // A producer may fail before the consumer starts reading response headers.
  void headers.catch(() => {});
  const fail = (error: unknown) => { failure = error; rejectHeaders(error); stream.destroy(error instanceof Error ? error : new Error(String(error))); };
  session.on("error", fail);
  stream.on("error", error => { failure = error; rejectHeaders(error); });
  stream.on("response", response => { resolveHeaders(response); if (response["grpc-status"] !== undefined) trailers = response; });
  stream.on("trailers", value => { trailers = value; });
  stream.on("close", () => { if (!trailers) rejectHeaders(failure ?? new TypeError("gRPC closed before response headers")); });
  const abort = () => { fail(options.signal.reason); session.destroy(); };
  options.signal.addEventListener("abort", abort, { once: true });
  if (options.signal.aborted) abort();
  const close = () => {
    if (closed) return; closed = true;
    options.signal.removeEventListener("abort", abort);
    rejectHeaders(new TypeError("gRPC stream is closed"));
    stream.close(http2.constants.NGHTTP2_CANCEL); session.destroy();
  };
  const responses = (async function* (): AsyncIterableIterator<Uint8Array> {
    try {
      const response = await headers;
      options.signal.throwIfAborted();
      if (response[":status"] !== 200) throw new TypeError(`gRPC returned HTTP ${String(response[":status"])}`);
      const contentType = response["content-type"];
      if (typeof contentType !== "string" || !/^application\/grpc(?:\+proto)?(?:;|$)/.test(contentType)) throw new TypeError("gRPC returned an invalid content type");
      let pending = new Uint8Array(0);
      for await (const chunk of stream) {
        options.signal.throwIfAborted();
        if (!(chunk instanceof Uint8Array)) throw new TypeError("gRPC returned non-binary data");
        const combined = new Uint8Array(pending.length + chunk.length); combined.set(pending); combined.set(chunk, pending.length);
        pending = combined;
        while (pending.length >= 5) {
          if (pending[0] !== 0) throw new TypeError("Compressed gRPC messages are not supported");
          const size = new DataView(pending.buffer, pending.byteOffset, 5).getUint32(1);
          if (size > 64 * 1024 * 1024) throw new TypeError("gRPC message exceeds 64 MiB");
          if (pending.length < 5 + size) break;
          yield pending.subarray(5, 5 + size);
          pending = pending.subarray(5 + size);
        }
      }
      options.signal.throwIfAborted();
      if (pending.length) throw new TypeError("Truncated gRPC message");
      const status = trailers?.["grpc-status"];
      if (typeof status !== "string" || !/^\d+$/.test(status) || Number(status) > 16) throw new TypeError("gRPC response lacks a valid final status");
      if (status !== "0") {
        const message = trailers?.["grpc-message"];
        let decoded = typeof message === "string" ? message : `gRPC failed with status ${status}`;
        try { decoded = decodeURIComponent(decoded); } catch {}
        throw new GrpcError(Number(status), decoded);
      }
    } finally { close(); }
  })();
  return {
    responses,
    write: async message => {
      options.signal.throwIfAborted();
      if (failure !== undefined) throw failure;
      if (closed || ended) throw new TypeError("gRPC input is closed");
      if (message.byteLength > 64 * 1024 * 1024) throw new TypeError("gRPC message exceeds 64 MiB");
      const frame = new Uint8Array(message.byteLength + 5);
      new DataView(frame.buffer).setUint32(1, message.byteLength); frame.set(message, 5);
      await new Promise<void>((resolve, reject) => { stream.write(frame, error => error ? reject(error) : resolve()); });
    },
    end: () => { if (closed || ended) return; ended = true; stream.end(); },
    close,
  };
}
