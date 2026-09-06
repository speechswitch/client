# ElevenLabs

```ts
import { synthesize } from "./index.ts";

const audio = synthesize({
  model: "flash-v2.5",
  voice: "your-existing-custom-or-library-voice-id",
  text: "Hello world!",
  output: { format: "mp3", sampleRateHz: 44100, bitRateBps: 128000 },
}, { auth: { elevenlabs: { apiKey: "..." } } });
```

One `synthesize` operation always returns an audio stream. Complete text uses the
byte-native HTTP streaming operation. WAV uses the ordinary HTTP operation because
WAV is absent from the streaming operation's output enum; the adapter still reads
the response body incrementally. With character timestamps, HTTP uses NDJSON,
except WAV's ordinary JSON response (one audio envelope).

## Incremental input and cancellation

| Model | Wire model | Incremental protocol | Commands |
| --- | --- | --- | --- |
| `flash-v2` | `eleven_flash_v2` | TTS multi-context WebSocket | `clear`, `flush` |
| `flash-v2.5` | `eleven_flash_v2_5` | TTS multi-context WebSocket | `clear`, `flush` |
| `multilingual-v2` | `eleven_multilingual_v2` | TTS multi-context WebSocket | `clear`, `flush` |
| `eleven-v3` | `eleven_v3` | Text-to-Dialogue WebSocket | `flush` |

Supplying an `AsyncIterable` selects the appropriate input-streaming protocol.
V3 registers the chosen voice, then sends `inputs` messages; it is never sent to
the non-v3 TTS WebSocket. This integration synthesizes one selected voice, not a
multi-speaker dialogue script. The separate multi-context *dialogue* operation is
not exposed here. V3 input types therefore reject `clear`; use AbortSignal to
cancel that connection. All HTTP operations also support AbortSignal cancellation.

For Flash/Multilingual, `clear` closes the current context, creates a fresh context
ID, and yields `{ event: "clear" }` as a local playback boundary. This is **not** a
fabricated server acknowledgement. Late audio/final/error messages for retired contexts
are discarded. `flush` forces buffered generation, but no flush-complete event is
invented: this protocol does not identify such an acknowledgement separately.
Consumer exit closes the connection and releases the input iterator. Abort works
even if its pending `next()` never settles. Idle input is kept alive every ten
seconds; `timeoutMs` can bound the entire operation. No synthesis is retried.

Input strings are forwarded without appending a space after each token (which
would corrupt partial words). The protocol initialization space is sent once per
context, and a space is appended when flushing or finishing TTS input. Native
final frames can contain audio: that audio is yielded before completion.

## Controls and types

Independent controls are flat: `stability`, `voiceSimilarity`, `styleExaggeration`,
`voiceBoost`, `speed`, `randomSeed`, `textNormalization`, and
`languageTextNormalization`. Existing library/designed/cloned voices all use
`voice`; reference-audio cloning is a separate provider API, not a required TTS
input. V3 is restricted to stability voice settings, following the current product
guide and dialogue reference; unsupported voice knobs are not silently sent.
Multilingual v2 excludes explicit language selection.

`pronunciationDictionaries` contains ordered `{ id, versionId? }` references (up to
three). Streaming requires explicit versions; HTTP may use the latest version.
`contextBefore` and `contextAfter` each contain either `text` or `requestIds`
(one to three), never both: the provider ignores text when IDs are present.
These context controls and language-specific normalization are HTTP-only.

`textBufferThresholds` specifies successive character thresholds (50–500, last
repeats); `textBuffering: false` selects upstream `auto_mode` and excludes custom
thresholds. They apply only to the non-v3 WebSocket. Its `inputType: "ssml"` enables
upstream SSML parsing. Model-specific pronunciation/tag support remains a provider
constraint; the adapter does not manufacture SSML or rewrite v3 audio tags.

The deprecated HTTP latency optimization remains fully addressable: `none`,
`moderate`, `strong`, `aggressive`, and `maximum` map to levels 0–4. `maximum`
disables normalization and cannot be combined with `true` or `"auto"`. Omitting
this control does not send the deprecated query parameter. Normalization omission
or `"auto"` selects provider automatic behavior; booleans map explicitly to on/off.

Output format, sample rate, bit rate, sample encoding, and byte order are separate
concepts. Provider unions enforce the documented combinations (including the
22.05kHz/32kbps and 24kHz/48kbps MP3 pairs). PCM/WAV use signed 16-bit little endian;
Opus uses 48kHz; A-law and µ-law use 8kHz. Higher quality encodings, zero retention,
voice availability and other account entitlements remain server-enforced.

`timestampGranularity: "character"` returns `correlation: "chunk"` envelopes:
audio and timing come from the same native packet. Seconds from HTTP are converted
to milliseconds; TTS uses camel-case millisecond fields and dialogue uses
snake-case millisecond fields. Missing timing is represented as an empty list,
not fabricated from arrival order. Original and normalized text can be selected;
v3 WebSocket types exclude normalized timing because that field is explicitly
reserved/unused. Malformed or mismatched timing arrays fail instead of being zipped
silently. No synthetic word timestamps are inferred.

## Configuration

API keys resolve from shared `auth.elevenlabs.apiKey`, then
`SPEECHSWITCH_ELEVENLABS_API_KEY`, then `ELEVENLABS_API_KEY`. WebSockets also accept
`auth.elevenlabs.singleUseToken`, taking precedence over API keys for that
connection. API keys travel in the HTTP header or the first WebSocket message,
never the WebSocket URL. Short-lived single-use tokens use the documented query
parameter. Do not expose a private API key in a public browser bundle.

`fetch` and `webSocket` are injectable. Native WebSockets are created only at the
public provider boundary. `baseUrl` changes the API origin and preserves proxy
prefixes and query parameters (including the derived WebSocket endpoint); `webSocketUrl` is a full
endpoint override. `requestLogging: false` requests eligible zero-retention mode.
HTTP errors preserve status, error code, and upstream `request-id`.

## Why this is handwritten

The OpenAPI has substantial structured HTTP coverage, but the combined contracts
are not a complete, trustworthy basis for this provider:

- Every query field in the embedded TTS/dialogue AsyncAPI has only
  `description: Any type`, not its value type, enum, bounds, or default.
- TTS initialization names the auth field `xi-api-key` in its schema, while the
  official examples and multi-context/dialogue schema use `xi_api_key`.
- The multi-context response schema uses `contextId`/`isFinal`, while examples
  on the same page use `context_id`/`is_final`. Both documented spellings are
  accepted explicitly; conflicting values or missing context IDs are rejected.
- Model restrictions and several bounds exist only in prose. For example, the
  generic HTTP voice-settings object does not describe v3's unavailable controls.

Request validation is generated from our own authored TypeScript schema, separately
from wire-client generation. Unions, literals, optional `never` exclusions, and
annotated numeric bounds are not duplicated in the adapter. Generated input-item
checks run when each item arrives, without consuming an iterable during initial
validation. The emitted code consists of specialized predicates, not runtime schema
descriptors. Nonempty voice and dictionary IDs use generated pattern checks.
Integer/cardinality constraints and numeric array-element bounds are authored in
the schema too. `@integer`, `@minItems`/`@maxItems`, and
`@itemInteger`/`@itemMinimum`/`@itemMaximum` generate the same specialized checks in
TypeScript, Rust, Python and Go. Only wire decoding and protocol-state checks
remain handwritten.

The fourteen raw references are preserved as fetched and cataloged with GET
acquisition URLs and SHA-256 hashes. The September 6 refresh changed three Markdown
snapshots only through renewed signed image URLs; the protocol content and all
other snapshots remained byte-identical. HTML is retained as research evidence, not converted to a
hand-repaired schema. No generated client or fixed client template is introduced.
The normalized schema and registry are still generated/validated normally.

Tests cover HTTP and both WebSocket protocols, native Node fetch/WebSocket
loopback exchanges, auth paths, cancellation, UTF-8 framing, last-chunk delivery,
type restrictions, and browser bundling. They do **not** call the live ElevenLabs
service. Account-specific synthesis, voice quality, and disputed upstream control
behavior have not been live-validated in this PR.
