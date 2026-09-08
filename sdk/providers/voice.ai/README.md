# Voice.ai

Handwritten TTS integration with both the original issue's
`POST https://api.voice.ai/tts/v2/audio/speech` and the current
`https://dev.voice.ai/api/v1` API. One `synthesize` operation always returns a
stream; consuming the complete stream is an explicit caller operation.

```ts
import { synthesize } from "./index.ts";

const auth = { "voice.ai": { apiKey: "..." } };
for await (const item of synthesize({ text: "Hello", voice: "existing-cloned-id" }, { auth })) {
  // HTTP audio items are Uint8Array. The final item is { event: "done" }.
}
```

Authentication resolves `auth["voice.ai"].apiKey`, then
`SPEECHSWITCH_VOICE_AI_API_KEY`, then `VOICE_AI_API_KEY` at the public boundary.
The native WebSocket sends `Authorization: Bearer ...` as an upgrade header in
Node/Bun, never as a query token or fabricated subprotocol. Browser WebSockets
cannot set that header: use a backend or an authenticated `webSocket` override.
Keep permanent API keys on the server.

## Model and API selection

The provider-owned TypeScript union drives validation, playground options and
generated Rust/Python/Go requests. Base request types remain variant-union-free.

| Request selection | Language | Default transport |
| --- | --- | --- |
| Omitted model or `model: "auto"` | `en` by default; selects the standard or multilingual hosted model from language | Streaming HTTP for whole text |
| Standard `voiceai-tts-v1-latest` or `voiceai-tts-v1-2026-02-10` | English | Streaming HTTP for whole text |
| Lite `voiceai-tts-lite-v1-latest` or `voiceai-tts-lite-v1-2026-04-15` | English | Streaming HTTP for whole text |
| Multilingual `voiceai-tts-multilingual-v1-latest` or `voiceai-tts-multilingual-v1-2026-02-10` | Required `ca`, `sv`, `es`, `fr`, `de`, `it`, `pt`, `pl`, `ru`, or `nl` | Streaming HTTP for whole text |
| `apiVersion: "tts-v2"` | Not exposed by that API; `voice` required | Legacy HTTP with `streaming: true` |

Modern `apiVersion` defaults to `v1`. `model: "auto"` is normalized model routing,
not an invented upstream model ID or ASR language auto-detection. Explicit `http`
transport selects `/api/v1/tts/speech` (or legacy `streaming: false`), still read
incrementally by the SDK. Input streaming and paced audio require the
structured WebSocket protocol; an incompatible transport override fails before
network access. Lite is not in the captured HTTP model enum, but the current
quickstart explicitly documents hosted IDs in any TTS request. The handwritten
adapter follows that guide instead of copying the stale enum's restriction.

Voice IDs select existing built-in or cloned voices. Omit `voice` on the current
API to use its built-in default. Reference-audio upload/voice creation is not a
synthesis input and is not conflated with voice selection.

## Output and pronunciation

Keep `output.format`, `sampleRateHz`, and `bitRateBps` independent. Provider unions
encode every documented MP3, Opus, PCM, WAV, A-law and mu-law combination. Basic
modern MP3/WAV/PCM use 32 kHz; PCM is mono signed 16-bit little-endian. Legacy
sample rate/PCM layout and the native Opus container are not guessed from another
endpoint. `audioDelivery: "paced"` requires explicit PCM or telephony output and
uses WebSocket; MP3/WAV/Opus cannot silently fall back to raw cadence.

Use `pronunciationDictionaries: [{ id: "existing-dictionary", version: 2 }]` for
one managed dictionary. Omit `version` for latest; this numeric revision is not
an opaque `versionId`. Temperature/top-p accept zero on the current API. The
legacy contract instead narrows them to 0.8–1.2 and 0.4–0.9 respectively.

## Incremental text, flush and clear

Modern `text` also accepts `AsyncIterable<string | { command: "flush" } |
{ command: "clear" }>`. Settings are fixed per synthesis call; the documented
subsequent messages do not accept pronunciation/model/voice updates.

- Text accumulates in a native context until flush or input EOF. Empty text and
  flushing an empty buffer are no-ops, not fabricated native acknowledgments.
- Each nonempty flush uses `auto_close: true`; later text gets a new native
  context so input/clear handling does not block behind in-flight generation.
- Audio envelopes carry the exact echoed `context_id` as `correlationId` with
  `correlation: "ordered"` and empty timestamps. Concurrent contexts can interleave:
  keep their audio separate, especially for independently headed file formats.
- `is_last` yields `{ event: "flush", correlationId }`. The distinct
  `context_closed` acknowledgment releases that context. There is no fabricated
  second input-group ID; the shared flush event now allows it to be absent.
- Clear retires all previous contexts and immediately suppresses their subsequent
  audio. Buffered contexts receive `close_context`; already flushing contexts are
  awaiting native auto-close, so no racing duplicate close is sent. The clear event
  waits for their closure acknowledgments. With no active contexts it completes
  locally. Native closure is **not documented as hard inference cancellation**,
  and it does not stop audio already queued in a consumer's player.
- Done requires input EOF and every active context to close. Premature socket
  closure, missing flush completion, unknown context IDs and empty generation
  fail. Caller abort/timeout closes transport and requests producer cleanup without
  waiting for an uncooperative producer's pending `next` or `return`.

`maxMessageBytes` bounds individual JSON socket frames (default 4 MiB), not raw
HTTP audio. Network dependencies are injectable; no third-party runtime package
is shipped. There is no silence timer masquerading as successful completion,
automatic retry, or cancellation billing guarantee.

## Contract provenance

All nine freshly acquired inputs remain unchanged under
`schemas/sources/voice.ai/`, with exact URLs/methods/SHA-256 in `schemas/sources.yaml`.
The public OpenAPI 1.4.0 describes the old endpoint with no response body schema,
no auth scheme, and constraints only in prose. Current endpoint Markdown embeds
OpenAPI 1.5.0 with different models, bounds and hosts. Generating a wire client
from the old document would lose current capabilities; repairing it by hand would
misrepresent its provenance. The adapter is therefore handwritten.

The captured WebSocket Markdown includes structured channel operations and
`jsonPayloadSchema` definitions, satisfying the issue's structured-protocol gate.
It is not passed off as a fetched standalone AsyncAPI document (that URL returned
404). Source tests parse the fenced YAML deterministically, preserve the separate
audio/flush/closure messages, and audit the HTTP/WS model difference. The single
context socket is also cataloged; the adapter uses the documented multi-context
endpoint to support repeated flushes and independent context identity.

Tests use exact payload/diagnostic assertions, native Node HTTP and authenticated
WebSocket loopback servers, generated schema validation and playground defaults.
No credentialed live provider synthesis has been performed.
