> ## Documentation Index
> Fetch the complete documentation index at: https://docs.inworld.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# One-time tokens

> Single-use, short-lived bearer tokens for clients that must never hold your API key.

A one-time token is a single-use, short-lived bearer credential minted from your API key. It is built for clients that must not hold the key itself — browsers, mobile apps, devices, or gateways running outside your infrastructure. Your backend keeps the API key and mints one token per connection attempt; the client authenticates with the token, once.

One-time tokens are the preferred client credential: every token carries its parent key's full permissions, and a single-use, minutes-lived credential exposes them for at most one connection — a leaked one that was already used is worthless.

## Mint a token

Authenticate with your [API key](/portal/api-key-auth) — bearer callers are refused, so a token can never mint another token:

```bash
curl https://api.inworld.ai/auth/v1/tokens \
  --request POST \
  --header "Authorization: Basic $INWORLD_API_KEY" \
  --header "Content-Type: application/json" \
  --data '{
    "single_use": true,
    "ttl": "300s",
    "client_reference_id": "user-4711-session-42"
  }'
```

```json
{
  "name": "tokens/1f0d8e9a-1d2b-4c3d-8e9f-0a1b2c3d4e5f",
  "accessToken": "eyJhbGciOiJSUzI1NiIs...",
  "expireTime": "2026-09-01T12:05:00Z",
  "singleUse": true,
  "clientReferenceId": "user-4711-session-42",
  "createTime": "2026-09-01T12:00:00Z",
  "apiKey": "workspaces/my-workspace/apikeys/4aa6d7e9-..."
}
```

- `single_use` must be `true` — only single-use tokens are supported today.
- `ttl` or `expire_time` (pick one): how long the token stays valid, up to 1 hour. Omitted, it defaults to 15 minutes. Keep it as short as your flow allows — just long enough for the client to receive the token and open its connection.
- `client_reference_id` (optional): your own correlation ID (a user or session ID; printable ASCII, at most 256 characters). It is echoed in the response and attached to the token.
- `accessToken` is returned only here and never stored — hand it to your client.
- `name` (`tokens/{id}`) is the token's stable ID: safe to log and correlate on.

See the [API reference](/api-reference/authAPI/tokens/create-token) for the full schema.

## Use it

The token authenticates the same APIs your key can reach. Send it as a Bearer token:

```
Authorization: Bearer <accessToken>
```

For WebSocket connections from browsers (where you can't set headers), pass it in the `Sec-WebSocket-Protocol` header instead:

```javascript
const ws = new WebSocket("wss://api.inworld.ai/tts/v1/voice:streamBidirectional", [
  "bearer_" + accessToken,
]);
```

<Warning>Do not put the token in a URL query parameter. URLs land in server logs and `Referer` headers, and a logged single-use token can be spent by whoever reads it first.</Warning>

## Semantics to design around

- **One use means one authentication**: one HTTP request, or one WebSocket connection (however long it stays open). The token is consumed the moment it authenticates — a request that later fails (wrong parameters, insufficient permissions) has still consumed it. Nothing un-consumes a token; mint a fresh one per attempt.
- **Scopes are inherited**: the token can do exactly what its parent API key can do — no more, no less. Scope narrowing per token is planned.
- **Realtime sessions refuse one-time tokens.** A Realtime session internally opens several streams on your behalf, which a single-use credential cannot cover. Use a [session token](/portal/session-tokens) for Realtime, ideally minted from a [Realtime-only key](/portal/api-keys#realtime-only-api-keys); one-time tokens cover direct TTS, STT, and other API connections.
- **No individual revocation**: a token dies at its `expire_time`, or immediately when you delete its parent API key — deleting the key invalidates everything minted from it. To retire one unused token early, spend it yourself: any authenticated call consumes a single-use token, which is as final as expiry.
- **Minting is rate-limited per API key** (60 tokens per minute). If a mint fails with a server error, mint a fresh token rather than retrying a possibly-consumed one.

## Usage attribution

The token ID (`name`) and your `client_reference_id` are attached to requests the token makes, so usage can be attributed to the exact client session that spent it. Per-token usage reporting in the [usage dashboard](/portal/usage) is planned.
