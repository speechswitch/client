> ## Documentation Index
> Fetch the complete documentation index at: https://docs.kugelaudio.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Models

> Available TTS models and legacy model IDs

KugelAudio currently exposes **Kugel 3** as the canonical production TTS model for new integrations.

<Tip>
  **New here? Use `kugel-3`.** It supports voice cloning, streaming, multilingual generation, IPA, timestamps, and `break` tags.
</Tip>

## Current model

| Model ID  | Name    | Best for                                                               |
| --------- | ------- | ---------------------------------------------------------------------- |
| `kugel-3` | Kugel 3 | Voice agents, narration, brand voices, streaming, and multilingual TTS |

## Legacy model IDs

Older integrations may still send previous model IDs. These IDs remain accepted for backwards compatibility, but new integrations should use `kugel-3`.

| Legacy `model_id` | Status                               |
| ----------------- | ------------------------------------ |
| `kugel-2.5`       | Accepted for backwards compatibility |
| `kugel-2-turbo`   | Accepted for backwards compatibility |
| `kugel-2`         | Accepted for backwards compatibility |
| `kugel-1`         | Accepted for backwards compatibility |
| `kugel-1-turbo`   | Accepted for backwards compatibility |

<Note>
  Legacy requests may route through the current production model, but billing and Dashboard usage keep the requested `model_id` visible for auditability. Use `kugel-3` in new integrations for the clearest reporting.
</Note>

## Example

<Tabs>
  <Tab title="Python">
    ```python theme={null}
    audio = client.tts.generate(
        text='Welcome to KugelAudio. <break time="400ms"/> How can I help you today?',
        model_id="kugel-3",
        voice_id=1071,
        cfg_scale=2.0,
    )
    ```
  </Tab>

  <Tab title="JavaScript">
    ```typescript theme={null}
    const audio = await client.tts.generate({
      text: 'Welcome to KugelAudio. <break time="400ms"/> How can I help you today?',
      modelId: 'kugel-3',
      voiceId: 1071,
      cfgScale: 2.0,
    });
    ```
  </Tab>

  <Tab title="cURL">
    ```bash theme={null}
    curl -X POST https://api.kugelaudio.com/v1/tts/generate \
      -H "Authorization: Bearer $KUGELAUDIO_API_KEY" \
      -H "Content-Type: application/json" \
      -d '{
        "text": "Welcome to KugelAudio. <break time=\"400ms\"/> How can I help you today?",
        "model_id": "kugel-3",
        "voice_id": 1071,
        "cfg_scale": 2.0
      }' \
      --output output.pcm
    ```
  </Tab>
</Tabs>

## Capabilities

| Capability                   | `kugel-3`                                                                    |
| ---------------------------- | ---------------------------------------------------------------------------- |
| Voice cloning (zero-shot)    | Supported                                                                    |
| IPA custom pronunciation     | Supported                                                                    |
| Built-in text normalization  | Supported                                                                    |
| Input text streaming         | Supported                                                                    |
| Output audio streaming       | Supported                                                                    |
| Word-level timestamps        | Supported                                                                    |
| Multilingual TTS             | 39 languages, single multilingual model                                      |
| Break tags (`break` element) | Supported                                                                    |
| Sample rate                  | 24 kHz native; 8 kHz, 16 kHz, 22.05 kHz, 24 kHz, and 44.1 kHz output options |
| Max input length             | 10,000 characters                                                            |

## Listing models

`GET /v1/models` returns canonical current models only. Legacy IDs are accepted for backwards compatibility, but they are not included in this endpoint response.

<Tabs>
  <Tab title="Python">
    ```python theme={null}
    models = client.models.list()

    for model in models:
        print(f"{model.id}: {model.name}")
    ```
  </Tab>

  <Tab title="JavaScript">
    ```typescript theme={null}
    const models = await client.models.list();

    for (const model of models) {
      console.log(`${model.id}: ${model.name}`);
    }
    ```
  </Tab>

  <Tab title="cURL">
    ```bash theme={null}
    curl https://api.kugelaudio.com/v1/models \
      -H "Authorization: Bearer $KUGELAUDIO_API_KEY"
    ```
  </Tab>
</Tabs>
