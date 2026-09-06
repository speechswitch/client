> ## Documentation Index
> Fetch the complete documentation index at: https://docs.rime.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Streaming TTS

> Choose HTTP or WebSockets for real-time Rime speech, with runnable examples for low-latency voice agents.

## tl;dr: All Rime models stream.

Rime's TTS API streams audio as it is generated rather than waiting for the full utterance. Coda and Mist stream over HTTP and WebSockets. Under typical conditions, the cloud API delivers sub-200ms end-to-end latency when an application uses the nearest [regional endpoint](/docs/regional-endpoints). For real-time voice agents, streaming is the default mode of operation.

## Choosing a transport

|                           | HTTP streaming                             | WebSocket (JSON)                             | SSE                                                  |
| ------------------------- | ------------------------------------------ | -------------------------------------------- | ---------------------------------------------------- |
| **Endpoint**              | `POST /v1/rime-tts`                        | `wss://users-ws.rime.ai/ws3`                 | `POST /v1/rime-tts` with `Accept: text/event-stream` |
| **Models**                | All                                        | All                                          | Mist v2 only                                         |
| **Connection**            | One request per utterance                  | Persistent, multi-utterance                  | One request per utterance                            |
| **Input**                 | Full text upfront                          | Incremental text (e.g. from a streaming LLM) | Full text upfront                                    |
| **Word-level timestamps** | ❌                                          | ✅                                            | ❌                                                    |
| **Interruption handling** | Close the connection                       | `clear` operation + context IDs              | Close the connection                                 |
| **Best for**              | Simple integrations, server-side synthesis | Voice agents, conversational AI, telephony   | Browser `EventSource` clients                        |

**Rules of thumb:**

* **Building a voice agent?** Use the [WebSocket API](/docs/websockets). A persistent connection avoids per-utterance handshakes, you can feed text in as your LLM generates it, and word-level timestamps tell you exactly what was spoken when a caller interrupts.
* **Synthesizing complete sentences server-side?** HTTP streaming is the simplest path: one POST, audio bytes stream back in the response body.
* **Already using LiveKit, Pipecat, Vapi, or Daily?** The [integrations](/docs/livekit) handle transport for you. Rime plugs in as the TTS stage of the pipeline.

## HTTP streaming

A single `POST` to `https://users.rime.ai/v1/rime-tts` returns audio bytes in the response body as they are generated. The `Accept` header controls the format: Opus, MP3, WAV, PCM, or G.711 μ-law. See the [full format table](/api-reference/coda/http).

```bash cURL theme={null}
curl --request POST \
  --url https://users.rime.ai/v1/rime-tts \
  --header 'Accept: audio/mpeg' \
  --header "Authorization: Bearer $RIME_API_KEY" \
  --header 'Content-Type: application/json' \
  --output output.mp3 \
  --fail \
  --show-error \
  --data '{
  "text": "Streaming audio from Rime, as it is generated.",
  "modelId": "coda",
  "speaker": "astra",
  "lang": "en"
}'
```

```python Python theme={null}
import os, requests

with requests.post(
    "https://users.rime.ai/v1/rime-tts",
    headers={
        "Authorization": f"Bearer {os.environ['RIME_API_KEY']}",
        "Content-Type": "application/json",
        "Accept": "audio/mpeg",
    },
    json={
        "text": "Streaming audio from Rime, as it is generated.",
        "modelId": "coda",
        "speaker": "astra",
        "lang": "en",
    },
    stream=True,
) as response:
    response.raise_for_status()
    for chunk in response.iter_content(chunk_size=4096):
        ...  # feed chunk to your player, telephony stream, or file
```

The first audio bytes arrive long before synthesis finishes; consume the body incrementally (as above) rather than buffering the whole response, or you give back most of the latency win. See [Latency](/docs/latency) for measured time-to-first-audio per model.

Endpoint references: [Coda](/api-reference/coda/http) · [Mist v3](/api-reference/mistv3/http) · [Mist v2](/api-reference/mistv2/http)

## WebSocket streaming

Rime's WebSocket API (`wss://users-ws.rime.ai/ws3`) holds a persistent connection: send text messages as your application produces them and receive structured JSON events back, including base64 audio chunks, word-level timestamps, and a `done` event per synthesis batch.

```python Python theme={null}
import asyncio, base64, json, os
import websockets

async def main():
    url = "wss://users-ws.rime.ai/ws3?speaker=astra&modelId=coda&audioFormat=mp3"
    headers = {"Authorization": f"Bearer {os.environ['RIME_API_KEY']}"}

    async with websockets.connect(url, additional_headers=headers) as ws:
        await ws.send(json.dumps({"text": "Hello from Rime over WebSockets."}))
        await ws.send(json.dumps({"operation": "eos"}))  # synthesize and close

        async for message in ws:
            event = json.loads(message)
            if event["type"] == "chunk":
                audio_bytes = base64.b64decode(event["data"])
                ...  # play or forward the audio
            elif event["type"] == "timestamps":
                print(event["word_timestamps"]["words"])
            elif event["type"] == "done":
                print("synthesis complete")

asyncio.run(main())
```

The server emits four event types: `chunk` (base64 audio), `timestamps` (word-level timing), `done` (synthesis batch complete), and `error`. The `segment` parameter controls text buffering and when synthesis starts. See [Segmentation & behavior settings](/docs/websockets-segment).

<Card title="WebSocket API overview" icon="plug" href="/docs/websockets">
  Choosing between /ws3, /ws2, and /ws, the full event schema, context IDs, and interruption handling.
</Card>

Endpoint references: [Coda](/api-reference/coda/websockets-json) · [Mist v3](/api-reference/mistv3/websockets-json) · [Mist v2](/api-reference/mistv2/websockets-json)

## Server-sent events (SSE)

For clients built around `EventSource`, Mist v2 supports [server-sent events](/api-reference/mistv2/sse): the same `POST /v1/rime-tts` endpoint with `Accept: text/event-stream` streams audio as events over a standard HTTP response. SSE is only available for Mist v2; for other models, use HTTP or WebSocket streaming.

## Streaming for telephony and IVR

For phone-based voice agents and IVR systems, request audio that matches the telephony codec directly. Rime synthesizes G.711 μ-law (`audio/PCMU`) and 8kHz-sampled audio natively, so no transcoding step sits between synthesis and the caller:

* Set `Accept: audio/PCMU` (HTTP) or `audioFormat=mulaw` (WebSocket) for μ-law output.
* Set `samplingRate: 8000` to match the telephony stream and shrink payloads.

Telephony and voice-agent platform guides: [LiveKit](/docs/livekit) · [Vapi](/docs/vapi) · [SignalWire](/docs/signalwire) · [Daily](/docs/daily) · [VideoSDK](/docs/videosdk)

## Latency

Listeners experience time to first audio, not total synthesis time, so streaming has the largest effect on perceived responsiveness. Under typical conditions, Rime's cloud API delivers sub-200ms end-to-end latency when an application uses the nearest [regional endpoint](/docs/regional-endpoints). With `mistv3`, typical time to first byte is well below 100ms. Coda achieves sub-100ms model latency on the GPU engine when self-hosted or on-prem.

<Card title="Latency" icon="gauge-simple-max" href="/docs/latency">
  Measured benchmarks per model, what affects response time, and how to reduce it; regional endpoints, payload sizing, and text normalization.
</Card>
