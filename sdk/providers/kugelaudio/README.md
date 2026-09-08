# KugelAudio

Native TTS integration for issue #14. The canonical `kugel-3` model and documented
legacy aliases share the same controls; aliases may route to the current model.
Use a catalog/custom voice handle or legacy numeric voice ID. Voice creation,
dictionary management, realtime voice agents and concurrent multi-context socket
multiplexing are separate operations, not capabilities of this one-voice
`synthesize` operation.

```ts
import { synthesize } from "../../dispatch.ts";

for await (const item of synthesize("kugelaudio", {
  text: "Hello from an existing voice.",
  voice: "your-custom-voice-handle",
  output: { format: "pcm", sampleRateHz: 24000 },
}, { auth: { kugelaudio: { apiKey: "your-key" } } })) {
  // Consume Uint8Array audio incrementally. Buffer only if your application needs it.
}
```

Authentication resolves `auth.kugelaudio.apiKey`, then
`SPEECHSWITCH_KUGELAUDIO_API_KEY`, then `KUGELAUDIO_API_KEY`. HTTP uses bearer
authentication. Native Node/Bun WebSockets use the Authorization header, not a
secret-bearing URL. Browsers need a caller-supplied authenticated `webSocket` or
server proxy; this adapter does not expose a permanent key automatically. The
provider's realtime-only client secrets are not TTS tokens.

`baseUrl` overrides `region`, which overrides an `eu-` key prefix. The prefix is
removed before authentication. `region: "eu"` pins the direct EU endpoint;
`"global"` selects the canonical geo-routed endpoint. `webSocketUrl` overrides
the complete socket URL. Injected sockets belong exclusively to this operation
and close on completion, failure, abort or consumer return.

## Audio and request controls

Whole text uses raw-byte `POST /v1/tts/generate`. Word timestamps, an explicit
`voiceBoost` (native speaker prefix), or a socket override select `/ws/tts`.
Incremental text uses `/ws/tts/stream`. Native WebSocket audio is necessarily
base64-encoded JSON; only that path decodes base64. There are no runtime packages,
compatibility-proxy detours or implicit whole-response buffers.

PCM is signed 16-bit little-endian mono, with 8000/16000/22050/24000/44100 Hz
output. G.711 `mulaw` and `alaw` use 8000 Hz. Format and sample rate stay separate
in the normalized request. The adapter uses legacy `sample_rate` for PCM because
the native combined-token catalog has no `pcm_44100`. The native format set does
not include MP3; this integration does not silently switch to an ElevenLabs
compatibility endpoint for transcoding.

Language omission leaves normalization's automatic detection intact. Static
temperature defaults to 0.4; live temperature omission must remain unset.
`voiceGuidance`, `maxAudioTokens`, `speed`, `textNormalization`,
`textFlushDelayMs` and `textBufferThreshold` map explicitly to their native
controls. Buffer settings belong only to streaming input. Inline break, spell
and prosody-rate tags pass through; this is not a general SSML implementation.

`pronunciationDictionarySelection: { scope: projectId, ids?: dictionaryIds }`
keeps the scope/selection together. Omitted selection loads no dictionaries;
omitted IDs load the project's active, language-filtered defaults; `ids: []`
disables them; explicit IDs include inactive dictionaries and bypass language
filtering. Remote ownership/access checks remain server responsibilities.

## Streaming turns

```ts
async function* text() {
  yield "First answer.";
  yield { command: "clear" } as const;
  yield { command: "update", speed: 1.1, temperature: 0 } as const;
  yield "Replacement answer.";
  yield { command: "flush" } as const;
}
```

`clear` sends `cancel`, discards in-flight output, and yields `event: "clear"`
only on `interrupted`. Stop local playback when initiating a barge-in. `flush`
ends a turn, waits for `final` followed by `session_closed`, and yields a flush
event with the turn ID and any native usage. New text then starts the next turn
on the same socket. End-of-input flushes an active turn once and closes the
connection; empty input does not manufacture a turn. An abort abandons the whole
operation instead of draining it.

`update` supports guidance, temperature, token limit, language, normalization and
speed. It updates only supplied fields and yields the native acknowledged
settings as `event: "updated"`. Settings apply to the **next turn**, not current
generation. Voice, model, format, dictionaries and pronunciation replacements
cannot change through this command. A different voice/model requires a new
`synthesize` call.

Native idle auto-flushes also end turns; they do not terminate the input iterator.
Use `onWarning` to observe provider advisories. Sending raw text tokens does not
flush each token: the server chooses sentence boundaries. Continue consuming the
output while supplying commands; async-iterator backpressure also pauses command
processing. `signal` and `timeoutMs` cover producer and transport waits, including
blocked input and response bodies. Cleanup does not wait for an uncooperative
producer's `return()`.

Word timestamps arrive after audio and refer to the normalized/dictionary-rewritten
text of their native `chunk_id`, not the original request. Envelopes have
`correlation: "ordered"`, a turn-scoped native chunk ID, and chunk-relative
audio/timestamp ranges. Multiple audio frames can share that ID; out-of-order
alignment keeps its original association. Audio is never held waiting for
alignment. Character offsets and confidence are preserved. Usage reports retain
an unavailable cost as null rather than zero.

## Sources and verification

Unchanged OpenAPI and documentation snapshots are cataloged with URLs and SHA-256
hashes in `schemas/sources.yaml`. The OpenAPI omits WebSockets, describes successful
raw audio as unconstrained JSON, and does not require the documented mandatory
voice. `sources.node-test.ts` pins these gaps. No repaired specification or
template-based fake codegen is used: the wire protocol lives here.

Authored types in `schemas/providers/kugelaudio/index.ts` generate runtime request
checks, playground controls, and Rust/Python/Go request types. Token and buffering
integers, dictionary scope/ID integers and selection cardinality come from annotations.
Handwritten checks remain for wire/protocol validity, mixed string/numeric voice
constraints. Amazon's string-only stream and xAI's required
replacement updates remain narrower than the shared request.

Tests use injected transports and real loopback Node HTTP/WebSocket connections.
They cover incremental bytes, native header auth, regions, turn reuse, barge-in,
updates, trailing timestamp association, cleanup and deadlines. No paid provider
request or voice-quality test has been run. Python, Go and Rust synthesis adapters
use the generated types and validators; see `sdks/README.md` for their native and
injected transport requirements.
