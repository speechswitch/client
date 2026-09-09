import type { Auth } from "./auth.ts";
import type { Fetch } from "./runtime/fetch.ts";
import type { AwsEventStreamClient } from "./runtime/aws/event-stream.ts";
import type { WebSocketLike } from "./websocket.ts";

export interface ProviderOptions {
  readonly auth?: Auth;
  readonly fetch?: Fetch;
  /** Authenticated socket override. */
  readonly webSocket?: WebSocketLike;
  readonly eventStream?: AwsEventStreamClient;
  readonly baseUrl?: string;
  readonly webSocketUrl?: string;
  readonly signal?: AbortSignal;
}
