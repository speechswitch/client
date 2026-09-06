> ## Documentation Index
> Fetch the complete documentation index at: https://voice.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Text-to-Speech API Quickstart

> Integrate the Voice.ai Text-to-Speech API in minutes. Follow our developer quickstart to authenticate, select voices, and synthesize high-quality speech with our REST API

Generate speech from text using the Voice.ai TTS API.

<Info>
  **Prerequisites**: [API key](/docs/guides/authentication)
</Info>

## Available TTS models

Pass the hosted model ID in the `model` field of any TTS request. If you omit
`model`, English defaults to the standard hosted model.

| Model ID                                 | Use for                          | Languages                                                  |
| ---------------------------------------- | -------------------------------- | ---------------------------------------------------------- |
| `voiceai-tts-v1-latest`                  | Standard TTS, latest version     | English                                                    |
| `voiceai-tts-v1-2026-02-10`              | Standard TTS, pinned version     | English                                                    |
| `voiceai-tts-lite-v1-latest`             | Lite TTS, latest version         | English only                                               |
| `voiceai-tts-lite-v1-2026-04-15`         | Lite TTS, pinned version         | English only                                               |
| `voiceai-tts-multilingual-v1-latest`     | Multilingual TTS, latest version | `ca`, `sv`, `es`, `fr`, `de`, `it`, `pt`, `pl`, `ru`, `nl` |
| `voiceai-tts-multilingual-v1-2026-02-10` | Multilingual TTS, pinned version | `ca`, `sv`, `es`, `fr`, `de`, `it`, `pt`, `pl`, `ru`, `nl` |

Use the `latest` IDs for most applications. Use a pinned dated ID when you need
the same model snapshot across deploys. You can also fetch current public IDs
from [List Supported Models](/docs/api-reference/models/list-supported-models).

<Tip>
  **Hosted Lite**: Set `model` to `voiceai-tts-lite-v1-latest` and keep
  `language` as `en`. Lite does not support `auto` or non-English languages.
</Tip>

<Steps>
  <Step title="Get a Voice ID (Optional)">
    Optionally get a `voice_id` from your dashboard or [clone a voice](/docs/guides/text-to-speech/voice-cloning). Skip this to use the default voice.
  </Step>

  <Step title="Generate Speech">
    Generate speech from text. Include `voice_id` if you have one, or omit it to use the default voice. See the [Generate Speech](/docs/api-reference/text-to-speech/generate-speech) endpoint for details.

    <CodeGroup>
      ```python Python theme={null}
      import requests

      # Using default voice (voice_id is optional)
      response = requests.post(
          'https://dev.voice.ai/api/v1/tts/speech',
          headers={'Authorization': 'Bearer YOUR_API_KEY', 'Content-Type': 'application/json'},
          json={
              'text': 'Hello! This is a test of the Voice.ai TTS API.',
              'model': 'voiceai-tts-v1-latest',  # Optional, defaults to voiceai-tts-v1-latest
              'language': 'en'  # Optional, defaults to 'en'
          }
      )

      # Or with a custom voice_id:
      # json={'voice_id': 'your-voice-id-here', 'text': 'Hello! This is a test of the Voice.ai TTS API.', 'model': 'voiceai-tts-v1-latest', 'language': 'en'}

      with open('output.mp3', 'wb') as f:
              f.write(response.content)
      ```

      ```bash cURL theme={null}
      # Using default voice (voice_id is optional)
      curl -X POST "https://dev.voice.ai/api/v1/tts/speech" \
        -H "Authorization: Bearer YOUR_API_KEY" \
        -H "Content-Type: application/json" \
        --output output.mp3 \
        -d '{
          "text": "Hello! This is a test of the Voice.ai TTS API.",
          "model": "voiceai-tts-v1-latest",
          "language": "en"
        }'

      # Or with a custom voice_id:
      # -d '{"voice_id": "your-voice-id-here", "text": "Hello! This is a test of the Voice.ai TTS API.", "model": "voiceai-tts-v1-latest", "language": "en"}'
      ```

      ```typescript TypeScript theme={null}
      // Using default voice (voice_id is optional)
      const response = await fetch('https://dev.voice.ai/api/v1/tts/speech', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer YOUR_API_KEY',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          text: 'Hello! This is a test of the Voice.ai TTS API.',
          model: 'voiceai-tts-v1-latest',  // Optional, defaults to voiceai-tts-v1-latest
          language: 'en'  // Optional, defaults to 'en'
          // Or with a custom voice_id:
          // voice_id: 'your-voice-id-here',
        })
      });

      const audioBlob: Blob = await response.blob();

      // Play audio
      const audio = new Audio(URL.createObjectURL(audioBlob));
      audio.play();

      // Or download
      const url = URL.createObjectURL(audioBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'output.mp3';
      a.click();
      ```
    </CodeGroup>
  </Step>
</Steps>

## Streaming

<Tip>
  **For lowest latency**: Use the [WebSocket endpoint](/docs/guides/text-to-speech/streaming#websocket-streaming) for conversational AI or multiple sequential requests.
</Tip>

### HTTP Streaming (Simple)

For simple request/response streaming, use the [HTTP streaming endpoint](/docs/api-reference/text-to-speech/speech-stream):

<CodeGroup>
  ```python Python theme={null}
  import requests

  # Using default voice (voice_id is optional)
  response = requests.post(
      'https://dev.voice.ai/api/v1/tts/speech/stream',
      headers={'Authorization': 'Bearer YOUR_API_KEY', 'Content-Type': 'application/json'},
      json={
          'text': 'This text will be streamed in chunks.',
          'model': 'voiceai-tts-v1-latest',  # Optional, defaults to voiceai-tts-v1-latest
          'language': 'en'  # Optional, defaults to 'en'
      },
      stream=True
  )

  # Or with a custom voice_id:
  # json={'voice_id': 'your-voice-id-here', 'text': 'This text will be streamed in chunks.', 'model': 'voiceai-tts-v1-latest', 'language': 'en'}

  with open('output.mp3', 'wb') as f:
      for chunk in response.iter_content():
          if chunk: f.write(chunk)
  ```

  ```bash cURL theme={null}
  # Use -N flag to disable buffering for streaming
  # Using default voice (voice_id is optional)
  curl -N -X POST "https://dev.voice.ai/api/v1/tts/speech/stream" \
    -H "Authorization: Bearer YOUR_API_KEY" \
    -H "Content-Type: application/json" \
    --output output.mp3 \
    -d '{
      "text": "This text will be streamed in chunks.",
      "model": "voiceai-tts-v1-latest",
      "language": "en"
    }'

  # Or with a custom voice_id:
  # -d '{"voice_id": "your-voice-id-here", "text": "This text will be streamed in chunks.", "model": "voiceai-tts-v1-latest", "language": "en"}'
  ```

  ```typescript TypeScript theme={null}
  // Using default voice (voice_id is optional)
  const response = await fetch('https://dev.voice.ai/api/v1/tts/speech/stream', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer YOUR_API_KEY',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      text: 'This text will be streamed in chunks.',
      model: 'voiceai-tts-v1-latest',  // Optional, defaults to voiceai-tts-v1-latest
      language: 'en'  // Optional, defaults to 'en'
      // Or with a custom voice_id:
      // voice_id: 'your-voice-id-here',
    })
  });

  const reader = response.body!.getReader();
  const chunks: Uint8Array[] = [];

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      // Optionally: play chunks as they arrive for real-time playback
    }
  }

  // Play complete audio
  const audioBlob = new Blob(chunks, { type: 'audio/mpeg' });
  const audio = new Audio(URL.createObjectURL(audioBlob));
  audio.play();
  ```
</CodeGroup>

### WebSocket Streaming (Optimal for Conversational AI)

For lowest latency in multi-turn conversations, use the **Multi-Context WebSocket** (`/multi-stream`):

<CodeGroup>
  ```python Python theme={null}
  import asyncio
  import json
  import base64
  import websockets

  async def tts_conversation():
      # Use /multi-stream for multiple generations over persistent connection
      url = "wss://dev.voice.ai/api/v1/tts/multi-stream"
      headers = {"Authorization": "Bearer YOUR_API_KEY"}
      
      try:
          async with websockets.connect(url, additional_headers=headers) as ws:
              # First message (context auto-generated)
              await ws.send(json.dumps({
                  "text": "Hello! How can I help you today?",
                  "language": "en",
                  "flush": True
              }))
              
              # Receive audio chunks
              while True:
                  msg = await ws.recv()
                  data = json.loads(msg)
                  if data.get("error"):
                      print(f"Error: {data['error']}")
                      break
                  if data.get("audio"):
                      audio_chunk = base64.b64decode(data["audio"])
                      # Process/play audio chunk...
                  elif data.get("is_last"):
                      break
              
              # Second generation (same connection)
              await ws.send(json.dumps({
                  "text": "I can help you with that.",
                  "flush": True
              }))
              
              # Receive audio...
              while True:
                  msg = await ws.recv()
                  data = json.loads(msg)
                  if data.get("error"):
                      print(f"Error: {data['error']}")
                      break
                  if data.get("audio"):
                      audio_chunk = base64.b64decode(data["audio"])
                      # Process/play audio chunk...
                  elif data.get("is_last"):
                      break
              
              # Close when done
              await ws.send(json.dumps({"close_socket": True}))
              
      except websockets.ConnectionClosed as e:
          # Handle connection errors (auth failures, invalid params, etc.)
          # Close codes: 1000=normal, 1003=invalid message, 1007=invalid data,
          #              1008=policy violation (auth/credits), 1011=server error
          print(f"Connection closed: code={e.code} reason={e.reason}")

  asyncio.run(tts_conversation())
  ```

  ```typescript TypeScript theme={null}
  import WebSocket from 'ws';

  // Use /multi-stream for multiple generations over persistent connection
  const ws = new WebSocket('wss://dev.voice.ai/api/v1/tts/multi-stream', {
    headers: { 'Authorization': 'Bearer YOUR_API_KEY' }
  });

  let messageCount = 0;

  ws.on('open', () => {
    // First message
    ws.send(JSON.stringify({
      text: 'Hello! How can I help you today?',
      language: 'en',
      flush: true
    }));
  });

  ws.on('message', (data: Buffer) => {
    const message = JSON.parse(data.toString());
    
    // Handle errors
    if (message.error) {
      console.error('Error:', message.error);
      return;
    }
    
    if (message.audio) {
      const audioChunk = Buffer.from(message.audio, 'base64');
      // Process/play audio chunk...
    } else if (message.is_last) {
      messageCount++;
      if (messageCount === 1) {
        // First message complete, send second
        ws.send(JSON.stringify({
          text: 'I can help you with that.',
          flush: true
        }));
      } else {
        // All done, close connection
        ws.send(JSON.stringify({ close_socket: true }));
      }
    }
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error.message);
  });

  ws.on('close', (code, reason) => {
    // Handle connection errors (auth failures, invalid params, etc.)
    // Close codes: 1000=normal, 1003=invalid message, 1007=invalid data,
    //              1008=policy violation (auth/credits), 1011=server error
    if (code !== 1000) {
      console.error(`Connection closed with error: code=${code} reason=${reason.toString()}`);
    }
  });
  ```
</CodeGroup>

<Tip>
  **WebSocket Close Codes**: Errors are communicated via close codes. `1000` = normal, `1007` = invalid data (including validation errors like extra fields on text-only messages), `1008` = auth/credits/policy issue, `1011` = server error. See the [Streaming Guide](/docs/guides/text-to-speech/streaming#websocket-streaming) for full error handling documentation.
</Tip>

<Tip>
  **delivery\_mode**: Set `"delivery_mode": "paced"` for paced chunk emission on PCM-based outputs (`pcm`, `pcm_*`, `ulaw_8000`, `alaw_8000`). Other formats automatically fall back to `"raw"`. Default is `"raw"` for lowest latency (emits chunks immediately as generated). See the [Streaming Guide](/docs/guides/text-to-speech/streaming#single-context-websocket) for all WebSocket options.
</Tip>

## Supported Languages

The TTS API supports multiple languages. Specify the `language` parameter using ISO 639-1 language codes. If not provided, the API defaults to English (`en`).

| Language Code | Language   | Model Type       |
| ------------- | ---------- | ---------------- |
| `en`          | English    | Non-multilingual |
| `ca`          | Catalan    | Multilingual     |
| `sv`          | Swedish    | Multilingual     |
| `es`          | Spanish    | Multilingual     |
| `fr`          | French     | Multilingual     |
| `de`          | German     | Multilingual     |
| `it`          | Italian    | Multilingual     |
| `pt`          | Portuguese | Multilingual     |
| `pl`          | Polish     | Multilingual     |
| `ru`          | Russian    | Multilingual     |
| `nl`          | Dutch      | Multilingual     |

<Info>
  **Model Selection**: The API automatically selects the appropriate model based on the language. English uses `voiceai-tts-v1-latest`, while all other languages use `voiceai-tts-multilingual-v1-latest`. For Lite, explicitly set `voiceai-tts-lite-v1-latest` and `language: "en"`. See the [Model ID list](#available-tts-models) for all supported model IDs.
</Info>

## Audio Output

The TTS API supports multiple audio formats with various sample rates and bitrates. Basic formats (`mp3`, `wav`, `pcm`) output at **32kHz sample rate**. Format-specific options allow you to control sample rate and bitrate.

### 32kHz Formats

| Format | Description                                 | Use Case                              |
| ------ | ------------------------------------------- | ------------------------------------- |
| `mp3`  | Compressed, smallest file size              | Web playback, storage efficiency      |
| `wav`  | Uncompressed with headers                   | Professional audio editing            |
| `pcm`  | Raw 16-bit signed little-endian, 32kHz mono | Real-time processing, custom decoders |

### MP3 Formats (with sample rate and bitrate)

| Format          | Sample Rate | Bitrate | Use Case                     |
| --------------- | ----------- | ------- | ---------------------------- |
| `mp3_22050_32`  | 22.05kHz    | 32kbps  | Low bandwidth, voice-only    |
| `mp3_24000_48`  | 24kHz       | 48kbps  | Voice applications           |
| `mp3_44100_32`  | 44.1kHz     | 32kbps  | Music/voice, low bandwidth   |
| `mp3_44100_64`  | 44.1kHz     | 64kbps  | Music/voice, balanced        |
| `mp3_44100_96`  | 44.1kHz     | 96kbps  | Music/voice, good quality    |
| `mp3_44100_128` | 44.1kHz     | 128kbps | Music/voice, high quality    |
| `mp3_44100_192` | 44.1kHz     | 192kbps | Music/voice, highest quality |

### Opus Formats (with sample rate and bitrate)

| Format           | Sample Rate | Bitrate | Use Case                     |
| ---------------- | ----------- | ------- | ---------------------------- |
| `opus_48000_32`  | 48kHz       | 32kbps  | Low bandwidth, voice-only    |
| `opus_48000_64`  | 48kHz       | 64kbps  | Voice applications, balanced |
| `opus_48000_96`  | 48kHz       | 96kbps  | Voice/music, good quality    |
| `opus_48000_128` | 48kHz       | 128kbps | Voice/music, high quality    |
| `opus_48000_192` | 48kHz       | 192kbps | Voice/music, highest quality |

### PCM Formats (with sample rate)

All `pcm_*` formats use 16-bit signed little-endian mono at the specified sample rate.

| Format      | Sample Rate | Use Case                    |
| ----------- | ----------- | --------------------------- |
| `pcm_8000`  | 8kHz        | Telephony, low bandwidth    |
| `pcm_16000` | 16kHz       | Voice applications          |
| `pcm_22050` | 22.05kHz    | Voice/music, balanced       |
| `pcm_24000` | 24kHz       | Voice/music                 |
| `pcm_32000` | 32kHz       | Voice/music, standard       |
| `pcm_44100` | 44.1kHz     | Music, CD quality           |
| `pcm_48000` | 48kHz       | Music, professional quality |

### WAV Formats (with sample rate)

| Format      | Sample Rate | Use Case              |
| ----------- | ----------- | --------------------- |
| `wav_16000` | 16kHz       | Voice applications    |
| `wav_22050` | 22.05kHz    | Voice/music, balanced |
| `wav_24000` | 24kHz       | Voice/music           |

### Telephony Formats

| Format      | Sample Rate | Use Case                |
| ----------- | ----------- | ----------------------- |
| `alaw_8000` | 8kHz        | A-law telephony (G.711) |
| `ulaw_8000` | 8kHz        | μ-law telephony (G.711) |

<CardGroup cols={3}>
  <Card title="Voice Cloning" icon="microphone" href="/docs/guides/text-to-speech/voice-cloning">
    Create custom voices from audio samples
  </Card>

  <Card title="Streaming" icon="waveform" href="/docs/guides/text-to-speech/streaming">
    HTTP & WebSocket streaming (WebSocket for lowest latency)
  </Card>

  <Card title="API Reference" icon="book" href="/docs/api-reference">
    Complete endpoint documentation
  </Card>
</CardGroup>
