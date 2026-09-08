# Microsoft Azure Speech

`synthesize("microsoft", request, options)` always returns a stream. Whole text
uses the byte-native SSML REST endpoint; incremental input uses WebSocket v2.
Whole-text timestamp requests use the Speech SDK's WebSocket v1 endpoint. Both
transports are handwritten from the unchanged, hashed first-party sources in
`schemas/sources/microsoft/`.

The cataloged TypeSpec and 2026-01-01 Swagger describe management operations,
not this synthesis protocol. They are retained for provenance, not used to
manufacture a generated wire client. The canonical TypeScript request schema
does generate runtime request checks, playground controls, and Rust/Python/Go
types. Those foreign-language packages remain type foundations, not network SDKs.

## Requests

```ts
import { synthesize } from "../../dispatch.ts";

for await (const event of synthesize("microsoft", {
  model: "dragon-hd-omni",
  voice: "en-US-Ava",
  text: "Hello!",
  temperature: 0.7,
  topK: 22,
  timestampGranularity: "word",
})) {
  // Audio and timestamps use separate envelopes on the same native timeline.
}
```

For HD/MAI models, `voice` is the persona before the colon; the selected `model`
adds the documented model suffix. `neural` uses the full catalog/custom voice
name unchanged. `options.deploymentId` selects an existing custom deployment
independently of that voice name. Default output is raw mono 24-kHz signed 16-bit
little-endian PCM; output variants encode valid sample-rate/bitrate combinations.
HD keeps the required `en-US` root SSML locale and maps an explicit `language`
override to a nested `lang` element; omission does not force that override.

| Model | Normalized controls |
| --- | --- |
| `neural` (default) | Speed, pitch, volume scale, voice-specific speaking style; word/sentence timing |
| `dragon-hd` | Temperature; whole-text pronunciation enhancement |
| `dragon-hd-omni` | Temperature, speaking style, word timing; whole-text top-p/top-k/guidance |
| `dragon-hd-flash` | Speaking style, English/Chinese locales |
| `mai-voice-2`, `mai-voice-2-flash` | Speaking style |

The current upstream MAI catalog supersedes the issue's `mai-voice-1` entry with
MAI-Voice-2 and MAI-Voice-2-Flash. Availability and styles still depend on the
voice and region. No exhaustive live voice catalog is hardcoded into the schema.

`inputType: "ssml"` accepts a complete document, with voice/model/language and
delivery authored inside it instead of simultaneously supplying normalized
controls. This supports advanced SSML and existing legacy/custom voices without
claiming every model supports every SSML element. Raw SSML can request word,
sentence, bookmark (`ssml`), and viseme metadata; support depends on its voices.

Incremental `text` is `AsyncIterable<string>`. No SSML concatenation or simulated
sentence batching is performed. WAV is exposed only over REST: this adapter does
not fabricate unknown-length RIFF headers for a live stream. WAV plus timestamps
is consequently excluded by the request schema. Sampling knobs without a v2
wire equivalent are also excluded from incremental requests.

## Authentication and cancellation

Provide the shared `auth.microsoft` entry:

```ts
const auth = { microsoft: { apiKey: "...", region: "eastus" } };
// Or { microsoft: { accessToken: "short-lived Speech token", region: "eastus" } }.
```

Environment fallbacks are `SPEECHSWITCH_MICROSOFT_API_KEY` / `AZURE_SPEECH_KEY`,
`SPEECHSWITCH_MICROSOFT_REGION` / `AZURE_SPEECH_REGION`, and
`SPEECHSWITCH_MICROSOFT_ACCESS_TOKEN`. Explicit credentials override environment
credentials. If both explicit credential forms are supplied, the token wins.

Node/Bun native sockets authenticate in upgrade headers, never by putting a
subscription key in a URL. Browsers need an already-authenticated `webSocket`
override for socket synthesis, or a server-side call. Whole-text REST accepts
injected `fetch`. `baseUrl`, `webSocketUrl`, and `webSocket` support testing and
custom endpoints; an injected socket is exclusive and closed on completion.

`signal` and `timeoutMs` cover input, connection, and response waits. Consumer
return sends the native stop control when possible and closes the socket;
aborting closes it immediately. Input cancellation does not wait indefinitely
for an uncooperative producer. This adapter does not expose a reusable-session
`clear` command or fabricate an acknowledgement: a subsequent utterance starts a
new synthesis operation.

Audio frames retain native stream IDs. Independent metadata keeps its request
timeline; no source offsets or audio-chunk association are guessed from arrival
order. Viseme animation chunks remain opaque and retain their final-chunk flag.
Session duration is converted from native 100-nanosecond ticks to milliseconds.

Tests use protocol fixtures and native Node loopback connections; no paid Azure
synthesis request has been made as part of verification.
