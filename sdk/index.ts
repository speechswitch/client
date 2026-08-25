export type { Auth } from "./auth.ts";
export { requireAuth } from "./auth.ts";
export { synthesize, synthesizeStreaming, synthesizeStreamingWithTimestamps, synthesizeWithTimestamps } from "./dispatch.ts";
export type { Operation, Provider } from "./dispatch.ts";
export { decodeBase64, encodeBase64 } from "./base64.ts";
export { request, requestBytes, streamBytes } from "./http.ts";
export type {
  BasicCredentials,
  ByteStream,
  Credential,
  Fetch,
  HttpOptions,
  HttpRequest,
  HttpResult,
  SecurityScheme,
} from "./http.ts";
export { HttpError } from "./http.ts";
export { connectWebSocket } from "./websocket.ts";
export type {
  WebSocketData,
  WebSocketDecoder,
  WebSocketEncoder,
  WebSocketFactory,
  WebSocketLike,
  WebSocketOptions,
} from "./websocket.ts";
export type { StreamingText, TtsRequest, TtsRequestBase } from "../schemas/tts.ts";
export { textChunks } from "./text.ts";
export type {
  SynthesisEnvelope,
  SynthesisResult,
  Timestamp,
  TimestampCorrelation,
  TimestampKind,
} from "./timestamps.ts";
