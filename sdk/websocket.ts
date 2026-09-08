export interface WebSocketLike {
  readonly readyState: number;
  binaryType: string;
  send(data: string | ArrayBuffer | ArrayBufferView | Blob): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: "open", listener: () => void): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  addEventListener(type: "error" | "close", listener: (event: unknown) => void): void;
  removeEventListener(
    type: "open" | "message" | "error" | "close",
    listener: (event: unknown) => void,
  ): void;
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
  const { socket, signal } = options;
  if (signal?.aborted) {
    socket.close();
    signal.throwIfAborted();
  }
  socket.binaryType = "arraybuffer";

  const queue: (ServerMessage | undefined)[] = [];
  let head = 0;
  let pending:
    | { resolve(value: IteratorResult<ServerMessage>): void; reject(error: unknown): void }
    | undefined;
  let state: "opening" | "open" | "closed" | "failed" = "opening";
  let failure: unknown;
  const opened = Promise.withResolvers<void>();

  const detach = () => {
    socket.removeEventListener("open", onOpen);
    socket.removeEventListener("message", onMessage);
    socket.removeEventListener("error", onError);
    socket.removeEventListener("close", onClose);
    signal?.removeEventListener("abort", onAbort);
  };

  const fail = (error: unknown) => {
    if (state === "closed" || state === "failed") return;
    if (state === "opening") opened.reject(error);
    state = "failed";
    failure = error;
    queue.length = 0;
    head = 0;
    pending?.reject(error);
    pending = undefined;
    detach();
  };

  const onMessage = (event: unknown) => {
    if (state === "closed" || state === "failed") return;
    let message: ServerMessage;
    try {
      message = options.decode((event as { data: unknown }).data);
    } catch (error) {
      fail(error);
      // Native WebSocket.close permits only 1000 or application codes 3000–4999.
      socket.close(4000, "Unable to decode message");
      return;
    }
    if (pending) {
      pending.resolve({ value: message, done: false });
      pending = undefined;
    } else queue.push(message);
  };
  const onError = (event: unknown) => {
    fail(
      new TypeError(state === "opening" ? "WebSocket failed to open" : "WebSocket failed", {
        cause: event,
      }),
    );
    socket.close();
  };
  const onClose = () => {
    if (state === "opening") {
      fail(new TypeError("WebSocket closed before opening"));
      return;
    }
    if (state !== "open") return;
    state = "closed";
    pending?.resolve({ value: undefined, done: true });
    pending = undefined;
    detach();
  };
  const onAbort = () => {
    fail(signal?.reason);
    socket.close();
  };
  const onOpen = () => {
    if (state !== "opening") return;
    state = "open";
    socket.removeEventListener("open", onOpen);
    opened.resolve();
  };
  socket.addEventListener("message", onMessage);
  socket.addEventListener("error", onError);
  socket.addEventListener("close", onClose);
  socket.addEventListener("open", onOpen);
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) onAbort();
  else if (socket.readyState === 1) onOpen();
  else if (socket.readyState > 1) onClose();
  await opened.promise;

  // One consumer may have a pending read at a time.
  const messages: AsyncIterableIterator<ServerMessage> = {
    next(): Promise<IteratorResult<ServerMessage>> {
      if (head < queue.length) {
        const value = queue[head]!;
        queue[head++] = undefined;
        if (head === queue.length) {
          queue.length = 0;
          head = 0;
        } else if (head >= 1024 && head * 2 >= queue.length) {
          // Amortized compaction bounds storage when the queue never fully drains.
          queue.splice(0, head);
          head = 0;
        }
        return Promise.resolve({ value, done: false });
      }
      if (state === "failed") return Promise.reject(failure);
      if (state === "closed") return Promise.resolve({ value: undefined, done: true });
      if (pending)
        return Promise.reject(new TypeError("Concurrent WebSocket reads are not supported"));
      const read = Promise.withResolvers<IteratorResult<ServerMessage>>();
      pending = read;
      return read.promise;
    },
    [Symbol.asyncIterator]() {
      return this;
    },
  };

  return {
    socket,
    messages,
    send(message: ClientMessage): void {
      if (state === "failed") throw failure;
      if (state === "closed") throw new TypeError("WebSocket is closed");
      socket.send(options.encode(message));
    },
    close(code?: number, reason?: string): void {
      if (state === "closed" || state === "failed") return;
      queue.length = 0;
      head = 0;
      onClose();
      socket.close(code, reason);
    },
  };
}
