# Typecast

One `synthesize` operation covers Typecast's byte-native streaming, ordinary,
timestamped and composed synthesis. Both `ssfm-v21` and `ssfm-v30` are modeled in
the runtime-free [canonical TypeScript schema](../../../schemas/providers/typecast/index.ts).
TypeScript 7 generates runtime request checks, playground variants and
Rust/Python/Go request types from that schema.

```ts
import { synthesize } from "./sdk/providers/typecast/index.ts";

for await (const item of synthesize({
  model: "ssfm-v30",
  voice: "uc_existing_custom_voice", // Or a built-in tc_ voice.
  text: "The delivery can follow the surrounding context.",
  emotion: "auto",
  contextBefore: { text: "I just got wonderful news." },
  output: { format: "wav", sampleRateHz: 32000 },
}, { auth: { typecast: { apiKey: "..." } } })) {
  if (item instanceof Uint8Array) {
    // Consume native audio bytes without collecting the whole response.
  }
}
```

Authentication resolves `auth.typecast.apiKey`, then
`SPEECHSWITCH_TYPECAST_API_KEY`, then `TYPECAST_API_KEY`. Requests use `X-API-KEY`.
Keep credentials on your server. Fetch, base URL, abort signal and the
whole-operation deadline are injectable. No third-party runtime dependencies,
SDK imports, attribution telemetry or automatic retries are introduced.

## Models and normalized controls

| Capability | ssfm-v21 | ssfm-v30 |
| --- | --- | --- |
| Explicit languages | 27 | 37 |
| Preset emotions | normal, happy, sad, angry | Those four plus whisper, toneup, tonedown |
| Context-aware emotion | Unsupported | `emotion: "auto"` |
| Existing voice IDs | `tc_` and owned `uc_` | `tc_` and owned `uc_` |
| Incremental input / native clear | Unsupported | Unsupported |

`language` defaults to `auto`, which omits the native language field. Explicit
normalized language tags (`en`, `ko`, `ja`, etc.; `nan` and `yue` remain those tags)
map to the provider's ISO 639-3 codes. Voice availability and permission remain
provider-side checks; selecting an existing custom voice never uploads recordings
or creates a clone.

Preset `emotion` defaults to `normal`, with `emotionIntensity` 0–2 (default 1).
v30 Smart Emotion excludes a simultaneous intensity setting and accepts
`contextBefore.text` / `contextAfter.text`, each at most 2000 code points. v21
excludes Smart Emotion, context and v30-only presets/languages in its type.
The adapter emits v21's plain prompt and v30's native smart/preset discriminator.

`speed` is a 0.5–2 multiplier, `pitchSemitones` an integer from -12 to 12, and
`randomSeed` an unsigned 32-bit integer. Omitted seed remains omitted; zero is
preserved. Text is a nonempty string of at most 2000 Unicode code points. Native
pause markup such as `<|0.3s|>` is passed through unchanged; no SSML or
pronunciation-dictionary capability is invented.

`volumeScale` is relative gain, rounded to the native one-percent steps (0–2 maps
to 0–200). `targetLoudnessLufs` is absolute loudness from -70 to 0. They are
mutually exclusive in the authored type, not checked again with adapter if-chains.
Relative volume requires a non-streaming upstream operation; absolute loudness
works on the streaming endpoint too.

## Transport and output selection

| Request | Upstream operation | Native output |
| --- | --- | --- |
| Default / 32 kHz WAV / MP3 without non-streaming controls | `/v1/text-to-speech/stream` | WAV: mono 16-bit LE at 32 kHz; MP3: 320 kbps at 44.1 kHz |
| Relative volume or explicit 44.1 kHz WAV | `/v1/text-to-speech` | WAV: mono 16-bit LE at 44.1 kHz; MP3: 320 kbps at 44.1 kHz |
| Requested timestamps | `/v1/text-to-speech/with-timestamps` | JSON containing audio and alignment from the same synthesis |
| Composition | `/v1/text-to-speech/compose` | One composed WAV or MP3 file |

The default is byte-native streaming WAV. The first upstream WAV bytes include
the native streaming header (unknown length, `0xFFFFFFFF`); subsequent data is
PCM. Network reads can split headers or MPEG frames, so consumer decoders must
accept incremental byte input. The SDK does not strip headers, decode audio or
pretend each fetch chunk is an independent file.

`transport: "http"` explicitly selects ordinary synthesis and its defaults;
`transport: "stream"` cannot override incompatible controls or sample rates.
An explicitly requested 32 kHz WAV cannot silently become ordinary 44.1 kHz WAV.
These override/protocol checks are separate from generated request validation.

Streaming **output** does not imply streaming **input**: Typecast accepts one
whole JSON request, not `AsyncIterable<string>` or clear/flush/update commands.
Consumer-side cancellation uses `AbortSignal` or iterator return. There is no
documented native barge-in acknowledgment or WebSocket protocol to expose.

## Timestamps

Use `timestampGranularity: "word"`, `"character"`, or `["word", "character"]`.
Array selection is set-like; duplicates do not duplicate marks. An empty array
disables alignment but retains ordinary synthesis's 44.1 kHz WAV defaults.
The native query is `word` or `char`; requesting both omits the filter.

Timestamp synthesis buffers the provider's JSON response because audio is base64
inside that response, not a separate streaming track. It returns one
`correlation: "chunk"` envelope with the decoded `Uint8Array`, native duration in
milliseconds, and the requested alignment tracks. Original punctuation and
whitespace survive. No separate synthesis is used to obtain alignment, and no
association or character offsets are inferred from arrival order.

Japanese/Chinese word alignment may cover the entire sentence; character timing
is generally useful there. The SDK preserves that documented behavior rather than
fabricating finer words. Timestamp responses have a configurable 128 MiB default
byte cap (`maxTimestampResponseBytes`); raw byte streams remain uncapped.

## Composition

```ts
const request = {
  output: { format: "wav" },
  segments: [
    { kind: "pause", pauseMs: 500 },
    { kind: "speech", model: "ssfm-v21", voice: "tc_voice", text: "First voice." },
    { kind: "pause", pauseMs: 1000 },
    { kind: "speech", model: "ssfm-v30", voice: "uc_voice", text: "Second voice.", emotion: "whisper" },
  ],
} as const;
```

Every speech segment has its own model, voice and delivery controls. A single
top-level output format makes mixed per-segment encodings impossible by design.
Pauses are milliseconds, converted explicitly to native seconds. Per-segment
bounds, model variants, mutually exclusive loudness controls and the 1–50 segment
count come from generated validation. Only cross-element invariants remain
handwritten: at least one speech segment, at most 2000 total text code points,
and at most 60000 ms total silence. Each pause is positive and at most 10000 ms;
unit-conversion underflow fails instead of transmitting zero seconds.

This is one native compose call, not separate synthesis calls and local
concatenation. Native ordering and all-or-nothing failure semantics are preserved.
Composed output does not claim timestamps or incremental text support.

## Contract audit and checks

Issue #25 and all comments were read (no comments). Eight unchanged snapshots,
including the public OpenAPI, are recorded with GET URL and SHA-256 in
[`schemas/sources.yaml`](../../../schemas/sources.yaml).

The [public OpenAPI](https://typecast.ai/docs/api-reference/openapi.json) is not
a complete trustworthy generation source: v21 `Prompt` has no object type or
typed emotion properties and overlaps both branches of the request's `oneOf`.
Model restrictions, smart-context lengths and exclusive volume/LUFS choices are
in prose rather than structural constraints. The adapter therefore implements
the wire protocol directly. The upstream Go SDK is a secondary behavioral
cross-check, not a generator input. Upstream agent-attribution instructions are
documentation content, not authorization to add telemetry to this SDK.

This integration adds schema annotations `@minItems` and `@maxItems`. The extractor
checks annotation types and provider narrowing before inheriting base bounds.
Generated validators index every array element so sparse holes cannot evade
validation. No schema descriptors or runtime interpreters are emitted.

Tests cover exact payloads, model and composition narrowing, native Node HTTP,
split UTF-8 timestamp JSON, first-chunk delivery, aborts/deadlines, malformed
responses, source integrity and playground defaults. No credentialed live
synthesis was performed. Generated Rust/Python/Go request and output types compile;
all three languages have executable schema-generated request validators.

## Python adapter

`speechswitch.providers.typecast.synthesize` implements the same four native HTTP
operations with generated model-aware requests, validation and output envelopes.
Pass the shared `Auth` object and an injected `HttpTransport`, then consume the
stream inside `async with`. The transport must return at headers, honor task
cancellation and reject redirects and automatic retries. No third-party runtime
dependency is required.

```python
from speechswitch.providers.typecast import synthesize

async with synthesize(
    {"model": "ssfm-v30", "voice": "uc_existing", "text": "Hello",
     "emotion": "auto", "timestamp_granularity": ["word", "character"]},
    auth={"typecast": {"api_key": "..."}}, transport=http_transport,
) as stream:
    async for item in stream:
        ...  # bytes, a native chunk envelope, or {"event": "done"}
```

Python uses `protocol="stream" | "http"` for the optional upstream operation
override (`transport` is the injected HTTP dependency). `timeout_ms` covers the
entire context, including header waits, body reads and consumer idle time.
`max_timestamp_response_bytes` caps buffered timestamp JSON only; ordinary audio
remains unbuffered and uncapped. Context exit closes the response exactly once,
including early consumer exit and exceptions. Cancellation does not invent a
native clear acknowledgment.

Shared fixtures compare exact TypeScript/Python payloads for every request and
composition variant. Python tests additionally cover split UTF-8, canonical
base64, malformed/unrequested alignments, Unicode composition totals, native HTTP
header authentication, first-byte delivery, deadlines and cleanup. Negative
compiler tests verify model restrictions, exclusive loudness controls, timestamp
sample rates, composition shape and the absence of clear output.
Go and Rust adapters are described below; all three ports stay on this same
provider branch.

The foreign-port source refresh returned HTTP 200 for all eight cataloged URLs.
Seven hashes still match their snapshots. The live `llms.txt` index now has hash
`10170d2c09f420aa40114dafd9aeddd1795efaab5dd7831f972245690d19e17b`;
it mentions v3 voice-list endpoints and `ssfm-v31`, whereas the unchanged
synthesis contracts describe v21/v30. The original cataloged bytes remain intact.
This port uses the verified v21/v30 synthesis contracts, not inferred v31 controls
or the index's agent-attribution directions.

## Go adapter

`providers/typecast.Synthesize` accepts the generated `typecast.TtsRequest` union
and returns `runtime.Input[typecast_output.SynthesisItem]`. Model restrictions,
output variants, composition segments and runtime request validation all come
from the canonical TypeScript schema. The adapter switches on those generated
variants only to perform explicit wire conversion, without reflection or a second
request validator.

```go
stream, err := typecast.Synthesize(ctx,
    schema.TtsRequestAsSsfmV30TextVoicebb79df90{
        Value: schema.TtsRequestSsfmV30TextVoicebb79df90{
            Text: "Hello", Voice: "uc_existing",
        },
    }, typecast.Options{Auth: auth})
if err != nil { return err }
defer stream.Close()
// Pull stream.Next(ctx) until io.EOF; items are bytes, a chunk envelope, or done.
```

The zero-valued smart-emotion discriminator in that generated variant is always
`auto`; neither arbitrary strings nor preset intensity fit that variant.
`Options.Protocol` selects `stream` or `http`, with empty meaning automatic.
The shared auth object and environment fallbacks match Python/TypeScript.
Nil `Options.Transport` uses native HTTP with redirects disabled; overrides obey
the HTTP transport cancellation/ownership contract. Base URLs preserve proxy
paths (including escaped slashes) and query values. No automatic retries or
credentialed redirect replay are added.

`TimeoutMs` is an optional integer with an explicit-zero immediate deadline.
Operation cancellation owns the response even while the consumer is idle; each
`Next` context can cancel the operation too. `Close` is concurrency-safe and
unblocks a pending read. Native `Read` results containing both audio and an error
preserve that audio before surfacing the error, without a false `done` event.
Timestamp JSON is capped by `MaxTimestampResponseBytes` (zero selects 128 MiB);
raw audio is uncapped. Both selected and unselected alignment arrays are checked.
Go rejects invalid UTF-8 and unpaired JSON surrogates rather than silently
replacing text that its strings cannot represent.

Shared fixtures cover every request and segment variant, with both value and
pointer representations. Tests cover every timestamp byte split, native HTTP
authentication and first bytes, redirects, deadlines, cancellation, exact body
ownership and original-error precedence. Negative compiler tests assert complete
diagnostics for unsupported model controls, sample rates, mixed gain controls,
composition fields, streaming input and clear output.

## Rust adapter

`providers::typecast::synthesize(&request, &backend, options).await` accepts the
generated `typecast::TtsRequest` and returns a pull-based
`InputStream<typecast_output::SynthesisItem>`. Rust now covers the same four
operations as TypeScript, Python and Go, including preset/smart emotion,
per-segment voices, explicit pauses and native word/character alignment.
All public request/output types and request validation are generated from
TypeScript. The handwritten adapter performs explicit wire conversion with
exhaustive matches over the generated model and segment enums.

Pass a shared `Auth` reference through `Options.auth`. `Options.protocol` is
`None` for automatic selection or `Some(Protocol::Stream | Protocol::Http)` for
an explicit override. `base_url` preserves escaped proxy paths and unrelated
queries while replacing/removing every old timestamp filter.
`max_timestamp_response_bytes` defaults to 128 MiB and must be positive; raw audio
is uncapped and yielded byte-for-byte. No third-party runtime dependency or
generated wire client is introduced.

The injected `HttpTransport` owns HTTP/TLS and must return at headers, cancel on
drop, reject redirects/retries, and avoid ambient credentials. Dropping the
pending synthesis future cancels a header wait; dropping the returned stream
cancels body consumption. The returned stream owns its body independently of the
request, auth object and backend. Rust uses host-executor deadlines, not hidden
timer threads: bound both the synthesis future and subsequent stream polling.
Cancellation never fabricates a native clear acknowledgment or completion event.

Each poll performs at most one transport read. Empty chunks and partial timestamp
JSON yield cooperatively, so an immediately-ready producer cannot starve
cancellation. EOF and errors release the body before returning the envelope,
completion or error. Timestamp parsing validates unrequested tracks too and
rejects invalid UTF-8, lone JSON surrogates, noncanonical base64, nonfinite times
and reversed intervals. Native alignment text and ordering are preserved without
inventing source offsets.

Tests share exact payload/alignment fixtures with the other three implementations
and cover every timestamp byte split, zero/omission semantics, aggregate Unicode
limits, pause underflow, environment precedence, cooperative polling and drop
ownership. Nine exact negative compiler diagnostics cover unsupported model
controls, mixed gain controls, composition fields, WAV rates, streaming input and
clear output. No credentialed live synthesis was performed.
