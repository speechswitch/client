# Inworld

`synthesize` always returns an audio stream. Static text defaults to HTTP streaming;
incremental text uses the native WebSocket context protocol. The same operation
can use the single-response HTTP endpoint with `httpMode: "single"`.

```ts
import { synthesize } from "./index.ts";

for await (const output of synthesize({
  model: "inworld-tts-2",
  voice: "your-existing-custom-voice-id",
  text: "Hello!",
  instructions: "speak warmly",
  deliveryMode: "balanced",
  output: { format: "pcm", sampleRateHz: 24000 },
})) {
  // Without timestamps, output is audio bytes (or a native flush event on sockets).
}
```

## Models and request types

The request union distinguishes TTS-2 from Flash/legacy models and static from
streaming input. The generated playground changes controls with those choices.
Rust, Python and Go request types are generated from this same canonical schema.

- `inworld-tts-2`: `deliveryMode: "stable" | "balanced" | "creative"`, no
  temperature. Static input supports `instructions`; WebSocket steering uses
  inline bracket tags, not an invented session instruction field.
- `inworld-tts-2-flash`, `inworld-tts-1.5-max`, `inworld-tts-1.5-mini`: temperature,
  no TTS-2 delivery mode or steering instruction field. The reference describes
  temperature as ignored specifically on TTS-2 and delivery mode as ignored on
  other models. A temperature of zero selects the native default of one.
- The 1.5 aliases are deprecated upstream but remain covered as requested by
  issue #13. Discontinued 1.0 aliases are not exposed as distinct models.
- Voice IDs may refer to built-in or already-created custom voices. Enrollment,
  voice design, batch jobs and long-running async jobs are separate APIs, not
  additional synthesis operations or implicit writes here. Reference recordings
  cannot be submitted directly to these synthesis endpoints.
- Omitted `language` stays omitted: Inworld detects the language and uses the
  selected voice's original prompt. No default English language is inserted.

Supported output is PCM, WAV, MP3, Ogg Opus, mu-law and A-law; HTTP also exposes
FLAC from its reference. PCM is signed 16-bit little-endian. Sample rates and
compressed bit rates remain separate fields with encoding-specific constraints.
The legacy `LINEAR16` wire encoding is not used: unlike `PCM`, it repeats WAV
headers in every chunk. For socket WAV, the adapter strips per-flush repeated
headers and emits one incremental WAV with unknown RIFF/data sizes. Finalize
those sizes after buffering when a consumer requires a seekable file. PCM avoids
container-header processing altogether.

Static text accepts up to 4000 characters in HTTP streaming, or 2000 with
`httpMode: "single"`. Each socket input string accepts up to 2000. Text is sent
verbatim; the adapter does not insert spaces between incremental fragments.
`contextBefore.texts` preserves ordered prior request boundaries over HTTP; their
combined length is limited to 2000 characters. `audioEnhancement` maps HTTP
denoising. These HTTP-only fields are forbidden for streaming input.

## Streaming controls and cancellation

```ts
async function* text() {
  yield "Hello ";
  yield "there.";
  yield { command: "flush" } as const;
  yield "Another sentence.";
}

const controller = new AbortController();
const audio = synthesize({
  model: "inworld-tts-2",
  voice: "Dennis",
  text: text(),
  output: { format: "pcm" },
  textBufferThreshold: 1000,
  textFlushDelayMs: 100,
  automaticTextFlushing: false,
}, { signal: controller.signal });
```

`textBufferThreshold` maps the native character threshold; zero means its default
of 1000. `textFlushDelayMs` is an idle timer, reset by arriving text, not an absolute
delay from the first token. Zero disables that timer. `automaticTextFlushing`
enables the provider's adaptive low-latency/quality mode, recommended for complete
phrase input. Automatic thresholds and explicit flush can coexist.

Create and text messages are pipelined without waiting for `contextCreated`.
The input iterator ending sends `close_context`, which synthesizes any remaining
buffered text; audio drains until `contextClosed`. A bare socket close is an error.

There is **no native clear command** in this TTS protocol. `close_context` flushes,
so it must not be used to emulate cancellation. Abort the operation or stop
consuming its output to close the socket and return unfinished input. Cleanup
does not wait for an uncooperative producer's pending `next` or `return`. A deadline
applies to the whole operation. The adapter does not reconnect, replay text,
refresh credentials, or retry synthesis automatically.

## Timestamp correlation

`timestampGranularity` selects words or characters. Word alignment also preserves
phonemes and visemes, with `wordIndex` retaining each phone's native association
to a token in that message, including whitespace, punctuation and silence tokens.

`timestampDelivery: "trailing"` is the SDK's low-latency default: audio arrives on
a `timeline` envelope and later timestamp-only envelopes have no invented audio
association. `"chunk"` requests native synchronized alignment and returns `chunk`
envelopes. Single-response HTTP naturally has one synchronized audio result.

Socket timestamps reset on each native `flushCompleted`, including automatically
triggered flushes. Envelopes preserve this with `correlationId: "<context>:<ordinal>"`.
Each completion emits `{ event: "flush", correlationId, inputGroupId }`, where
`inputGroupId` is that flush ordinal. It is **not** the index of a client flush
command: automatic flushes count too. No cumulative time offset or audio-chunk
association is inferred from arrival order.

## Authentication and runtime

API key resolution: `options.auth.inworld.apiKey`, then
`SPEECHSWITCH_INWORLD_API_KEY`, then `INWORLD_API_KEY`. Supply the portal credential
as-is; the adapter sends `Authorization: Basic <key>` without encoding it again.

`options.auth.inworld.accessToken` takes precedence over an API key. HTTP uses
Bearer auth. Native WebSockets use the documented `bearer_<token>` subprotocol,
which works in browsers without putting credentials in URL queries. Obtain
one-time tokens on your backend; one is consumed per authenticated connection or
HTTP request. The adapter does not mint or renew them.

Native API-key WebSocket headers require Node/Bun. Browsers should use a token or
an injected authenticated `webSocket`. `fetch` and `webSocket` are injectable;
socket overrides are exclusive to this operation. `baseUrl` preserves proxy path
and query components; `webSocketUrl` can override the full socket URL. Credentials
and handshake headers must not be logged.

## Source discipline

The current references are not the complete Mintlify JSON Schemas described in
the original issue. Fresh snapshots embed UI field lists and literal response
examples. The stream reference lists only `text` and `timestampTransportStrategy`,
omitting required voice/model fields; its Markdown mirror contains only an intro.
Model restrictions are prose, and the socket response list omits phonetic details
documented on the timestamp page. Wire clients cannot be generated reliably from
these partial contracts; the adapter is handwritten, with executable tests pinning
the actual gaps. No source is patched into an artificial OpenAPI contract.

The snapshots and their hashes are cataloged unchanged in `schemas/sources.yaml`.
Current routes are `/tts/v1/voice`, `/tts/v1/voice:stream`, and
`/tts/v1/voice:streamBidirectional`. The fresh `llms.txt` still advertises the old
socket route and calls one delivery option `EXPRESSIVE`; the current reference
and release notes specify `CREATIVE`. The adapter follows the current references
and runnable official examples, not those stale index entries.

Generated validation owns authored unions, literals, forbidden fields and bounds.
Handwritten checks cover protocol state, integer-valued controls, aggregate context
length and the per-socket-string limit that current schema annotations cannot
express. Tests use injected transports and real local HTTP/WebSocket handshakes;
no paid synthesis request is required.
