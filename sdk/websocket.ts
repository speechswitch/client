export interface WebSocketLike {
  readonly readyState: number;
  binaryType: string;
  send(data: string | ArrayBuffer | ArrayBufferView | Blob): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: "open", listener: () => void): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  addEventListener(type: "error" | "close", listener: (event: unknown) => void): void;
  removeEventListener(type: "open" | "error" | "close", listener: (event: unknown) => void): void;
}

export type WebSocketFactory = (url: string, protocols?: string | string[]) => WebSocketLike;
export type WebSocketData = string | ArrayBuffer | ArrayBufferView | Blob;
export type WebSocketEncoder<Message> = (message: Message) => WebSocketData;
export type WebSocketDecoder<Message> = (data: unknown) => Message;

export interface WebSocketOptions<ClientMessage, ServerMessage, Parameters> {
  readonly url: string;
  readonly encode: WebSocketEncoder<ClientMessage>;
  readonly decode: WebSocketDecoder<ServerMessage>;
  readonly parameters?: Parameters;
  readonly protocols?: string | string[];
  readonly webSocket?: WebSocketFactory;
}

function resolveUrl(url: string, parameters: unknown): string {
  let result = url;
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries((parameters ?? {}) as Record<string, unknown>)) {
    if (value === undefined || value === null) continue;
    if (result.includes(`{${name}}`)) result = result.replaceAll(`{${name}}`, encodeURIComponent(String(value)));
    else query.set(name, String(value));
  }
  if (/\{[^}]+\}/.test(result)) throw new TypeError(`Missing WebSocket path parameter for ${result}`);
  const parsed = new URL(result);
  query.forEach((value, name) => parsed.searchParams.set(name, value));
  return parsed.toString();
}

export async function connectWebSocket<ClientMessage, ServerMessage, Parameters = never>(
  options: WebSocketOptions<ClientMessage, ServerMessage, Parameters>,
) {
  const create = options.webSocket ?? ((url: string, protocols?: string | string[]) => new WebSocket(url, protocols) as WebSocketLike);
  const socket = create(resolveUrl(options.url, options.parameters), options.protocols);
  socket.binaryType = "arraybuffer";

  const queue: ServerMessage[] = [];
  const waiting: Array<{
    resolve: (value: IteratorResult<ServerMessage>) => void;
    reject: (error: unknown) => void;
  }> = [];
  let closed = false;
  let failed = false;
  let failure: unknown;

  const reject = (error: unknown) => {
    failed = true;
    failure = error;
    for (const waiter of waiting.splice(0)) waiter.reject(error);
  };

  socket.addEventListener("message", (event) => {
    if (closed || failed) return;
    let message: ServerMessage;
    try {
      message = options.decode(event.data);
    } catch (error) {
      reject(error);
      socket.close(1003, "Unable to decode message");
      return;
    }
    const waiter = waiting.shift();
    waiter ? waiter.resolve({ value: message, done: false }) : queue.push(message);
  });
  socket.addEventListener("error", reject);
  socket.addEventListener("close", () => {
    closed = true;
    for (const waiter of waiting.splice(0)) waiter.resolve({ value: undefined, done: true });
  });

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      socket.removeEventListener("open", onOpen);
      socket.removeEventListener("error", onError);
      socket.removeEventListener("close", onClose);
      error ? reject(error) : resolve();
    };
    const onOpen = () => finish();
    const onError = (event: unknown) => finish(new TypeError("WebSocket failed to open", { cause: event }));
    const onClose = (event: unknown) => finish(new TypeError("WebSocket closed before opening", { cause: event }));
    socket.addEventListener("open", onOpen);
    socket.addEventListener("error", onError);
    socket.addEventListener("close", onClose);
  });

  const messages: AsyncIterableIterator<ServerMessage> = {
    next(): Promise<IteratorResult<ServerMessage>> {
      if (queue.length) return Promise.resolve({ value: queue.shift()!, done: false });
      if (failed) return Promise.reject(failure);
      if (closed) return Promise.resolve({ value: undefined, done: true });
      return new Promise((resolve, reject) => waiting.push({ resolve, reject }));
    },
    [Symbol.asyncIterator]() {
      return this;
    },
  };

  return {
    socket,
    messages,
    send(message: ClientMessage): void {
      socket.send(options.encode(message));
    },
    close(code?: number, reason?: string): void {
      socket.close(code, reason);
    },
  };
}
