# Async

An authored adapter, not a generated client: the exported OpenAPI describes audio
as empty objects, nests unrelated OpenAPI documents inside response entries, and
omits WebSockets and model-specific restrictions. The unchanged export and the
separate protocol/model documentation are cataloged with hashes and acquisition
parameters in `schemas/sources.yaml`.

```ts
import { synthesize } from "./index.ts";

const audio = synthesize(
  {
    model: "flash_v1.5",
    voice: "your-existing-catalog-or-custom-voice-id",
    text: "Hello!",
    output: { container: "raw", codec: "pcm", sampleRateHz: 24000 },
  },
  { auth: { async: { apiKey: "..." } } },
);

for await (const chunk of audio) {
  // Consume raw audio bytes.
}
```

Configuration resolves once at the public boundary. The API key can also come
from `SPEECHSWITCH_ASYNC_API_KEY` or `ASYNC_API_KEY`, in that order.
Request combinations, bounds, and input items are checked by validators generated
from the authored provider schema, including integer sample rates and bit rates.
`@serializeAs` generates direct language, speed, sample-rate, and bit-rate settings
mappings. Model IDs, voice selection, PCM sample formats, and stability scaling
remain explicit protocol conversions.

`synthesize` yields raw audio bytes. `synthesizeWithTimestamps` preserves native
word alignment in audio envelopes, matching the shared SDK operations:

- Complete text uses byte-native streaming HTTP, except WAV, which needs the
  provider's full-file endpoint. The SDK still yields its response body directly.
- `synthesizeWithTimestamps` with `timestampGranularity: "word"` uses the HTTP
  timestamp endpoint and yields a
  chunk-correlated audio/timestamp envelope. This provider response contains the
  entire base64 audio file; incremental timestamps are not documented.
- `AsyncIterable<string>` uses the documented WebSocket protocol. Each value is a
  text segment; Async requires a trailing space. Use `segmentation: "immediate"`
  to force synthesis of each segment, otherwise sentence buffering is retained.

The cataloged `castleflow-1.0` model maps to the current `async_flash_v1.0` wire ID.
Only that model supports speed and stability. Normalized stability is 0–1 and is
rounded to the nearest hundredth for the native integer 0–100 scale; every native
level is representable. Flash v1.5 supports six languages; Pro v1.0 only English.

Async documents no clear command/acknowledgment. The request type therefore accepts
only strings, with no synthetic clear events. Abort cancels the current operation;
start a new synthesis for the next utterance. Early output termination closes the
socket and requests input iterator cleanup. An input iterator that ignores return
cannot be forcibly unwound, but its late values are never sent.

HTTP cancellation interrupts stalled headers and body reads even when an injected
fetch ignores its signal. Late responses and early consumer termination release
response bodies without waiting for an uncooperative cancellation callback.
Custom base URLs retain their path prefix and query. Redirects are rejected so
requests carrying credentials cannot be forwarded to another destination.

Both Node's native WebSocket and browser WebSockets use the documented query-string
authentication. Never ship a secret provider API key in a public browser bundle;
use a trusted server for production credentials. `fetch` and `webSocket` remain
injectable for tests and runtime overrides.

Verification includes model/transport type exclusions, wire serialization, stream
cleanup and error cases, source hashes, and Node loopback HTTP/WebSocket tests.
Loopback tests do not constitute live upstream API validation.

Audio output uses independent `codec` and `container` fields. Raw/WAV PCM supports
`sampleFormat: "int16" | "float32"`; raw G.711 uses `codec: "mulaw"` without a PCM
sample format. MP3 uses `codec: "mp3"` with provider-fixed framing and no container
selection. The base output union rules out incompatible combinations before
provider-specific model and transport restrictions are applied.
