# LOVO Genny

Job-based TTS for issue #15, using the current NestJS OpenAPI snapshot. Supply
whole `text` (1–500 Unicode code points), an existing speaker ID as `voice`, an
optional saved `voiceStyle` ID belonging to that speaker, and `speed` (0.05–3,
default 1).

```ts
import { synthesize } from "../../dispatch.ts";

for await (const part of synthesize("lovo", {
  text: "Hello from Genny.",
  voice: "640f477d2babeb0024be422b",
}, { auth: { lovo: { apiKey: "your-key" } } })) {
  // part.audio is incremental Uint8Array data.
  // A new correlationId means a new file, not another chunk of the old container.
}
```

The selected voice determines its model and language. The synthesis API has no
`model`, output-format/sample-rate, streaming-text, timestamp or inline
reference-audio fields. In particular, the issue's `pro`/`pro-v2`/`rapid` inventory
is not a documented request selector. We do not add a decorative model union,
claim a custom-cloning API, or manufacture word timings from job metadata.

## Lifecycle and transport

The single public `synthesize` operation always streams audio. By default it
submits to `/api/v1/tts/sync`, avoiding polling latency when the server finishes
within its 90-second synchronous window. If the job remains `in_progress`, it
polls `/api/v1/tts/{jobId}`. `mode: "async"` submits directly to `/api/v1/tts` and
polls instead. An already-done async submission is still retrieved: its creation
schema does not include the result data.

This is **download streaming after generation**, not low-latency generation or
streaming text input. Once the job is done, the adapter fetches its audio URLs
and yields bytes as they arrive. It buffers JSON job metadata, never whole audio
files. The native URL array does not promise one concatenable audio container;
each output/asset receives an explicit ordered envelope group. Consumers must
retain those file boundaries. `timestamps` is empty; IDs identify files, not
invented alignment. Every job output is checked before any download begins, so a
failed output does not silently yield partial success.

`auth.lovo.apiKey` takes precedence over `SPEECHSWITCH_LOVO_API_KEY`, then
`LOVO_API_KEY`. Only API calls receive `X-API-KEY`. Audio requests carry neither
that key nor browser cookies. Redirects are rejected on both paths; returned
asset URLs must be credential-free HTTPS (HTTP is allowed only on an explicitly
configured API origin, for local proxies/tests). Applications requiring a host
allowlist can enforce it with injected `fetch`.

`baseUrl` supports a proxy prefix; query parameters survive path construction.
`fetch` is injectable, with no third-party runtime dependencies. `pollIntervalMs`
defaults to 1000. Optional `timeoutMs` is a whole-operation deadline covering
submission, polling, metadata and file downloads. Abort and consumer return
release pending readers without waiting for an uncooperative cancel promise.
There is **no documented remote cancellation operation**: abort stops SDK work
but does not guarantee that a submitted job stops running or stops accruing
charges. No retries resubmit synthesis automatically.

Voice discovery/administration, server callbacks and job management outside this
streaming operation are not separate SDK operations here. The generated wire
client includes only the three TTS operations needed by synthesis; it does not
generate the unrelated speaker/billing APIs.

## Source and generation

`schemas/sources/lovo/00-openapi.json` is an unchanged fresh GET of
`https://api.genny.lovo.ai/api/docs-json`, cataloged with its SHA-256 hash. The
current bytes match the issue's preserved snapshot. The selected TTS graph
codifies request fields, response/job structure, error objects within jobs,
paths, status codes and header auth. HTTP error bodies are unspecified, so they
remain opaque in `LovoError`; no handwritten body schema is passed off as generated.

`codegen/lovo-client.ts` resolves this graph into concrete wire types, validation
predicates and direct injected-fetch calls. Mutation tests verify that schema,
method, route, auth-header, success-status and nested-response changes alter
executed code. Unsupported selected contract semantics fail generation rather
than being patched into a static template. Date-time and Mongo ID formats remain
annotations on opaque strings; this client does not reinterpret them as codecs.

Normalized request types live only in `schemas/providers/lovo/index.ts`, with
generated validators, playground controls and Rust/Python/Go request types.
Foreign-language artifacts remain type foundations, not complete network SDKs.

## Current upstream availability

On 2026-09-05 the API served a Let's Encrypt YR1 chain without the required
Root YR cross-certificate. The fresh snapshot was acquired **without disabling
TLS verification**: the missing cross-certificate was downloaded from
`https://letsencrypt.org/certs/gen-y/root-yr-by-x1.pem`, verified against the
system trust bundle, and supplied only for that curl request. The SDK does not
change trust stores or disable certificate checks. If the upstream chain is
still incomplete, use a properly configured injected transport or have the
provider fix its chain.

The requested `https://docs.genny.lovo.ai/llms.txt` and reference pages currently
redirect to `/inactive` and return HTTP 401 to direct retrieval. Those error
bodies were not recorded as documentation snapshots. Publicly indexed reference
pages corroborate the job-based flow, but generation relies exclusively on the
fresh live OpenAPI, not a cached search result.

Tests cover generated-contract mutation, schema narrowing, native Node HTTP,
polling, credential separation, file boundaries, failed/malformed results,
abort/deadline/consumer cleanup, and playground materialization. No paid provider
synthesis or voice-quality test was run.
