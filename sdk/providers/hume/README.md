# Hume / Octave

One `synthesize` operation supports static text, dialogue turns, and incremental
text/turns over a native WebSocket. Use `model: "octave-1"` for acting directions
or novel voice design; `model: "octave-2"` requires a saved voice and supports word
and phoneme timestamps. The generated playground form follows these same types.

```ts
import { synthesize } from "../../dispatch.ts";

const audio = synthesize("hume", {
  model: "octave-2",
  text: "Welcome back.",
  voice: "your-existing-custom-voice-id",
  output: { format: "pcm" },
});
for await (const chunk of audio) { /* consume bytes as they arrive */ }
```

Authentication resolves `auth.hume.apiKey`, then `SPEECHSWITCH_HUME_API_KEY`, then
`HUME_API_KEY`. Existing custom voices are the default namespace; set
`voiceSource: "catalog"` for a voice-library entry. `voiceName` selects by name
instead of ID. Voice conditioning audio is not a synthesis input: enrollment and
voice conversion are separate Hume operations and are not performed implicitly.

`auth.hume.accessToken` supports short-lived browser credentials. HTTP uses bearer
authentication for tokens or `X-Hume-Api-Key` for keys. Native WebSockets use the
documented `access_token` / `api_key` query authentication. Never expose a private
API key to browser code or log authenticated socket URLs. Supply an authenticated
`webSocket` override only for incremental input; each call owns and closes it.

Static input uses the byte-native streaming-file endpoint. Incremental input uses
binary WebSocket audio, preserving token boundaries verbatim. An iterator can
yield `{ command: "flush" }`; ending it sends native `close: true` and drains the
server until successful socket closure. Hume does not document a TTS clear command
or flush acknowledgement. Abort the call to cancel; it does not reconnect or
replay billable input. `signal` and `timeoutMs` cover transport and producer waits.

Choose `timestampGranularity: "word"`, `"phoneme"`, or both as an array to receive
JSON envelopes. Independent audio and timestamp events retain native snippet IDs;
no chunk association or global timing offset is inferred. Aggregate final-snippet
audio/timestamps are not emitted a second time. `generationId`, `requestId`, native
chunk indices and final-chunk flags are preserved. `includeMetadata: true` in
provider options selects these envelopes without requiring timestamps, including
Octave 1. Continue with `contextBefore: { requestIds: [generationId] }`.

HTTP also supports preceding text or reference dialogue turns as context. Dialogue
uses `speakers` with unique aliases and `turns` referencing them. Each turn can set
speed and trailing silence (milliseconds), plus Octave 1 acting directions.
`splitTurns` controls native HTTP utterance splitting; it is excluded from live
input. `latencyOptimization: "none"` disables instant mode. Voice design uses
`voiceDescription`, not acting instructions, and disables instant mode. Each call
produces one generation; it never concatenates competing candidate generations.

The unchanged Fern IR, OpenAPI, AsyncAPI and protocol references are cataloged in
`schemas/sources.yaml`. Fern's JSON-stream response has no item or framing graph;
AsyncAPI omits binary and error responses. Wire behavior is handwritten here;
request validation and capabilities are generated from the plain authored schema.
No third-party runtime dependency or compiler API enters the browser bundle.
