> ## Documentation Index
> Fetch the complete documentation index at: https://docs.gradium.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Data Residency

> Pin your speech sessions to the EU or the US with eu.api.gradium.ai and us.api.gradium.ai

Gradium runs inference in both the European Union and the United States. By
default you call a single endpoint, `api.gradium.ai`, and requests are routed
to the nearest cluster. For most customers this already means that, in
practice, sessions are processed close to home.

Data residency is for when "in practice" is not enough. Once enabled on your
plan, processing in a chosen region becomes a guarantee that is enforced on
every request: your sessions are never re-routed out of that region, and every
response tells you so.

## Endpoints

| Endpoint            | Behaviour                                                                                                      |
| ------------------- | -------------------------------------------------------------------------------------------------------------- |
| `api.gradium.ai`    | Default. Routed to the nearest cluster; no residency commitment.                                               |
| `eu.api.gradium.ai` | EU-pinned. For organizations enrolled in EU data residency, sessions are guaranteed to be processed in the EU. |
| `us.api.gradium.ai` | US-pinned. For organizations enrolled in US data residency, sessions are guaranteed to be processed in the US. |

The three endpoints are the same API: same API key, same routes, same request
and response formats. Only the host changes.

```
https://eu.api.gradium.ai/api      wss://eu.api.gradium.ai/api
https://us.api.gradium.ai/api      wss://us.api.gradium.ai/api
```

## What is guaranteed

For an organization enrolled in data residency for a region:

* **Inference stays in the region.** Text-to-Speech, Speech-to-Text and
  Speech-to-Speech sessions, over WebSocket or the POST REST endpoints,
  run on our clusters in that region.
* **No cross-region fallback.** Under load a session may be served by another
  cluster in the same region, but never by a cluster outside it.
* **Fail closed.** If a pinned request ever reaches a cluster in another
  region, it is refused rather than processed out of region (see
  [Rejections](#rejections)).
* **Session data is written in region.** Whatever session data we retain
  (see [Zero Data Retention](/guides/faq#how-do-i-enable-zero-data-retention)
  to retain none) is written by the cluster that served the session.

## EU data residency

`eu.api.gradium.ai` is served by our EU clusters. For an organization enrolled
in EU residency, a session that starts on one of them stays within Europe: it
is never handed to a US cluster, and a pinned request that reaches one is
refused.

EU residency is the more complete of the two, because our control plane, which
manages account data, is hosted in the EU for **all** customers, enrolled or
not. So for an EU-pinned organization, both the audio processed in a session
and the account metadata behind it stay in the European Union.

## US data residency

`us.api.gradium.ai` is served by our US clusters, on the East and West coasts.
For an organization enrolled in US residency, sessions are guaranteed to run
on those clusters and are never re-routed to the EU.

<Note>
  US residency covers **inference**: the audio and text of your sessions. Our
  control plane is hosted in the EU for all customers, so account data, custom
  voices and pronunciation dictionaries are still stored — and management calls
  still served — in the EU. If you need the control plane in the US as well,
  talk to us about a self-hosted deployment.
</Note>

## How to opt in

<Note>
  Data residency is available on our paid plans. It is enabled on your plan by
  our team; there is no self-serve toggle yet.
</Note>

### 1. Ask us to enable it

Contact [support@gradium.ai](mailto:support@gradium.ai) with your organization
name and the region you need (`eu` or `us`), then pick one of two modes:

* **Explicit** (default): sessions are pinned when you call the region
  endpoint. Calls to `api.gradium.ai` keep today's behaviour. Choose this if
  only part of your traffic needs the guarantee.
* **Implicit**: your whole organization is pinned to its region, whichever
  endpoint you call. Choose this if all of your usage is in scope.

An organization has at most one residency region. If different parts of your
traffic need different regions, use explicit mode and pick the endpoint per
integration.

### 2. Point your integration at the region endpoint

<CodeGroup>
  ```python Python SDK theme={null}
  import gradium

  client = gradium.client.GradiumClient(
      api_key="your-api-key",
      base_url="https://eu.api.gradium.ai/api",  # or https://us.api.gradium.ai/api
  )
  ```

  ```bash cURL theme={null}
  # -D - prints the response headers, including x-gradium-residency
  curl -L -D - -o bonjour.wav -X POST https://eu.api.gradium.ai/api/post/speech/tts \
    -H "x-api-key: your-api-key" \
    -H "Content-Type: application/json" \
    -d '{"text": "Bonjour !", "voice_id": "YTpq7expH9539ERJ", "output_format": "wav", "only_audio": true}'
  ```

  ```text WebSocket theme={null}
  wss://eu.api.gradium.ai/api/speech/tts
  wss://us.api.gradium.ai/api/speech/asr
  ```
</CodeGroup>

With **implicit** mode this step is optional, since every endpoint pins your
sessions to your region, but we still recommend it.

### 3. Verify

Every response reports the residency the request actually got, so you can
check it instead of trusting a hostname:

* **REST**: the `x-gradium-residency` response header.
* **WebSocket**: the `residency` field of the `ready` message.

| Value                  | Meaning                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------- |
| `pinned; zone=eu`      | The guarantee is in force: this session is processed in the EU and will not leave it.       |
| `pinned; zone=us`      | Same, for the US.                                                                           |
| `best-effort; zone=eu` | The request landed in the EU, but your organization is not enrolled: no commitment is made. |
| `best-effort; zone=us` | Same, for the US.                                                                           |
| `none`                 | No region is involved: default endpoint, organization not enrolled.                         |

```json TTS ready theme={null}
{
  "type": "ready",
  "request_id": "req_...",
  "model_name": "default",
  "residency": "pinned; zone=eu",
  "sample_rate": 48000,
  "frame_size": 3840
}
```

<Tip>
  If you rely on the guarantee, assert `pinned` in your client and treat
  anything else as a configuration error. `best-effort` on a region endpoint
  means residency has not been enabled on your plan yet.
</Tip>

## Rejections

A pinned request that reaches a cluster outside its region is refused instead
of being processed out of region:

* **REST**: `403 Forbidden`
* **WebSocket**: close code `1008` (policy violation)

Both carry the reason
`This request must be sent to the <region> region endpoint.` In practice this
happens when an organization in **implicit** mode calls an endpoint that is
not pinned to its region; the fix is to use `eu.api.gradium.ai` or
`us.api.gradium.ai`.

## Residency and Zero Data Retention

The two are independent and combine:

* **Data residency** governs *where* your requests are processed.
* **Zero Data Retention** governs *whether* request and response payloads are
  retained at all. See the
  [FAQ](/guides/faq#how-do-i-enable-zero-data-retention) to enable it.

For a Data Processing Agreement or details on our privacy and security
posture, contact [support@gradium.ai](mailto:support@gradium.ai).
