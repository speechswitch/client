# Respeecher Space TTS

Implements issue #22's `realtime-tts` model using the Space API, not the separate
Marketplace API. `language: "en"` (default) routes to `en-rt`; `"uk"` routes to
`ua-rt`. Text, including Ukrainian inline stress marks, passes through unchanged.
Select a catalog or provisioned custom voice by ID. Space has no public voice
cloning/reference-audio input and exposes no timestamps.

```ts
import { synthesize } from "./sdk/providers/respeecher/index.ts";

const text = (async function* () {
  yield "Hello.";
  yield { command: "flush" } as const;
  yield "This can be interrupted.";
  yield { command: "clear" } as const;
  yield "A fresh utterance.";
})();

for await (const output of synthesize(
  { model: "realtime-tts", voice: "samantha", text },
  { auth: { respeecher: { apiKey: "..." } } },
)) {
  // Handle audio envelopes and clear/flush/done events without buffering.
}
```

Authentication resolves `auth.respeecher.apiKey`, then
`SPEECHSWITCH_RESPEECHER_API_KEY`, then `RESPEECHER_API_KEY`. Node/Bun native
WebSockets authenticate through the `X-API-Key` handshake header, never a query
parameter. Browsers need an authenticated `webSocket` override or whole-text
HTTP mode. Overrides are exclusive to the operation and closed on exit.

## Transports and audio

| Request | Transport | Output |
| --- | --- | --- |
| PCM or mulaw, including omitted output | WebSocket by default | Envelopes with native context IDs |
| PCM or mulaw with `transport: "http"` | `/tts/sse`, actually JSONL | Raw audio chunks |
| WAV, whole text only | `/tts/bytes` | Raw WAV bytes as they arrive |

Default output is mono float32 little-endian PCM at 22050 Hz. PCM also supports
signed 16-bit little-endian samples; WAV is signed 16-bit. Sampling rate is
independent of format, and mulaw does not inherit a guessed telephony-only rate.
The byte endpoint documents an *approximate* 5000-character limit; the adapter
does not invent an exact schema bound for it.

All sampling overrides remain flat in the normalized request. Omission retains
the selected voice's native defaults. `topK: 0` disables filtering (native `-1`);
positive safe integers select the candidate count. `topP` must be strictly
positive. Bounds and integer checks are generated from the canonical schema,
not repeated in the adapter. The new `frequencyPenalty` and `presencePenalty`
concepts are independent of repetition penalty and each other.

Text deltas are sent immediately with `continue: true`. Flush or input EOF sends
an empty final transcript with `continue: false`; flush completion follows the
native context's `done`. Multiple contexts may overlap, and each audio envelope
retains its native context ID. The adapter never invents timestamps or pairs
independently arriving audio by order.

`clear` sends native cancellation for all unfinished contexts, suppresses their
late responses, and emits a **local** playback-clear event. There is no native
cancellation acknowledgement. Respeecher warns that already generated but not
yet streamed audio can still be charged. `signal` and `timeoutMs` cancel the
whole operation, including blocked input and network waits; exiting the
consumer closes the response/socket and calls unfinished input's `return`.
Cleanup does not await an uncooperative producer, which cannot be forcibly stopped.

## Contract audit

The ten raw sources in `schemas/sources/respeecher/` are unchanged, with URL,
GET method and SHA-256 catalog entries. The discovery manifest's `/docs/` links
are now correct; the issue's stale-link warning is historical.

The structured snapshots are not complete codified contracts: AsyncAPI omits
the required socket-auth mechanism; OpenAPI labels JSONL as `text/event-stream`
and omits required request-body markers; sampling bounds/defaults are prose.
The protocol therefore lives directly in `index.ts`. Only normalized request
validation, specification, registry and foreign-language types are generated.
No static client template, repaired vendor schema or third-party runtime ships.

Tests exercise all transports, native Node header authentication, incremental
first-audio latency, clear/flush interleaving, context correlation, malformed
responses, deadlines, cancellation, source hashes and playground defaults.
They use fixtures and loopback servers, not paid provider calls.

## Python and generated foreign contracts

The Python adapter is implemented in `sdks/python/speechswitch/providers/respeecher.py`.
Its request types, input checks and output envelopes are generated from the canonical
TypeScript schemas, along with the corresponding Go and Rust types. Go and Rust
Respeecher adapters are not implemented yet.

```python
from collections.abc import AsyncIterator
from speechswitch.generated.respeecher import TtsRequestObjectTextAsyncIterableItem as Input
from speechswitch.providers.respeecher import synthesize

async def text() -> AsyncIterator[Input]:
    yield "Hello."
    yield {"command": "flush"}
    yield "This can be interrupted."
    yield {"command": "clear"}
    yield "A fresh utterance."

async def speak() -> None:
    async with synthesize({"voice": "samantha", "text": text()}) as stream:
        async for item in stream:
            print(item)
```

Python uses the same scoped/legacy environment names, or shared
`auth={"respeecher": {"api_key": "..."}}`. Its native asyncio WebSocket sends
`X-API-Key` in the upgrade, without external packages. Supply `web_socket` for an
already authenticated, exclusively owned socket. `protocol="http"` selects
whole-text JSONL; WAV selects byte HTTP automatically. HTTP requires an injected
asynchronous `transport` implementing `speechswitch.http.HttpTransport`; it must
release pending requests on cancellation and must not redirect credentials.
`base_url` preserves proxy paths and queries; `web_socket_url` overrides the socket
endpoint directly. Defaults resolve at the public provider boundary.

Always use `async with`, including on early consumer exit. `timeout_ms` covers
connection, input and consumption; task cancellation also closes resources.
An unfinished input iterator is canceled and closed without waiting on a producer
that ignores cancellation. HTTP backends and socket overrides must cooperate with
cancellation. `max_message_bytes` defaults to 4 MiB for each socket message or JSONL
line; JSONL is incremental, UTF-8 safe, bounded and cooperatively scheduled.
Clear/flush retain the TypeScript semantics above, including local-only clear and
suppression of canceled contexts' late output.

On 2026-09-07 at 12:16:48–49 UTC all ten cataloged sources were freshly fetched
with GET, no request body, redirects followed and non-2xx responses rejected.
Every SHA-256 matched the catalog; no snapshot or hash needed changing.
Shared TypeScript/Python fixtures check exact requests and every JSONL byte split.
Python tests also cover native socket auth, backpressured writes, overlapping
contexts, malformed packets, deadlines, body ownership and an uncooperative
producer. Negative Pyright tests assert exact diagnostic rules and locations.
