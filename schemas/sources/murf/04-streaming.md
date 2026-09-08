> For clean Markdown of any page, append .md to the page URL.
> For a complete documentation index, see https://murf.ai/api/docs/llms.txt.
> For AI client integration (Claude Code, Cursor, etc.), connect to the MCP server at https://murf.ai/_mcp/server.

Our legacy Gen2 streaming model is deprecated. We recommend using our latest [Falcon 2](/api/docs/text-to-speech-models/falcon-2) model instead.

Murf TTS API supports real-time streaming capabilities, allowing developers to generate and play text-to-speech (TTS) audio dynamically as it is being generated in real-time, reducing the time-to-first-byte. This ensures minimal latency, making it ideal for conversational AI, real-time applications, and voice-enabled assistants.

New: Pass model = `falcon-2` to use our Falcon 2 model in text-to-speech
streaming endpoints, designed for ultra-low latency (\~100 ms).

In addition to HTTP [streaming endpoint](/api/docs/api-reference/text-to-speech/stream), Murf TTS supports Websocket streaming which enables bidirectional streaming for real-time audio generation.

#### [WebSockets](/api/docs/text-to-speech/web-sockets)

Generate speech in real-time with low latency and high quality using
WebSockets

## Quickstart

Streaming enables returning raw audio bytes (e.g., MP3 data) directly over HTTP using chunked transfer encoding. This allows clients to process or play audio incrementally as it is generated. This section focuses on how streaming works for requests made to the Text to Speech API.

#### Getting Started

Generate an API key [here](https://murf.ai/api/dashboard?utm_source=murf_api_docs). Store the key in a secure location, as you'll need it to authenticate your requests. You can optionally save the key as an environment variable in your terminal.

#### Initiating a Streaming Request

#### Python SDK

### Install the Python SDK and PyAudio

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

```bash
pip install murf pyaudio
```

### Make the API Call with Real-Time Playback

Once you have the SDK and PyAudio installed, and the API key set as an environment variable, you are ready to make your first streaming API call with real-time audio playback.

```python
import pyaudio
from murf import Murf, MurfRegion

client = Murf(
    api_key="YOUR_API_KEY", # Not required if you have set the MURF_API_KEY environment variable
    region=MurfRegion.GLOBAL
)

# For lower latency, specify a region closer to your users
# client = Murf(region=MurfRegion.IN)  # Example: India region

# Audio format settings (must match your API output)
SAMPLE_RATE = 24000  
CHANNELS = 1
FORMAT = pyaudio.paInt16

def play_streaming_audio():
    # Get the streaming audio generator
    audio_stream = client.text_to_speech.stream(
        text="Hi, How are you doing today?",
        voice_id="Gordon",
        model="falcon-2",
        locale="en-US",
        sample_rate=SAMPLE_RATE,
        format="PCM"
    )

    # Setup audio stream for playback
    pa = pyaudio.PyAudio()
    stream = pa.open(format=FORMAT, channels=CHANNELS, rate=SAMPLE_RATE, output=True)

    try:
        print("Starting audio playback...")
        for chunk in audio_stream:
            if chunk:  # Check if chunk has data
                stream.write(chunk)
    except Exception as e:
        print(f"Error during streaming: {e}")
    finally:
        stream.stop_stream()
        stream.close()
        pa.terminate()
        print("Audio streaming and playback complete!")

if __name__ == "__main__":
    play_streaming_audio()
```

#### REST API

```py

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

```js
const axios = require('axios');
const Speaker = require('speaker');

async function playStreamingAudio() {
  const apiUrl = "https://global.api.murf.ai/v1/speech/stream"; // Global endpoint
  // const apiUrl = "https://in.api.murf.ai/v1/speech/stream"; // Regional endpoint
  const apiKey = process.env.MURF_API_KEY; // Use environment variable

  const requestBody = {
    text: "Hi, How are you doing today?",
    voiceId: "Gordon",
    locale:"en-US",
    model:"falcon-2",
    format: "PCM",
    sampleRate: 24000,
  };

  try {
    const response = await axios.post(apiUrl, requestBody, {
      headers: {
        "Content-Type": "application/json",
        "api-key": apiKey,
      },
      responseType: "stream",
    });

    // Setup speaker for audio playback
    const speaker = new Speaker({
      channels: 1,          
      bitDepth: 16,         
      sampleRate: 24000     
    });

    console.log("Starting audio playback...");
    response.data.pipe(speaker);

    speaker.on('close', () => {
      console.log("Audio playback complete!");
    });

    speaker.on('error', (err) => {
      console.error("Speaker error:", err);
    });

  } catch (error) {
    console.error("Error:", error.message);
  }
}

playStreamingAudio();
```

```curl
# Global URL
curl -X POST https://global.api.murf.ai/v1/speech/stream \
  -H "api-key: $MURF_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Hi, How are you doing today?",
    "voiceId": "Gordon",
    "locale":"en-US",
    "model": "falcon-2"
  }'

# Eg : Regional URL
curl -X POST https://in.api.murf.ai/v1/speech/stream \
  -H "api-key: $MURF_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
  "text": "Hi, How are you doing today?",
  "voiceId": "Gordon",
  "locale":"en-US",
  "model": "falcon-2"
}'

```

In the response, you will receive a stream of audio data. You can save this data to a file or play it directly using an audio library.

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

## Endpoint & Concurrency Overview

| Endpoint base                                                       | Concurrency cap                                              |
| ------------------------------------------------------------------- | ------------------------------------------------------------ |
| `https://global.api.murf.ai/v1/speech/stream`                       | **5** (if nearest server is US-East) / 2 (all other regions) |
| `https://<region>.api.murf.ai/v1/speech/stream` (see regions below) | 5 for US-East / 2 for all other regions                      |

The **Global Router** automatically picks the nearest region automatically.The
concurrency limit is **5** for the **US-East**
region and **2** for all other regions. To get higher
concurrency, use the **US-East** endpoint directly or contact us
to increase limits for regional endpoints.

### Available Regions

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

## FAQs

#### What is Falcon 2?

Falcon 2 is our fastest streaming model (\~100 ms latency) optimized for
real-time interactions.

#### Who should use Falcon 2?

Use Falcon 2 when your top priority is ultra-low latency. Typical fits
include: - Conversational agents & live support where snappy turn-taking
matters. - Real-time apps (IVR, gaming, tutoring, assistive tech) that
stream audio as users speak. - Interruptible/barge-in experiences and
interactive demos or prototyping.

#### How do I enable Falcon 2?

Include model = `falcon-2` in your request (HTTP or WebSocket). If omitted,
the default streaming model is used.

#### What features are supported in streaming mode?

In streaming mode, you can control the voice, style, pitch, speed, and
locale in both Gen2 and Falcon 2 models. The Gen2 model also supports pause
tags.

#### What audio format will this support

* We support **MP3**, **FLAC**, **WAV**, **ALAW**, **ULAW**, **OGG**, and
  **PCM**. - If you need to transmit audio as text, you can Base64-encode any
  of these.

```
```