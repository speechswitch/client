# Mistral Voxtral TTS

One `synthesize("mistral", request, options)` operation returns an audio iterator.
It sends whole text to `/v1/audio/speech` and requests SSE output, decoding the
native base64 audio deltas into `Uint8Array`. The documented JSON response is
also supported without introducing a separate buffering API.

```ts
import { synthesize } from "../../dispatch.ts";

for await (const event of synthesize("mistral", {
  model: "voxtral-mini-tts-2603",
  voice: "existing-preset-or-custom-voice-id",
  text: "Hello!",
  output: { format: "pcm" },
})) {
  // Uint8Array audio; { event: "done", usage } on SSE completion.
}
```

`voice` selects an existing voice. `referenceAudio` independently accepts a
complete encoded audio file as bytes for zero-shot cloning; no transcript is
needed. The adapter does not create, delete or upload persistent voice profiles.
Neither published request schema defines a voice/reference exclusion or requires
one of them; these constraints are not invented locally. The service remains
responsible for undocumented selection/precedence behavior.

Omitted model selects `voxtral-mini-tts-2603`. Omitted output selects the
documented lowest-latency PCM: mono 24-kHz float32 little-endian. Fixed PCM fields
are typed literals, not promises of arbitrary resampling. All five native output
formats are supported: PCM, WAV, MP3, FLAC, Opus. Opus container/framing is not
specified clearly enough to relabel it as raw Opus or Ogg Opus. Encoded formats
do not advertise undocumented sample-rate, bitrate or representation controls.
Choose WAV or MP3 for the current playground's browser audio player; raw PCM
requires a consumer that understands its sample representation.

`metadata` carries nested JSON data, and `promptCacheKey` maps to the native cache
affinity hint. The canonical types generate their runtime checks and foreign
types. JSON metadata retains null/false/zero and rejects undefined, sparse arrays,
non-finite numbers, cycles and non-JSON objects before serialization. No `any`,
JSON string field, or duplicate handwritten request schema is needed.

There is no documented streaming text input, clear/flush command, speech-language
selector, prosody control, or timestamp output on this endpoint. Accordingly,
`text` is string-only and those request fields are excluded by the provider
types. The model infers language from the text/voice prompt. Output streaming
does not imply input streaming. Audio is not split into invented timestamp
envelopes or associated with guessed word offsets.

## Streaming and lifecycle

SSE event names and JSON data discriminators are preserved and checked for
conflicts. `speech.audio.delta` yields bytes; `speech.audio.done` yields completion
with native usage normalized to camelCase. Premature EOF, missing usage, malformed
audio and unknown speech events fail explicitly. JSON mode emits bytes and done
without fabricating usage data. Native usage nullability and omission remain
distinct, including both legacy/current prompt-detail fields.

Set `auth.mistral.apiKey`, `SPEECHSWITCH_MISTRAL_API_KEY`, or `MISTRAL_API_KEY`, in
that precedence order. The provider resolves auth and defaults at its public
boundary and calls the injected `fetch` directly. `baseUrl` preserves proxy paths
and query parameters. No third-party runtime dependency is introduced.

`signal` and `timeoutMs` cover connection and response-body waits. Consumer return
cancels the HTTP response and releases its reader; no fake reusable-session clear
acknowledgement is emitted. A subsequent utterance is a new synthesis operation.
HTTP failures retain their status, opaque body and retry header, including native
content-moderation rejections. No implicit retry can duplicate billed synthesis.

## Why the wire protocol is handwritten

The [checked-in OpenAPI](https://raw.githubusercontent.com/mistralai/platform-docs-public/main/openapi.yaml)
omits metadata/cache fields present in the live docs and requires integer usage
fields that the newer contract permits to be null or absent. The
[docs OpenAPI download](https://docs.mistral.ai/openapi.yaml) embeds SSE definitions
but references them as document-root `#/$defs/...` pointers without corresponding
root definitions or a new resource ID. Neither snapshot is repaired or used to
manufacture generated wire code. Exact source-audit tests pin these differences.

Eleven unchanged, hashed first-party snapshots are cataloged under
`schemas/sources/mistral/`, including the live reference, speech guide and pinned
SDK/cookbook sources. The [speech guide](https://docs.mistral.ai/studio/audio/text_to_speech/speech)
specifies float32 LE PCM; the pinned first-party playback example establishes
24-kHz mono. The SDK confirms the SSE event/data framing and current request
fields.

The canonical TypeScript schema still generates request validators, the registry,
playground controls, and Rust/Python/Go request types. Foreign-language packages
are type foundations, not complete synthesis SDKs or wire serializers.

Tests cover exact request/response fixtures, native Node HTTP streaming and reader
cancellation, model/output types, metadata, source hashes and compiled foreign
examples. No paid Mistral synthesis request was made during verification.
