> ## Documentation Index
> Fetch the complete documentation index at: https://docs.rime.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Error reference

> What the Rime API returns when a request fails, per transport, and what to capture when you need support.

Most Rime failures return the reason as a **plain-text body**: the status code carries the class of failure and the body carries the message. Two exceptions return JSON with an `error` field: an unhandled `500` from `POST /v1/rime-tts`, and failures from `/phonemize` or `/textnorm`. Branch on the status code and `Content-Type`, not the body shape, and do not expect a machine-readable error code field in either form.

<Warning>**No response carries a request ID.** There is nothing in a response or close frame that you can quote back to support, so an accurate UTC timestamp is the single most useful thing to capture when something fails. Record everything under [what to send to support](#what-to-send-to-support) at the moment it happens.</Warning>

## How failures reach you, per transport

| Transport                   | Where it fails           | What you observe                                                                                                                                                 |
| :-------------------------- | :----------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HTTP `POST /v1/rime-tts`    | Any                      | HTTP status, plain-text body with the message                                                                                                                    |
| WebSocket `/ws3`, `/ws2`    | At the upgrade           | The upgrade fails with an HTTP status and plain-text body. No WebSocket is established.                                                                          |
| WebSocket `/ws3`, `/ws2`    | After the socket is open | Close code `1011`, with the message in the close reason. Where an HTTP equivalent applies the reason usually begins with it, for example `400: text is too long` |
| WebSocket `/ws` (raw audio) | Any                      | No structured error events. Use `/ws3` or `/ws2` if you need to distinguish failures.                                                                            |

Log the complete close reason string. It carries the message, and where an HTTP equivalent applies it usually begins with that status as a diagnostic aid, so it is worth reading but not worth branching on.

Handle both failure paths: the same bad request can be rejected on the upgrade with an HTTP status, or accepted and then closed with `1011` once the socket is open.

## 400, the request was rejected

| Message                                              | Cause                                            | Fix                                                                                        |
| :--------------------------------------------------- | :----------------------------------------------- | :----------------------------------------------------------------------------------------- |
| `request body is required`                           | No body sent                                     | Send a JSON body                                                                           |
| `payload must be an object`                          | Body parsed but is not a JSON object             | Send an object, not an array or scalar                                                     |
| `text is required`                                   | `text` absent                                    | Include `text`                                                                             |
| `text must be a string`                              | `text` is a number, object, or null              | Send a string                                                                              |
| `text must not be empty`                             | `text` is `""`                                   | Send at least one character                                                                |
| `text is too long`                                   | `text` exceeded 1,000 characters                 | Split into multiple requests at sentence boundaries                                        |
| `speaker is required`                                | `speaker` absent                                 | Include `speaker`. There is no default voice                                               |
| `lang must be a string`                              | `lang` is not a string                           | Send a string such as `eng` or `en`                                                        |
| `audioFormat must be a string`                       | `audioFormat` is not a string                    | Send a string. See [Streaming formats](/docs/streaming)                                    |
| `Language <lang> is not supported for model <model>` | The language is not in the model's supported set | Use a supported language for that model. See the [language matrix](/docs/voices#languages) |

<Warning>**Do not rely on this error to catch a bad pairing.** It is not returned for every model or transport, so an unsupported combination of `speaker`, `modelId`, and `lang` can be accepted and synthesized rather than rejected. Verify the combination against the [Coda](/docs/voices-coda) or [Mist v3](/docs/voices-mist-v3) catalog before you ship it, and treat a successful response as no evidence that the pairing was valid.</Warning>

## 401, authentication failed

| Message                        | Cause                                                       |
| :----------------------------- | :---------------------------------------------------------- |
| `Missing Authorization header` | No `Authorization` header sent                              |
| `missing headers`              | Required headers absent on this endpoint                    |
| `empty apikey`                 | The header is present but the key is empty                  |
| `invalid api key`              | The key is not recognized                                   |
| `invalid subscription`         | The key resolves to an account without a valid subscription |

Note that `invalid subscription` arrives as a 401 rather than a 402 or 403, so a billing problem can look like an authentication problem. If your key is correct and unchanged, check the account's subscription before regenerating credentials. Create and manage keys on the [API Tokens page](https://app.rime.ai/tokens); see [Authentication](/docs/api-authentication).

## 403, authenticated but not allowed

`access forbidden` means the credential is valid but the account may not use this endpoint or resource. Retrying will not help. Contact [support@rime.ai](mailto:support@rime.ai) if you expect access.

## 406, the requested media type cannot be produced

`modelId "<model>" can only be returned as streamed audio; set Accept to one of: ...` means `Accept` named a concrete type the API cannot produce for that model. Only Mist v1 and Mist v2 have a JSON representation; every other model returns audio only. Set `Accept` to one of the listed types. Retrying will not help.

## 429, too many requests

`Currently at websocket limit` is returned at the WebSocket upgrade when an account opens WebSocket connections faster than Rime allows. Rime does not publish a connection limit, so do not design to a specific number.

Treat a 429 as a signal to back off: stop opening new connections, retry the upgrade after a delay, and reuse existing connections rather than opening one per utterance. Limits apply to the account as a whole, so on a team account, connections opened by one member count against the others.

<Note>Synthesis concurrency is separate from this connection limit, and Rime does not publish a figure for it. If you need a concurrency commitment for capacity planning, contact [support@rime.ai](mailto:support@rime.ai) rather than inferring one from what you observe.</Note>

## 500 and 502, the request failed on Rime's side

| Status | Message                                              | Meaning                                                                                |
| :----- | :--------------------------------------------------- | :------------------------------------------------------------------------------------- |
| 500    | `internal error`, `Internal error`, `Database error` | An unhandled server-side failure                                                       |
| 502    | `text normalization engine error`                    | The [text normalization](/docs/text-normalization) endpoint could not reach its engine |

These are the only failures where a retry is reasonable on its own. Retry with backoff, and see [the retry guidance](#retrying-safely) below before retrying anything that may already have produced audio.

## Retrying safely

Retry a 500 or 502. Do not retry a 400, 401, or 403: the request will fail identically and, for 401, repeated attempts with a bad credential are indistinguishable from an attack.

For a 429, back off and retry the connection rather than the synthesis.

<Warning>**Retries are billed as new synthesis.** Rime bills by characters synthesized, and each request is billed independently. If a connection drops partway through a long utterance, resynthesizing the full text incurs its full character count again. For long utterances, synthesize in sentence-aligned chunks and resume from the last chunk you received, so a retry only re-sends what was lost.</Warning>

## What to send to support

Because no response carries a request ID you can quote, include all of the following when you report a failure. Redact your API key.

* The UTC timestamp of the failure, to the second. This matters most, because it is how support locates the request
* The endpoint and [regional endpoint](/docs/regional-endpoints) you called
* `modelId`, `speaker`, and `lang` exactly as sent
* The HTTP status and the full plain-text body, or the WebSocket close code and its complete reason string
* A minimal request that reproduces it, with the key removed
* Whether any audio had already arrived when the failure occurred

## Related

* [API authentication](/docs/api-authentication): creating keys and the header format, for diagnosing 401s.
* [Voices](/docs/voices): the catalog to verify a `speaker`, `modelId`, and `lang` combination against.
* [Streaming formats](/docs/streaming): valid `audioFormat` values and their tradeoffs.
* [WebSockets](/docs/websockets): which endpoint reports structured errors and which does not.
