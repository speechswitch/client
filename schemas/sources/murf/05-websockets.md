> For clean Markdown of any page, append .md to the page URL.
> For a complete documentation index, see https://murf.ai/api/docs/llms.txt.
> For AI client integration (Claude Code, Cursor, etc.), connect to the MCP server at https://murf.ai/_mcp/server.

Murf TTS API supports [WebSocket streaming](/api/docs/api-reference/text-to-speech/stream-input), enabling low-latency, bidirectional communication over a persistent connection. It's designed for building responsive voice experiences like interactive voice agents, live conversations, and other real-time applications.

New: Pass model = `falcon-2` to use our Falcon 2 model in text-to-speech
streaming endpoints, designed for ultra-low latency (\~100 ms).

With a single WebSocket connection, you can stream text input and receive synthesized audio continuously, without the overhead of repeated HTTP requests. This makes it ideal for use cases where your application sends or receives text in chunks and needs real-time audio to deliver a smooth, conversational experience.

![Simple WebSocket Connection](https://fdr-prod-docs-files-public.s3.us-east-1.amazonaws.com/murf.docs.buildwithfern.com/e45b8ea71835a6ea912fceaccea2e95d5fd0f57ce4942285b15f521f8dcb826b/assets/websockets/Simple_Web_socket_conncction.png?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=AKIA6KXJSKKNFOCF7G4B%2F20260906%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20260906T004812Z&X-Amz-Expires=604800&X-Amz-Signature=efd879dd7bddbf4b4ca091652f0a0af38bc7e1ec8ff2f6751b900c51d8206f6c&X-Amz-SignedHeaders=host&x-amz-checksum-mode=ENABLED&x-id=GetObject)

### Quickstart

This guide walks you through setting up and making your first WebSocket streaming request.

#### Getting Started

Generate an API key [here](https://murf.ai/api/dashboard). Store the key in a secure location, as you'll need it to authenticate your requests. You can optionally save the key as an environment variable in your terminal.

```bash title="macOS / Linux"
# Export an environment variable on macOS or Linux systems
export MURF_API_KEY="your_api_key_here"
```

```bash title="Windows"
# Export an environment variable in PowerShell
setx MURF_API_KEY "your_api_key_here"
```

#### Install required packages

This guide uses the `websockets` and `pyaudio` Python packages. The `websockets` package is essential for the core functionality.

> **Note:** `pyaudio` is used in this quickstart guide to demonstrate playing the audio received from the WebSocket. However, it is not required to use Murf WebSockets if you have a different method for handling or playing the audio stream.

`pyaudio` depends on `PortAudio`, you may need to install it first.

#### Installing PortAudio (for PyAudio)

`PyAudio` depends on `PortAudio`, a cross-platform audio I/O library. You may need to install `PortAudio` separately if it's not already on your system.

#### macOS

```bash
brew install portaudio
```

#### Linux (Debian/Ubuntu)

```bash
sudo apt-get install libasound-dev portaudio19-dev libportaudio2 libportaudiocpp0
```

#### Windows

`PortAudio` is often bundled with Python distributions like Anaconda. If you encounter issues, you might need to download `PortAudio` binaries or install them via a package manager like Chocolatey:

```bash
choco install portaudio
```

Alternatively, refer to the [official PyAudio documentation](https://people.csail.mit.edu/hubert/pyaudio/#downloads) for Windows installation instructions.

Once you have installed `PortAudio`, you can install the required Python packages using the following command:

```bash title="Install Python packages"
pip install websockets pyaudio
```

#### Streaming Text and Playing Synthesized Audio

```py
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

## Falcon 2 Supported Voices

#### [Find your Perfect Voice](https://murf.ai/api/products/text-to-speech/Falcon?utm_source=murf_api_docs)

Explore, preview, and select from 150+ voices in 20+ expressive styles

#### English - US & Canada

| Voice ID  | Supported Locales             | Voice Styles           |
| --------- | ----------------------------- | ---------------------- |
| Will      | en-US (English - US & Canada) | Conversation           |
| Grant     | en-US (English - US & Canada) | Conversational         |
| Judith    | en-US (English - US & Canada) | Conversational         |
| Amara     | en-US (English - US & Canada) | Conversational         |
| Alicia    | en-US (English - US & Canada) | Conversation           |
| Alina     | en-US (English - US & Canada) | Conversational         |
| Angela    | en-US (English - US & Canada) | Promo                  |
| Ariana    | en-US (English - US & Canada) | Conversation           |
| Caleb     | en-US (English - US & Canada) | Conversation           |
| Daisy     | en-US (English - US & Canada) | Conversation           |
| Delilah   | en-US (English - US & Canada) | Conversational         |
| Edmund    | en-US (English - US & Canada) | Conversation           |
| Ezekiel   | en-US (English - US & Canada) | Conversational         |
| Gordon    | en-US (English - US & Canada) | Conversational         |
| Imani     | en-US (English - US & Canada) | Conversational         |
| Josie     | en-US (English - US & Canada) | Conversational         |
| Julia     | en-US (English - US & Canada) | Conversational         |
| Lillian   | en-US (English - US & Canada) | Conversational         |
| Luke      | en-US (English - US & Canada) | Conversational         |
| Madison   | en-US (English - US & Canada) | Conversational         |
| Matthew   | en-US (English - US & Canada) | Conversation           |
| Maverick  | en-US (English - US & Canada) | Conversation           |
| Miles     | en-US (English - US & Canada) | Customer Support Agent |
| Molly     | en-US (English - US & Canada) | Conversational         |
| Natalie   | en-US (English - US & Canada) | Conversation           |
| Olivia    | en-US (English - US & Canada) | Conversational         |
| Phoebe    | en-US (English - US & Canada) | Conversational         |
| Samantha  | en-US (English - US & Canada) | Conversational         |
| Sebastian | en-US (English - US & Canada) | Conversational         |
| Tyler     | en-US (English - US & Canada) | Conversational         |
| Vivian    | en-US (English - US & Canada) | Conversational         |
| Zion      | en-US (English - US & Canada) | Conversation           |

#### English - UK

| Voice ID | Supported Locales    | Voice Styles   |
| -------- | -------------------- | -------------- |
| Ruby     | en-UK (English - UK) | Conversational |
| Sharon   | en-UK (English - UK) | Conversational |
| Bertie   | en-UK (English - UK) | Conversational |
| Joshua   | en-UK (English - UK) | Conversational |
| Benedict | en-UK (English - UK) | Conversational |
| Freddie  | en-UK (English - UK) | Conversational |
| Hazel    | en-UK (English - UK) | Conversational |
| Heidi    | en-UK (English - UK) | Conversational |
| Hugo     | en-UK (English - UK) | Conversational |
| Juliet   | en-UK (English - UK) | Conversational |
| Lydia    | en-UK (English - UK) | Conversational |
| Mason    | en-UK (English - UK) | Conversational |
| Pearl    | en-UK (English - UK) | Conversational |
| Theo     | en-UK (English - UK) | Narration      |

#### English - India

| Voice ID | Supported Locales                                                                                                                                                                                                                                                           | Voice Styles   |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| Abhinav  | en-IN (English - India)                                                                                                                                                                                                                                                     | Conversational |
| Anisha   | en-IN (English - India), as-IN (Assamese - India), bn-IN (Bangla - India), hi-IN (Hindi - India), kn-IN (Kannada - India), ml-IN (Malayalam - India), mr-IN (Marathi - India), or-IN (Odia - India), pa-IN (Punjabi - India), ta-IN (Tamil - India), te-IN (Telugu - India) | Conversation   |
| Anusha   | en-IN (English - India), hi-IN (Hindi - India)                                                                                                                                                                                                                              | Conversational |
| Nikhil   | en-IN (English - India), hi-IN (Hindi - India)                                                                                                                                                                                                                              | Conversational |
| Palak    | en-IN (English - India), hi-IN (Hindi - India)                                                                                                                                                                                                                              | Conversational |
| Pooja    | en-IN (English - India), hi-IN (Hindi - India)                                                                                                                                                                                                                              | Conversational |
| Samar    | en-IN (English - India), as-IN (Assamese - India), hi-IN (Hindi - India), kn-IN (Kannada - India), or-IN (Odia - India), te-IN (Telugu - India)                                                                                                                             | Conversational |

#### English - Australia

| Voice ID | Supported Locales           | Voice Styles   |
| -------- | --------------------------- | -------------- |
| Harper   | en-AU (English - Australia) | Conversational |
| Ivy      | en-AU (English - Australia) | Conversational |
| Jimm     | en-AU (English - Australia) | Conversational |
| Leyton   | en-AU (English - Australia) | Conversational |
| Sophia   | en-AU (English - Australia) | Narration      |

#### French - France

| Voice ID  | Supported Locales       | Voice Styles   |
| --------- | ----------------------- | -------------- |
| Adélie    | fr-FR (French - France) | Conversational |
| Axel      | fr-FR (French - France) | Conversational |
| Guillaume | fr-FR (French - France) | Conversational |
| Justine   | fr-FR (French - France) | Conversational |

#### French - Canada

| Voice ID | Supported Locales       | Voice Styles   |
| -------- | ----------------------- | -------------- |
| Alexis   | fr-CA (French - Canada) | Conversational |

#### German - Germany

| Voice ID | Supported Locales        | Voice Styles   |
| -------- | ------------------------ | -------------- |
| Björn    | de-DE (German - Germany) | Conversational |
| Erna     | de-DE (German - Germany) | Conversational |
| Lara     | de-DE (German - Germany) | Conversational |
| Ralf     | de-DE (German - Germany) | Conversational |

#### Spanish - Mexico

| Voice ID | Supported Locales        | Voice Styles   |
| -------- | ------------------------ | -------------- |
| Carlos   | es-MX (Spanish - Mexico) | Conversational |
| Luisa    | es-MX (Spanish - Mexico) | Conversational |
| Valeria  | es-MX (Spanish - Mexico) | Conversational |

#### Spanish - Spain

| Voice ID | Supported Locales       | Voice Styles   |
| -------- | ----------------------- | -------------- |
| Carmen   | es-ES (Spanish - Spain) | Conversational |
| Javier   | es-ES (Spanish - Spain) | Conversational |

#### Italian - Italy

| Voice ID | Supported Locales       | Voice Styles   |
| -------- | ----------------------- | -------------- |
| Angelo   | it-IT (Italian - Italy) | Conversational |
| Greta    | it-IT (Italian - Italy) | Conversational |
| Vera     | it-IT (Italian - Italy) | Conversational |
| Vincenzo | it-IT (Italian - Italy) | Conversational |

#### Portuguese - Brazil

| Voice ID | Supported Locales           | Voice Styles   |
| -------- | --------------------------- | -------------- |
| Benício  | pt-BR (Portuguese - Brazil) | Conversational |
| Eloa     | pt-BR (Portuguese - Brazil) | Conversational |
| Gustavo  | pt-BR (Portuguese - Brazil) | Conversational |
| Heitor   | pt-BR (Portuguese - Brazil) | Conversational |
| Isadora  | pt-BR (Portuguese - Brazil) | Conversational |
| Silvio   | pt-BR (Portuguese - Brazil) | Conversational |
| Yago     | pt-BR (Portuguese - Brazil) | Conversational |

#### Mandarin - China

| Voice ID | Supported Locales        | Voice Styles   |
| -------- | ------------------------ | -------------- |
| Jiao     | zh-CN (Mandarin - China) | Conversational |
| Tao      | zh-CN (Mandarin - China) | Conversational |
| Wei      | zh-CN (Mandarin - China) | Conversational |
| Yuxan    | zh-CN (Mandarin - China) | Conversational |

#### Dutch - Netherlands

| Voice ID | Supported Locales           | Voice Styles   |
| -------- | --------------------------- | -------------- |
| Dirk     | nl-NL (Dutch - Netherlands) | Conversational |
| Famke    | nl-NL (Dutch - Netherlands) | Conversational |
| Merel    | nl-NL (Dutch - Netherlands) | Conversational |

#### Hindi - India

| Voice ID | Supported Locales                                                                                                                                                                                                                                                           | Voice Styles   |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| Aman     | hi-IN (Hindi - India)                                                                                                                                                                                                                                                       | Conversational |
| Karan    | hi-IN (Hindi - India)                                                                                                                                                                                                                                                       | Conversational |
| Khyati   | hi-IN (Hindi - India)                                                                                                                                                                                                                                                       | Conversational |
| Namrita  | hi-IN (Hindi - India), kn-IN (Kannada - India), tr-TR (Turkish - Turkey)                                                                                                                                                                                                    | Conversational |
| Sunaina  | hi-IN (Hindi - India)                                                                                                                                                                                                                                                       | Conversational |
| Anisha   | hi-IN (Hindi - India), as-IN (Assamese - India), bn-IN (Bangla - India), en-IN (English - India), kn-IN (Kannada - India), ml-IN (Malayalam - India), mr-IN (Marathi - India), or-IN (Odia - India), pa-IN (Punjabi - India), ta-IN (Tamil - India), te-IN (Telugu - India) | Conversational |
| Anusha   | hi-IN (Hindi - India), en-IN (English - India)                                                                                                                                                                                                                              | Conversational |
| Nikhil   | hi-IN (Hindi - India), en-IN (English - India)                                                                                                                                                                                                                              | Conversational |
| Palak    | hi-IN (Hindi - India), en-IN (English - India)                                                                                                                                                                                                                              | Conversational |
| Pooja    | hi-IN (Hindi - India), en-IN (English - India)                                                                                                                                                                                                                              | Conversational |
| Samar    | hi-IN (Hindi - India), as-IN (Assamese - India), en-IN (English - India), kn-IN (Kannada - India), or-IN (Odia - India), te-IN (Telugu - India)                                                                                                                             | Conversational |

#### Korean - Korea

| Voice ID | Supported Locales            | Voice Styles   |
| -------- | ---------------------------- | -------------- |
| Jangmi   | ko-KR (Korean - South Korea) | Conversational |
| Jong-su  | ko-KR (Korean - South Korea) | Conversational |
| Seok     | ko-KR (Korean - South Korea) | Conversational |

#### Tamil - India

| Voice ID    | Supported Locales                                                                                                                                                                                                                                                           | Voice Styles   |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| Karthikeyan | ta-IN (Tamil - India)                                                                                                                                                                                                                                                       | Conversational |
| Anisha      | ta-IN (Tamil - India), as-IN (Assamese - India), bn-IN (Bangla - India), en-IN (English - India), hi-IN (Hindi - India), kn-IN (Kannada - India), ml-IN (Malayalam - India), mr-IN (Marathi - India), or-IN (Odia - India), pa-IN (Punjabi - India), te-IN (Telugu - India) | Conversational |

#### Polish - Poland

| Voice ID | Supported Locales       | Voice Styles   |
| -------- | ----------------------- | -------------- |
| Blazej   | pl-PL (Polish - Poland) | Conversational |
| Jacek    | pl-PL (Polish - Poland) | Conversational |
| Kasia    | pl-PL (Polish - Poland) | Conversational |

#### Bangla - India

| Voice ID  | Supported Locales                                                                                                                                                                                                                                                           | Voice Styles   |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| Debarati  | bn-IN (Bangla - India)                                                                                                                                                                                                                                                      | Conversational |
| Subhankar | bn-IN (Bangla - India)                                                                                                                                                                                                                                                      | Conversational |
| Anisha    | bn-IN (Bangla - India), as-IN (Assamese - India), en-IN (English - India), hi-IN (Hindi - India), kn-IN (Kannada - India), ml-IN (Malayalam - India), mr-IN (Marathi - India), or-IN (Odia - India), pa-IN (Punjabi - India), ta-IN (Tamil - India), te-IN (Telugu - India) | Conversational |

#### Japanese - Japan

| Voice ID | Supported Locales        | Voice Styles   |
| -------- | ------------------------ | -------------- |
| Denki    | ja-JP (Japanese - Japan) | Conversational |
| Kenji    | ja-JP (Japanese - Japan) | Conversational |
| Kimi     | ja-JP (Japanese - Japan) | Conversational |

#### Gujarati - India

| Voice ID | Supported Locales        | Voice Styles   |
| -------- | ------------------------ | -------------- |
| Diya     | gu-IN (Gujarati - India) | Conversational |
| Hardik   | gu-IN (Gujarati - India) | Conversational |

#### Kannada - India

| Voice ID  | Supported Locales                                                                                                                                                                                                                                                           | Voice Styles   |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| Harshitha | kn-IN (Kannada - India)                                                                                                                                                                                                                                                     | Conversational |
| Anisha    | kn-IN (Kannada - India), as-IN (Assamese - India), bn-IN (Bangla - India), en-IN (English - India), hi-IN (Hindi - India), ml-IN (Malayalam - India), mr-IN (Marathi - India), or-IN (Odia - India), pa-IN (Punjabi - India), ta-IN (Tamil - India), te-IN (Telugu - India) | Conversational |
| Namrita   | kn-IN (Kannada - India), hi-IN (Hindi - India), tr-TR (Turkish - Turkey)                                                                                                                                                                                                    | Conversational |
| Samar     | kn-IN (Kannada - India), as-IN (Assamese - India), en-IN (English - India), hi-IN (Hindi - India), or-IN (Odia - India), te-IN (Telugu - India)                                                                                                                             | Conversational |

#### Malayalam - India

| Voice ID | Supported Locales                                                                                                                                                                                                                                                           | Voice Styles   |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| Madhavan | ml-IN (Malayalam - India)                                                                                                                                                                                                                                                   | Conversational |
| Nimisha  | ml-IN (Malayalam - India)                                                                                                                                                                                                                                                   | Conversational |
| Anisha   | ml-IN (Malayalam - India), as-IN (Assamese - India), bn-IN (Bangla - India), en-IN (English - India), hi-IN (Hindi - India), kn-IN (Kannada - India), mr-IN (Marathi - India), or-IN (Odia - India), pa-IN (Punjabi - India), ta-IN (Tamil - India), te-IN (Telugu - India) | Conversational |

#### Marathi - India

| Voice ID   | Supported Locales                                                                                                                                                                                                                                                           | Voice Styles   |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| Prajakta   | mr-IN (Marathi - India)                                                                                                                                                                                                                                                     | Conversational |
| Prathamesh | mr-IN (Marathi - India)                                                                                                                                                                                                                                                     | Conversational |
| Vaibhav    | mr-IN (Marathi - India)                                                                                                                                                                                                                                                     | Conversational |
| Anisha     | mr-IN (Marathi - India), as-IN (Assamese - India), bn-IN (Bangla - India), en-IN (English - India), hi-IN (Hindi - India), kn-IN (Kannada - India), ml-IN (Malayalam - India), or-IN (Odia - India), pa-IN (Punjabi - India), ta-IN (Tamil - India), te-IN (Telugu - India) | Conversational |

#### Punjabi - India

| Voice ID | Supported Locales                                                                                                                                                                                                                                                           | Voice Styles   |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| Harman   | pa-IN (Punjabi - India)                                                                                                                                                                                                                                                     | Conversational |
| Harpreet | pa-IN (Punjabi - India)                                                                                                                                                                                                                                                     | Conversational |
| Anisha   | pa-IN (Punjabi - India), as-IN (Assamese - India), bn-IN (Bangla - India), en-IN (English - India), hi-IN (Hindi - India), kn-IN (Kannada - India), ml-IN (Malayalam - India), mr-IN (Marathi - India), or-IN (Odia - India), ta-IN (Tamil - India), te-IN (Telugu - India) | Conversational |

#### Telugu - India

| Voice ID | Supported Locales                                                                                                                                                                                                                                                           | Voice Styles   |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| Anisha   | te-IN (Telugu - India), as-IN (Assamese - India), bn-IN (Bangla - India), en-IN (English - India), hi-IN (Hindi - India), kn-IN (Kannada - India), ml-IN (Malayalam - India), mr-IN (Marathi - India), or-IN (Odia - India), pa-IN (Punjabi - India), ta-IN (Tamil - India) | Conversational |
| Samar    | te-IN (Telugu - India), as-IN (Assamese - India), en-IN (English - India), hi-IN (Hindi - India), kn-IN (Kannada - India), or-IN (Odia - India)                                                                                                                             | Conversational |

## Available Regions

Use the region closest to your users for the lowest latency.

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

The **Global Router** automatically picks the nearest region automatically.The
concurrency limit is **5** for the **US-East**
region and **2** for all other regions. To get higher
concurrency, use the **US-East** endpoint directly or contact us
to increase limits for regional endpoints.

## Best Practices

Following are some best practices for using the WebSocket streaming API:

* Once connected, the session remains active as long as it is in use and will automatically close after 3 minutes of inactivity.
* You can maintain up to 10X your streaming concurrency limit in WebSocket connections, as per your plan's [rate limits](/api/docs/resources/rate-limits).
* For the lowest latency, prefer Falcon 2 voices by setting **model** = `falcon-2`.

## Next Steps

#### [Context ID](/text-to-speech/web-sockets/context-id)

Use a unique identifier to track a specific TTS request, ensuring continuity
in the conversation.

#### [Advanced WebSockets](/text-to-speech/web-sockets/advanced-settings)

Fine-tune text buffering to balance audio quality and Time to First Byte
(TTFB).

## FAQs

#### How is WebSocket streaming different from HTTP streaming in the Murf TTS API?

WebSocket allows you to stream input text and receive audio over the same
persistent connection, making it truly bidirectional. In contrast, HTTP
streaming is one-way, you send the full text once and receive audio while it
is being generated. WebSocket is better for real-time, interactive use cases
where text arrives in parts.

#### What format is the audio received over WebSocket?

The audio is streamed as a sequence of base64-encoded strings, with each
message containing a chunk of the overall audio

#### After how long will the WebSocket connection close due to inactivity?

The WebSocket connection will automatically close after 3 minutes of
inactivity.

#### What features can I use with the WebSocket Streaming API?

You can control style, speed, pitch and pauses.

#### How do I enable Falcon 2 over WebSockets, and who should use it?

Add **model** = `falcon-2` to your WebSocket connection query (or request
parameters). Falcon 2 is optimized for ultra-low latency (\~100 ms) and is
ideal for interactive agents, live support, gaming, tutoring, and other
real-time experiences where fast turn-taking matters.