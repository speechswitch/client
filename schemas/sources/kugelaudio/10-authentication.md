> ## Documentation Index
> Fetch the complete documentation index at: https://docs.kugelaudio.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Authentication

> How to authenticate with the KugelAudio API

Protected API requests require authentication using an API key. The health and
model-catalog endpoints are public; synthesis, voice, and dictionary endpoints
authenticate the caller. This page explains how to obtain and use your API key.

## Getting Your API Key

1. Sign up at [kugelaudio.com](https://kugelaudio.com)
2. Go to your [Dashboard](https://kugelaudio.com/dashboard)
3. Navigate to **Settings** → **API Keys**
4. Click **Create API Key**
5. Copy and securely store your key

<Warning>
  API keys are shown only once when created. Store them securely! If you lose a key, you'll need to create a new one.
</Warning>

## Using Your API Key

### HTTP Requests

Include your API key in the `Authorization` header using Bearer token format:

```bash theme={null}
curl -X POST "https://api.kugelaudio.com/v1/tts/generate" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"text": "Hello, world!", "model_id": "kugel-3", "voice_id": 1071}'
```

The native API also accepts the equivalent `X-API-Key` header:

```bash theme={null}
curl "https://api.kugelaudio.com/v1/voices?limit=1" \
  -H "X-API-Key: YOUR_API_KEY"
```

The `api_key` query parameter is accepted for protocol compatibility, but use a
header for HTTP requests so the secret is less likely to appear in URLs and
access logs. WebSocket clients commonly need the query form because browser
WebSocket APIs cannot set arbitrary handshake headers.

### WebSocket Connections

For WebSocket connections, pass the API key as a query parameter:

```javascript theme={null}
const ws = new WebSocket('wss://api.kugelaudio.com/ws/tts?api_key=YOUR_API_KEY');
```

Or with `Authorization: Bearer` or `X-API-Key` in the handshake headers (where
the client library supports custom headers):

```python theme={null}
import os

import websockets

async with websockets.connect(
    "wss://api.kugelaudio.com/ws/tts",
    additional_headers={"Authorization": f"Bearer {os.environ['KUGELAUDIO_API_KEY']}"}
) as ws:
    # ...
```

### Browser Realtime connections

Never place an API key in browser code. A server can exchange a
project-scoped API key for a five-minute Realtime client secret:

```bash theme={null}
curl -X POST "https://api.kugelaudio.com/v1/realtime/client_secrets" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

Pass the returned `value` as the `client_secret` query parameter when opening
the Realtime WebSocket. The short-lived secret retains the originating
project identity and is accepted only by that endpoint. See
[Realtime voice agent](/api-reference/realtime) for the complete connection
sequence.

### SDK Usage

<Tabs>
  <Tab title="Python">
    ```python theme={null}
    from kugelaudio import KugelAudio
    import os

    # Pass directly
    client = KugelAudio(api_key="YOUR_API_KEY")

    # Or read the environment variable explicitly
    client = KugelAudio(api_key=os.environ["KUGELAUDIO_API_KEY"])
    ```
  </Tab>

  <Tab title="JavaScript">
    ```typescript theme={null}
    import { KugelAudio } from 'kugelaudio';

    // Pass directly
    const client = new KugelAudio({ apiKey: 'YOUR_API_KEY' });

    // Or read the environment variable explicitly (Node.js)
    const client = new KugelAudio({ apiKey: process.env.KUGELAUDIO_API_KEY! });
    ```
  </Tab>

  <Tab title="cURL">
    ```bash theme={null}
    # Set your API key as an environment variable
    export KUGELAUDIO_API_KEY="YOUR_API_KEY"

    # Then reference it in requests
    curl https://api.kugelaudio.com/v1/models \
      -H "Authorization: Bearer $KUGELAUDIO_API_KEY"
    ```
  </Tab>
</Tabs>

## Environment Variables

For security, we recommend using environment variables instead of hardcoding API keys:

```bash theme={null}
# .env file
KUGELAUDIO_API_KEY=your_api_key_here
```

The Python and JavaScript clients require the key in their constructors; read
`KUGELAUDIO_API_KEY` from your process environment as shown above. The Java
client also provides `KugelAudio.fromEnv()`.
Traffic goes to the canonical geo-routed endpoint by default. Prefix your key
with `eu-` to use the direct EU endpoint. See [Regions](/guides/regions).

## API Key Security

<AccordionGroup>
  <Accordion title="Never expose keys in client-side code" icon="eye-slash">
    API keys should only be used in server-side code. Never include them in:

    * Frontend JavaScript
    * Mobile app source code
    * Public repositories
    * Client-side environment variables
  </Accordion>

  <Accordion title="Use environment variables" icon="lock">
    Store API keys in environment variables, not in code:

    ```bash theme={null}
    export KUGELAUDIO_API_KEY=your_key_here
    ```
  </Accordion>

  <Accordion title="Rotate keys regularly" icon="rotate">
    Create new API keys periodically and delete old ones. This limits the impact of any potential key exposure.
  </Accordion>

  <Accordion title="Use separate keys for environments" icon="layer-group">
    Create separate API keys for development, staging, and production. This makes it easier to rotate keys and track usage.
  </Accordion>
</AccordionGroup>

## Managing API Keys

### Creating Keys

1. Go to **Dashboard** → **Settings** → **API Keys**
2. Click **Create API Key**
3. Give it a descriptive name (e.g., "Production Server")
4. Copy the key immediately (it won't be shown again)

### Revoking Keys

If a key is compromised:

1. Go to **Dashboard** → **Settings** → **API Keys**
2. Find the compromised key
3. Click **Revoke**
4. Create a new key
5. Update your applications

<Note>
  API-key lookups are cached briefly. A revocation can take roughly 30 seconds
  to propagate to an ingress process, so rotate applications before revoking
  the old key and do not rely on revocation as an instantaneous session kill.
</Note>

### Key Scope

Dashboard API keys are scoped to a project. Resource APIs such as dictionaries
enforce that project scope.

## Authentication Errors

### 401 Unauthorized

```json theme={null}
{
  "error": "Invalid API key",
  "error_code": "UNAUTHORIZED",
  "code": 401
}
```

**Causes:**

* Missing `Authorization` header
* Invalid API key
* Revoked API key
* Malformed header format

**Solutions:**

* Check that you're including the `Authorization` header
* Verify the API key is correct
* Check if the key has been revoked
* Ensure format is `Bearer YOUR_API_KEY`

### 403 Forbidden

```json theme={null}
{
  "error": "Forbidden",
  "error_code": "UNAUTHORIZED",
  "code": 403
}
```

**Causes:**

* Trying to access resources from another account
* Using a key whose project does not own the requested resource
* Calling voice-management operations with a credential that has no organization/user identity

**Solutions:**

* Verify you're using the correct API key
* Verify the key belongs to the resource's project or organization

## Testing Authentication

Verify your API key is working:

```bash theme={null}
curl --fail-with-body "https://api.kugelaudio.com/v1/voices?limit=1" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

A valid key receives a `200` voice-page response. A missing, invalid, or revoked
key receives the standard `401 UNAUTHORIZED` error envelope. Do not use
`/v1/models` for this check: the model catalog is public and cannot verify a key.
