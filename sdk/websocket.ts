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
export type IncomingFrame<Message> = Message | string | ArrayBuffer | Blob;
export type OutgoingFrame<Message> = Message | string | ArrayBuffer | ArrayBufferView | Blob;

export interface WebSocketOptions<Parameters> {
  readonly url: string;
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

function decode<Message>(data: unknown): IncomingFrame<Message> {
  if (typeof data !== "string") return data as IncomingFrame<Message>;
  try {
    return JSON.parse(data) as Message;
  } catch {
    return data;
  }
}

export async function connectWebSocket<ClientMessage, ServerMessage, Parameters = never>(
  options: WebSocketOptions<Parameters>,
) {
  const create = options.webSocket ?? ((url: string, protocols?: string | string[]) => new WebSocket(url, protocols) as WebSocketLike);
  const socket = create(resolveUrl(options.url, options.parameters), options.protocols);
  socket.binaryType = "arraybuffer";

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

  const queue: IncomingFrame<ServerMessage>[] = [];
  const waiting: Array<{
    resolve: (value: IteratorResult<IncomingFrame<ServerMessage>>) => void;
    reject: (error: unknown) => void;
  }> = [];
  let closed = false;
  let failure: unknown;

  socket.addEventListener("message", (event) => {
    const message = decode<ServerMessage>(event.data);
    const waiter = waiting.shift();
    waiter ? waiter.resolve({ value: message, done: false }) : queue.push(message);
  });
  socket.addEventListener("error", (event) => {
    failure = event;
    for (const waiter of waiting.splice(0)) waiter.reject(event);
  });
  socket.addEventListener("close", () => {
    closed = true;
    for (const waiter of waiting.splice(0)) waiter.resolve({ value: undefined, done: true });
  });

  const messages: AsyncIterableIterator<IncomingFrame<ServerMessage>> = {
    next(): Promise<IteratorResult<IncomingFrame<ServerMessage>>> {
      const value = queue.shift();
      if (value !== undefined) return Promise.resolve({ value, done: false });
      if (failure !== undefined) return Promise.reject(failure);
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
    send(message: OutgoingFrame<ClientMessage>): void {
      const encoded = typeof message === "object"
        && !(message instanceof Blob)
        && !(message instanceof ArrayBuffer)
        && !ArrayBuffer.isView(message)
        ? JSON.stringify(message)
        : message;
      socket.send(encoded as string | ArrayBuffer | ArrayBufferView | Blob);
    },
    close(code?: number, reason?: string): void {
      socket.close(code, reason);
    },
  };
}
