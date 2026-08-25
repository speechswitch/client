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

export type WebSocketData = string | ArrayBuffer | ArrayBufferView | Blob;
export type WebSocketEncoder<Message> = (message: Message) => WebSocketData;
export type WebSocketDecoder<Message> = (data: unknown) => Message;

export interface WebSocketOptions<ClientMessage, ServerMessage> {
  readonly socket: WebSocketLike;
  readonly encode: WebSocketEncoder<ClientMessage>;
  readonly decode: WebSocketDecoder<ServerMessage>;
}

export async function connectWebSocket<ClientMessage, ServerMessage>(
  options: WebSocketOptions<ClientMessage, ServerMessage>,
) {
  const socket = options.socket;
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
