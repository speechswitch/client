import { expectTypeOf, test } from "bun:test";
import type { TtsRequest as BaseRequest } from "../../../schemas/base.ts";
import type { TtsRequest } from "./index.ts";

test("Vocu distinguishes speech, controllable markup, subtitles and asynchronous batches", () => {
  expectTypeOf<TtsRequest>().toExtend<BaseRequest>();
  const direct = { voice: "owned", text: "Hello", language: "auto", randomSeed: 0 } as const satisfies TtsRequest;
  const markup: TtsRequest = { voice: "owned", text: "{{happy}}Hello", inputType: "markup", referenceEmphasis: "expressive" };
  const batch: TtsRequest = { segments: [{ kind: "speech", ...direct }], subtitleFormat: "srt" };
  const splitter: TtsRequest = { text: "[speaker] Hello", textSplitter: { id: "existing" } };
  // @ts-expect-error The API does not expose a model selector; the voice owns its version.
  const model: TtsRequest = { ...direct, model: "v3.5" };
  // @ts-expect-error Controllable synthesis does not generate SRT.
  const markedSubtitles: TtsRequest = { ...markup, subtitleFormat: "srt" };
  // @ts-expect-error Flash mode does not generate SRT.
  const fastSubtitles: TtsRequest = { ...direct, latencyOptimization: "maximum", subtitleFormat: "srt" };
  // @ts-expect-error Streaming input is not documented.
  const streaming: TtsRequest = { voice: "owned", text: (async function* () { yield "Hello"; })() };
  // @ts-expect-error Async filters flash out; it is not an effective segment control.
  const flashBatch: TtsRequest = { segments: [{ kind: "speech", ...direct, latencyOptimization: "maximum" }] };
  // @ts-expect-error Splitting and explicit content are mutually exclusive.
  const mixed: TtsRequest = { ...splitter, segments: [{ kind: "speech", ...direct }] };
  void [direct, markup, batch, splitter, model, markedSubtitles, fastSubtitles, streaming, flashBatch, mixed];
});
