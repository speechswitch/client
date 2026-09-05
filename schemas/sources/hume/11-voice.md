> For clean Markdown of any page, append .md to the page URL.
> For a complete documentation index, see https://dev.hume.ai/llms.txt.
> For AI client integration (Claude Code, Cursor, etc.), connect to the MCP server at https://dev.hume.ai/_mcp/server.

# Voice Guide

Hume’s text-to-speech (TTS) API lets you specify which voice to use when synthesizing speech. You can use a custom
voice that you have saved or select one from Hume’s [Voice Library](https://app.hume.ai/voices).

This guide explains how to specify a voice across all of Hume's TTS endpoints.

To learn how to create or manage voices, see the [Voice Design Guide](/docs/voice/voice-design), [Voice Cloning Guide](/docs/voice/voice-cloning), and
[Voice Management Guide](/docs/voice/management).

## Voice reference options

You can specify a voice by `name` or `id`. If you use `name`, include a `provider` (defaults to `CUSTOM_VOICE`). To reference a voice from Hume's Voice Library by name, set the `provider` to `HUME_AI`.

#### By ID

#### Specify either a custom voice or one from Hume's Voice Library by ID

```json
{
  "voice": {
    "id": "9e068547-5ba4-4c8e-8e03-69282a008f04"
  }
}
```

#### By Name

#### Specify a custom voice by name

```json
{
  "voice": {
    "name": "Your Custom Voice"
  }
}
```

#### Specify a voice from Hume's Voice Library by name

```json
{
  "voice": {
    "name": "Male English Actor",
    "provider": "HUME_AI"
  }
}
```

Get voice IDs and names from [/v0/tts/voices](/reference/voices/list) or from the Platform's [Voice Library page](https://app.hume.ai/voices).

## Specify a voice in your request

To set a voice, include the
[voice](/reference/text-to-speech-tts/synthesize-json-streaming#request.body.utterances.voice) field in the first
[utterance](/reference/text-to-speech-tts/synthesize-json-streaming#request.body.utterances) of your request. That
voice is used for all following utterances unless you override it later.

Voice specification works the same across streaming and non-streaming endpoints.
The code snippets below demonstrate how to set the voice in your TTS request.

#### cURL

```cURL maxLines={0}
curl https://api.hume.ai/v0/tts/stream/json \
  -H "X-Hume-Api-Key: <apiKey>" \
  --json '{
  "version": "2",
  "utterances": [
    {
      "text": "Beauty is no quality in things themselves: It exists merely in the mind which contemplates them.",
      "voice": {
        "id": "9e068547-5ba4-4c8e-8e03-69282a008f04"
      }
    }
  ]
}'
```

#### Python

```python maxLines={0}
from hume import HumeClient
from hume.tts import PostedUtterance, PostedUtteranceVoiceWithId

client = HumeClient(api_key="YOUR_API_KEY")
response = client.tts.synthesize_json_streaming(
    utterances=[
        PostedUtterance(
            text="Beauty is no quality in things themselves: It exists merely in the mind which contemplates them.",
            voice=PostedUtteranceVoiceWithId(
                id="9e068547-5ba4-4c8e-8e03-69282a008f04"
            ),
        ),
    ],
    version="2",
)

for chunk in response.data:
    yield chunk
```

#### TypeScript

```typescript maxLines={0}
import { HumeClient } from "hume";

const client = new HumeClient({ apiKey: "YOUR_API_KEY" });
const response = await client.tts.synthesizeJsonStreaming({
  utterances: [
    {
      text: "Beauty is no quality in things themselves: It exists merely in the mind which contemplates them.",
      voice: {
        id: "9e068547-5ba4-4c8e-8e03-69282a008f04"
      },
    },
  ],
  version: "2",
});

for await (const item of response) {
  console.log(item);
}
```

Octave 1 voices are supported for both Octave 1 and Octave 2 requests, while Octave 2 voices are only supported for Octave 2
requests. If you specify an Octave 2 voice for an Octave 1 request, it will return an error.

## Resources

#### [Voice Design Guide](/docs/voice/voice-design)

Learn how to design and create custom voices.

#### [Voice Cloning Guide](/docs/voice/voice-cloning)

Create a voice clone from a live recording or an audio file.

#### [Acting Instructions](/docs/text-to-speech-tts/acting-instructions)

Control speech delivery using expressive performance cues.

#### [Continuation Guide](/docs/text-to-speech-tts/continuation)

Generate speech that leverages previous generations as context.

---