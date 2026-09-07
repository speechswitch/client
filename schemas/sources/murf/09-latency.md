> For clean Markdown of any page, append .md to the page URL.
> For a complete documentation index, see https://murf.ai/api/docs/llms.txt.
> For AI client integration (Claude Code, Cursor, etc.), connect to the MCP server at https://murf.ai/_mcp/server.

# Latency Optimization

## Introduction

Voice agents and real-time applications rely on consistently low latency. This page explains how to use streaming output, how to correctly measure latency, and what you can do to reliably achieve **\~100 ms** first-byte response times with [Murf Falcon 2](/api/docs/text-to-speech-models/falcon-2).

## How to Use Streaming Output

With streaming output, you don’t need to wait for the entire audio response or write it to a file before playback. Instead, process and play each audio chunk as soon as the server delivers it.

Below are example code snippets showing how to test and play streaming audio:

#### HTTP Streaming

```python
import requests
import pyaudio
import os

api_key = os.getenv("MURF_API_KEY")

url = "https://global.api.murf.ai/v1/speech/stream" # Global URL

# url = "https://in.api.murf.ai/v1/speech/stream" # Regional URL

response = requests.post(
    url,
    headers={"api-key": api_key},
    json={
        "text": "Hi, How are you doing today?",
        "model": "falcon-2",
        "voiceId": "Gordon",
        "locale": "en-US",
        "format": "PCM",
        "sampleRate": 24000
    },
    stream=True
)

# Audio format settings (must match your API output)
SAMPLE_RATE = 24000  # Default sample rate for streaming
CHANNELS = 1
FORMAT = pyaudio.paInt16

# Setup audio stream for playback
pa = pyaudio.PyAudio()
stream = pa.open(format=FORMAT, channels=CHANNELS, rate=SAMPLE_RATE, output=True)

try:
    print("Starting audio playback...")
    for chunk in response.iter_content(chunk_size=1024):
        if chunk:
            stream.write(chunk)
except Exception as e:
    print(f"Error during streaming: {e}")
finally:
    stream.stop_stream()
    stream.close()
    pa.terminate()
    print("Audio streaming and playback complete!")
```

#### WebSockets

```python
import asyncio
import websockets
import json
import base64
import pyaudio
# import os


API_KEY = "YOUR_API_KEY" # Or use os.getenv("MURF_API_KEY") if you have set the API key as an environment variable
WS_URL = "wss://global.api.murf.ai/v1/speech/stream-input"
PARAGRAPH = "With a single WebSocket connection, you can stream text input and receive synthesized audio continuously, without the overhead of repeated HTTP requests. This makes it ideal for use cases where your application sends or receives text in chunks and needs real-time audio to deliver a smooth, conversational experience"

# Audio format settings (must match your API output)
SAMPLE_RATE = 24000
CHANNELS = 1
FORMAT = pyaudio.paInt16

async def tts_stream():
    async with websockets.connect(
        f"{WS_URL}?api-key={API_KEY}&model=falcon-2&sample_rate=24000&channel_type=MONO&format=WAV"
    ) as ws:
        # Send voice config first (optional)
        voice_config_msg = {
            "voice_config": {
                "voiceId": "Gordon",
                "locale":"en-US",
                "style": "Conversation",
                "rate": 0,
                "pitch": 0,
                "variation": 1
            }
        }
        print(f'Sending payload : {voice_config_msg}')
        await ws.send(json.dumps(voice_config_msg))

        # Send text in one go (or chunk if you want streaming)
        text_msg = {
            "text": PARAGRAPH,
            "end" : True # This will close the context. So you can re-run and concurrency is available.
        }
        print(f'Sending payload : {text_msg}')
        await ws.send(json.dumps(text_msg))

        # Setup audio stream
        pa = pyaudio.PyAudio()
        stream = pa.open(format=FORMAT, channels=CHANNELS, rate=SAMPLE_RATE, output=True)

        first_chunk = True
        try:
            while True:
                response = await ws.recv()
                data = json.loads(response)
                print(f'Received data:  {data}')
                if "audio" in data:
                    audio_bytes = base64.b64decode(data["audio"])
                    # Skip the first 44 bytes (WAV header) only for the first chunk
                    if first_chunk and len(audio_bytes) > 44:
                        audio_bytes = audio_bytes[44:]
                        first_chunk = False
                    stream.write(audio_bytes)
                if data.get("final"):
                    break
        finally:
            stream.stop_stream()
            stream.close()
            pa.terminate()

if __name__ == "__main__":
    asyncio.run(tts_stream())
```

We also recommend integrating Falcon 2 directly into your agent infrastructure when testing streaming output. For the fastest and simplest setup, use the Murf plugins, which are optimized for low latency.

#### [LiveKit Integration](https://github.com/murf-ai/livekit-murf)

#### [Pipecat Integration](/api/docs/integrations/pipecat)

## How to Measure Latency

### Streaming & WebSocket Endpoints

Both Streaming and WebSocket endpoints deliver audio incrementally. To measure latency correctly, the key metric to track is **Time to First Audio Byte**. This is the only metric that reflects true real-time performance.

### Understanding Latency Components

* **Time\_namelookup:** This is the time spent resolving DNS. It can be reduced through OS-level DNS caching or by using long-lived processes that avoid repeated lookups.
* **time\_connect:** This represents the TCP handshake. You can reduce it by reusing connections and enabling keep-alive agents.
* **time\_appconnect:** This is the TLS handshake time. It can be improved by using TLS 1.3 and leveraging persistent TLS sessions.
* **time\_starttransfer:** This measures how long it takes for the server to send the very first byte of audio. This is the most important indicator for streaming performance. You can lower it with proper streaming usage and by sending shorter text chunks.
* **time\_total:** This is the full time required to receive the entire response. For real-time applications, this metric is not critical. Focus instead on **first-byte latency**.

### Measuring Latency with curl

You can inspect all timing components using the `curl -w` formatter:

```bash
curl -w "\
\n  time_namelookup:   %{time_namelookup}s\
\n  time_connect:      %{time_connect}s\
\n  time_appconnect:   %{time_appconnect}s\
\n  time_starttransfer: %{time_starttransfer}s\
\n  time_total:        %{time_total}s\n" \
  -o /dev/null \
  -X POST https://global.api.murf.ai/v1/speech/stream \
  -H "api-key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
     "text":"Hello, how are you doing today?",
     "voiceId": "Gordon",
     "locale":"en-US",
     "model": "falcon-2"
  }'
```

### **Measuring Latency with Postman**

If you prefer a UI-based method, Postman also provides a simple way to measure latency.
After you send a request, Postman shows the **request duration** directly in the response window. This value represents how long it took for Postman to receive the **first byte** of the response.

![Postman latency measurement showing request duration](https://fdr-prod-docs-files-public.s3.us-east-1.amazonaws.com/murf.docs.buildwithfern.com/bea000a47c8483985b82b5fc3995ba7ced9e3483d8498d6273eba1fd4845b666/assets/Postman_websocket.png?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=AKIA6KXJSKKNFOCF7G4B%2F20260907%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20260907T091018Z&X-Amz-Expires=604800&X-Amz-Signature=840e47fe534b3bd1ada98902a8af3926b24f3f0c1e5435cbe5c171bb0e7e2580&X-Amz-SignedHeaders=host&x-amz-checksum-mode=ENABLED&x-id=GetObject)

## **Best practices to achieve lowest latency**

### 1. Client Location

Murf provides Falcon 2 deployment in **11 global regions**. For best performance, you should:

* **Choose the region closest to your infrastructure**, or
* Use the **Global Endpoint**, which automatically routes your request to the nearest available Murf region.

This ensures your request travels the shortest possible distance, giving you the fastest achievable first-byte latency.

For example: if your agent is hosted in AWS us-east-2, choosing the same Murf region minimizes RTT. Or If you're testing from Europe or India, the global endpoint will route you to the nearest region automatically.

**Recommendation:**

Use the global endpoint for routing the request to the nearest region automatically. Below are regional urls for Falcon 2 streaming endpoint.

| Region (City/Area)                    | Endpoint                                          |
| ------------------------------------- | ------------------------------------------------- |
| Global (Routes to the nearest server) | `https://global.api.murf.ai/v1/speech/stream`     |
| US-East                               | `https://us-east.api.murf.ai/v1/speech/stream`    |
| US-West                               | `https://us-west.api.murf.ai/v1/speech/stream`    |
| India                                 | `https://in.api.murf.ai/v1/speech/stream`         |
| Canada                                | `https://ca.api.murf.ai/v1/speech/stream`         |
| South Korea                           | `https://kr.api.murf.ai/v1/speech/stream`         |
| UAE                                   | `https://me.api.murf.ai/v1/speech/stream`         |
| Japan                                 | `https://jp.api.murf.ai/v1/speech/stream`         |
| Australia                             | `https://au.api.murf.ai/v1/speech/stream`         |
| EU (Central)                          | `https://eu-central.api.murf.ai/v1/speech/stream` |
| UK                                    | `https://uk.api.murf.ai/v1/speech/stream`         |
| South America (São Paulo)             | `https://sa-east.api.murf.ai/v1/speech/stream`    |

### 2. Client Environment

Latency depends heavily on **where your request originates**. Your client (browser or server) must send a request to Murf’s servers and wait for the first audio byte to come back. The physical distance and network path directly affect round-trip time (RTT).

### **Browser vs. Server**

When you test from a **browser**, your **local machine** becomes the client. This means latency will include:

* Your home/office network quality
* Your ISP routing
* Distance from your physical location to Murf’s servers
* Wi-Fi instability, VPNs, or proxies

As a result, browser tests usually show **higher** and more **variable** latency. However, in production your voice agent will typically be hosted on a **server**, such as **AWS**, or **GCP**. Servers in major cloud regions have:

* Much lower network hop counts
* Direct peering to hyperscalers
* Highly stable routing paths

This results in significantly lower and more consistent latency.

#### Recommendation:

To understand real-world performance of your agent, always measure latency from the same environment where the agent will run, **ideally a cloud server**, not your local laptop.

### 3. Language & Script Considerations

Some languages require additional preprocessing or have inherently higher synthesis complexity, which can add a 10-20 milliseconds to first-byte latency. You can minimize this by using the right script and optimizing input text.

#### Best Practices:

**Use the correct script for each language**

For Hindi, always prefer **Devanagari (देवनागरी)** instead of Latin transliteration. This reduces preprocessing and results in **lower latency** and more accurate pronunciation. If you send Hindi written in English characters (“aap kaise ho”), the system currently performs transliteration, which adds 5–10 ms of overhead.

Examples:

* **Hindi — Devanagari (देवनागरी)**

  * **Recommended:** "आप कैसे हैं?"
  * **Not recommended:** "aap kaise hain?"

* **Tamil — Tamil script (தமிழ்)**

  * **Recommended:** "நீங்கள் எப்படி இருக்கிறீர்கள்?"
  * **Not recommended:** "neenga eppadi irukeenga?"

* **Telugu — Telugu script (తెలుగు)**

  * **Recommended:** "మీరు ఎలా ఉన్నారు?"
  * **Not recommended:** "meeru ela unnaru?"

* **Kannada — Kannada script (ಕನ್ನಡ)**

  * **Recommended:** "ನೀವು ಹೇಗಿದ್ದೀರಿ?"
  * **Not recommended:** "neevu hegiddiri?"

* **Bengali — Bengali script (বাংলা)**

  * **Recommended:** "আপনি কেমন আছেন?"

  * **Not recommended:** "apni kemon achhen?"

* **Marathi — Devanagari (देवनागरी)**

  * **Recommended:** "तू कसा आहेस?"

  * **Not recommended:** "tu kasa ahes?"

* **Gujarati — Gujarati script (ગુજરાતી)**

  * **Recommended:** "તમે કેમ છો?"

  * **Not recommended:** "tame kem cho?"

#### Keep your text concise

Very long input blocks delay the tokenization stage before streaming can start.Shorter, well-structured sentences allow faster first-byte response.

### 4. Use Connection Pooling (Persistent Connections)

Reusing connections avoids repeated TCP and TLS handshakes, which significantly reduces first-byte latency.

* **Python:** use `httpx.AsyncClient()` or `requests.Session()` to keep connections warm.
* **WebSockets:** Keep the socket open and stream multiple generations over the same connection.

Persistent connections help you avoid 30 - 80 ms of extra overhead per request, especially in real-time voice workloads.