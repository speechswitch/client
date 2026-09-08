> ## Documentation Index
> Fetch the complete documentation index at: https://docs.kugelaudio.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Error Codes

> Lookup table for KugelAudio TTS API error responses

KugelAudio TTS endpoints return the same error shape for HTTP responses and
WebSocket error frames.

```json theme={null}
{
  "error": "Rate limit exceeded",
  "error_code": "RATE_LIMITED",
  "code": 429
}
```

| Field        | Type    | Description                                                                      |
| ------------ | ------- | -------------------------------------------------------------------------------- |
| `error`      | string  | Safe client-facing message. Do not parse this field for program logic.           |
| `error_code` | string  | Stable machine-readable error category.                                          |
| `code`       | integer | HTTP-style status code for the error.                                            |
| `context_id` | string  | Multi-context identifier; present only on context-scoped `/ws/tts/multi` errors. |

<Note>
  `retry_after` is not included in the JSON body. When retry timing is available
  for an HTTP response, use the `Retry-After` response header.
</Note>

## HTTP and WebSocket payloads

| Status / payload `code` | `error_code`           | Message                                                                                      | Meaning                                                                                                                                           |
| ----------------------: | ---------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
|                   `400` | `VALIDATION_ERROR`     | `Invalid request`                                                                            | The request payload or WebSocket message is malformed or invalid.                                                                                 |
|                   `400` | `MISSING_VOICE_ID`     | `voice_id is required`                                                                       | No `voice_id` was supplied for synthesis. There is no default voice — set a `voice_id`. Distinct from the `404` "voice doesn't exist" case below. |
|                   `400` | `VALIDATION_ERROR`     | `Unsupported audio format`                                                                   | Uploaded reference audio uses an unsupported file format.                                                                                         |
|                   `400` | `VALIDATION_ERROR`     | `Invalid voice metadata`                                                                     | Voice creation metadata could not be parsed or validated.                                                                                         |
|                   `401` | `UNAUTHORIZED`         | `Unauthorized`                                                                               | The API key is missing, invalid, or not accepted for this request.                                                                                |
|                   `402` | `INSUFFICIENT_CREDITS` | `Insufficient credits`                                                                       | The organization does not have enough credits for the request.                                                                                    |
|                   `403` | `UNAUTHORIZED`         | `Forbidden`                                                                                  | The API key is valid, but it cannot access the requested resource.                                                                                |
|                   `404` | `NOT_FOUND`            | `Voice not found`                                                                            | The requested voice does not exist or is not visible to the caller.                                                                               |
|                   `404` | `NOT_FOUND`            | `Dictionary not found`                                                                       | The requested dictionary does not exist or is not visible to the caller.                                                                          |
|                   `404` | `NOT_FOUND`            | `Entry not found`                                                                            | The requested dictionary entry does not exist or is not visible to the caller.                                                                    |
|                   `404` | `NOT_FOUND`            | `Reference not found`                                                                        | The requested voice reference does not exist or is not visible to the caller.                                                                     |
|                   `429` | `RATE_LIMITED`         | `Rate limit exceeded`                                                                        | The organization exceeded its rate limit.                                                                                                         |
|                   `429` | `TOO_MANY_CONTEXTS`    | `Too many concurrent contexts (max 20); close an existing context before opening a new one.` | `/ws/tts/multi` already has 20 live contexts. The frame also carries `context_id`.                                                                |
|                   `413` | `VALIDATION_ERROR`     | `Request exceeds the maximum character limit`                                                | The text is longer than the model or organization tier allows for one request.                                                                    |
|                   `413` | `VALIDATION_ERROR`     | `File too large (max 50 MB)`                                                                 | A dedicated voice-reference upload exceeds the 50 MiB per-file limit.                                                                             |
|                   `500` | `INTERNAL_ERROR`       | `Audio generation failed`                                                                    | The generation request failed before usable audio could be returned.                                                                              |
|                   `500` | `INTERNAL_ERROR`       | `Sample generation failed`                                                                   | Voice sample generation failed.                                                                                                                   |
|                   `501` | `VALIDATION_ERROR`     | `Voice management is not available`                                                          | The deployment does not provide voice-management operations.                                                                                      |
|                   `503` | `INTERNAL_ERROR`       | `voice catalog temporarily unavailable`                                                      | The voice catalog dependency or management surface is unavailable.                                                                                |
|                   `503` | `INTERNAL_ERROR`       | `dictionary management unavailable`                                                          | The deployment does not provide dictionary management.                                                                                            |
|                   `503` | `MODEL_UNAVAILABLE`    | `The requested model is temporarily unavailable. Please try again shortly.`                  | The selected model is temporarily unavailable.                                                                                                    |

## WebSocket close codes

WebSocket error frames use the same JSON payload shape as HTTP errors. If the
server closes the socket after sending an error, the WebSocket close code is
separate from the JSON `code`.

| WebSocket close code | Related `error_code`   | Meaning                                                                                                  |
| -------------------: | ---------------------- | -------------------------------------------------------------------------------------------------------- |
|               `4001` | `UNAUTHORIZED`         | Authentication failed.                                                                                   |
|               `4003` | `INSUFFICIENT_CREDITS` | The organization does not have enough credits.                                                           |
|               `4029` | `RATE_LIMITED`         | The organization exceeded its rate limit.                                                                |
|               `4500` | `MODEL_UNAVAILABLE`    | The selected model is temporarily unavailable or overloaded.                                             |
|               `4000` | `INTERNAL_ERROR`       | The connection closed because of a generic generation failure.                                           |
|               `1012` | (none)                 | The replica is restarting during a rolling deploy. Reconnect and resend the current turn.                |
|               `1013` | (none)                 | The replica accepted the connection only to report that it is draining. Retry against the load balancer. |

Close codes `1012` and `1013` are not failures of your request. During a rolling
deploy each replica finishes the turn it is generating, then closes idle
sockets with `1012`; a socket that was mid-turn receives its `session_closed`
event first. Audio you already received is complete up to the last chunk. A
handshake against a draining replica is accepted and immediately closed with
`1013`, so browser and server-side WebSocket clients receive the same portable
restart signal. The SDK retry delay defaults to one second.

The Python and JavaScript SDKs absorb this for you. If no audio for the current
turn has been delivered yet, they wait for the restart retry delay, reconnect to another
replica, resend the turn (session config and open contexts included) and keep
streaming, so a deploy is invisible to your users. Nothing is replayed once
audio has started, because that would repeat what the listener already heard,
and no turn is replayed twice. In those two cases the SDK raises the retryable
`ServerRestartingError` and you decide what to resend. The JavaScript SDK also
offers an `onServerRestart` callback for observing the silent replays; the
Python SDK logs them at `INFO` on the `kugelaudio.streaming` logger.

## Handling errors

Use `error_code` and `code` for application logic. Treat `error` as display
text only.

```javascript theme={null}
if (message.error_code === "RATE_LIMITED") {
  // Back off and retry later.
}

if (message.error_code === "MODEL_UNAVAILABLE") {
  // The model or cluster is temporarily overloaded.
}
```
