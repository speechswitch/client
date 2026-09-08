import { expectTypeOf, test } from "bun:test";
import type { TtsRequest as BaseRequest } from "../../../schemas/base.ts";
import type { TtsInput, TtsRequest } from "./index.ts";

test("Voice.ai models narrow language, formats and API generations", () => {
  expectTypeOf<TtsRequest>().toExtend<BaseRequest>();
  const text = (async function* (): AsyncIterableIterator<TtsInput> { yield "Hello"; yield { command: "flush" }; yield { command: "clear" }; })();
  const modern: TtsRequest = { model: "voiceai-tts-lite-v1-latest", text, output: { format: "pcm", sampleRateHz: 16000 }, audioDelivery: "paced" };
  const multilingual: TtsRequest = { text: "Hola", model: "voiceai-tts-multilingual-v1-latest", language: "es", pronunciationDictionaries: [{ id: "owned", version: 2 }] };
  const legacy: TtsRequest = { apiVersion: "tts-v2", voice: "owned", text: "Hello" };
  // @ts-expect-error Standard models are English-only.
  const wrongLanguage: TtsRequest = { text: "Hola", model: "voiceai-tts-v1-latest", language: "es" };
  // @ts-expect-error Multilingual models require a documented non-English language.
  const missingLanguage: TtsRequest = { text: "Hola", model: "voiceai-tts-multilingual-v1-latest" };
  // @ts-expect-error TTS language is not ASR language auto-detection.
  const autoLanguage: TtsRequest = { text: "Hello", language: "auto" };
  // @ts-expect-error Paced MP3 would silently fall back upstream.
  const pacedMp3: TtsRequest = { text: "Hello", audioDelivery: "paced", output: { format: "mp3" } };
  // @ts-expect-error Legacy streaming input is not documented.
  const legacyStream: TtsRequest = { ...legacy, text };
  // @ts-expect-error Legacy sample rate is not specified by the legacy contract.
  const legacyRate: TtsRequest = { ...legacy, output: { format: "pcm", sampleRateHz: 32000 } };
  // @ts-expect-error Version IDs and numbered dictionary revisions are not interchangeable.
  const opaqueVersion: TtsRequest = { text: "Hello", pronunciationDictionaries: [{ id: "owned", versionId: "2" }] };
  // @ts-expect-error The exact 22.05 kHz MP3 option uses 32 kbps.
  const mp3Rate: TtsRequest = { text: "Hello", output: { format: "mp3", sampleRateHz: 22050, bitRateBps: 64000 } };
  // @ts-expect-error No in-context update message is documented.
  const update: TtsInput = { command: "update", replacements: [] };
  void [modern, multilingual, legacy, wrongLanguage, missingLanguage, autoLanguage, pacedMp3, legacyStream, legacyRate, opaqueVersion, mp3Rate, update];
});
