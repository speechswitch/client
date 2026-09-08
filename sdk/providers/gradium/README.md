# Gradium

One `synthesize` operation streams raw HTTP audio for complete text, NDJSON
envelopes when timestamps are requested, and WebSocket output for incremental
text or pronunciation dictionaries. The wire protocol is handwritten in the
provider: the current OpenAPI omits model/tuning fields and response schemas.
Normalized request and async-item validation is still generated from TypeScript.

```ts
import { synthesize } from "../../index.ts";

for await (const audio of synthesize("gradium", {
  model: "default",
  voice: "your-library-or-existing-custom-voice-id",
  text: "Hello!",
  output: { format: "pcm", sampleRateHz: 24000 },
}, { auth: { gradium: { apiKey: "..." } } })) {
  // Consume audio as it arrives; buffering is a consumer operation.
}
```

## Models and controls

`model` defaults to `"default"`; `"gradium-tts-beta"` selects the preview. Those
are the current documented wire aliases, not the issue's older `tts`/`tts-beta`
labels. Both currently document the same capabilities, so they share one plain
request shape. Existing custom voice IDs work with both. Creating/cloning voices
is a separate operation; the synthesis API does not accept inline reference audio.

| Normalized field | Native setting | Accepted range | Default |
| --- | --- | --- | --- |
| `temperature` | `temp` | 0–1.5 | 0.7 |
| `voiceGuidance` | `cfg_coef` | 1–10 | 2 |
| `pacingBias` | `padding_bonus` | -5–5 | 0 |

These are Gradium's documented validation ranges. Recommended tuning ranges are
narrower: temperature through 1.4, guidance 1–4, and pacing -4–4. The schema does
not discard accepted values. Positive pacing bias slows speech, negative speeds
it up; it is **not** a multiplier. Guidance is a conditioning coefficient, not a
0–1 similarity score. No undocumented conversion is applied to either control.

`textNormalization` is one cohesive value:

- Omitted or `"auto"`: use the voice language's default rewriting rules.
- `false`: send `"none"`, disabling rewriting.
- `{ locale: "fr-ch" }`: select a documented language alias.
- `{ rules: ["CurrencyFrCh", "UrlFr"] }`: apply the selected native rule IDs in order.

Do not combine locale and rules, or pass an empty rule list. `lexicon` selects an
existing pronunciation dictionary ID and uses WebSocket synthesis even for a
complete text string; the REST endpoint cannot apply dictionaries. Pattern-based
normalization is available over both transports. There is no separate TTS language
field: rewriting language and voice language are not interchangeable.

## Audio formats

PCM is mono signed 16-bit little-endian. `sampleRateHz` accepts 8000, 16000,
22050, 24000, 44100, or 48000 (default). WAV is fixed at 48000 Hz/s16le mono.
`ogg_opus` maps to native `opus`; no unsupported bitrate or resampling control is
offered. `mulaw` and `alaw` are headerless 8000 Hz telephony audio. Native names
such as `pcm_16000` stay at the wire boundary, not in normalized `format`.

## Incremental input and interruption

`text` also accepts `AsyncIterable<string | { command: "flush" }>`.
Gradium inserts a space between native text messages. The adapter therefore
retains unfinished words and markup until a whitespace boundary, a complete
`<flush>` tag, an explicit flush command, or input completion. LLM tokens such as
`"Hel"`, `"lo"`, `","`, `" world"` cannot accidentally become `"Hel lo , world"`.
Whitespace at message boundaries may be normalized by the provider.

`{ command: "flush" }` sends the native `<flush>` text tag. It does not reset the
session or discard already-produced audio. There is no documented TTS clear
command or correlated flush acknowledgement; none is fabricated. For barge-in,
abort the operation, stop/clear local playback, and open another operation.

The adapter sends setup first and then input without adding a ready round-trip;
the current protocol explicitly allows this. Output is consumed concurrently and
must begin with ready. WebSocket completion requires native `end_of_stream`;
HTTP NDJSON completion is EOF, with an optional terminal message. Producer errors,
socket errors, deadlines, abort, and consumer exit close the operation without
waiting for an uncooperative input iterator's `next()` or `return()`.

Each call owns one session and closes its socket. Shared-socket multiplexing is
not exposed by this operation; an injected socket must be exclusive to the call.
`setupRetryMs` optionally configures the server's worker-allocation retry window
and selects WebSocket transport. It defaults to zero and never retries billable
synthesis automatically.

## Timestamps

Set `timestampGranularity: "segment"`. Gradium promises text segments, often
but not always word-aligned—not character or guaranteed word timings. The output
uses `correlation: "timeline"`, preserving independent audio and text events.
An audio envelope carries empty `timestamps`; a text envelope carries no audio.
Native `stream_id`, when supplied, becomes `correlationId`. Native audio
`start_s`/`stop_s` becomes `audioTiming: { startTimeMs, endTimeMs }`; text ranges
become segment timestamp fields in the same timeline. Neither range nor packet
association is guessed from arrival order. No range is invented when audio
messages omit it.

## Authentication, runtimes, and endpoints

`auth.gradium.apiKey` takes precedence over `SPEECHSWITCH_GRADIUM_API_KEY`, then
`GRADIUM_API_KEY`. Native Node/Bun WebSockets and HTTP use the `x-api-key` header,
never a key in the URL. Browser WebSockets instead accept
`auth.gradium.singleUseToken`, placed in the documented `token` query parameter.
Obtain a new short-lived token from trusted backend code for each connection;
do not expose the API key or reuse a consumed token. An authenticated
`webSocket?: WebSocketLike` is also available for tests or runtime overrides.

`fetch`, `baseUrl`, `webSocketUrl`, `signal`, and whole-operation `timeoutMs` are
injectable. `baseUrl` defaults to `https://api.gradium.ai/api`; preserve `/api`
when selecting EU/US endpoints or proxies. An explicit `webSocketUrl` is a full
endpoint URL; otherwise it is derived from `baseUrl`. Region hostnames alone do
not create a residency guarantee—Gradium requires enrollment in the relevant
plan. This adapter does not assert residency from the hostname.

## Verification and source discipline

Unchanged raw sources are cataloged with their URLs and SHA-256 hashes. The fresh
OpenAPI has one HTTP synthesis operation, `/post/speech/tts`; `/speech/tts` is the
WebSocket upgrade route, not the second POST mentioned in the original issue.
REST's own prose documents `model_name` and a JSON-string `json_config` in the
body even though its schema omits both. The adapter uses that explicit body
contract, not a stale guide's query-string wording.

Tests cover native Node auth handshakes (key and token), early HTTP/socket audio,
input buffering/flush, timestamp timelines, exact errors, cancellation/deadlines,
generated model/field checks, source contradictions, and playground defaults.
No paid live-provider synthesis was performed.
