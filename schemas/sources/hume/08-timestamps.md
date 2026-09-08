> For clean Markdown of any page, append .md to the page URL.
> For a complete documentation index, see https://dev.hume.ai/llms.txt.
> For AI client integration (Claude Code, Cursor, etc.), connect to the MCP server at https://dev.hume.ai/_mcp/server.

# Timestamps Guide

Octave 2 supports **word- and phoneme-level timestamps** in TTS responses. These timestamps enable developers
to:

* **Align audio with text** for real-time captions or word highlighting.
* **Synchronize multimodal outputs** such as animated avatars or lip-syncing.
* **Post-process speech** by cutting, looping, or segmenting audio with precision.

## Requesting timestamps

**Timestamps are only returned when you specify them** in your request.

**Use `include_timestamp_types` to specify timestamps** by passing an array of supported types: `"word"` and `"phoneme"`.

**Specify `"version": "2"` in your request body** to ensure timestamp support.

How you specify timestamps differs between **HTTP** and **WebSocket** endpoints:

* **HTTP**: Include the [`include_timestamp_types`](/reference/text-to-speech-tts/synthesize-json-streaming#request.body.include_timestamp_types)
  field in your request body.

  #### cURL

  ```curl maxLines=0 highlight={5}
  curl "https://api.hume.ai/v0/tts/stream/json" \
    -H "X-Hume-Api-Key: $HUME_API_KEY" \
    --json '{
      "version": "2",
      "include_timestamp_types": ["word", "phoneme"],
      "utterances": [
        {
          "voice": { "id": "5bb7de05-c8fe-426a-8fcc-ba4fc4ce9f9c" },
          "text": "My friend told me about this amazing place!",
        }
      ]
    }'
  ```

  #### Python

  ```python maxLines=0 highlight={7}
  import os, asyncio
  from hume import AsyncHumeClient

  hume = AsyncHumeClient(api_key=os.getenv("HUME_API_KEY"))
  stream = await hume.tts.synthesize_json_streaming(
      version="2",
      include_timestamp_types=["word", "phoneme"],
      utterances=[{
          "voice": { "id": "5bb7de05-c8fe-426a-8fcc-ba4fc4ce9f9c" },
          "text": "My friend told me about this amazing place!",
      }],
  )
  ```

  #### TypeScript

  ```typescript maxLines=0 highlight={6}
  import { HumeClient } from "@humeai/sdk";

  const hume = new HumeClient({ apiKey: process.env.HUME_API_KEY! });
  const stream = await hume.tts.synthesizeJsonStreaming({
    version: "2",
    includeTimestampTypes: ["word", "phoneme"],
    utterances: [{
      voice: { id: "5bb7de05-c8fe-426a-8fcc-ba4fc4ce9f9c" },
      text: "My friend told me about this amazing place!",
    }],
  });
  ```
* **WebSocket**: Set the [`include_timestamp_types`](/reference/text-to-speech-tts/stream-input#request.query.include_timestamp_types)
  **query parameter** of the handshake request. This will ensure timestamps will be streamed alongside TTS output
  audio for the duration of the session.

## Receiving timestamps

**When you request to receive timestamps you’ll receive
[**`OctaveOutputTimestamp`**](/reference/text-to-speech-tts/synthesize-json-streaming#response.body.OctaveOutputTimestamp)
objects**, containing the timestamp data, over the stream. `OctaveOutputTimestamp` objects arrive interleaved with
[`SnippetAudioChunk`](/reference/text-to-speech-tts/synthesize-json-streaming#response.body.SnippetAudioChunk)
objects.

#### Phoneme-level

```json maxLines={0}
{
  "type":"timestamp",
  "request_id":"dc995e9e-5379-48d7-a62a-81593300395e2570671",
  "generation_id":"eae965b6-7c20-4b56-b703-bbea7e50793f",
  "snippet_id":"72837cf5-fdb4-4232-9cf0-0b5b8bd2579a",
  "timestamp": {
    "type":"phoneme",
    "text":"m",
    "time": {
      "begin":60,
      "end":80
    }
  }
}
```

#### Word-level

```json maxLines={0}
{
  "type":"timestamp",
  "request_id":"dc995e9e-5379-48d7-a62a-81593300395e2570671",
  "generation_id":"eae965b6-7c20-4b56-b703-bbea7e50793f",
  "snippet_id":"72837cf5-fdb4-4232-9cf0-0b5b8bd2579a",
  "timestamp":{
    "type":"word",
    "text":"My",
    "time": {
      "begin":60,
      "end":120
    }
  }
}
```

#### Phoneme standard

Phoneme-level timestamps use **IPA (International Phonetic Alphabet)** symbols.
For some languages, we use **IPA-compatible extensions** consistent with the
[eSpeak NG](https://github.com/espeak-ng/espeak-ng) phoneme inventory and
language dictionaries.

## Resources

#### [TypeScript Lipsync Example](https://github.com/HumeAI/hume-api-examples/tree/main/tts/tts-typescript-lipsync)

See an example of how to use timestamps in a TypeScript project.