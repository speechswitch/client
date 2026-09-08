> ## Documentation Index
> Fetch the complete documentation index at: https://docs.cartesia.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# API Errors

For `Cartesia-Version: 2026-03-01` and newer, Cartesia returns structured JSON error objects.

For older API versions, errors may be plain text (for example `Title: Message`).

## HTTP Error Object

```json HTTP error response theme={null}
{
  "error_code": "concurrency_limited",
  "title": "Too many concurrent requests",
  "message": "You have exceeded your plan's concurrency limit.",
  "request_id": "550e8400-e29b-41d4-a716-446655440000"
}
```

| Field        | Type            | Required | Nullable | Notes                                                             |
| ------------ | --------------- | -------- | -------- | ----------------------------------------------------------------- |
| `error_code` | `string`        | Yes      | Yes      | Machine-readable code. Can be `null` if no specific code applies. |
| `title`      | `string`        | Yes      | No       | Short human-readable error summary.                               |
| `message`    | `string`        | Yes      | No       | Detailed human-readable error explanation.                        |
| `request_id` | `string` (UUID) | Yes      | No       | Request identifier for support/debugging.                         |
| `doc_url`    | `string`        | No       | No       | Optional docs link for the error. Omitted when not available.     |

## WebSocket Error Event Object

```json WebSocket error event theme={null}
{
  "type": "error",
  "done": true,
  "status_code": 429,
  "error_code": "concurrency_limited",
  "title": "Too many concurrent requests",
  "message": "You have exceeded your plan's concurrency limit.",
  "request_id": "550e8400-e29b-41d4-a716-446655440000:happy-monkeys-fly:8a0f5f3a-3b2f-4f28-b73e-8c5f27e2f8bb",
  "context_id": "happy-monkeys-fly"
}
```

| Field         | Type      | Required | Nullable | Notes                                                                                                           |
| ------------- | --------- | -------- | -------- | --------------------------------------------------------------------------------------------------------------- |
| `type`        | `string`  | Yes      | No       | Always `"error"`.                                                                                               |
| `done`        | `boolean` | Yes      | No       | Currently always `true` for error events.                                                                       |
| `status_code` | `integer` | Yes      | No       | HTTP-like status code for the error.                                                                            |
| `error_code`  | `string`  | Yes      | Yes      | Machine-readable code. Can be `null`.                                                                           |
| `title`       | `string`  | Yes      | No       | Short human-readable error summary.                                                                             |
| `message`     | `string`  | Yes      | No       | Detailed human-readable error explanation.                                                                      |
| `request_id`  | `string`  | Yes      | No       | Request identifier for support/debugging. For WebSocket, this may be a UUID or a derived per-message ID string. |
| `doc_url`     | `string`  | No       | No       | Optional docs link for the error. Omitted when not available.                                                   |
| `context_id`  | `string`  | No       | No       | TTS context identifier. Present when available.                                                                 |

## SSE Error Event Object

SSE errors are sent with `event: error` and JSON in the `data:` line.

```text SSE error event theme={null}
event: error
data: {"type":"error","done":true,"status_code":500,"error_code":null,"title":"Unexpected error","message":"An unexpected error occurred, please contact support@cartesia.ai if the problem persists.","request_id":"550e8400-e29b-41d4-a716-446655440000"}
```

| Field         | Type            | Required | Nullable | Notes                                                         |
| ------------- | --------------- | -------- | -------- | ------------------------------------------------------------- |
| `type`        | `string`        | Yes      | No       | Always `"error"`.                                             |
| `done`        | `boolean`       | Yes      | No       | Currently always `true` for error events.                     |
| `status_code` | `integer`       | Yes      | No       | HTTP-like status code for the error.                          |
| `error_code`  | `string`        | Yes      | Yes      | Machine-readable code. Can be `null`.                         |
| `title`       | `string`        | Yes      | No       | Short human-readable error summary.                           |
| `message`     | `string`        | Yes      | No       | Detailed human-readable error explanation.                    |
| `request_id`  | `string` (UUID) | Yes      | No       | Request identifier for support/debugging.                     |
| `doc_url`     | `string`        | No       | No       | Optional docs link for the error. Omitted when not available. |

## Current Error Codes

<Note>
  More error codes may be added in the future. Integrations should handle unknown
  `error_code` values gracefully.
</Note>

| `error_code`               | Meaning                                                                   |
| -------------------------- | ------------------------------------------------------------------------- |
| `quota_exceeded`           | The account has exceeded quota (for example credits or agents usage).     |
| `concurrency_limited`      | The account has exceeded the plan's concurrency limit.                    |
| `voice_model_mismatch`     | The requested voice is incompatible with the requested model.             |
| `voice_not_found`          | The requested voice does not exist.                                       |
| `model_not_found`          | The requested model does not exist.                                       |
| `language_not_supported`   | The requested language is not supported for the requested model or voice. |
| `file_too_large`           | The uploaded file is too large.                                           |
| `unsupported_audio_format` | The provided audio format is not supported.                               |
| `plan_upgrade_required`    | The feature requires a higher plan tier.                                  |
