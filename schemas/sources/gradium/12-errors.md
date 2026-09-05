> ## Documentation Index
> Fetch the complete documentation index at: https://docs.gradium.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Errors

> How errors are reported across REST, WebSocket, and streamed responses

Gradium reports errors differently depending on the transport (REST or
WebSocket) and on whether the failure happens before or after a streamed
response has started.

## REST endpoints

REST calls (`POST /api/post/speech/tts` and `POST /api/post/speech/asr`)
have two error surfaces.

### Pre-stream errors (HTTP-level)

If the request fails before the response stream has started, for
example a missing or revoked API key, an unsupported `Content-Type`,
malformed audio, or an invalid voice ID, the server responds with
`HTTP 500` and a plain-text body. Two body shapes occur:

**Upstream errors (with a Gradium status code).** Authentication
failures and worker-level rejections come back with a numeric code:

```
error from server <code>: <reason>
```

For example, a revoked or expired API key returns:

```
error from server 1008: API key is revoked or expired
```

The numeric `<code>` matches the codes used by the WebSocket `error`
message:

| Code   | Meaning                                                                                      |
| ------ | -------------------------------------------------------------------------------------------- |
| `1008` | Policy violation: invalid/missing API key, missing setup message, invalid audio format, etc. |
| `1011` | Internal server error                                                                        |

**Proxy-level rejections.** Errors raised before the request reaches
the upstream worker, for example an unsupported `Content-Type` header, come back as raw error strings without the `error from server` prefix:

```
unsupported content type for SST 'audio/mpeg'
```

In both cases the response is `HTTP 500` and the body is plain text
(not JSON). Treat any non-2xx response as fatal for that request. To
recover a Gradium error code, check whether the body starts with
`error from server`; if it does, parse the prefix.

### In-stream errors

Errors that surface after the response has started streaming are
reported as JSON messages within the streamed body. The HTTP status will
already be `200`.

**TTS** (`POST /api/post/speech/tts`, when `only_audio` is `false`):

```json theme={null}
{"type": "error", "message": "Error description"}
```

**STT** (`POST /api/post/speech/asr`, always NDJSON):

```json theme={null}
{"type": "error", "message": "Error description"}
```

In both cases the connection terminates after the error message. Treat
any `error` line you see in the stream as the end of useful output.

## WebSocket endpoints

When something goes wrong on a WebSocket session (`/api/speech/tts`,
`/api/speech/asr`, `/api/speech/s2s`), the server sends an `error`
message and then closes the socket:

```json theme={null}
{"type": "error", "message": "Error description", "code": 1008}
```

**Common close codes:**

| Code   | Meaning                                                                                                                                |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `1008` | Policy violation. Causes include invalid API key, missing or malformed setup message, sending data before setup, invalid audio format. |
| `1011` | Internal server error. The session ended due to an unexpected server-side failure.                                                     |

After receiving an `error` message, the server closes the WebSocket.
Open a new connection to retry.

For the full setup/input/flush/end lifecycle, see
[WebSocket Lifecycle](/guides/websocket-lifecycle).

## Authentication errors

Authentication failures (missing, invalid, or revoked API key) always
produce code `1008`:

* **REST**: `HTTP 500` with body `error from server 1008: API key is revoked or expired` (or similar).
* **WebSocket**: `error` message with `code: 1008`, then close.

Generate a new API key in the Gradium dashboard and replace the value of
the `x-api-key` header.
