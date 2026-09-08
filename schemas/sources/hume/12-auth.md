> For clean Markdown of any page, append .md to the page URL.
> For a complete documentation index, see https://dev.hume.ai/llms.txt.
> For AI client integration (Claude Code, Cursor, etc.), connect to the MCP server at https://dev.hume.ai/_mcp/server.

# Getting your API keys

## API keys

Each Hume account is provisioned with an **API key** and **Secret key**. These keys are accessible from the Hume
Portal.

1. **Sign in**: Visit the [Hume Portal](https://app.hume.ai/) and log in, or create an account.
2. **View your API keys**: Navigate to the [API keys page](https://app.hume.ai/keys) to view your keys.

![API keys view within the Hume Platform](https://fdr-prod-docs-files-public.s3.us-east-1.amazonaws.com/hume.docs.buildwithfern.com/a1f0de8e220e156d319145f6a81748fa4b7c726366b8e8afbab0fc28b4d381ff/docs/pages/documentation/introduction/img/platform-api-keys-page.png?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=AKIA6KXJSKKNFOCF7G4B%2F20260907%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20260907T015828Z&X-Amz-Expires=604800&X-Amz-Signature=02d4682ec58bcf861c37e2b0011c595794fc43546b5cbe4d55ed9da70ea8857e&X-Amz-SignedHeaders=host&x-amz-checksum-mode=ENABLED&x-id=GetObject)

## Authentication strategies

Hume APIs support two authentication strategies:

1. [**API key strategy**](/docs/introduction/api-key#api-key-authentication): Use API key authentication for making
   **server-side requests**. API key authentication allows you to make authenticated requests by supplying a single
   secret using the `X-Hume-Api-Key` header. Do not expose your API key in client-side code. All Hume APIs support this
   authentication strategy.

2. [**Token strategy**](/docs/introduction/api-key#token-authentication): Use Token authentication for making
   **client-side** requests. With Token authentication you first obtain a temporary **access token** by making a
   server-side request first, and use the access token when making client-side requests. This allows you to avoid
   exposing the API key to the client. Access tokens expire after 30 minutes, and you must obtain a new one. Today,
   only our [Empathic Voice Interface](https://dev.hume.ai/docs/speech-to-speech-evi/overview) (EVI) and
   [Text-to-Speech](/docs/text-to-speech/overview) APIs support this authentication strategy.

### API key authentication

To use API key authentication on **REST API** endpoints, include the API key in the `X-Hume-Api-Key` request header.

#### EVI

```bash
curl https://api.hume.ai/v0/evi/{path} \
  --header 'Accept: application/json; charset=utf-8' \
  --header "X-Hume-Api-Key: <YOUR API KEY>"
```

#### TTS

```bash
curl https://api.hume.ai/v0/tts/{path} \
  --header 'Accept: application/json; charset=utf-8' \
  --header "X-Hume-Api-Key: <YOUR API KEY>"
```

For **WebSocket** endpoints, include the API key as a query parameter in the URL.

#### EVI

```TypeScript
const ws = new WebSocket(`wss://api.hume.ai/v0/evi/chat?api_key=${apiKey}`);
```

### Token authentication

To use Token authentication you must first obtain an Access Token from the `POST /oauth2-cc/token` endpoint.

This is a unique endpoint that uses the ["Basic" authentication scheme](https://en.wikipedia.org/wiki/Basic_access_authentication), with your API key as the username and the Secret key as the password. This means you must concatenate your API key and Secret key, separated by a colon (`:`), base64 encode this value, and then put the result in the `Authorization` header of the request, prefixed with `Basic `.

You must also supply the `grant_type=client_credentials` parameter in the request body.

#### cURL

```sh
# Assumes `HUME_API_KEY` and `HUME_SECRET_KEY` are defined as environment variables
response=$(curl -s 'https://api.hume.ai/oauth2-cc/token' \
  -u "${HUME_API_KEY}:${HUME_SECRET_KEY}" \
  -d 'grant_type=client_credentials')

# Uses `jq` to extract the access token from the JSON response body
accessToken=$(echo $response | jq -r '.access_token')
```

#### TypeScript

```typescript
import {fetchAccessToken} from 'hume';

// Reads `HUME_API_KEY` and `HUME_SECRET_KEY` from environment variables
const HUME_API_KEY = process.env.HUME_API_KEY;
const HUME_SECRET_KEY = process.env.HUME_SECRET_KEY;

const accessToken = await fetchAccessToken({
  apiKey: HUME_API_KEY,
  secretKey: HUME_SECRET_KEY
});
```

#### Python

```python
import os
import httpx
import base64

# Reads `HUME_API_KEY` and `HUME_SECRET_KEY` from environment variables
HUME_API_KEY = os.getenv('HUME_API_KEY')
HUME_SECRET_KEY = os.getenv('HUME_SECRET_KEY');

auth = f"{HUME_API_KEY}:{HUME_SECRET_KEY}"
encoded_auth = base64.b64encode(auth.encode()).decode()
resp = httpx.request(
    method="POST",
    url="https://api.hume.ai/oauth2-cc/token",
    headers={"Authorization": f"Basic {encoded_auth}"},
    data={"grant_type": "client_credentials"},
)

access_token = resp.json()['access_token']
```

On the client side, open an authenticated WebSocket by including the access token as a query parameter in the URL.

#### EVI

```typescript
const ws = new WebSocket(`wss://api.hume.ai/v0/evi/chat?access_token=${accessToken}`);
```

Or, make a REST request by including the access token in the `Authorization` header.

#### EVI

```typescript
fetch('https://api.hume.ai/v0/evi/chats', {
  headers: {
    Authorization: `Bearer ${accessToken}`,
  },
});
```

## Organization vs personal API keys

If you are part of an Organization, use your **Organization API Key** for all requests across **Text-to-Speech**, **Speech-to-Speech (EVI)**, **Voice Design**, and **Voice Cloning**.

You can regenerate either your Organization or Personal API keys at any time.

### Regenerating API keys

API keys can be regenerated by clicking the **Regenerate keys** button on the API keys page. This permanently invalidates the current keys, requiring you to update any applications using them.

![Regenerate API keys view within the Hume portal](https://fdr-prod-docs-files-public.s3.us-east-1.amazonaws.com/hume.docs.buildwithfern.com/c8520fd281ce6ea960c2ff544a8a37fd78d2daf19c4a4d7f6f61ca8272930639/docs/pages/documentation/introduction/img/regenerate-keys.png?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=AKIA6KXJSKKNFOCF7G4B%2F20260907%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20260907T015828Z&X-Amz-Expires=604800&X-Amz-Signature=b75042a5dc9e388564ffa7b962444ac9a01d431d719184c0fa5597d6b10d2606&X-Amz-SignedHeaders=host&x-amz-checksum-mode=ENABLED&x-id=GetObject)

---