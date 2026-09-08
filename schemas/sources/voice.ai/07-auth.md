> ## Documentation Index
> Fetch the complete documentation index at: https://voice.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Authentication

All API requests require authentication using an API key.

## Create an API Key

1. Visit the [API Keys dashboard](https://voice.ai/app/dashboard/developers)
2. Click **"+ API Key"**
3. Name your key (e.g., "Production", "Development")
4. Click **"Create"**

<Warning>
  API keys are only shown once when created. Copy and store your key securely.
</Warning>

## Using Your API Key

Include your API key in the `Authorization` header as a Bearer token:

```bash theme={null}
Authorization: Bearer YOUR_API_KEY
```

<CodeGroup>
  ```python Python theme={null}
  import requests

  # Upload audio file using multipart/form-data
  with open('voice_sample.mp3', 'rb') as f:
      files = {'file': ('voice_sample.mp3', f, 'audio/mpeg')}
      data = {'name': 'My Voice'}
      response = requests.post(
          'https://dev.voice.ai/api/v1/tts/clone-voice',
          headers={'Authorization': 'Bearer YOUR_API_KEY'},
          files=files,
          data=data
      )
  ```

  ```bash cURL theme={null}
  curl -X POST "https://dev.voice.ai/api/v1/tts/clone-voice" \
    -H "Authorization: Bearer YOUR_API_KEY" \
    -F "file=@voice_sample.mp3" \
    -F "name=My Voice"
  ```

  ```typescript TypeScript theme={null}
  // Node.js: Using form-data library
  import FormData from 'form-data';
  import * as fs from 'fs';

  const form = new FormData();
  form.append('file', fs.createReadStream('voice_sample.mp3'));
  form.append('name', 'My Voice');

  const response = await fetch('https://dev.voice.ai/api/v1/tts/clone-voice', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer YOUR_API_KEY',
      ...form.getHeaders()
    },
    body: form
  });

  const data = await response.json();
  ```
</CodeGroup>

## Browser Usage & CORS

<Warning>
  **Browser Requests**: The API has CORS restrictions. TypeScript/JavaScript examples in the docs are for reference. For browser-based applications, use a backend proxy or server-side code to avoid CORS errors. API keys should never be exposed in client-side code.
</Warning>

For browser applications, make API calls from your backend server (Node.js, Python, etc.) rather than directly from the browser to avoid CORS issues and keep your API key secure.

## Security Best Practices

* Never commit API keys to version control
* Never expose API keys in client-side code
* Use environment variables or secret management tools
* Rotate keys regularly
* Use separate keys for development, staging, and production
* Delete unused keys

## Base URL

```
https://dev.voice.ai
```
