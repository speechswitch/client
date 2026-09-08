> ## Documentation Index
> Fetch the complete documentation index at: https://voice.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Text-to-Speech Streaming API

> Stream real-time audio with the Voice.ai Streaming TTS API. Implement HTTP Chunked or WebSocket protocols for low-latency speech synthesis in conversational AI applications

* [HTTP Chunked Streaming](#http-chunked-streaming)
* [WebSocket Streaming](#websocket-streaming)
  * [Single-Context WebSocket](#single-context-websocket)
  * [Multi-Context WebSocket](#multi-context-websocket)
* [When to Use](#when-to-use)
* [Best Practices](#best-practices)

Stream audio in real-time using HTTP chunked transfer encoding or WebSocket connections. Both methods send audio chunks as they're generated, reducing latency for conversational AI and real-time applications.

## HTTP Chunked Streaming

The [streaming endpoint](/docs/api-reference/text-to-speech/speech-stream) (`/api/v1/tts/speech/stream`) uses HTTP chunked transfer encoding:

* Audio arrives incrementally, reducing time-to-first-audio
* Start playing audio before generation completes
* Lower memory usage (no need to buffer entire file)
* Better UX for real-time applications

### Examples

<CodeGroup>
  ```python Python theme={null}
  import requests

  # Using default voice (voice_id is optional)
  response = requests.post(
      'https://dev.voice.ai/api/v1/tts/speech/stream',
      headers={'Authorization': 'Bearer YOUR_API_KEY', 'Content-Type': 'application/json'},
      json={
          'text': 'This is a test of streaming audio generation.',
          'model': 'voiceai-tts-v1-latest',  # Optional, defaults to voiceai-tts-v1-latest
          'language': 'en'  # Optional, defaults to 'en'
      },
      stream=True
  )

  # Or with a custom voice_id:
  # json={'voice_id': 'your-voice-id-here', 'text': 'This is a test of streaming audio generation.', 'model': 'voiceai-tts-v1-latest', 'language': 'en'}

  with open('output.mp3', 'wb') as f:
      for chunk in response.iter_content():
          if chunk: f.write(chunk)
  ```

  ```bash cURL theme={null}
  # Using default voice (voice_id is optional)
  curl -N -X POST "https://dev.voice.ai/api/v1/tts/speech/stream" \
    -H "Authorization: Bearer YOUR_API_KEY" \
    -H "Content-Type: application/json" \
    --output output.mp3 \
    -d '{
      "text": "This is a test of streaming audio generation.",
      "model": "voiceai-tts-v1-latest",
      "language": "en",
      "audio_format": "mp3",
      "temperature": 1.0,
      "top_p": 0.8
    }'

  # Or with a custom voice_id:
  # -d '{"voice_id": "your-voice-id-here", "text": "This is a test of streaming audio generation.", "model": "voiceai-tts-v1-latest", "language": "en", "audio_format": "mp3", "temperature": 1.0, "top_p": 0.8}'
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
      text: 'This is a test of streaming audio generation.',
      model: 'voiceai-tts-v1-latest',  // Optional, defaults to voiceai-tts-v1-latest
      language: 'en'  // Optional, defaults to 'en'
      // Or with a custom voice_id:
      // voice_id: 'your-voice-id-here',
    })
  });

  const reader = response.body!.getReader();
  const chunks: Uint8Array[] = [];

  // Process chunks as they arrive
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }

  // Play complete audio
  const audioBlob = new Blob(chunks, { type: 'audio/mpeg' });
  const audio = new Audio(URL.createObjectURL(audioBlob));
  audio.play();
  ```
</CodeGroup>

## WebSocket Streaming

WebSocket streaming for real-time TTS. Two modes are available:

| Endpoint        | Use Case                            | Connection Lifecycle           |
| --------------- | ----------------------------------- | ------------------------------ |
| `/stream`       | Single generation                   | Closes after audio completes   |
| `/multi-stream` | Multiple generations, multi-speaker | Persistent until client closes |

**Authentication:** Include your API key in the `Authorization` header. See the [Authentication guide](/docs/guides/authentication) for details.

**Protocol:**

* First message is an **init message** (sets voice, model, language)
* Text can be buffered over multiple messages before flush
* All messages are JSON text (binary input is rejected)
* Server responds with JSON messages containing base64-encoded audio

### Single-Context WebSocket

**Endpoint:** [`wss://dev.voice.ai/api/v1/tts/stream`](/docs/api-reference/text-to-speech/single-context-websocket)

Single generation per WebSocket connection. Text is buffered until flush, audio streams back, then the server closes the connection (code 1000). For multiple generations, use [Multi-Context WebSocket](#multi-context-websocket) instead.

<CodeGroup>
  ```python Python theme={null}
  import asyncio
  import json
  import base64
  import websockets

  async def test_tts_websocket():
      url = "wss://dev.voice.ai/api/v1/tts/stream"
      headers = {
          "Authorization": "Bearer YOUR_API_KEY"
      }
      
      try:
          async with websockets.connect(url, additional_headers=headers) as ws:
              # Init message with text and flush=true for immediate generation
              await ws.send(json.dumps({
                  "voice_id": None,  # Optional: voice ID (None = default built-in voice)
                  "text": "Hello, this is a test.",
                  "audio_format": "mp3",
                  "language": "en",
                  "model": "voiceai-tts-v1-latest",
                  "flush": True
              }))
              
              # Receive audio chunks
              audio_data = b""
              while True:
                  msg = await ws.recv()
                  data = json.loads(msg)
                  if data.get("audio"):
                      chunk = base64.b64decode(data["audio"])
                      audio_data += chunk
                      print(f"Received {len(chunk)} bytes")
                  elif data.get("is_last"):
                      print("Complete!")
                      break
              
              # Save audio
              with open("output.mp3", "wb") as f:
                  f.write(audio_data)
                  
      except websockets.ConnectionClosed as e:
          # Errors close connection with close code (no JSON error message)
          print(f"Connection closed: code={e.code} reason={e.reason}")

  asyncio.run(test_tts_websocket())
  ```

  ```bash cURL theme={null}
  # Using websocat (install: brew install websocat)
  websocat -H "Authorization: Bearer YOUR_API_KEY" \
    "wss://dev.voice.ai/api/v1/tts/stream"

  # Then send JSON messages:
  # {"voice_id": "<VOICE_ID>", "text": "Hello world", "language": "en", "model": "voiceai-tts-v1-latest", "flush": true}

  # Or using wscat (install: npm install -g wscat)
  wscat -H "Authorization: Bearer YOUR_API_KEY" \
    -c "wss://dev.voice.ai/api/v1/tts/stream"
  ```

  ```typescript TypeScript theme={null}
  // Node.js: Using 'ws' library (npm install ws)
  import WebSocket from 'ws';
  import * as fs from 'fs';

  const ws = new WebSocket('wss://dev.voice.ai/api/v1/tts/stream', {
    headers: {
      'Authorization': 'Bearer YOUR_API_KEY'
    }
  });

  let audioData = Buffer.alloc(0);

  ws.on('open', () => {
    ws.send(JSON.stringify({
      voice_id: null,
      text: 'Hello, this is a test.',
      audio_format: 'mp3',
      language: 'en',
      model: 'voiceai-tts-v1-latest',
      flush: true
    }));
  });

  ws.on('message', (data: Buffer) => {
    const message = JSON.parse(data.toString());
    
    if (message.audio) {
      const chunk = Buffer.from(message.audio, 'base64');
      audioData = Buffer.concat([audioData, chunk]);
      console.log(`Received ${chunk.length} bytes`);
      return;
    }
    
    if (message.is_last) {
      console.log('Complete!');
      fs.writeFileSync('output.mp3', audioData);
    }
  });

  ws.on('close', (code, reason) => {
    // Errors close connection with close code (no JSON error message)
    if (code !== 1000) {
      console.error(`Error: code=${code} reason=${reason.toString()}`);
    } else {
      console.log('Connection closed');
    }
  });
  ```
</CodeGroup>

**Message Format:**

* **Input:** JSON text messages only
* **Output:** JSON messages with base64-encoded audio

```json theme={null}
{
  "voice_id": "uuid",      // Optional: voice to use (defaults to model's built-in voice if omitted)
  "text": "Hello world",   // Text to buffer
  "language": "en",        // Optional: Language code (ISO 639-1, e.g., "en", "es", "fr"), defaults to "en"
  "flush": true,           // Trigger audio generation (connection closes after)
  "audio_format": "mp3",   // Optional: mp3, wav, pcm, or format-specific options (e.g., mp3_44100_128, opus_48000_64, pcm_16000)
  "temperature": 1.0,      // Optional: 0.0-2.0
  "top_p": 0.8,            // Optional: 0.0-1.0
  "delivery_mode": "raw",  // Optional: "raw" (default) = emit immediately for lowest latency; "paced" applies only to pcm/pcm_*/ulaw_8000/alaw_8000 (other formats fall back to raw)
  "model": "voiceai-tts-v1-latest"  // Optional: model. Use voiceai-tts-lite-v1-latest for English-only Lite generation.
}
```

**Server Responses:**

* `{"audio": "<base64-encoded-audio>"}` - Audio chunks as base64 strings (streamed immediately)
* `{"is_last": true}` - Sent after all audio chunks are sent. Indicates generation is complete. Server closes connection (code 1000) immediately after this message.

**Error Handling:** Errors are sent via WebSocket close codes only (no JSON error messages). Handle the `close` event to detect errors:

* `1000` - Normal closure (generation complete)
* `1003` - Invalid message type (binary not supported, or expected text message)
* `1007` - Invalid data (malformed JSON, validation errors). Includes `extra inputs are not permitted` when subsequent messages send init-only fields.
* `1008` - Policy violation (authentication failed, text too long, insufficient credits, invalid parameters)
* `1011` - Internal server error (TTS generation failed, session preparation failed)

### Multi-Context WebSocket

**Endpoint:** [`wss://dev.voice.ai/api/v1/tts/multi-stream`](/docs/api-reference/text-to-speech/multi-context-websocket)

Multiple concurrent TTS streams over a single WebSocket connection. Each context has its own voice and settings.

<CodeGroup>
  ```python Python theme={null}
  import asyncio
  import json
  import base64
  import websockets

  async def test_multi_context():
      url = "wss://dev.voice.ai/api/v1/tts/multi-stream"
      headers = {
          "Authorization": "Bearer YOUR_API_KEY",
      }
      
      try:
          async with websockets.connect(url, additional_headers=headers) as ws:
              # Init context-1 (first message to ctx-1)
              await ws.send(json.dumps({
                  "context_id": "ctx-1",
                  "voice_id": "VOICE_ID_1",
                  "text": "Hello from context one.",
                  "language": "en",
                  "model": "voiceai-tts-v1-latest",
                  "flush": True
              }))
              
              # Init context-2 (first message to ctx-2, can use different voice)
              await ws.send(json.dumps({
                  "context_id": "ctx-2", 
                  "voice_id": "VOICE_ID_2",
                  "text": "Hello from context two.",
                  "language": "en",
                  "model": "voiceai-tts-v1-latest",
                  "flush": True
              }))
              
              # Receive responses (will be interleaved, all JSON with base64 audio)
              audio_by_context = {}  # {context_id: bytes}
              completed = set()
              while len(completed) < 2:
                  msg = await ws.recv()
                  data = json.loads(msg)
                  ctx = data.get("context_id")
                  if data.get("audio"):
                      chunk = base64.b64decode(data["audio"])
                      if ctx not in audio_by_context:
                          audio_by_context[ctx] = b""
                      audio_by_context[ctx] += chunk
                      print(f"Audio chunk for {ctx}: {len(chunk)} bytes")
                      # Note: is_last is sent as a separate message after all chunks
                  elif data.get("is_last"):
                      # Flush completion (sent after all audio chunks for this flush)
                      # Context remains active and can receive more flushes
                      completed.add(ctx)
                      print(f"{ctx} flush complete!")
                  elif data.get("error"):
                      # Handle errors (e.g., insufficient credits, invalid voice)
                      print(f"Error for {ctx}: {data['error']}")
                      completed.add(ctx)  # Mark as done to avoid infinite loop
              
              # Send another message to existing context
              await ws.send(json.dumps({
                  "context_id": "ctx-1",
                  "text": "More text for context one.",
                  "flush": True
              }))
              
              # Receive audio for the new message
              while True:
                  msg = await ws.recv()
                  data = json.loads(msg)
                  if data.get("audio"):
                      chunk = base64.b64decode(data["audio"])
                      audio_by_context["ctx-1"] += chunk
                  elif data.get("is_last"):
                      break
                  elif data.get("error"):
                      print(f"Error: {data['error']}")
                      break
              
              # Close entire socket
              await ws.send(json.dumps({"close_socket": True}))
          
          # Save audio to files
          for ctx_id, audio_data in audio_by_context.items():
              filename = f"output_{ctx_id}.mp3"
              with open(filename, "wb") as f:
                  f.write(audio_data)
              print(f"Saved {ctx_id} audio to {filename} ({len(audio_data)} bytes)")
              
      except websockets.ConnectionClosed as e:
          # Connection-level errors (auth, policy violations)
          print(f"Connection closed: code={e.code} reason={e.reason}")

  asyncio.run(test_multi_context())
  ```

  ```bash cURL theme={null}
  # Using websocat
  websocat -H "Authorization: Bearer YOUR_API_KEY" \
    "wss://dev.voice.ai/api/v1/tts/multi-stream"

  # Send messages with context_id:
  # {"context_id": "alice", "voice_id": "<ALICE_VOICE>", "text": "Hi!", "language": "en", "model": "voiceai-tts-v1-latest", "flush": true}
  # {"context_id": "bob", "voice_id": "<BOB_VOICE>", "text": "Hello!", "language": "en", "model": "voiceai-tts-v1-latest", "flush": true}
  ```

  ```typescript TypeScript theme={null}
  // Node.js: Using 'ws' library
  import WebSocket from 'ws';
  import * as fs from 'fs';

  const ws = new WebSocket('wss://dev.voice.ai/api/v1/tts/multi-stream', {
    headers: {
      'Authorization': 'Bearer YOUR_API_KEY'
    }
  });

  const audioByContext: Record<string, Buffer> = {};
  const completed = new Set<string>();

  ws.on('open', () => {
    // Init context-1
    ws.send(JSON.stringify({
      context_id: 'ctx-1',
      voice_id: 'VOICE_ID_1',
      text: 'Hello from context one.',
      language: 'en',
      model: 'voiceai-tts-v1-latest',
      flush: true
    }));
    
    // Init context-2
    ws.send(JSON.stringify({
      context_id: 'ctx-2',
      voice_id: 'VOICE_ID_2',
      text: 'Hello from context two.',
      language: 'en',
      model: 'voiceai-tts-v1-latest',
      flush: true
    }));
  });

  ws.on('message', (data: Buffer) => {
    const message = JSON.parse(data.toString());
    const ctx = message.context_id;
    
    if (message.audio) {
      const chunk = Buffer.from(message.audio, 'base64');
      if (!audioByContext[ctx]) {
        audioByContext[ctx] = Buffer.alloc(0);
      }
      audioByContext[ctx] = Buffer.concat([audioByContext[ctx], chunk]);
      console.log(`Audio chunk for ${ctx}: ${chunk.length} bytes`);
      // Note: is_last is sent as a separate message after all chunks
      return;
    }
    
    if (message.is_last) {
      // Flush completion (sent after all audio chunks for this flush)
      // Context remains active and can receive more flushes
      completed.add(ctx);
      console.log(`${ctx} flush complete!`);
      
      // Save audio when all contexts are complete
      if (completed.size === 2) {
        for (const [ctxId, audioData] of Object.entries(audioByContext)) {
          fs.writeFileSync(`output_${ctxId}.mp3`, audioData);
        }
      }
    } else if (message.error) {
      // Handle per-context errors (e.g., insufficient credits, invalid voice)
      console.error(`Error for ${ctx}: ${message.error}`);
      completed.add(ctx);  // Mark as done to avoid waiting forever
    }
  });

  ws.on('close', (code, reason) => {
    // Connection-level errors (auth, policy violations)
    if (code !== 1000) {
      console.error(`Connection closed: code=${code} reason=${reason.toString()}`);
    }
  });

  ws.on('error', (err) => {
    console.error(`WebSocket error: ${err.message}`);
  });
  ```
</CodeGroup>

**Message Format:**

* **Input:** JSON text messages only
* **Output:** JSON messages with base64-encoded audio and `context_id`

```json theme={null}
{
  "context_id": "ctx-1",   // Context identifier (auto-generated if omitted)
  "voice_id": "uuid",      // Optional: voice to use (defaults to model's built-in voice if omitted)
  "text": "Hello",         // Text to buffer
  "language": "en",        // Optional: Language code (ISO 639-1, e.g., "en", "es", "fr"), defaults to "en"
  "flush": true,           // Trigger audio generation
  "audio_format": "mp3",   // Optional: mp3, wav, pcm, or format-specific options (e.g., mp3_44100_128, opus_48000_64, pcm_16000)
  "temperature": 1.0,      // Optional: 0.0-2.0
  "top_p": 0.8,            // Optional: 0.0-1.0
  "delivery_mode": "raw",  // Optional: "raw" (default) = emit immediately; "paced" applies only to pcm/pcm_*/ulaw_8000/alaw_8000 (other formats fall back to raw)
  "model": "voiceai-tts-v1-latest",  // Optional: model
  "auto_close": true,      // Auto-close context after flush (releases concurrent slot)
  "close_context": true,   // Close this context explicitly
  "close_socket": true     // Close entire connection
}
```

**Server Responses:**

* `{"audio": "<base64-encoded-audio>", "context_id": "ctx-1"}` - Audio chunks with context ID (streamed immediately, no buffering delay)
* `{"is_last": true, "context_id": "ctx-1"}` - Completion message sent after all audio chunks for a flush (separate message, never included in audio messages)
  * **Note:** `is_last` is sent after EACH flush completes, allowing the same context to be reused for multiple flushes
* `{"context_closed": true, "context_id": "ctx-1"}` - Sent when a context is explicitly closed via `close_context` (separate from `is_last`)
* `{"error": "message", "context_id": "ctx-1"}` on error

**Closing Contexts and Connections:**

* `{"context_id": "ctx-1", "close_context": true}` - Close a specific context. Server responds with `context_closed` to confirm.
* `{"close_socket": true}` - Close the entire WebSocket connection and all contexts. Can be included in any message or sent standalone.

**Auto-Close (Fire-and-Forget):**

Use `auto_close: true` with your flush to automatically close the context after audio generation completes. This is useful for:

* Single-generation patterns where you don't need to reuse the context
* Releasing concurrent generation slots immediately after audio is sent
* Fire-and-forget TTS where you just want the audio without managing context lifecycle

```json theme={null}
{"context_id": "ctx-1", "text": "Hello!", "flush": true, "auto_close": true}
```

The server will send `is_last` followed by `context_closed` when auto-close is enabled.

## When to Use

**Use HTTP Chunked Streaming for:**

* Simple request/response patterns
* One-off audio generation
* Stateless operations

**Use Single-Context WebSocket (`/stream`) for:**

* Single audio generation with WebSocket protocol
* Text buffering before generation (send text incrementally, flush once)
* When you need WebSocket protocol but only one generation per connection

**Use Multi-Context WebSocket (`/multi-stream`) for:**

* Conversational AI applications with multiple turns
* Multiple sequential audio generations over persistent connection
* Multiple concurrent voices in the same application
* Conversation simulations with multiple speakers
* When voice settings should persist across multiple requests
* Applications requiring voice switching

**Use non-streaming for:**

* Batch processing
* Simpler code requirements
* Small text inputs
* When you don't need real-time audio

## Best Practices

### HTTP Chunked Streaming

* Handle network errors gracefully
* Start playing audio chunks as soon as they arrive
* Implement timeout handling for long streams
* Prefer MP3 for efficiency; PCM for highest quality

### WebSocket Streaming

* Always send an init message first (with voice, model, language)
* Handle `is_last` as a separate message to know when audio is complete
  * The same context can be reused for multiple flushes - each flush generates its own `is_last`
* Handle `context_closed` message for context closure confirmation
  * When you send `close_context`, the server responds with `context_closed` to confirm the context is closed
* Decode base64 audio chunks properly
* Handle errors gracefully
* **Single-context (`/stream`):** Connection closes after `is_last`. Reconnect for each generation.
* **Multi-context (`/multi-stream`):** Connection stays open. Track audio by `context_id` to avoid mixing streams.
  * **Closing contexts:** Send `{"context_id": "ctx-1", "close_context": true}` (can be sent standalone, no text/flush required). Server responds with `context_closed` to confirm closure.
  * **Auto-close contexts:** Use `auto_close: true` with your flush to automatically close the context after generation completes. This releases the concurrent generation slot immediately and is ideal for fire-and-forget patterns.
  * **Closing connection:** Send `{"close_socket": true}` to close the entire WebSocket connection and all contexts.

### General

* Use appropriate audio format (MP3 for efficiency, WAV/PCM for quality)
* All audio is output at **32kHz sample rate**
* Implement reconnection logic for WebSocket connections
* Monitor connection health and handle disconnections
* Set appropriate timeouts for all streaming methods

## Audio Output Formats

The TTS API supports multiple audio formats with various sample rates and bitrates. Basic formats (`mp3`, `wav`, `pcm`) output at **32kHz sample rate**. Format-specific options allow you to control sample rate and bitrate.

### 32kHz Formats

| Format | Description                                 | Use Case                              |
| ------ | ------------------------------------------- | ------------------------------------- |
| `mp3`  | Compressed, smallest size                   | Web playback, bandwidth efficiency    |
| `wav`  | Uncompressed with headers                   | Professional audio, editing           |
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

## Related Endpoints

* [Generate Speech (Non-streaming)](/docs/api-reference/text-to-speech/generate-speech) - Standard request/response TTS
* [Generate Speech Stream](/docs/api-reference/text-to-speech/speech-stream) - HTTP chunked streaming
* [Single-Context WebSocket](/docs/api-reference/text-to-speech/single-context-websocket) - WebSocket streaming for single voice
* [Multi-Context WebSocket](/docs/api-reference/text-to-speech/multi-context-websocket) - WebSocket streaming for multiple concurrent voices

See the [API Reference](/docs/api-reference) for complete documentation.
