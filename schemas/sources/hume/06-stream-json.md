> For clean Markdown of any page, append .md to the page URL.
> For a complete documentation index, see https://dev.hume.ai/llms.txt.
> For AI client integration (Claude Code, Cursor, etc.), connect to the MCP server at https://dev.hume.ai/_mcp/server.

# Text-to-Speech (Streamed JSON)

POST https://api.hume.ai/v0/tts/stream/json
Content-Type: application/json

Streams synthesized speech using the specified voice. If no voice is provided, a novel voice will be generated dynamically. Optionally, additional context can be included to influence the speech's style and prosody. 

The response is a stream of JSON objects including audio encoded in base64.

Reference: https://dev.hume.ai/reference/text-to-speech-tts/synthesize-json-streaming

## Authentication

- `X-Hume-Api-Key` header (required)

## Request

### Body (application/json)

- `utterances` (list of object, required) — A list of **Utterances** to be converted to speech output. An **Utterance** is a unit of input for [Octave](/docs/text-to-speech-tts/overview), and includes input `text`, an optional `description` to serve as the prompt for how the speech should be delivered, an optional `voice` specification, and additional controls to guide delivery for `speed` and `trailing_silence`.
  - `text` (string, required) — The input text to be synthesized into speech.
  - `description` (string, optional, nullable) — Natural language instructions describing how the synthesized speech should sound, including but not limited to tone, intonation, pacing, and accent. **This field behaves differently depending on whether a voice is specified**: - **Voice specified**: the description will serve as acting directions for delivery. Keep directions concise—100 characters or fewer—for best results. See our guide on [acting instructions](/docs/text-to-speech-tts/acting-instructions). - **Voice not specified**: the description will serve as a voice prompt for generating a voice. See our [prompting guide](/docs/text-to-speech-tts/prompting) for design tips.
  - `speed` (double, optional, default: 1) — Speed multiplier for the synthesized speech. Extreme values below 0.75 and above 1.5 may sometimes cause instability to the generated output.
  - `trailing_silence` (double, optional, default: 0) — Duration of trailing silence (in seconds) to add to this utterance
  - `voice` (object or object, optional, nullable) — The `name` or `id` associated with a **Voice** from the **Voice Library** to be used as the speaker for this and all subsequent `utterances`, until the `voice` field is updated again. See our [voices guide](/docs/text-to-speech-tts/voices) for more details on generating and specifying **Voices**.
    - VoiceId
      - `id` (string, required) — The unique ID associated with the **Voice**.
      - `provider` (enum, optional) — Specifies the source provider associated with the chosen voice. - **`HUME_AI`**: Select voices from Hume's [Voice Library](https://app.hume.ai/tts/voice-library), containing a variety of preset, shared voices. - **`CUSTOM_VOICE`**: Select from voices you've personally generated and saved in your account. If no provider is explicitly set, the default provider is `CUSTOM_VOICE`. When using voices from Hume's **Voice Library**, you must explicitly set the provider to `HUME_AI`. Preset voices from Hume's **Voice Library** are accessible by all users. In contrast, your custom voices are private and accessible only via requests authenticated with your API key.
        - Allowed values: `HUME_AI`, `CUSTOM_VOICE`
    - VoiceName
      - `name` (string, required) — The name of a **Voice**.
      - `provider` (enum, optional) — Specifies the source provider associated with the chosen voice. - **`HUME_AI`**: Select voices from Hume's [Voice Library](https://app.hume.ai/tts/voice-library), containing a variety of preset, shared voices. - **`CUSTOM_VOICE`**: Select from voices you've personally generated and saved in your account. If no provider is explicitly set, the default provider is `CUSTOM_VOICE`. When using voices from Hume's **Voice Library**, you must explicitly set the provider to `HUME_AI`. Preset voices from Hume's **Voice Library** are accessible by all users. In contrast, your custom voices are private and accessible only via requests authenticated with your API key.
        - Allowed values: `HUME_AI`, `CUSTOM_VOICE`
- `context` (object or object, optional, nullable) — Utterances to use as context for generating consistent speech style and prosody across multiple requests. These will not be converted to speech output.
  - ContextGenerationId
    - `generation_id` (string, required) — The ID of a prior TTS generation to use as context for generating consistent speech style and prosody across multiple requests. Including context may increase audio generation times.
  - ContextUtterances
    - `utterances` (list of object, required)
      - `text` (string, required) — The input text to be synthesized into speech.
      - `description` (string, optional, nullable) — Natural language instructions describing how the synthesized speech should sound, including but not limited to tone, intonation, pacing, and accent. **This field behaves differently depending on whether a voice is specified**: - **Voice specified**: the description will serve as acting directions for delivery. Keep directions concise—100 characters or fewer—for best results. See our guide on [acting instructions](/docs/text-to-speech-tts/acting-instructions). - **Voice not specified**: the description will serve as a voice prompt for generating a voice. See our [prompting guide](/docs/text-to-speech-tts/prompting) for design tips.
      - `speed` (double, optional, default: 1) — Speed multiplier for the synthesized speech. Extreme values below 0.75 and above 1.5 may sometimes cause instability to the generated output.
      - `trailing_silence` (double, optional, default: 0) — Duration of trailing silence (in seconds) to add to this utterance
      - `voice` (object or object, optional, nullable) — The `name` or `id` associated with a **Voice** from the **Voice Library** to be used as the speaker for this and all subsequent `utterances`, until the `voice` field is updated again. See our [voices guide](/docs/text-to-speech-tts/voices) for more details on generating and specifying **Voices**.
        - VoiceId
          - `id` (string, required) — The unique ID associated with the **Voice**.
          - `provider` (enum, optional) — Specifies the source provider associated with the chosen voice. - **`HUME_AI`**: Select voices from Hume's [Voice Library](https://app.hume.ai/tts/voice-library), containing a variety of preset, shared voices. - **`CUSTOM_VOICE`**: Select from voices you've personally generated and saved in your account. If no provider is explicitly set, the default provider is `CUSTOM_VOICE`. When using voices from Hume's **Voice Library**, you must explicitly set the provider to `HUME_AI`. Preset voices from Hume's **Voice Library** are accessible by all users. In contrast, your custom voices are private and accessible only via requests authenticated with your API key.
            - Allowed values: `HUME_AI`, `CUSTOM_VOICE`
        - VoiceName
          - `name` (string, required) — The name of a **Voice**.
          - `provider` (enum, optional) — Specifies the source provider associated with the chosen voice. - **`HUME_AI`**: Select voices from Hume's [Voice Library](https://app.hume.ai/tts/voice-library), containing a variety of preset, shared voices. - **`CUSTOM_VOICE`**: Select from voices you've personally generated and saved in your account. If no provider is explicitly set, the default provider is `CUSTOM_VOICE`. When using voices from Hume's **Voice Library**, you must explicitly set the provider to `HUME_AI`. Preset voices from Hume's **Voice Library** are accessible by all users. In contrast, your custom voices are private and accessible only via requests authenticated with your API key.
            - Allowed values: `HUME_AI`, `CUSTOM_VOICE`
- `format` (object, optional, default: {"type":"mp3"}) — Specifies the output audio file format.
  - `type`: `mp3` (Mp3Format)
  - `type`: `pcm` (PcmFormat)
  - `type`: `wav` (WavFormat)
- `include_timestamp_types` (list of enum, optional, default: []) — The set of timestamp types to include in the response. Only supported for Octave 2 requests.
  - Allowed values: `word`, `phoneme`
- `num_generations` (integer, optional, default: 1) — Number of audio generations to produce from the input utterances. Using `num_generations` enables faster processing than issuing multiple sequential requests. Additionally, specifying `num_generations` allows prosody continuation across all generations without repeating context, ensuring each generation sounds slightly different while maintaining contextual consistency.
- `split_utterances` (boolean, optional, default: true) — Controls how audio output is segmented in the response. - When **enabled** (`true`), input utterances are automatically split into natural-sounding speech segments. - When **disabled** (`false`), the response maintains a strict one-to-one mapping between input utterances and output snippets. This setting affects how the `snippets` array is structured in the response, which may be important for applications that need to track the relationship between input text and generated audio segments. When setting to `false`, avoid including utterances with long `text`, as this can result in distorted output.
- `strip_headers` (boolean, optional, default: false) — If enabled, the audio for all the chunks of a generation, once concatenated together, will constitute a single audio file. Otherwise, if disabled, each chunk's audio will be its own audio file, each with its own headers (if applicable).
- `temperature` (double, optional, nullable) — Sampling temperature for the speech generation model. Higher values increase variation; lower values increase consistency. **This is an experimental parameter.** It is recommended to use the default values for most use cases. Defaults when omitted: - Octave 1 voice creation (no voice specified): `0.9` - Octave 1 text-to-speech: `0.8` - Octave 2 text-to-speech: `0.75`
- `version` (enum, optional) — Selects the Octave model version used to synthesize speech for this request. If you omit this field, Hume automatically routes the request to the most appropriate model. Setting a specific version ensures stable and repeatable behavior across requests. Use `2` to opt into the latest Octave capabilities. When you specify version `2`, you must also provide a `voice`. Requests that set `version: 2` without a voice will be rejected. For a comparison of Octave versions, see the [Octave versions](/docs/text-to-speech-tts/overview#octave-versions) section in the TTS overview.
  - Allowed values: `1`, `2`
- `instant_mode` (boolean, optional, default: true) — Enables ultra-low latency streaming, significantly reducing the time until the first audio chunk is received. Recommended for real-time applications requiring immediate audio playback. For further details, see our documentation on [instant mode](/docs/text-to-speech-tts/overview#ultra-low-latency-streaming-instant-mode). - A [voice](/reference/text-to-speech-tts/synthesize-json-streaming#request.body.utterances.voice) must be specified when instant mode is enabled. Dynamic voice generation is not supported with this mode. - Instant mode is only supported for streaming endpoints (e.g., [/v0/tts/stream/json](/reference/text-to-speech-tts/synthesize-json-streaming), [/v0/tts/stream/file](/reference/text-to-speech-tts/synthesize-file-streaming)). - Ensure only a single generation is requested ([num_generations](/reference/text-to-speech-tts/synthesize-json-streaming#request.body.num_generations) must be `1` or omitted).

## Response

### 200

Successful Response

- Streaming response of `object`.

## Examples

**Request**

```json
{
  "utterances": [
    {
      "text": "Beauty is no quality in things themselves: It exists merely in the mind which contemplates them.",
      "voice": {
        "name": "Male English Actor",
        "provider": "HUME_AI"
      }
    }
  ]
}
```

**SDK Code**

```typescript
import { HumeClient } from "hume";

async function main() {
    const client = new HumeClient({
        apiKey: "YOUR_API_KEY_HERE",
    });
    await client.tts.synthesizeJsonStreaming({
        utterances: [
            {
                text: "Beauty is no quality in things themselves: It exists merely in the mind which contemplates them.",
                voice: {
                    name: "Male English Actor",
                    provider: "HUME_AI",
                },
            },
        ],
    });
}
main();

```

```python
from hume import HumeClient
from hume.tts import PostedUtterance, PostedUtteranceVoiceWithName

client = HumeClient(
    api_key="YOUR_API_KEY_HERE",
)

client.tts.synthesize_json_streaming(
    utterances=[
        PostedUtterance(
            text="Beauty is no quality in things themselves: It exists merely in the mind which contemplates them.",
            voice=PostedUtteranceVoiceWithName(
                name="Male English Actor",
                provider="HUME_AI",
            ),
        )
    ],
)

```