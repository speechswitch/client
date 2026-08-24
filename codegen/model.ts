import type { SecurityScheme } from "../sdk/http.ts";

export type HttpResponseKind = "json" | "bytes" | "byte-stream";

export interface HttpOperationModel {
  readonly name: string;
  readonly method: string;
  readonly path: string;
  readonly inputType?: string;
  readonly outputType?: string;
  readonly contentType?: string;
  readonly responseKind: HttpResponseKind;
  readonly security?: readonly SecurityScheme[];
}

export interface HttpClientModel {
  readonly baseUrl: string;
  readonly operations: readonly HttpOperationModel[];
}

export interface WebSocketClientModel {
  readonly url: string;
  readonly parametersType?: string;
  readonly clientMessageType?: string;
  readonly serverMessageType?: string;
}
