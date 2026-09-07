# Vocu

Handwritten native HTTP synthesis, with normalized requests and generated checks
defined in [schemas/providers/vocu](../../../schemas/providers/vocu/index.ts).
The same TypeScript 7 graph produces playground controls and Rust/Python/Go types.
There are no third-party runtime dependencies or vendor SDK imports.

```ts
import { synthesize } from "./sdk/providers/vocu/index.ts";

for await (const item of synthesize({
  voice: "market:existing-purchased-voice", // Owned voice IDs also work.
  voiceStyle: "existing-style",
  text: "Hello there!",
  language: "auto",
  output: { format: "mp3" },
}, { auth: { vocu: { apiKey: "..." } } })) {
  if (item instanceof Uint8Array) {
    // Consume incremental native MP3 bytes.
  } else {
    // item.completion distinguishes transport EOF from a confirmed generated job.
    // item.metadata retains native response data when available.
  }
}
```

## Authentication and transport

Direct synthesis requires an API key and a paid account. Resolve the key from
`auth.vocu.apiKey`, `SPEECHSWITCH_VOCU_API_KEY`, then `VOCU_API_KEY`. Async jobs can
also authenticate with `auth.vocu.accessToken`, `SPEECHSWITCH_VOCU_ACCESS_TOKEN`,
or `VOCU_ACCESS_TOKEN`. An explicitly supplied credential wins over environment
fallbacks. Session tokens are never silently used on the API-key-only endpoint.
The async API does not require an API key specifically; it still operates on an
authenticated account, not anonymous jobs. All API credentials stay in Bearer
headers; keep them on your server.

The default is `POST /api/tts/simple-generate` with `stream: true` and
`direct_stream: true`. This returns byte-native MP3 without putting synthesis text
in a URL. The documented GET `.mp3` alias is not needed. `mode: "http"` selects the
JSON response, then fetches `streamUrl` (or `audio` if absent). `mode: "async"`
submits a native task and polls its status before fetching its merged audio.
Batches and text splitters select async automatically.

MP3 is the only published synthesis output format. There is no supported sample
rate, channel count, bitrate or PCM selector; these are forbidden in the schema.
Chunks are network chunks, not independently decodable MP3 files.

The provider warns that over-concurrency requests can wait roughly 330 seconds
before failing. There is no hidden short SDK timeout. Set `timeoutMs` to bound the
whole operation, including queueing, polling and audio reads. Polling defaults to
1000 ms; `fetch`, `baseUrl`, signal and polling interval are injectable.
No synthesis request is automatically retried or resubmitted.

Native download URLs are limited to the documented API/storage origins under
`vocu.ai` and `vocu.studio`. Additional exact trusted origins can be supplied using
`audioOrigins`, for example for a local test server. Downloads never receive the
API key or browser cookies, and redirects are not automatically followed.

## Models, voices and controls

The issue catalogs v3.5, but the current synthesis requests have **no model
selector**. Model versions belong to saved voices; the public model guide and
response examples also disagree about version/engine names. The adapter therefore
does not accept a `model` field that it would merely ignore. Language and V3
delivery capability ultimately depend on the selected voice's native version.
Existing custom voices and purchased `market:<id>` voices pass through unchanged.
Selecting `voiceStyle` uses an existing prompt/style; it does not upload reference
audio, create a clone or mutate the voice.

| Normalized control | Native mapping |
| --- | --- |
| `language` | `auto` by default; `en-US` / `fr-FR` become `en-us` / `fr-fr` |
| `deliveryMode` | creative / balanced / stable become creative / balance / stable |
| `emotionSource` | text / voice become `break_clone: true` / false; omitted preserves the preset |
| `vividExpression` | `vivid`, defaults false |
| `emotionBlend` | Named anger/happiness/neutral/sadness/contextual weights become the fixed five-element `emo_switch` |
| `speed` | Higher means faster; native duration multiplier is `1 / speed` |
| `randomSeed` | `seed`, -1 means random; explicit zero survives |
| `latencyOptimization` | none / maximum become `flash: false` / true |
| `longTextMode` | `infinite_mode` |
| `audioProcessingProfile` | Existing `post_processing` chain ID |

Each emotion weight is an integer 0–10; missing weights become zero when a blend
is supplied. All zero means following the sample emotion, not a neutral override.
Speed is 0.5–2, seed is an integer -1–2147483647. Cantonese requires explicit
`language: "yue"`; native automatic recognition does not detect it. Short `en` /
`fr` values are not advertised because the API silently drops unsupported codes
in synchronous mode but rejects them in async contents.

The API's explicit duration-based `speechRate` description takes precedence over
the UI guide's conflicting speed wording. Likewise, `emotionSource` follows the
POST parameter definition and generation guide, not the GET parameter's conflicting
pause-cloning description. These conflicts are retained in the raw snapshots.

Use `inputType: "markup"` for native `{{...}}` controllable synthesis. Optional
`referenceEmphasis` selects similarity / balanced / expressive only on that path.
Markup stays in `text`; no undocumented standalone instruction prompt is invented.
The schema excludes SRT on markup and Flash requests, including marked segments
inside inline splitters. Async content filtering drops Flash, so it is not exposed
as an effective batch-segment control.

## Native batches and text splitting

```ts
const request = {
  segments: [
    { kind: "speech", voice: "alice", text: "Hello!", emotionBlend: { happiness: 4 } },
    { kind: "speech", voice: "bob", text: "{{quiet}}Good evening.", inputType: "markup" },
  ],
} as const;
```

This submits one `contents` task, explicitly marking every block as native `text`.
The adapter waits through `pending` and `processing` and only downloads the merged
`metadata.audio` after `generated`. A changed ID, unknown status, failed job or
missing final merged URL fails rather than pairing unrelated files or silently
dropping segments. Native `sync` is not used: it waits only until processing starts,
not until generation succeeds. No local per-segment concatenation is performed.

For server-side text splitting, use a saved ID:

```ts
{ text: "[Alice] Hello!", textSplitter: { id: "existing-splitter" } }
```

Or provide inline normalized bindings:

```ts
{
  text: "[Alice] Hello!",
  textSplitter: {
    placeholders: [{ marker: "[Alice]", voice: "alice", speed: 1.2 }],
    brackets: [{ open: "[", close: "]" }],
    fallback: { voice: "narrator" },
    lookup: [{ tags: ["angry", ["Alice", "sad"]], emotionBlend: { anger: 5 } }],
  },
}
```

An inline splitter requires placeholders, a fallback or bracket configuration.
Each bracket side is one UTF-16 unit, matching the native two-unit bracket pair.
Lookup entries retain their order: tags are OR alternatives, nested tag arrays
require all their tags. Omitted binding controls remain omitted so native inherited
settings are not overwritten with single-utterance defaults. Reserved marker-key
collisions and duplicate literal markers are protocol errors checked before
submission. Other bounds and alternatives come from generated request validation.
The adapter never creates, edits or deletes saved splitter configurations.

## Subtitles, metadata and completion

`subtitleFormat: "srt"` requests the native subtitle artifact. It is separate from
normalized timestamp tracks: the published response schema does not specify its
representation or a dependable timing/audio association. Native JSON data is
preserved verbatim as finite JSON in the done event's `metadata`, including SRT,
billing and IDs when present. The adapter does not guess whether an SRT value is
inline text, a URL or a nested object, fetch unknown subtitle URLs, or invent
word/character timestamps. Tests use representative opaque metadata, not claimed
live subtitle fixtures. `timestampGranularity` is consequently not supported.

SRT can be silently disabled for free async accounts. Saved splitter settings are
opaque, so a saved instruct segment may also suppress it. Inspect native metadata
when you need to determine whether the requested artifact was produced.
JSON and response-header metadata are bounded by `maxMetadataBytes` (default 4 MiB);
native audio is streamed without this buffering or size cap.

Direct MP3 has no definitive final protocol success marker. Its documented
mid-stream failures can appear as early EOF. The final event reports
`completion: "transport"`, not verified synthesis success. Async mode reports
`completion: "generated"` only after observing that native state and reading the
audio stream to EOF. HTTP read errors and empty audio still fail.

Whole text only: no public WebSocket protocol, incremental text iterator, native
clear command or barge-in acknowledgment is documented for this surface. Abort
interrupts pending work; iterator return releases resources after a yielded chunk.
Stopping async polling **does
not cancel the server job**, which may continue consuming credits. The native
delete endpoint explicitly rejects jobs in flight; it is never used as cancellation.
An abort racing task submission can leave an accepted job on the server even if
the client never receives its ID. There is no cancellation success fabrication.

## Source audit and scope

Issue #26 and all comments were read (no comments). Sixteen unchanged sources are
cataloged with their exact URL/method/body and SHA-256 in
[`schemas/sources.yaml`](../../../schemas/sources.yaml).
The issue's `dev.vocu.ai` acquisition failed certificate validation on 2026-09-06.
The same public Apifox project exported successfully from its official
`dev.vocu.studio` host with TLS verification enabled. That actual URL is cataloged,
not mislabeled as a successful fetch from the original host. The exported server
remains `https://v1.vocu.ai`. Two standalone schema Markdown URLs returned 404;
their schema definitions are retained in the successful complete raw export.

The current export has 21 paths, not the issue's older 13. It is still not a
trustworthy wire-generation input: MP3 bytes are typed as an empty object,
mandatory API-key security is represented as an empty security array, POST
`direct_stream` / instruct controls are absent from properties, async splitter
alternatives are absent, all content types require text/voice, and the task engine
enum contradicts its own response example. The adapter is handwritten; the raw
contract is not patched, templated or misrepresented as generated code.

This is a TTS integration, not a general Vocu administration/music/voice-conversion
SDK. It does not create voices, upload conversion audio, generate music/effects,
manage templates or delete resources. Names mentioned without usable parameter
semantics (such as `gamble` and interval controls) are not exposed as an untyped
escape hatch. The absence of a trustworthy subtitle shape is documented above.

Tests exercise exact native payloads, generated constraints, Node HTTP streaming,
polling identity, native inheritance, response ownership, abort/deadline behavior,
safe asset downloads, source integrity, playground defaults and foreign compiler
narrowing. No credentialed live synthesis was performed.

The foreign-port source refresh on 2026-09-07 fetched all sixteen cataloged URLs
successfully, including the exact POST export recipe. Fifteen hashes were unchanged.
The overview HTML changed its Apifox application shell; its embedded documentation
payload was byte-for-byte unchanged. The cataloged raw snapshots remain intact.
These checks do not resolve the wire-contract contradictions described above.

## Python

Python now has a handwritten provider adapter. Requests, executable validation and
the byte/done output union are generated from this provider's TypeScript schema;
there is no second authored Python schema or new runtime dependency. The shared
[`sdks/fixtures/vocu.json`](../../../sdks/fixtures/vocu.json) payloads are also
executed against the TypeScript adapter. Go also has a native adapter on this
provider branch. Rust currently has generated types and validators; its Vocu
adapter is still pending here.

```python
from speechswitch.providers.vocu import synthesize

async with synthesize(
    {"voice": "market:existing-purchased-voice", "text": "Hello!"},
    auth={"vocu": {"api_key": "..."}},
    transport=transport,
) as stream:
    async for item in stream:
        if isinstance(item, bytes):
            consume_audio(item)
        else:
            inspect_completion(item["completion"])
```

Always use `async with`, including for early exit. The injected `HttpTransport`
returns at response headers, releases pending requests on cancellation, and must
not follow redirects, retry submissions or attach cookies/implicit credentials.
The adapter sends Bearer auth only to API operations; asset downloads receive no
auth headers, including when they share the API origin. Every acquired body is
closed on EOF, cancellation, early exit or error. `timeout_ms` covers submission,
polling, downloading and time spent by the consumer inside the context.

The Python adapter supports direct streaming, `mode="http"`, and native async jobs
selected by `mode="async"`, batches or splitters. Python option names are
`base_url`, `poll_interval_ms`, `max_metadata_bytes` and `audio_origins`.
Native metadata keys remain verbatim; normalized fields use snake_case, including
`request_id`. Malformed/nonfinite JSON, invalid UTF-8, changed job IDs, untrusted
download URLs, empty audio and failed native jobs are errors, not completion events.
Neither a direct stream's EOF nor canceled polling is reported as successful
server-side cancellation.

## Go

Go's `providers/vocu.Synthesize` accepts the generated `vocu.TtsRequest` union and
returns `runtime.Input[vocu_output.SynthesisItem]`. All seven request variants,
native controls, subtitle restrictions, saved/inline splitters and batch jobs use
the same canonical TypeScript schema and shared payload fixtures as Python.
The adapter has no runtime reflection, external dependency or parallel request
schema. Wire conversion is explicit; generated checks own bounds and combinations.
Splitter objects use order-preserving JSON encoding: a Go map would reorder native
lookup rules once there are more than ten entries. An exact wire-order regression
test covers that case along with literal marker order.

```go
request := vocu.TtsRequestAsTextVoice9c5ed44a{
    Value: vocu.TtsRequestTextVoice9c5ed44a{
        Voice: "market:existing-purchased-voice",
        Text: "Hello!",
    },
}
stream, err := provider.Synthesize(ctx, request, provider.Options{Auth: auth})
if err != nil {
    return err
}
defer stream.Close()
for {
    item, err := stream.Next(ctx)
    if err == io.EOF {
        break
    }
    if err != nil {
        return err
    }
    consume(item)
}
```

Here `vocu` is `sdks/go/generated/vocu` and `provider` is
`sdks/go/providers/vocu`. Native `net/http` is the default; an injected `Transport`
must honor cancellation, unblock reads on close, and reject redirects, implicit
retries and ambient credentials. `Synthesize` returns at the initial API response
headers; `Next` reads metadata, polls an async job and downloads merged audio.
Both the parent context and each `Next` context cancel pending work. `Close` may
run concurrently with `Next`, and each acquired body is released once.

`Mode` selects `"stream"`, `"http"` or `"async"`; omission selects async for
batches/splitters and direct streaming otherwise. `PollIntervalMs` and `TimeoutMs`
use `runtime.Optional[int64]` to distinguish omission from explicit zero. A timeout
also covers consumer idle time. `MaxMetadataBytes == 0` selects 4 MiB, and
`AudioOrigins` supplies exact trusted download origins. Error values retain native
HTTP status, job/request IDs and Retry-After without exposing response bodies.
Metadata is returned as the generated output's JSON record alternative, preserving
native keys and nulls; invalid UTF-8, unpaired surrogates and nonfinite numbers are
rejected rather than silently rewritten by Go's JSON decoder.
