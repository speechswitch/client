# Cartesia

```ts
import { synthesize } from "./index.ts";

const audio = synthesize({
  model: "sonic-3.5",
  voice: "your-existing-custom-or-catalog-voice-id",
  text: "Hello world!",
  output: { format: "mp3", sampleRateHz: 44100, bitRateBps: 128000 },
}, { auth: { cartesia: { apiKey: "..." } } });
```

Auth resolves from the shared `Auth` object, then
`SPEECHSWITCH_CARTESIA_API_KEY` / `CARTESIA_API_KEY` or
`SPEECHSWITCH_CARTESIA_ACCESS_TOKEN` / `CARTESIA_ACCESS_TOKEN`.
HTTP sends a Bearer credential and `Cartesia-Version: 2026-08-14`.
Native WebSockets use `access_token` and `cartesia_version` query parameters.
When only an API key is available, the adapter first exchanges it via injected
`fetch` for a TTS-only, 60-second access token. The secret key is never put in the
WebSocket URL. An injected, already-authenticated `webSocket` bypasses that exchange.
Keep API keys on trusted servers; browser applications should receive short-lived
tokens from their own backend. Pass a fresh token for each operation as needed.
Custom HTTP base URLs retain their proxy path prefix and query parameters for
both synthesis and token exchange. WebSocket overrides are complete endpoint URLs.

One `synthesize` operation always streams its output:

- Complete text defaults to byte-native `/tts/bytes`, without base64 or buffering.
- `timestampGranularity: "word"`, `"phoneme"`, or `["word", "phoneme"]` selects
  `/tts/sse` for complete text. SSE and WebSocket accept only raw audio encodings;
  MP3 and WAV remain exclusive to byte HTTP.
- Incremental text uses `/tts/websocket`. Strings concatenate verbatim; callers
  retain control of whitespace. `maxBufferDelayMs` defaults to 3000, per the
  buffering guide; set 0 for immediate generation of client-buffered phrases.
  This maximum wait is distinct from another provider's idle-only flush delay.

Sonic 3 and 3.5 support base language codes. Sonic 3.6 also accepts regional
locales, through the same normalized `language` field. The adapter never sends
both wire fields. `accent`, `speed`, `volumeScale`, `emotion`, `lexicon` (one
pronunciation dictionary ID), and text normalization are independent controls.
Use `textNormalization: { locale: "en-IN" }` to choose a normalization locale
independent of the synthesis language. Voice IDs include existing custom voices;
no reference recording is required. The emotion union follows the full list in
the generation-control guide, not the stale five-value WebSocket schema. The
guide describes these controls as guidance, and emotion tags as English-only;
do not assume strict acoustic adjustments or equal results across languages.

## Streaming lifecycle

Incremental input accepts strings, `{ command: "clear" }`, and
`{ command: "flush" }`:

- Clear sends a context cancellation, retires the old context, yields
  `{ event: "clear" }`, and uses a new context for subsequent text. This event is
  a **local playback boundary**, not a fabricated server acknowledgment. Cartesia
  may continue generating already-started work; its late audio, timing, errors,
  and completion are discarded. Consumers must stop/clear their playback queue.
- Flush sends an empty transcript with `continue: true` and `flush: true` without
  ending the context. The server's `flush_done` produces an `event: "flush"`
  carrying `correlationId` (context) and `inputGroupId` (native flush ID).
  Native group IDs on audio are preserved even when timing was not requested.
- End of input sends an empty transcript with `continue: false`. An observed
  context `done` while input is still open rotates the context for future text;
  no expiry is guessed from local clocks and no failed text is silently replayed.

Timestamped output uses `correlation: "timeline"`. Audio and timing arrive in
separate envelopes, sharing their native context as `correlationId`. Word and
phoneme seconds become milliseconds. `inputGroupId`, when supplied upstream,
identifies a flushed input group; it does not reset the context's timestamp
origin. There is no association guessed from adjacent audio/timing arrivals.
`timestampText` chooses `"original"` (adapter default) or `"normalized"` text.

`signal` aborts the operation. Optional `timeoutMs` is a whole-operation deadline,
including token exchange, socket opening, input waits, and response streaming.
There is no arbitrary default synthesis duration limit. Premature server closure
(including the documented five-minute WebSocket idle limit) fails explicitly.
Abort, protocol/input failures, and early output exit release socket listeners,
close the transport, and request source iterator cleanup. A stalled input
iterator cannot block cancellation or send text after termination.

`CartesiaError` retains `statusCode`, nullable/unknown `errorCode`, `requestId`,
`docUrl`, and `contextId` when supplied. Error handling does not depend on a closed
enum of today's error codes. Legacy plain-text HTTP failures remain readable.

## Why the wire implementation is handwritten

The unchanged sources and exact acquisition URLs/hashes are in
`schemas/sources.yaml`. The structured chunk schema omits the `flush_id` documented
by the flushing guide. The cancel description claims no further output, whereas
the context guide explicitly permits already-generating output. Error nullability
also disagrees with the API-error guide, and the WebSocket emotion enum omits
values explicitly supported by the generation-control guide. These are not
complete, trustworthy contracts for generating this integration.

The protocol therefore lives directly in this provider module: no extracted or
hand-repaired spec, static client template, or runtime schema interpreter.
Normalized schema checking, source integrity, registry/spec generation, and
provider narrowing still apply. This supersedes issue #5's older blanket request
for generated wire clients, following the updated repository direction.

Normalized request and streamed-item checks are generated from the provider's
authored schema: model/locale variants, output combinations, forbidden fields,
and annotated bounds are not duplicated in the adapter. Handwritten checks cover
wire responses, protocol state, and the public operation deadline.

Tests cover protocol/lifecycle behavior, TypeScript 7 negative cases (including
Amazon's narrower text iterable), native Node HTTP/SSE/WebSocket and token-exchange
loopback execution, and browser bundling. They are not live authenticated Cartesia
service tests; real synthesis quality and upstream behavior still need a provider
credential and manual/live validation.
