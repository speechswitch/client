export interface WebSocketLike {
  readonly readyState: number;
  binaryType: string;
  send(data: string | ArrayBuffer | ArrayBufferView | Blob): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: "open", listener: () => void): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  addEventListener(type: "error" | "close", listener: (event: unknown) => void): void;
  removeEventListener(type: "open" | "message" | "error" | "close", listener: (event: unknown) => void): void;
}

export type WebSocketData = string | ArrayBuffer | ArrayBufferView | Blob;
export type WebSocketEncoder<Message> = (message: Message) => WebSocketData;
export type WebSocketDecoder<Message> = (data: unknown) => Message;

export interface WebSocketOptions<ClientMessage, ServerMessage> {
  readonly socket: WebSocketLike;
  readonly encode: WebSocketEncoder<ClientMessage>;
  readonly decode: WebSocketDecoder<ServerMessage>;
  readonly signal?: AbortSignal;
}

export async function connectWebSocket<ClientMessage, ServerMessage>(
  options: WebSocketOptions<ClientMessage, ServerMessage>,
) {
  const socket = options.socket;
  const signal = options.signal ?? new AbortController().signal;
  if (signal.aborted) { socket.close(); signal.throwIfAborted(); }
  socket.binaryType = "arraybuffer";

  const queue: ServerMessage[] = [];
  const waiting: Array<{
    resolve: (value: IteratorResult<ServerMessage>) => void;
    reject: (error: unknown) => void;
  }> = [];
  let closed = false;
  let failed = false;
  let failure: unknown;
  let opening = true;
  let resolveOpen!: () => void;
  let rejectOpen!: (error: unknown) => void;
  const opened = new Promise<void>((resolve, reject) => {
    resolveOpen = resolve;
    rejectOpen = reject;
  });

  const detach = () => {
    socket.removeEventListener("open", onOpen);
    socket.removeEventListener("message", onMessage);
    socket.removeEventListener("error", onError);
    socket.removeEventListener("close", onClose);
    signal.removeEventListener("abort", onAbort);
  };

  const reject = (error: unknown) => {
    if (failed) return;
    failed = true;
    failure = error;
    queue.length = 0;
    if (opening) { opening = false; rejectOpen(error); }
    for (const waiter of waiting.splice(0)) waiter.reject(error);
    detach();
  };

  const onMessage = (event: unknown) => {
    if (closed || failed) return;
    let message: ServerMessage;
    try {
      message = options.decode((event as { data: unknown }).data);
    } catch (error) {
      reject(error);
      socket.close(1003, "Unable to decode message");
      return;
    }
    const waiter = waiting.shift();
    waiter ? waiter.resolve({ value: message, done: false }) : queue.push(message);
  };
  const onError = (event: unknown) => {
    reject(new TypeError(opening ? "WebSocket failed to open" : "WebSocket failed", { cause: event }));
    socket.close();
  };
  const onClose = () => {
    if (opening) reject(new TypeError("WebSocket closed before opening"));
    closed = true;
    for (const waiter of waiting.splice(0)) waiter.resolve({ value: undefined, done: true });
    detach();
  };
  const onAbort = () => { reject(signal.reason); socket.close(); };
  const onOpen = () => {
    if (!opening) return;
    opening = false;
    socket.removeEventListener("open", onOpen);
    resolveOpen();
  };
  socket.addEventListener("message", onMessage);
  socket.addEventListener("error", onError);
  socket.addEventListener("close", onClose);
  socket.addEventListener("open", onOpen);
  signal.addEventListener("abort", onAbort, { once: true });
  if (signal.aborted) onAbort();
  else if (socket.readyState === 1) onOpen();
  else if (socket.readyState > 1) onClose();
  await opened;

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
      if (failed) throw failure;
      if (closed) throw new TypeError("WebSocket is closed");
      socket.send(options.encode(message));
    },
    close(code?: number, reason?: string): void {
      if (closed || failed) return;
      queue.length = 0;
      onClose();
      socket.close(code, reason);
    },
  };
}
