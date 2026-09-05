> ## Documentation Index
> Fetch the complete documentation index at: https://docs.kugelaudio.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Regions

> Choose between the canonical endpoint and the direct EU endpoint

By default, SDKs use the canonical geo-routed endpoint. Existing API keys and
SDK code continue to work without changes. Select the direct EU endpoint only
when you need to pin traffic to Europe.

## Endpoint Options

| Selection       | Endpoint                | Behavior                                                  |
| --------------- | ----------------------- | --------------------------------------------------------- |
| Default         | `api.kugelaudio.com`    | Canonical geo-routed API                                  |
| `eu`            | `api.eu.kugelaudio.com` | Direct EU endpoint                                        |
| `us` / `global` | `api.kugelaudio.com`    | Supported compatibility hints; use the canonical endpoint |

## Choosing EU

Use the default endpoint for automatic geo-routing. Select **EU** only when you
need to pin traffic to Europe.

## How to Set Your Region

You can select the direct EU endpoint with an API-key prefix or an explicit
region. You can also bypass region resolution by supplying an API URL directly.

### Option 1: Prefix Your API Key

Prepend `eu-` to your API key. The prefix is stripped automatically before
authentication — the server never sees it.

This is the simplest approach, especially when your API key comes from an environment variable:

```bash theme={null}
# .env
KUGELAUDIO_API_KEY=eu-ka_your_api_key_here
```

No code changes needed — the SDK detects the prefix and uses the EU endpoint.

### Option 2: Set the Region in Code

All SDKs accept an explicit EU region parameter:

<Tabs>
  <Tab title="Python">
    ```python theme={null}
    from kugelaudio import KugelAudio

    client = KugelAudio(api_key="ka_your_api_key", region="eu")

    client = await KugelAudio.create(api_key="ka_your_api_key", region="eu")
    ```
  </Tab>

  <Tab title="JavaScript">
    ```typescript theme={null}
    import { KugelAudio } from 'kugelaudio';

    const client = new KugelAudio({
      apiKey: 'ka_your_api_key',
      region: 'eu',
    });
    ```
  </Tab>

  <Tab title="Java">
    ```java theme={null}
    import com.kugelaudio.sdk.*;

    KugelAudio client = new KugelAudio(
        KugelAudioOptions.builder("ka_your_api_key")
            .region(Region.EU)
            .build()
    );
    ```
  </Tab>

  <Tab title="cURL">
    ```bash theme={null}
    curl -X POST https://api.eu.kugelaudio.com/v1/tts/generate \
      -H "Authorization: Bearer $KUGELAUDIO_API_KEY" \
      -H "Content-Type: application/json" \
      -d '{"text": "Hello from KugelAudio!", "model_id": "kugel-3", "voice_id": 1071}'
    ```
  </Tab>
</Tabs>

### Priority

When multiple EU endpoint hints are present, the SDK resolves them in this order:

1. **Explicit API URL** — `api_url` in Python, `apiUrl` in JavaScript, or `apiUrl` in Java
2. **`region`** — explicit EU region parameter
3. **API key prefix** — `eu-`
4. **Default** — canonical geo-routed API (`api.kugelaudio.com`)

## WebSocket Connections

EU endpoint selection applies to both REST and WebSocket endpoints. The SDK
automatically uses the correct host for WebSocket connections:

```
wss://api.eu.kugelaudio.com/ws/tts?api_key=YOUR_API_KEY
```

## FAQ

<AccordionGroup>
  <Accordion title="Do I need to change anything if I use the default endpoint?">
    If you want automatic geo-routing, no. If you need to pin traffic to Europe, set `region="eu"` or use the `eu-` API key prefix.
  </Accordion>

  <Accordion title="Are voices and models the same across regions?">
    Query `/v1/models` and `/v1/voices` on the endpoint you plan to use to
    confirm its current catalog and your custom-voice availability.
  </Accordion>

  <Accordion title="Can I switch regions without getting a new API key?">
    Yes. Your API key works with the default and EU endpoints — just add or remove the `eu-` prefix or `region="eu"` parameter. No need to regenerate keys.
  </Accordion>
</AccordionGroup>
