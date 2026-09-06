# Resemble Chatterbox

This integration targets the three official deployed **Gradio Chatterbox Spaces**
from issue #21, not Resemble's separate commercial voice API.

| Model | Controls specific to this deployment |
| --- | --- |
| `chatterbox` (default) | Style exaggeration, voice guidance, reference VAD trimming |
| `chatterbox-multilingual` | Style exaggeration, voice guidance, 23 languages; English default |
| `chatterbox-turbo` | Min-p, top-p, top-k, repetition penalty, loudness normalization, inline paralinguistic tags |

```ts
import { synthesize } from "../../dispatch.ts";

for await (const item of synthesize("resemble", {
  model: "chatterbox-multilingual",
  text: "Bonjour !",
  language: "fr",
  output: { format: "wav" },
})) {
  if (item instanceof Uint8Array) {
    // Consume each chunk of the generated WAV download.
  }
}
```

All three accept encoded `referenceAudio: Uint8Array` for conditioning; there is
no saved voice-ID selector. Uploads preserve bytes without falsely labeling them
as WAV. Base Chatterbox permits unconditioned generation; multilingual uses the
deployment's language-specific reference when omitted. Turbo needs a reference
and has a deployed example: omission resolves its current cached recording from
the info API. Supplying your own reference avoids this additional metadata call
and avoids relying on a demo voice that may change.

## Model types and defaults

The canonical non-generic `TtsRequest` union lives in `schemas/providers/resemble`.
Unsupported model combinations use `never`, and generated runtime validation
checks those constraints without repeating them in the adapter. The shared base
stays free of request variants. Rust/Python/Go request types are generated from
the same TypeScript schema; they remain type foundations, not synthesis clients.

The documented 300-character input limit is enforced as Unicode code points,
preventing base Chatterbox's silent truncation. Text and Turbo tags are otherwise
unchanged. Defaults retain native scales: temperature 0.8, random seed 0,
style exaggeration 0.5, voice guidance 0.5. Style exaggeration supports 0.25–2;
ElevenLabs' separate provider range remains 0–1. Turbo defaults to min-p 0, top-p
0.95, top-k 1000, repetition penalty 1.2 and loudness normalization enabled at
the deployment's -27 LUFS target. The Space converts seed and top-k numbers to
integers; the SDK does not silently convert them itself.

Only WAV output is exposed. These endpoints have no format, sample-rate, bitrate
or speed override. Language is a multilingual-model option, not a fabricated
`auto` value on the English models.

## Lifecycle and auth

The adapter uploads references when supplied, submits an ordered Gradio `data`
array, waits for the queue's explicit `complete` SSE event, then streams the
completed file's bytes. It yields `{ event: "done", requestId }` after download.
Queue EOF is not completion; errors, malformed files and empty audio fail.

These deployed operations are not audio generators: there is no incremental
text input, native clear/flush message, or timestamp output. An iterator is still
returned for all requests, but generation finishes before download begins.
`signal`, `timeoutMs`, and iterator return release network consumption; they do
not promise interruption of a running GPU task or removal of cached audio.
Public demo availability and Hugging Face GPU quotas can affect calls.

Auth resolves from shared `auth.resemble.token`, then
`SPEECHSWITCH_RESEMBLE_TOKEN`, then `HF_TOKEN`, or anonymous public access.
This is a **Hugging Face token**, not a Resemble cloud key. `fetch` and `baseUrl`
are injectable; the latter is the deployment root and preserves proxy prefixes.
API redirects are rejected. Off-origin audio downloads receive neither the token
nor browser cookies. Private Gradio username/password login is not implemented;
an injected fetch can supply deployment-specific authentication.

## Why the wire implementation is handwritten

The fresh manifests describe positional fields, but bounds are partly prose,
file inputs omit nullability, and `/info` rewrites default-reference URLs to an
unrelated generic example while retaining the real cached path. Queue/upload
protocols are not defined there. The probed `/openapi.json` returned the Gradio
HTML shell, not an OpenAPI contract. The current cached default is runtime data;
resolving it does not interpret a schema to construct requests.

Fourteen unchanged snapshots (manifests, deployment configs, protocol docs and
secondary first-party sources) are retained with URLs and hashes in the source
catalog. Wire inputs follow the manifests, never inferred Python signatures.
The [Gradio protocol guide](https://gradio.app/guides/querying-gradio-apps-with-curl)
and framework routes establish upload/queue/file behavior; model/deployment
sources explain semantics not codified in the manifests. No static template is
presented as a generated client, and no third-party runtime dependency is added.

Verification uses exact protocol fixtures, real deployed metadata snapshots,
native Node loopback streaming/cancellation, model-conditioned playground tests,
source hashes, generated freshness and real Rust/Python/Go compilers. No live
GPU inference or paid API call is claimed.
