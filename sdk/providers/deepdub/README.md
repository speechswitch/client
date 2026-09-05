# Deepdub

```ts
import { synthesize } from "./index.ts";

const audio = synthesize({
  model: "phantom-x-3.2",
  voice: "your-existing-custom-or-catalog-voice-id",
  language: "en-US",
  text: "Hello world!",
  output: { format: "mp3", sampleRateHz: 24000 },
}, { auth: { deepdub: { apiKey: "..." } } });
```

The adapter implements issue #6's `POST /tts` operation directly. `synthesize`
always returns `AsyncIterableIterator<Uint8Array>` and yields response chunks
immediately; it does not fetch or buffer an entire file first. Audio buffering is
an explicit consumer choice.

Auth resolves from the shared `Auth` object, then
`SPEECHSWITCH_DEEPDUB_API_KEY`, then `DEEPDUB_API_KEY`. There is no embedded trial
credential or silent fallback key. The default API base is
`https://restapi.deepdub.ai/api/v1`; pass
`baseUrl: "https://eu-restapi.deepdub.ai/api/v1"` for EU service with an eligible
key. Custom proxy base paths are retained. Fetch and AbortSignal are injectable.
Never ship a secret provider key in a public browser bundle.

## Models and controls

| Normalized model | Wire model | Seed |
| --- | --- | --- |
| `og-1.1` | `dd-etts-1.1` | Supported |
| `lightning-2.5` | `dd-etts-2.5` | Not used upstream; excluded by types |
| `phantom-x-3.2` | `dd-etts-3.2` | Not used upstream; excluded by types |

Voice identity and reference audio are independent. Supply `voice`,
`referenceAudio: Uint8Array`, or both. An existing custom voice needs no reference
recording; reference-only cloning does not need a fabricated voice ID. Reference
bytes are base64-encoded explicitly because this wire field requires it.
`deliveryReference` is a separate performance-prompt ID for delivery guidance.

Independent controls remain flat: `temperature`, `deliveryVariance`, `voiceBoost`,
`durationStretching`, `audioEnhancement`, `automaticGainControl`, `speakerGender`,
and `processingPriority`. Real-time priority is a scheduling choice, not a
quality/latency optimization level. No unrelated `voiceTuning` wrapper or ignored
`voiceSource` discriminator is added.

`speed` (0.5–2) and `targetDurationMs` (positive) are mutually exclusive in both
the request union and runtime checks. Duration converts to the documented
`targetDuration` wire field in seconds. `randomSeed` requires OG 1.1 and a safe
integer. Accent blending is one cohesive value:
`accentBlend: { baseLocale: "en-US", targetLocale: "fr-FR", ratio: 0.5 }`; all
three fields are required together, and the ratio is in [0, 1].

The language remains an explicit locale string. The REST page's language table
is useful guidance, but the wire contract does not specify a closed language
enum. Voice/model/locale availability is checked by the service.

## Audio and failure semantics

HTTP supports MP3, µ-law, and a wire format named `opus`. Sample rate is a separate
field. The adapter resolves omitted rates to 48000 Hz, or 8000 Hz for µ-law, and
audio cleanup to true. Codec-specific resampling availability is determined by
the provider's conversion layer.

`output.format: "ogg_opus"` sends the wire value `opus` and verifies the Ogg codec
signature before exposing bytes as Opus. A live trial request on 2026-09-05
returned **Ogg Vorbis** for that wire value; the adapter rejects that mismatch
instead of silently mislabeling audio. The check buffers only enough to identify
the initial Ogg packet, not the synthesized audio. MP3 and µ-law have no such
prefix buffering. See [live observations](./LIVE_TESTS.md) for exact test scope.

Abort cancels the HTTP operation; early consumer exit cancels the response body.
HTTP failures retain status, message, and the upstream `x-generation-id` as
`DeepdubError.generationId`. `options.requestId` supplies a client generation ID;
otherwise a fresh UUID is sent. A failure is never retried automatically because
repeating synthesis may bill twice or produce different speech.

This HTTP integration takes complete text. Deepdub separately supports WebSocket
input streaming, WAV/PCM, and a cancel protocol, but those endpoints are not part
of issue #6's requested HTTP operation. This adapter neither buffers an iterable
into fake streaming input nor advertises commands, clear events, or timestamps
that this operation cannot produce. Use AbortSignal for HTTP barge-in and start a
fresh operation for the next utterance. The provider's publication/storage and
voice-management operations are not exposed as synthesis controls; the optional
`publish` field has no documented TTS semantics beyond its boolean type.

## Source and verification boundary

The official OpenAPI file structurally describes only four generation fields;
the optional controls are embedded in its description, and the successful audio
response has no media schema. Its required voice ID also conflicts with the
reference-only path documented and implemented by the official SDK. These inputs
do not warrant wire-client codegen. The protocol is authored here, with no
hand-repaired spec or generated static template. Raw sources, including official
SDK cross-checks, are cataloged unchanged with acquisition URLs and SHA-256 hashes.

The canonical request remains a plain non-generic type in `schemas/`, normalized
and validated against the base independently. Registry and specification outputs
are generated normally. Tests cover type narrowing, wire mapping, auth/defaults,
stream lifecycle, codec validation across split headers, native Node HTTP, and
browser bundling. Live MP3 checks cover all three cataloged models; they do not
prove every optional control or account-specific voice configuration.
