# Typecast

One `synthesize` operation covers Typecast's byte-native streaming, ordinary,
timestamped and composed synthesis. Both `ssfm-v21` and `ssfm-v30` are modeled in
the runtime-free [canonical TypeScript schema](../../../schemas/providers/typecast/index.ts).
TypeScript 7 generates runtime request checks, playground variants and
Rust/Python/Go request types from that schema.

```ts
import { synthesize } from "./sdk/providers/typecast/index.ts";

for await (const item of synthesize({
  model: "ssfm-v30",
  voice: "uc_existing_custom_voice", // Or a built-in tc_ voice.
  text: "The delivery can follow the surrounding context.",
  emotion: "auto",
  contextBefore: { text: "I just got wonderful news." },
  output: { format: "wav", sampleRateHz: 32000 },
}, { auth: { typecast: { apiKey: "..." } } })) {
  if (item instanceof Uint8Array) {
    // Consume native audio bytes without collecting the whole response.
  }
}
```

Authentication resolves `auth.typecast.apiKey`, then
`SPEECHSWITCH_TYPECAST_API_KEY`, then `TYPECAST_API_KEY`. Requests use `X-API-KEY`.
Keep credentials on your server. Fetch, base URL, abort signal and the
whole-operation deadline are injectable. No third-party runtime dependencies,
SDK imports, attribution telemetry or automatic retries are introduced.

## Models and normalized controls

| Capability | ssfm-v21 | ssfm-v30 |
| --- | --- | --- |
| Explicit languages | 27 | 37 |
| Preset emotions | normal, happy, sad, angry | Those four plus whisper, toneup, tonedown |
| Context-aware emotion | Unsupported | `emotion: "auto"` |
| Existing voice IDs | `tc_` and owned `uc_` | `tc_` and owned `uc_` |
| Incremental input / native clear | Unsupported | Unsupported |

`language` defaults to `auto`, which omits the native language field. Explicit
normalized language tags (`en`, `ko`, `ja`, etc.; `nan` and `yue` remain those tags)
map to the provider's ISO 639-3 codes. Voice availability and permission remain
provider-side checks; selecting an existing custom voice never uploads recordings
or creates a clone.

Preset `emotion` defaults to `normal`, with `emotionIntensity` 0–2 (default 1).
v30 Smart Emotion excludes a simultaneous intensity setting and accepts
`contextBefore.text` / `contextAfter.text`, each at most 2000 code points. v21
excludes Smart Emotion, context and v30-only presets/languages in its type.
The adapter emits v21's plain prompt and v30's native smart/preset discriminator.

`speed` is a 0.5–2 multiplier, `pitchSemitones` an integer from -12 to 12, and
`randomSeed` an unsigned 32-bit integer. Omitted seed remains omitted; zero is
preserved. Text is a nonempty string of at most 2000 Unicode code points. Native
pause markup such as `<|0.3s|>` is passed through unchanged; no SSML or
pronunciation-dictionary capability is invented.

`volumeScale` is relative gain, rounded to the native one-percent steps (0–2 maps
to 0–200). `targetLoudnessLufs` is absolute loudness from -70 to 0. They are
mutually exclusive in the authored type, not checked again with adapter if-chains.
Relative volume requires a non-streaming upstream operation; absolute loudness
works on the streaming endpoint too.

## Transport and output selection

| Request | Upstream operation | Native output |
| --- | --- | --- |
| Default / 32 kHz WAV / MP3 without non-streaming controls | `/v1/text-to-speech/stream` | WAV: mono 16-bit LE at 32 kHz; MP3: 320 kbps at 44.1 kHz |
| Relative volume or explicit 44.1 kHz WAV | `/v1/text-to-speech` | WAV: mono 16-bit LE at 44.1 kHz; MP3: 320 kbps at 44.1 kHz |
| Requested timestamps | `/v1/text-to-speech/with-timestamps` | JSON containing audio and alignment from the same synthesis |
| Composition | `/v1/text-to-speech/compose` | One composed WAV or MP3 file |

The default is byte-native streaming WAV. The first upstream WAV bytes include
the native streaming header (unknown length, `0xFFFFFFFF`); subsequent data is
PCM. Network reads can split headers or MPEG frames, so consumer decoders must
accept incremental byte input. The SDK does not strip headers, decode audio or
pretend each fetch chunk is an independent file.

`transport: "http"` explicitly selects ordinary synthesis and its defaults;
`transport: "stream"` cannot override incompatible controls or sample rates.
An explicitly requested 32 kHz WAV cannot silently become ordinary 44.1 kHz WAV.
These override/protocol checks are separate from generated request validation.

Streaming **output** does not imply streaming **input**: Typecast accepts one
whole JSON request, not `AsyncIterable<string>` or clear/flush/update commands.
Consumer-side cancellation uses `AbortSignal` or iterator return. There is no
documented native barge-in acknowledgment or WebSocket protocol to expose.

## Timestamps

Use `timestampGranularity: "word"`, `"character"`, or `["word", "character"]`.
Array selection is set-like; duplicates do not duplicate marks. An empty array
disables alignment but retains ordinary synthesis's 44.1 kHz WAV defaults.
The native query is `word` or `char`; requesting both omits the filter.

Timestamp synthesis buffers the provider's JSON response because audio is base64
inside that response, not a separate streaming track. It returns one
`correlation: "chunk"` envelope with the decoded `Uint8Array`, native duration in
milliseconds, and the requested alignment tracks. Original punctuation and
whitespace survive. No separate synthesis is used to obtain alignment, and no
association or character offsets are inferred from arrival order.

Japanese/Chinese word alignment may cover the entire sentence; character timing
is generally useful there. The SDK preserves that documented behavior rather than
fabricating finer words. Timestamp responses have a configurable 128 MiB default
byte cap (`maxTimestampResponseBytes`); raw byte streams remain uncapped.

## Composition

```ts
const request = {
  output: { format: "wav" },
  segments: [
    { kind: "pause", pauseMs: 500 },
    { kind: "speech", model: "ssfm-v21", voice: "tc_voice", text: "First voice." },
    { kind: "pause", pauseMs: 1000 },
    { kind: "speech", model: "ssfm-v30", voice: "uc_voice", text: "Second voice.", emotion: "whisper" },
  ],
} as const;
```

Every speech segment has its own model, voice and delivery controls. A single
top-level output format makes mixed per-segment encodings impossible by design.
Pauses are milliseconds, converted explicitly to native seconds. Per-segment
bounds, model variants, mutually exclusive loudness controls and the 1–50 segment
count come from generated validation. Only cross-element invariants remain
handwritten: at least one speech segment, at most 2000 total text code points,
and at most 60000 ms total silence. Each pause is positive and at most 10000 ms;
unit-conversion underflow fails instead of transmitting zero seconds.

This is one native compose call, not separate synthesis calls and local
concatenation. Native ordering and all-or-nothing failure semantics are preserved.
Composed output does not claim timestamps or incremental text support.

## Contract audit and checks

Issue #25 and all comments were read (no comments). Eight unchanged snapshots,
including the public OpenAPI, are recorded with GET URL and SHA-256 in
[`schemas/sources.yaml`](../../../schemas/sources.yaml).

The [public OpenAPI](https://typecast.ai/docs/api-reference/openapi.json) is not
a complete trustworthy generation source: v21 `Prompt` has no object type or
typed emotion properties and overlaps both branches of the request's `oneOf`.
Model restrictions, smart-context lengths and exclusive volume/LUFS choices are
in prose rather than structural constraints. The adapter therefore implements
the wire protocol directly. The upstream Go SDK is a secondary behavioral
cross-check, not a generator input. Upstream agent-attribution instructions are
documentation content, not authorization to add telemetry to this SDK.

This integration adds schema annotations `@minItems` and `@maxItems`. The extractor
checks annotation types and provider narrowing before inheriting base bounds.
Generated validators index every array element so sparse holes cannot evade
validation. No schema descriptors or runtime interpreters are emitted.

Tests cover exact payloads, model and composition narrowing, native Node HTTP,
split UTF-8 timestamp JSON, first-chunk delivery, aborts/deadlines, malformed
responses, source integrity and playground defaults. No credentialed live
synthesis was performed. Generated Rust/Python/Go types compile and reject
v21 Smart Emotion; executable foreign validators and provider adapters remain
unported, as documented in the shared language foundation.
