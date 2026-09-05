# CAMB.AI

```ts
import { synthesize } from "./index.ts";

const audio = synthesize({
  model: "mars8-flash",
  voice: "147320", // existing catalog, shared, or custom voice ID
  language: "en-us",
  text: "Hello world!",
  output: { format: "mp3" },
}, { auth: { camb: { apiKey: "..." } } });
```

The key can also come from `SPEECHSWITCH_CAMB_API_KEY`, then `CAMB_API_KEY`.
Configuration and network overrides resolve at the provider boundary.

One `synthesize` operation selects the protocol:

- Complete text without timestamps uses `/apis/tts-stream`, a byte-native HTTP
  stream. All three cataloged MARS 8 models and both documented MARS 8.1 beta
  models are supported. The deprecated asynchronous task API is not needed.
- Incremental text uses `/apis/live-tts/ws`. This endpoint is fixed by CAMB to
  `mars-8.1-flash-beta`, exposed as `mars8.1-flash-beta`; it cannot select the
  older Flash model. Text is not modified or segmented by the adapter.
- `timestampGranularity: "word"` uses the live endpoint for whole or incremental
  text. Each segment's timestamps and audio frames carry `correlation: "ordered"`
  and the native segment ID as `correlationId`. Times are relative to that segment,
  not an inferred global timeline. Audio frames are yielded before `segment.done`.
  Consumers that need complete encoded segments can explicitly buffer by ID.

Timestamp resolution is best-effort upstream. Missing timestamps remain an empty
array; they never delay playback. A skipped segment fails synthesis explicitly
rather than silently dropping text or replaying it out of order.

Sample encoding and byte order remain independent fields for raw PCM. HTTP AAC
maps to the documented `adts` wire format; live AAC uses the native `aac` value.
Live TTS does not support raw PCM or a requested encoded bit rate.

`textFlushDelayMs` is the idle delay for incomplete trailing text, not a maximum
latency for all text. Complete sentences can flush immediately. `inferenceSteps`
is exposed independently; it is not reduced to a boolean quality setting.

There is no documented clear command/acknowledgment. Abort cancels this operation;
start another synthesis for the next utterance. Cancellation, early output exit,
input failure, and protocol errors close the socket and request input cleanup.
Uncooperative input iterators cannot block termination or send late text.

## Source and generation boundary

Unchanged OpenAPI, AsyncAPI, and reference documentation snapshots are cataloged
with URLs and hashes. The selected HTTP operation and all live message payloads
are structurally specified, so their wire types, request validation, server-frame
validation, endpoint path, HTTP auth header, and server addresses are generated
from the schema graph. Unsupported schema constructs fail generation.

Generated clients contain specialized code, not runtime schema descriptors or an
interpreter. The identity-mapped locale union is generated into the runtime-free
schema project; the normalized request union remains authored independently.

Protocol sequencing, fixed live model, query authentication at the native socket
boundary, timestamp semantics, and failure policy remain explicit adapter code.
Contract mutation tests execute changed generated code to verify it enforces the
changed contract instead of merely reproducing a static template.

Verification includes TypeScript 7, source hashes, generation freshness, protocol
and lifecycle tests, native Node HTTP/binary-WebSocket loopback tests, and a
browser bundle check. These are not live authenticated CAMB API tests. Do not
expose a secret provider key in a public browser bundle; keep it on a trusted server.
