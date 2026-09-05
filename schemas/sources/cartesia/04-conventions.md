> ## Documentation Index
> Fetch the complete documentation index at: https://docs.cartesia.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# API Conventions

<Warning>
  All endpoints use HTTPS. HTTP is not supported. API keys that call the API
  over HTTP may be subject to automatic rotation.
</Warning>

All API requests use the following base URL: `https://api.cartesia.ai`. (For WebSockets the corresponding protocol is `wss://`.)

### Always send a `Cartesia-Version` header

Each request you send our API should have a `Cartesia-Version` header containing the date (`YYYY-MM-DD`) when you tested your integration. For WebSockets, you can alternately use the `?cartesia_version` query parameter, which will take precedence.

This will help us provide you with timely deprecation notices and enable us to provide automatic backwards compatibility where possible.

For a given `Cartesia-Version`, we will preserve existing input and output fields, but we may make non-breaking changes, such as:

1. Add optional request fields.
2. Add additional response fields.
3. Change conditions for specific error types
4. Add variants to enum-like output values.

Our versioning scheme is inspired by the [Anthropic API](https://docs.anthropic.com/en/api/versioning).

### Use API keys when making requests from a server

Create a new API key at [play.cartesia.ai/keys](https://play.cartesia.ai/keys). Include `Authorization: Bearer <api_key>` in the headers of your requests.

### Use admin API keys for management endpoints

Some routes—such as [credit usage](/api-reference/usage/credits), [agent usage](/api-reference/usage/agents), and [API key metadata](/api-reference/api-keys/list)—require an **admin** API key (`sk_car_admin_...`).

Create admin keys at [play.cartesia.ai/keys/admin](https://play.cartesia.ai/keys/admin) (organization admins only). Send them the same way: `Authorization: Bearer <admin_api_key>`.

<Note>
  The two key types are not interchangeable:

  * A standard API key (`sk_car_...`) on a management endpoint will be rejected.
  * An admin API key (`sk_car_admin_...`) on a standard endpoint (for example, TTS or STT) will be rejected—including in the API reference "Try it" panel.

  Check the **Authorizations** section on each endpoint page to see which key type it accepts.
</Note>

### Use access tokens when making requests from a client app

Never use API keys in client apps; they grant full account access and can be extracted from browser or mobile code.

Instead, your server can generate a short-lived access token and send it to the client. See the [Access Token API Reference](/api-reference/auth/access-token) for how to generate one.

* For HTTP requests, include `Authorization: Bearer <access_token>` in the headers.

* For WebSocket connections, pass the token as the `?access_token=<access_token>` query parameter since browsers can't set headers on WebSocket handshakes.

### Check response codes

Our API uses standard HTTP response codes; refer to [httpstatuses.io](https://httpstatuses.io).

### Parse structured error responses

For `Cartesia-Version` values on or after `2026-03-01`, Cartesia returns structured JSON errors.

For the full error reference (all current error codes, schemas, and field nullability), see [API Errors](/use-the-api/api-errors).

```json HTTP error response (Cartesia-Version 2026-03-01 and newer) theme={null}
{
  "error_code": "concurrency_limited",
  "title": "Too many concurrent requests",
  "message": "You have exceeded your plan's concurrency limit.",
  "request_id": "550e8400-e29b-41d4-a716-446655440000"
}
```

Field meanings:

1. `error_code`: machine-readable identifier for client logic; can be `null`.
2. `title`: short human-readable summary.
3. `message`: detailed human-readable explanation.
4. `request_id`: request identifier for support/debugging.
5. `doc_url`: optional link to docs for the specific error (when available).

Common `error_code` values today include `quota_exceeded`, `concurrency_limited`, `voice_model_mismatch`, `voice_not_found`, `model_not_found`, `language_not_supported`, `file_too_large`, `unsupported_audio_format`, and `plan_upgrade_required`.

WebSocket and SSE error events include the same error fields plus transport context:

```json WebSocket/SSE error event (Cartesia-Version 2026-03-01 and newer) theme={null}
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

Notes:

1. `context_id` appears for TTS WebSocket errors when available.
2. `status_code` is included in WebSocket/SSE error payloads; for HTTP, status remains in the HTTP response status line.
3. `request_id` is always a string; HTTP and SSE request IDs are UUIDs, while WebSocket request IDs may include additional context.

For `Cartesia-Version` values before `2026-03-01` (and invalid versions), legacy error formats are returned instead:

1. HTTP errors are plain text in `Title: Message` format.
2. WebSocket/SSE errors use legacy envelopes with string-only error messages.

### Pass data according to the method

All GET requests use query parameters to pass data. All POST requests use a JSON body or `multipart/form-data`.
