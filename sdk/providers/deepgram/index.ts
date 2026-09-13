import type { TtsRequest } from "../../../schemas/providers/deepgram/index.ts";
import { toRest, toStreaming } from "../../generated/serializers/deepgram.ts";
import { streamAura } from "./aura.ts";
import { streamFlux } from "./flux.ts";
import { pronunciation } from "./pronunciation.ts";
import type { ProviderOptions } from "../../options.ts";
import { validateRequest } from "../../generated/validators/deepgram.ts";
import type { WebSocketLike } from "../../websocket.ts";

export type { TtsInput, TtsRequest } from "../../../schemas/providers/deepgram/index.ts";

function speechUrl(request: TtsRequest, endpoint: string, streaming: boolean): URL {
  const url = new URL(endpoint);
  const output = request.output;
  const encoding = output.codec === "pcm" ? "linear16" : output.codec;
  url.searchParams.set(
    "model",
    `${request.model === "aura-1" ? "aura" : request.model}-${request.voice}-${request.language}`,
  );
  url.searchParams.set("encoding", encoding);
  if (!streaming && output.container !== undefined) {
    url.searchParams.set("container", output.container === "raw" ? "none" : output.container);
  }
  // Fixed-rate codecs allow the normalized rate for clarity, but reject it as a wire query parameter.
  if (
    output.sampleRateHz !== undefined &&
    output.codec !== "mp3" &&
    output.codec !== "opus" &&
    output.codec !== "aac"
  ) {
    url.searchParams.set("sample_rate", String(output.sampleRateHz));
  }
  if (output.bitRateBps !== undefined) url.searchParams.set("bit_rate", String(output.bitRateBps));
  const mapped: ReturnType<typeof toRest> = streaming ? toStreaming(request) : toRest(request);
  const { dataGovernance, telemetry, ...fields } = mapped;
  for (const parameters of [dataGovernance, fields, telemetry]) {
    if (!parameters) continue;
    for (const [name, value] of Object.entries(parameters)) {
      if (Array.isArray(value)) {
        for (const item of value) url.searchParams.append(name, item);
      } else url.searchParams.set(name, String(value));
    }
  }
  if (request.model === "flux" && request.expressivity !== undefined) {
    url.searchParams.set(
      "expressivity",
      String(
        {
          very_calm: -2,
          calm: -1,
          standard: 0,
          animated: 1,
          very_animated: 2,
        }[request.expressivity],
      ),
    );
  }
  return url;
}

export async function* synthesize(
  request: TtsRequest,
  options: ProviderOptions = {},
): AsyncIterableIterator<Uint8Array> {
  validateRequest(request);
  const pronunciations =
    "replacements" in request && request.replacements
      ? pronunciation(request.replacements)
      : undefined;
  const environment = typeof process === "undefined" ? {} : process.env;
  const apiKey =
    options.auth?.deepgram?.apiKey ??
    environment.SPEECHSWITCH_DEEPGRAM_API_KEY ??
    environment.DEEPGRAM_API_KEY;
  if (!apiKey) throw new TypeError("Missing auth.deepgram.apiKey configuration");
  const signal = options.signal ?? new AbortController().signal;
  signal.throwIfAborted();
  const version = request.model === "flux" ? "v2" : "v1";
  if (typeof request.text !== "string") {
    let socket = options.webSocket;
    if (!socket) {
      if (typeof globalThis.WebSocket !== "function")
        throw new TypeError("This runtime does not provide WebSocket");
      if (
        typeof Bun === "undefined" &&
        !(typeof process !== "undefined" && process.versions?.node)
      ) {
        throw new TypeError(
          "Deepgram native WebSocket authentication requires Node or Bun; inject an authenticated WebSocket in browsers",
        );
      }
      const Constructor = globalThis.WebSocket as unknown as new (
        url: string,
        options: { headers: Record<string, string> },
      ) => WebSocketLike;
      socket = new Constructor(
        speechUrl(request, options.webSocketUrl ?? `wss://api.deepgram.com/${version}/speak`, true)
          .href,
        { headers: { authorization: `Token ${apiKey}` } },
      );
    }
    if (request.model === "flux") yield* streamFlux(request, request.text, socket, signal);
    else yield* streamAura(request, request.text, socket, signal, pronunciations);
    return;
  }
  const baseUrl = new URL(options.baseUrl ?? "https://api.deepgram.com");
  baseUrl.pathname = `${baseUrl.pathname.replace(/\/$/, "")}/${version}/speak`;
  const lifetime = new AbortController();
  const httpSignal = AbortSignal.any([signal, lifetime.signal]);
  let rejectAbort!: (reason: unknown) => void;
  const aborted = new Promise<never>((_, reject) => {
    rejectAbort = reject;
  });
  void aborted.catch(() => {});
  const onAbort = () => rejectAbort(httpSignal.reason);
  httpSignal.addEventListener("abort", onAbort, { once: true });
  try {
    httpSignal.throwIfAborted();
    const pending = (options.fetch ?? globalThis.fetch)(speechUrl(request, baseUrl.href, false), {
      method: "POST",
      redirect: "error",
      headers: { authorization: `Token ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        text: pronunciations ? pronunciations.text(request.text, true) : request.text,
      }),
      signal: httpSignal,
    });
    // An injected fetch may ignore abort and return a body after this iterator
    // has already failed. That late body still belongs to this operation.
    void pending.then(
      (response) => {
        if (httpSignal.aborted) void response.body?.cancel().catch(() => {});
      },
      () => {},
    );
    const response = await Promise.race([pending, aborted]);
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      throw new TypeError(`Deepgram returned HTTP ${response.status}`);
    }
    if (!response.body) throw new TypeError("Deepgram returned no audio stream");
    const contentType = response.headers
      .get("content-type")
      ?.split(";", 1)[0]
      ?.trim()
      .toLowerCase();
    if (
      contentType &&
      !contentType.startsWith("audio/") &&
      contentType !== "application/octet-stream"
    ) {
      void response.body.cancel().catch(() => {});
      throw new TypeError("Deepgram returned an unexpected audio content type");
    }
    const reader = response.body.getReader();
    const cancel = () => {
      void reader.cancel(httpSignal.reason).catch(() => {});
    };
    httpSignal.addEventListener("abort", cancel, { once: true });
    let received = false;
    try {
      for (;;) {
        httpSignal.throwIfAborted();
        const item = await Promise.race([reader.read(), aborted]);
        httpSignal.throwIfAborted();
        if (item.done) break;
        if (item.value.byteLength) {
          received = true;
          yield item.value;
        }
      }
      if (!received) throw new TypeError("Deepgram returned no audio bytes");
    } finally {
      httpSignal.removeEventListener("abort", cancel);
      void reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  } finally {
    httpSignal.removeEventListener("abort", onAbort);
    lifetime.abort(new DOMException("Deepgram synthesis closed", "AbortError"));
  }
}
