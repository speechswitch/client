# xAI TTS

The TTS wire protocol is handwritten: the REST reference types latency as only
`"0" | "1"`, while the TTS guide documents integer levels `0 | 1 | 2`; the reference
does not provide a complete WebSocket contract. Unmodified upstream snapshots and
their hashes are cataloged in `schemas/sources.yaml`. Request validators are
generated from **our** authored provider types, independently of wire codegen.

## Session input and output

```ts
import { synthesize } from "./index.ts";

const text = (async function* () {
  yield {
    command: "update",
    replacements: [{ pattern: "Acme Mobile", replacement: "Acme Mobull" }],
  } as const;
  yield "Welcome to Acme Mobile.";
  yield { command: "flush" } as const;
  yield { command: "update", replacements: [] } as const;
  yield "This utterance uses the original pronunciation.";
})();

// Node >=22.18 and Bun authenticate their native WebSocket using auth.xai.apiKey
// or SPEECHSWITCH_XAI_API_KEY / XAI_API_KEY. No socket override is required.
for await (const item of synthesize({ text, language: "en" })) {
  if (item instanceof Uint8Array) { /* enqueue audio */ }
  else if ("event" in item) { /* updated, done, or clear */ }
}
```

- String input uses byte-streaming HTTP; iterable input uses one WebSocket session.
- Omitted `language` defaults to `"auto"` on both transports. The authored `@default`
  annotation supplies generated defaults, documentation, and playground initialization.
- `update` replaces the entire session pronunciation map. `[]` removes it. The
  `updated` event reports the map echoed by the server, not a guessed local state.
- An utterance uses the map present when its first text arrives. A mid-utterance
  update affects the next utterance. Maps survive `clear`; text is not rewritten
  locally, so phrase matching can span input chunks.
- `flush` maps to `text.done`. The adapter waits for `audio.done` before sending
  text for the next utterance. A `done` event preserves the native `traceId`.
  Finishing the input iterator flushes trailing text and waits for pending ACKs.
- `clear` cancels the current utterance. Audio arriving while cancellation is
  pending is discarded; `clear` is emitted on the real `audio.clear` ACK. Consumers
  must also clear their playback queue. The next utterance waits for that ACK.
- `signal` aborts the connection; producer errors and early consumer exit clean up
  the socket and request producer cancellation without awaiting a stalled return.
- Use `timestampGranularity: "character"` on the same `synthesize` operation for
  timestamp envelopes. This replaces xAI's former `synthesizeWithTimestamps` export.
  Native chunk association and duration are retained in milliseconds. Replacement
  timestamps describe substituted text; do not index them into the original text.

## Coverage and boundaries

Supported synthesis options: existing built-in **or custom** voice IDs, language,
all five codecs and six documented sample rates, MP3 bit rates, speed, all three
latency levels, text normalization, pronunciation replacements, and timestamps.
Inline expression/IPA markup passes through unchanged. MP3-only bit rates and
provider-specific commands are checked from the schema; Amazon remains string-only.

Known boundaries, not claims of complete xAI API coverage:

- Node >=22.18 and Bun attach Authorization headers through their native WebSocket
  constructor. Browsers need a backend proxy/socket override; they must not receive
  a long-lived API key. Keys are never placed in a URL or invented subprotocol.
- Voice creation, custom-voice listing/deletion, and speech-to-speech/Realtime are
  separate APIs and are not implemented here. `voices()` lists built-in voices;
  an existing custom voice ID can still be supplied directly to synthesis.
- The provider enforces text/map size limits and pronunciation-key syntax. Local
  checks additionally reject case/whitespace-equivalent duplicate keys rather than
  silently overwriting them during array-to-map conversion.
- Error frames terminate this SDK stream. The provider can keep a session open
  after an invalid map update, but its error frame has no typed correlation to
  distinguish that recoverable error safely from synthesis failure.
- Tests cover protocol behavior with injected sockets and HTTP responses. They
  do not constitute live, authenticated xAI acceptance tests.

Sources: [TTS guide](https://docs.x.ai/developers/model-capabilities/audio/text-to-speech),
[REST reference](https://docs.x.ai/developers/rest-api-reference/inference/voice),
[Node 22.18 native WebSocket header support](https://github.com/nodejs/node/blob/v22.18.0/deps/undici/src/lib/web/websocket/connection.js).
