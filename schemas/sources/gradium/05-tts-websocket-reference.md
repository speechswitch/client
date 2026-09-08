> ## Documentation Index
> Fetch the complete documentation index at: https://docs.gradium.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# TTS WebSocket Stream

> Stream real-time Gradium text-to-speech audio over WebSocket.

<RequestExample>
  ```bash cURL (WebSocket) theme={null}
  wscat -c "wss://api.gradium.ai/api/speech/tts" \
    -H "x-api-key: YOUR_API_KEY"
  ```
</RequestExample>

## Lifecycle

```json theme={null}
{"type":"setup","voice_id":"YTpq7expH9539ERJ","model_name":"default","output_format":"pcm"}
{"type":"text","text":"Hello, world."}
{"type":"end_of_stream"}
```

The server responds with `ready`, then one or more `audio` and `text`
messages, and finally `end_of_stream`. See
[WebSocket Lifecycle](/guides/websocket-lifecycle) for connection
behavior, reusable sockets, browser tokens, and errors.

## Client Messages

### `setup`

| Field              | Type             | Required    | Description                                                                                                   |
| ------------------ | ---------------- | ----------- | ------------------------------------------------------------------------------------------------------------- |
| `type`             | string           | Yes         | Always `"setup"`.                                                                                             |
| `model_name`       | string           | No          | Model alias, defaults to `"default"`. Set to `"gradium-tts-beta"` to test our newest Text-to-Speech model.    |
| `voice_id`         | string           | Recommended | Voice library or custom voice ID.                                                                             |
| `voice`            | string           | No          | Voice name fallback when `voice_id` is not provided.                                                          |
| `output_format`    | string           | No          | `wav`, `pcm`, `opus`, `ulaw_8000`, `alaw_8000`, or explicit PCM rates such as `pcm_16000`. Defaults to `wav`. |
| `json_config`      | object or string | No          | Advanced TTS settings. See [Voice Settings](/guides/voice-settings).                                          |
| `pronunciation_id` | string           | No          | Pronunciation dictionary ID.                                                                                  |
| `client_req_id`    | string           | No          | Correlates multiplexed requests.                                                                              |
| `close_ws_on_eos`  | boolean          | No          | Defaults to `true`; set `false` to keep the socket open.                                                      |
| `retry_for_s`      | number           | No          | Optional setup retry window in seconds.                                                                       |

### `text`

| Field           | Type   | Required | Description                                  |
| --------------- | ------ | -------- | -------------------------------------------- |
| `type`          | string | Yes      | Always `"text"`.                             |
| `text`          | string | Yes      | Text chunk to synthesize.                    |
| `client_req_id` | string | No       | Required when routing a multiplexed request. |

### `end_of_stream`

| Field           | Type   | Required | Description                           |
| --------------- | ------ | -------- | ------------------------------------- |
| `type`          | string | Yes      | Always `"end_of_stream"`.             |
| `client_req_id` | string | No       | End the matching multiplexed request. |

## Server Messages

### `ready`

| Field                | Type      | Description                                                                                                                                            |
| -------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `type`               | string    | Always `"ready"`.                                                                                                                                      |
| `request_id`         | string    | Gradium request ID for logging and support.                                                                                                            |
| `model_name`         | string    | Requested model alias.                                                                                                                                 |
| `model_ext`          | string    | Resolved model identifier, when present.                                                                                                               |
| `sample_rate`        | integer   | Output sample rate.                                                                                                                                    |
| `frame_size`         | integer   | Output frame size in samples.                                                                                                                          |
| `audio_stream_names` | string\[] | Named audio streams, when present.                                                                                                                     |
| `text_stream_names`  | string\[] | Named text streams, when present.                                                                                                                      |
| `client_req_id`      | string    | Present for multiplexed requests.                                                                                                                      |
| `residency`          | string    | Data residency of the session (e.g. `pinned; zone=eu`, `best-effort; zone=us`, or `none`), when present. See [Data Residency](/guides/data-residency). |

### `audio`

| Field           | Type    | Description                       |
| --------------- | ------- | --------------------------------- |
| `type`          | string  | Always `"audio"`.                 |
| `audio`         | string  | Base64-encoded audio chunk.       |
| `start_s`       | number  | Chunk start time in seconds.      |
| `stop_s`        | number  | Chunk stop time in seconds.       |
| `stream_id`     | integer | Stream identifier, when present.  |
| `client_req_id` | string  | Present for multiplexed requests. |

### `text`

| Field           | Type    | Description                                   |
| --------------- | ------- | --------------------------------------------- |
| `type`          | string  | Always `"text"`.                              |
| `text`          | string  | Text segment associated with generated audio. |
| `start_s`       | number  | Segment start time in seconds.                |
| `stop_s`        | number  | Segment stop time in seconds.                 |
| `stream_id`     | integer | Stream identifier, when present.              |
| `client_req_id` | string  | Present for multiplexed requests.             |

### Terminal messages

| Type            | Description                                                |
| --------------- | ---------------------------------------------------------- |
| `end_of_stream` | The request is complete.                                   |
| `flushed`       | Reserved for flush acknowledgements.                       |
| `error`         | Terminal error message; the socket closes after the error. |

```json Error theme={null}
{"type":"error","message":"Error description","code":1008}
```


## OpenAPI

````yaml GET /speech/tts
openapi: 3.1.0
info:
  title: Gradium API
  description: >-
    This documentation covers the Gradium API.


    This API exposes our Text-To-Speech and Speech-To-Text models, which offers
    low-latency, high-quality & natural sounding output and best in class
    accuracy.  


    For issues, questions, or feature requests, please contact us at
    support@gradium.ai
  version: 0.1.0
servers:
  - url: https://api.gradium.ai/api
    description: Gradium API
security:
  - ApiKeyAuth: []
tags:
  - name: Documentation
    description: >
      # Features


      - **Multilingual**: We currently support five languages: English (en),
      French (fr), German (de), Spanish (es) and Portuguese (pt) for our
      Text-To-Speech and Speech-To-Text with more languages to come. 

      - **Low-latency**: Our servers are based in Europe and in the US, with our
      expected time-to-first-token is below 300ms when streaming.

      - **Voice selection**: We provide a voice library, with multiple voices to
      choose from in different languages. You can also clone voices
      instantaneously using a 10'' voice sample. 


      # Installation


      ```bash

      pip install gradium

      ```


      # Quick Start


      ```python

      import asyncio

      import gradium


      async def main():
          client = gradium.client.GradiumClient(api_key="your-api-key")

          result = await client.tts(
              setup={"voice_id": "YTpq7expH9539ERJ", "output_format": "wav"},
              text="Welcome to Gradium! Transform your text into natural-sounding speech in seconds."
          )

          with open("welcome.wav", "wb") as f:
              f.write(result.raw_data)

      if __name__ == "__main__":
          asyncio.run(main())
      ```


      # Creating a Client


      ## Using API Key Directly


      ```python

      import gradium


      client = gradium.client.GradiumClient(api_key="gd_your_api_key_here")

      ```


      ## Using Environment Variable


      Set the `GRADIUM_API_KEY` environment variable:


      ```bash

      export GRADIUM_API_KEY=gd_your_api_key_here

      ```


      Then create the client without passing the API key:


      ```python

      client = gradium.client.GradiumClient()

      ```


      # Text-to-Speech (TTS)


      ## Basic Usage


      ```python

      import gradium


      client = gradium.client.GradiumClient()

      result = await client.tts(
          setup={
              "model_name": "default", 
              "voice_id": "YTpq7expH9539ERJ",
              "output_format": "wav"
          },
          text="Hello, world!"
      )


      with open("output.wav", "wb") as f:
          f.write(result.raw_data)

      print(f"Sample rate: {result.sample_rate}")

      print(f"Request ID: {result.request_id}")

      ```


      ## Setup Parameters


      - **`model_name`**: The TTS model to use (default: `"default"`)

      - **`voice_id`**: The voice id of the voice to be used. The voice id can
      be found in the voice library section of this documentation or in the
      studio.

      - **`output_format`**: Audio format of the input data (supported: `"pcm"`,
        `"wav"`, `"opus"`, ...)

      When using `"pcm"` output format, the audio will adhere to the following

      specifications:

      - **Sample Rate**: 48000 Hz (48kHz)

      - **Format**: PCM (Pulse Code Modulation)

      - **Bit Depth**: 16-bit signed integer

      - **Channels**: Single channel (mono)

      - **Chunk Size**: 3840 samples per chunk (80ms at 48kHz)


      When using the `"wav"` output format, the audio chunks are in WAV format,

      at 48kHz, 16-bit signed integer mono.


      When using the `"opus"` output format, the audio chunks use the Opus codec

      wrapped in an Ogg container.


      Alternative output formats include `"ulaw_8000"`, `"alaw_8000"`,
      `"pcm_8000"`,

      `"pcm_16000"`, and `"pcm_24000"`.



      ## Streaming TTS


      The TTS can be used in a streaming fashion. The first chunks of audio will
      be

      available as soon as they are generated.


      ```python

      stream = await client.tts_stream(
          setup={
              "model_name": "default",
              "voice_id": "LFZvm12tW_z0xfGo",
              "output_format": "pcm"
          },
          text="This is a longer text that will be streamed."
      )


      async for audio_chunk in stream.iter_bytes():
          print(f"Received {len(audio_chunk)} bytes")
      ```


      ## Using Custom Voices


      ```python

      result = await client.tts(
          setup={
              "model_name": "default",
              "voice_id": "YTpq7expH9539ERJ",
              "output_format": "wav"
          },
          text="Hello with my custom voice!"
      )

      ```


      ## Output Formats


      ```python

      # WAV format

      result = await client.tts(setup={"voice_id": "YTpq7expH9539ERJ",
      "output_format": "wav"}, text="Hello")


      # PCM format: the data is sampled at 48kHz, 16-bit signed integer, mono

      result = await client.tts(setup={"voice_id": "YTpq7expH9539ERJ",
      "output_format": "pcm"}, text="Hello")


      # Get numpy array from PCM

      pcm_array = result.pcm()

      pcm16_array = result.pcm16()

      ```


      ## Flushing and Pauses


      The model only generates audio when it has enough context to do so, so
      generally

      the audio lags a few words behind the text input. The `<flush>` tag can be

      used to force the model to output the audio for all the text that has been

      input so far.


      ```python

      sample_text = "Hello, this is a test from the Gradium Text to Speech
      system. <flush> We are testing the flush."

      test_audio = await client.tts(
          setup={'voice_id': 'YTpq7expH9539ERJ', 'output_format': 'wav'},
          text=sample_text,
      )

      ```


      Pauses can be generated by inserting a "break time" tag as show below.

      The brak time is specified in seconds and should be between 0.1 and 2.0s.

      The tag must be preceeded and followed by a space.


      ```python


      sample_text = 'Hello, this is a test from the Gradium Text to Speech
      system. <break time="1.5s" /> We are testing the pause.'


      test_audio = await client.tts(
          setup={'voice_id': 'YTpq7expH9539ERJ', 'output_format': 'wav'},
          text=sample_text,
      )

      ```


      ## Text with Timestamps


      The model also returns word-level timestamps for the generated audio.


      ```python

      result = await client.tts(
          setup={"voice_id": "YTpq7expH9539ERJ", "output_format": "wav"},
          text="Hello, world!"
      )


      for item in result.text_with_timestamps:
          print(f"{item.text}: {item.start_s:.2f}s - {item.stop_s:.2f}s")
      ```



      ## Async Generator Input


      ```python

      async def text_generator():
          yield "Hello, "
          yield "this is "
          yield "a streaming "
          yield "example."

      stream = await client.tts_stream(
          setup={"voice_id": "YTpq7expH9539ERJ", "output_format": "pcm"},
          text=text_generator()
      )


      async for chunk in stream.iter_bytes():
          pass
      ```


      ## Pronunciation Dictionaries


      Pronunciation dictionaries allow you to customize how specific words or
      phrases are pronounced in your TTS output. This is particularly useful
      for:

      - Brand names, technical terms, or proper nouns

      - Acronyms that should be pronounced in a specific way

      - Words with non-standard pronunciations in your use case



      The easiest way to create and manage pronunciation dictionaries is through
      the Gradium Studio, on the pronunciation page.

      Once you have created a dictionary and obtained its ID, you can use it in
      your TTS requests by passing the `pronunciation_id` parameter in the setup
      message, similar to the way we pass the voice_id:


      ```python

      import gradium


      client = gradium.client.GradiumClient()


      result = await client.tts(
          setup={
              "voice_id": "YTpq7expH9539ERJ",
              "output_format": "wav",
              "pronunciation_id": "bb1ckYhNHCcIJjdK",  # Whatever your ID is.
          },
          text="The text you want to generate."
      )


      with open("output.wav", "wb") as f:
          f.write(result.raw_data)
      ```


      # Multiplexing


      Multiplexing allows you to send multiple independent TTS requests over a
      single WebSocket connection. Each request is tracked independently using a
      unique identifier, allowing concurrent processing of multiple text inputs
      without opening multiple connections.


      When multiplexing is enabled, each message you send to the server must
      include a `client_req_id` field. The server will stamp all response
      messages (audio chunks, metadata, etc.) with the same `client_req_id`,
      allowing you to match responses to their corresponding requests.


      To enable multiplexing, include `close_ws_on_eos: False` in your setup
      message. This tells the server to keep the WebSocket connection open after
      completing individual requests.


      ```python

      setup = {
          "voice_id": "RI2y7oBdsQJmkgFF",
          "output_format": "wav",
          "close_ws_on_eos": False  # Enable multiplexing
      }

      texts = [
          "First request. Second part, last one.",
          "Second request. Second part, last one again.",
      ]


      client = gradium.client.GradiumClient(base_url=url, api_key=api_key)

      async with client.tts_realtime(send_setup_on_start=False) as stream:
          
          async def send_loop():
              for idx, text in enumerate(texts):
                  stamp = {'client_req_id': f'req-{idx:02d}'}
                  await stream.send_setup(setup | stamp)
                  await stream.send_text(text, **stamp)
                  await stream.send_eos(**stamp)
          
          async def recv_loop():
              audio = collections.defaultdict(list)
              num_eos = 0
              async for msg in stream:
                  if msg["type"] == "audio":
                      audio[msg.get('client_req_id')].append(msg["audio"])
                  elif msg['type'] == 'end_of_stream':
                      num_eos += 1
                      if num_eos == len(texts):
                          break
              return audio

          _, audio = await asyncio.gather(send_loop(), recv_loop())
          audio = {k: b"".join(v) for k, v in audio.items()}
      ```



      # Advanced Options


      Some models support advanced options that can be passed using the
      `json_config`

      parameter. In the Python api, this parameter is passed as a dictionary
      mapping

      string to values (either float or string).


      This parameter can be used to control:

      - Speed of the generated speech via the `padding_bonus` parameter.

      - Stability of the generated speech via the `temp` temperature parameter.

      - Voice similarity using the `cfg_coef` parameter.

      - Rewrite rules using `rewrite_rules`.


      **Speed Control** You can guide the speed of the model using the padding
      bonus

      parameter. Default value is 0.0. Negative values mean that the speaker
      will speak

      faster (values between -4.0 and -0.1) Positive values mean that the
      speaker will

      speak slower (values between 0.1 and 4.0)


      ```python

      sample_text = "Hello, this is a test from the Gradium Text to Speech
      system. We are testing the speed."


      slower_audio = await client.tts(
          setup={'voice_id': 'YTpq7expH9539ERJ', 'output_format': 'wav', 'json_config':{'padding_bonus':2.0}},
          text=sample_text,
      )


      faster_audio = await client.tts(
          setup={'voice_id': 'YTpq7expH9539ERJ', 'output_format': 'wav', 'json_config':{'padding_bonus':-2.0}},
          text=sample_text,
      )

      ```


      **Temperature Control** The temperature for the generation can be set with

      values ranging from 0 to 1.4. A value of 0 corresponds to a deterministic

      generation, while higher values lead to more diverse outputs. Default
      value is

      0.7.


      ```python

      setup = {'voice_id': 'YTpq7expH9539ERJ', 'output_format': 'wav',
      'json_config':{'temp':0.3}}


      audio = await client.tts(text=sample_text, setup=setup)

      ```


      **Voice Similarity Control** The `cfg_coef` parameter can be used to
      control the

      similarity of the generated speech to the target voice. Values range from
      1.0 to

      4.0. The default value is 2.0. The higher the value, the more the model

      replicates the cloned voice but larger values can lead to audio artifacts.


      **Rewrite Rules** The `rewrite_rules` parameter can be used to pass text

      rewriting rules that are applied before the text is synthesized. The rules

      should be passed as a string. More details on the rules themselves can be
      found

      below in this document. Values such as `"en"`, `"fr"`, `"de"`, `"es"`,
      `"pt"`

      enable all the rewriting rules for a given language.


      # Voices Library


      Gradium provides a selection of high-quality voices across multiple
      languages. Here are our voices.


      ## Flagship Voices



      | Name | Voice ID
      &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;|
      Language | Country | Age Group | Gender | Description |

      | :--- | :--- | :---: | :---: | :---: | :---: | :--- |

      | **Emma** | `YTpq7expH9539ERJ` | `en` | `us` 🇺🇸 | Adult | Feminine | A
      pleasant and smooth female voice ready to assist your customers and also
      eager to have nice conversations. |

      | **Kent** | `LFZvm12tW_z0xfGo` | `en` | `us` 🇺🇸 | Adult | Masculine | A
      relaxed and authentic American adult voice that connects like a genuine
      friend. |

      | **Sydney** | `jtEKaLYNn6iif5PR` | `en` | `us` 🇺🇸 | Adult | Feminine |
      A joyful and airy American adult voice that makes corporate training feel
      helpful and light.|

      | **John** | `KWJiFWu2O9nMPYcR` | `en` | `us` 🇺🇸 | Adult | Masculine | A
      warm low-pitched American adult voice with the resonant quality of a
      classic radio broadcaster. |

      | **Eva** | `ubuXFxVQwVYnZQhy` | `en` | `gb` 🇬🇧 | Adult | Feminine | A
      joyful and dynamic British adult voice ideal for lively conversations. |

      | **Jack** | `m86j6D7UZpGzHsNu` | `en` | `gb` 🇬🇧 | Adult | Masculine | A
      pleasant British voice suited for helpful service, casual conversations,
      or intense narrations. |

      | **Elise** | `b35yykvVppLXyw_l` | `fr` | `fr` 🇫🇷 | Adult | Feminine | A
      warm and smooth French adult voice ideal for friendly conversation and
      welcoming support. |

      | **Leo** | `axlOaUiFyOZhy4nv` | `fr` | `fr` 🇫🇷 | Adult | Masculine | A
      warm and smooth French adult voice ideal for friendly conversation and
      welcoming support. |

      | **Mia** | `-uP9MuGtBqAvEyxI` | `de` | `de` 🇩🇪 | Adult | Feminine | A
      joyful and energetic German voice perfect for professional context as well
      as enthusiastic discussions. |

      | **Maximilian** | `0y1VZjPabOBU3rWy` | `de` | `de` 🇩🇪 | Adult |
      Masculine | A warm and smooth German adult voice ideal for friendly
      conversation and professional narration. |

      | **Valentina** | `B36pbz5_UoWn4BDl` | `es` | `mx` 🇲🇽 | Adult | Feminine
      | A warm and engaging Mexican female voice perfect for natural
      storytelling and connecting like a genuine friend. |

      | **Sergio** | `xu7iJ_fn2ElcWp2s` | `es` | `es` 🇪🇸 | Adult | Masculine |
      A warm and smooth Spanish adult voice ideal for friendly conversation and
      professional narration. |

      | **Alice** | `pYcGZz9VOo4n2ynh` | `pt` | `br` 🇧🇷 | Adult | Feminine | A
      warm and smooth Brazilian female voice ideal for professional service and
      pleasant narration or even an enthusiastic conversation! |

      | **Davi** | `M-FvVo9c-jGR4PgP` | `pt` | `br` 🇧🇷 | Adult | Masculine |
      An engaging and smooth Brazilian adult voice ideal for helpful service and
      relaxing conversations. |



      ## All Voices 


      <details>
        <summary>View all voices</summary>

      Name | voice_id | Language | Country | Perceived age | Perceived gender |
      Description

      | :--- | :--- | :--- | :--- | :--- | :--- | :---

      Eva | ubuXFxVQwVYnZQhy | en | gb | Adult | Feminine | A joyful and dynamic
      British adult voice ideal for lively conversations

      Jack | m86j6D7UZpGzHsNu | en | gb | Adult | Masculine | A pleasant British
      voice suited for helpful service casual conversations or intense
      narrations

      Emma | YTpq7expH9539ERJ | en | us | Adult | Feminine | A pleasant and
      smooth female voice ready to assist your customers and also eager to have
      nice converstations

      Kent | LFZvm12tW_z0xfGo | en | us | Adult | Masculine | A relaxed and
      authentic American adult voice that connects like a genuine friend.

      Mia | -uP9MuGtBqAvEyxI | de | de | Adult | Feminine | A joyful and
      energetic German voice perfect for professional context as well as
      enthusiastic discussions.

      Maximilian | 0y1VZjPabOBU3rWy | de | de | Adult | Masculine | A warm and
      smooth German adult voice ideal for friendly conversation and professional
      narration.

      Valentina | B36pbz5_UoWn4BDl | es | mx | Adult | Feminine | A warm and
      engaging Mexican female voice perfect for natural storytelling and
      connecting like a genuine friend.

      Sergio | xu7iJ_fn2ElcWp2s | es | es | Adult | Masculine | A warm and
      smooth Spanish adult voice ideal for friendly conversation and
      professional narration.

      Elise | b35yykvVppLXyw_l | fr | fr | Adult | Feminine | A warm and smooth
      French adult voice ideal for friendly conversation and welcoming support.

      Leo | axlOaUiFyOZhy4nv | fr | fr | Adult | Masculine | A warm and smooth
      French adult voice ideal for friendly conversation and welcoming support.

      Alice | pYcGZz9VOo4n2ynh | pt | br | Adult | Feminine | A warm and smooth
      Brazilian female voice ideal for professional service and pleasant
      narration or even an enthusiastic conversation!

      Davi | M-FvVo9c-jGR4PgP | pt | br | Adult | Masculine | An engaging and
      smooth Brazilian adult voice ideal for helpful service and relaxing
      conversations.

      Max | NoJdNY6JTz-VJLwz | en | ca | Young Adult | Masculine | A clear calm
      and measured male voice.

      Kelly | Lxc7YlPC8ckLJA8H | en | gb | Adult | Feminine | Clear soft and
      measured female narration.

      Arjun | -_aUUFZaJ0CT1gks | en | in | Adult | Masculine | A warm voice with
      a clear low-pitch and a smooth texture.

      Hunter | W5htOuyiFI4Fwhxs | en | au | Adult | Masculine | A joyful and
      smooth Australian adult voice that keeps listeners tuned in with radio
      charm.

      Tiffany | Eu9iL_CYe8N-Gkx_ | en | us | Young Adult | Feminine | A warm and
      smooth American young adult voice that greets customers with a smile you
      can hear.

      Christina | 2H4HY2CBNyJHBCrP | en | us | Adult | Feminine | A joyful
      low-pitched American adult voice that handles business and service with
      efficiency.

      Maria | KNYHZTB8ZqdAZv5Q | en | us | Adult | Feminine | A joyful
      high-pitched American adult voice that teaches and tutors with genuine
      energy.

      Mark | dh0EzP6jCroK6prq | en | us | Adult | Masculine | A warm low-pitched
      American adult voice that resonates with professional radio quality.

      Logan | XJc-Y9tkSd1UA7s4 | en | us | Young Adult | Masculine | A joyful
      and smooth American young adult voice that fits the energetic vibe of a
      gym coach.

      Juan | 78zAgQK6xmExb8wS | en | us | Adult | Masculine | A joyful and
      smooth American adult voice that welcomes and hosts with vibrant energy.

      Kaitlyn | 56DcpvEI0Gawpidh | en | us | Adult | Feminine | A warm and
      smooth American adult voice that offers the kindness of a helpful
      neighbor.

      Michelle | lt88kyLfD8Mqemla | en | in | Young Adult | Feminine | A warm
      and smooth Indian English young adult voice for clear and friendly
      service.

      Mary | wPx6HPbUQkaUHGhq | en | us | Adult | Feminine | A joyful
      high-pitched American adult voice that connects perfectly with younger
      audiences.

      Cameron | c8BzreHTk1GG2R4z | en | us | Adult | Masculine | A steady
      low-pitched American adult voice ideal for tech reviews and casual
      explanations.

      Jeremy | 9QHzSiOYUD-RzEzM | en | us | Adult | Masculine | A composed
      American adult voice that sounds intelligent and tech-savvy.

      Jesse | hOhCtzjR-cRG4T5T | en | us | Young Adult | Masculine | A joyful
      high-pitched American young adult voice with a unique airy texture for
      character roles.

      Sean | cu0XE3Cxmg_GmSJ3 | en | us | Adult | Masculine | A joyful American
      adult voice that brings the spirited energy of a rodeo announcer.

      Charles | P0GYBrxlhTy5CC87 | en | gb | Adult | Masculine | A warm and
      smooth British adult voice that hosts with a classic reliable radio
      presence.

      Olivia | kr-Om35JRqmA3Hzq | en | us | Young Adult | Feminine | A warm
      low-pitched American young adult voice that guides meditation with
      soothing calm.

      Shelby | O0uTTRx5zcetDFX4 | en | us | Young Adult | Feminine | A joyful
      high-pitched American young adult voice that brings enthusiasm to web
      content.

      Patrick | Z5GIOZR45ieZ8M-W | en | us | Adult | Masculine | A joyful and
      smooth American adult voice perfect for clear and engaging public service
      announcements.

      Richard | HndphaVV7KTCfKQT | en | us | Adult | Masculine | A joyful
      high-pitched American adult voice that captures the excitement of sports
      commentary.

      Jason | FOFDH8py3aghc5kb | en | us | Adult | Masculine | A joyful American
      adult voice that delivers radio content with a distinct engaging tone.

      Kimberly | Abqwk2RWxlBEyv0j | en | gb | Adult | Feminine | A joyful
      high-pitched British adult voice that welcomes listeners with cheerful
      efficiency.

      Timothy | v5lib8tjaosy5sxQ | en | us | Adult | Masculine | A warm
      low-pitched American adult voice with a nostalgic friendly resonance.

      Nathan | 4NU5PqxX2BdMEtWe | en | us | Adult | Masculine | A warm and
      smooth American adult voice that sounds just like your friendly neighbor.

      Adam | EbIA5CIcQoa6NNd2 | en | us | Adult | Masculine | A joyful and
      smooth American adult voice that greets the morning with radio-ready
      energy.

      Abigail | KRo-uwfno-KcEgBM | en | us | Adult | Feminine | A warm and airy
      American adult voice that adds a touch of magic and empathy to any story.

      Melissa | 8Tm8RKFEbnkRtkdA | en | us | Adult | Feminine | A joyful and
      smooth American adult voice that facilitates with upbeat enthusiasm.

      Allison | yU6yxQ3e8LKRwU84 | en | us | Adult | Feminine | A joyful
      high-pitched American adult voice that brings high energy to training and
      teaching.

      Kelsey | MQC0U1yWvZXrppaF | en | us | Adult | Feminine | A balanced
      American adult voice that fits realistic everyday service interactions.

      Haley | aq7ltaIQ6ZJUY0jR | en | gb | Adult | Feminine | A confident and
      warm British adult voice versatile enough for e-learning support and
      storytelling.

      Anna | PS7enm5lVZiIvEKV | en | us | Adult | Feminine | A warm and smooth
      American adult voice that provides comfort and supportive guidance.

      Katherine | bvNlBZ3DWDoVy_Yc | en | us | Young Adult | Feminine | A warm
      and smooth American young adult voice that balances business
      professionalism with kindness.

      Steven | zyLIanWKViHkc6Wp | en | gb | Adult | Masculine | A steady and
      smooth British adult voice that offers helpful and consistent management
      advice.

      Brian | ptMwY_gvmFxXMmDf | en | us | Adult | Masculine | A steady American
      adult voice with a low-pitched tone suitable for distinct character roles.

      Jose | LqFNS0u6EII7VHBx | en | us | Adult | Masculine | A warm low-pitched
      American adult voice that offers the reassuring guidance of a mentor.

      Madison | cuXxqSrGVntdhFpZ | en | gb | Young Adult | Feminine | A warm
      low-pitched British young adult voice that feels like a friendly neighbor.

      Dylan | d9Fl9x8luXXX7u6E | en | us | Adult | Masculine | A warm and smooth
      American adult voice that keeps the flow going as a DJ or host.

      Rebecca | GJSxJhSTPAGIPDwy | en | us | Adult | Feminine | A warm and airy
      American adult voice that manages and assists with a gentle touch.

      Samuel | pxKsJ_4kEMid5XpZ | en | au | Young Adult | Masculine | A warm and
      smooth Australian young adult voice that sounds like a friendly bartender
      or colleague.

      Eric | knw-ddWDPNORRA4Z | en | us | Adult | Masculine | A joyful and
      smooth American adult voice that makes sales and service feel cheerful and
      easy.

      Alyssa | 22YWyuFACaMHsPh5 | en | us | Young Adult | Feminine | A warm and
      smooth American young adult voice that adds a relatable human touch to
      readings.

      Alexandra | 4nAcNUlNhEA_Kyjo | en | us | Adult | Feminine | A joyful and
      smooth American adult voice ideal for reading and hosting duties.

      Jasmine | QPHuXnvRPQ57oXYy | en | us | Adult | Feminine | A joyful
      high-pitched American adult voice that commands the room with managerial
      confidence.

      Benjamin | IBVzgY91NZ1IJ0oP | en | gb | Adult | Masculine | A joyful and
      smooth British adult voice that leads events and shows with
      master-of-ceremony flair.

      Aaron | Ve1zknlflaRwcAQw | en | gb | Adult | Masculine | A composed and
      smooth British adult voice perfect for technical and IT-related
      explanations.

      Jordan | ws0Wb0PZXl21_Bbz | en | us | Young Adult | Masculine | A joyful
      American young adult voice that motivates with the energy of a fitness
      instructor.

      Christian | x69x43aS-5mVLCX2 | en | gb | Adult | Masculine | A warm and
      smooth British adult voice that sounds like a kind and knowledgeable
      scholar.

      Thomas | m7fJRmVaJjG2TL1c | en | gb | Adult | Masculine | A warm and
      smooth British adult voice that brings an actor's versatility to
      conversation.

      Morgan | MGiwMOFxVe4a2aSU | en | gb | Adult | Feminine | A warm and airy
      British adult voice that guides listeners into a state of meditation.

      Cody | SqHUVuEiTPSlIB5r | en | us | Adult | Masculine | A warm and
      resonant American adult voice that delivers radio quality with a
      professional touch.

      Alex | 91EdXxJDbWICDBgz | en | us | Adult | Neutral | A joyful
      high-pitched American adult voice that grabs attention in advertisements.

      Brianna | fggSYM_FGJ30QTTl | en | us | Young Adult | Feminine | A warm and
      smooth American young adult voice ideal for music radio and educational
      content.

      Kevin | J2qsArcdozbto5Hn | en | au | Adult | Masculine | A joyful
      Australian adult voice that engages audiences as a TV host or tutor.

      Victoria | 8dBmiTurwb7KcxLY | en | us | Adult | Feminine | A warm and
      smooth American adult voice that conveys the reliability of a helpful
      colleague.

      Nicole | T7UL6gmeDqqYiVe1 | en | us | Adult | Feminine | A joyful American
      adult voice with a sarcastic edge perfect for entertaining podcasts.

      Jennifer | auZu0iT-fniQ4cJd | en | us | Adult | Feminine | A warm and
      smooth American adult voice that is always ready to help like a good
      friend.

      Courtney | UX3Hi2ZmK7tT0c3G | en | gb | Adult | Feminine | A joyful
      high-pitched British adult voice perfect for sales and professional
      announcements.

      Stephanie | ikbJkd83GvuyoSLb | en | us | Adult | Feminine | A joyful and
      smooth American adult voice that sounds like a modern relatable mom.

      Kyle | CjQcj4yeIs6h0uAb | en | us | Adult | Masculine | A joyful American
      adult voice that wakes up the audience with morning radio energy.

      Lauren | SG3KnxbSOkkrY097 | en | us | Adult | Feminine | An assertive and
      smooth American adult voice that fits the modern urban businesswoman
      persona.

      Alexis | 74asmf7CXzjfopIX | en | us | Adult | Feminine | A joyful American
      adult voice that delivers customer service scripts with a bright distinct
      tone.

      Megan | exG4bLr-lZ_bI0jF | en | us | Adult | Feminine | A joyful
      high-pitched American adult voice that mixes customer service clarity with
      influencer energy.

      Jonathan | 4u2uvwrHdTA2gRnZ | en | us | Adult | Masculine | A joyful
      high-pitched American adult voice with the charm of an old-timey character
      actor.

      Robert | gTAO-3xLZ8_WSfbm | en | us | Adult | Masculine | A warm and
      resonant American adult voice that brings a professional acting polish to
      any script.

      Alexander | 8sWSyTC7byLsbHkr | en | us | Adult | Masculine | A warm
      low-pitched American adult voice that motivates with the resonance of a
      fitness coach.

      Rachel | dEcrv3B8XGHoox2_ | en | gb | Adult | Feminine | A warm
      low-pitched British adult voice that balances professional business tones
      with a calming presence.

      Kayla | 9VXl5t2IMagUQAzg | en | gb | Adult | Feminine | A joyful British
      adult voice with a precise tone ideal for automated yet friendly service.

      Elizabeth | u8rA2xOF_0LRnNSb | en | us | Adult | Feminine | A consistent
      and smooth American adult voice that provides clear and reliable customer
      service.

      Amanda | ZZb4X9ueHSdRlv9q | en | gb | Young Adult | Feminine | A joyful
      and hip British young adult voice that brings energy to podcasts and
      modern content.

      Brittany | 3bIdO9CHnAh_pRAf | en | in | Adult | Feminine | A joyful and
      smooth Indian English adult voice that is perfect for friendly HR and
      service roles.

      William | VeVmpxxbyJiWrGNG | en | au | Adult | Masculine | A joyful
      high-pitched Australian adult voice that sounds like an energetic high
      school coach.

      Hannah | lP7D1y02OQFtffU3 | en | us | Young Adult | Feminine | A warm and
      airy American young adult voice that creates a calm atmosphere for yoga
      and meditation.

      Anthony | 2V3TjbyQGPlkY6ON | en | au | Adult | Masculine | A joyful and
      smooth Australian adult voice that brings a cartoonish MC-style energy.

      Justin | 6Mp6PGnaCdb-US21 | en | us | Adult | Masculine | A distinct
      American adult voice with a characterful tone ideal for niche roles.

      James | MZWrEHL2Fe_uc2Rv | en | us | Adult | Masculine | A warm and
      resonant American adult voice that excels at storytelling and persuasive
      advertising.

      David | OceLYI_PPbqsdgdV | en | gb | Young Adult | Masculine | A warm and
      smooth British young adult voice that captures the relaxed tone of a
      college student.

      Ryan | AqRuVz8-e8u3BR00 | en | us | Adult | Masculine | A warm low-pitched
      American adult voice with a resonant rural charm for sales and
      storytelling.

      Taylor | EfuzJVuTmw_mA7PC | en | us | Adult | Feminine | A warm and
      efficient American adult voice that fits perfectly for automated customer
      support.

      Sarah | aW5dxfdkzIFCIdXc | en | us | Young Adult | Feminine | A clear
      American young adult voice that is precise and perfect for student-focused
      reading.

      Joseph | MhsYZQ4bIfcDpokF | en | gb | Adult | Masculine | A warm and
      relatable British adult voice with a genuine blue-collar friendliness.

      Samantha | mn5sS7D8kYKETZXA | en | us | Adult | Feminine | A warm and
      professional American adult voice that is both helpful and authoritatively
      managerial.

      Austin | -0MuXG9RcCsuSVtb | en | us | Mature | Masculine | A warm
      rough-textured American mature voice that embodies the kindness of a
      gentle grandfather.

      Daniel | apU2CMobTyu92tZj | en | au | Adult | Masculine | A joyful and
      smooth Australian adult voice that brings a cheerful down-to-earth vibe to
      any chat.

      Emily | i1kmq28cO60ia35K | en | us | Young Adult | Feminine | A warm and
      smooth American young adult voice perfect for modern podcasting and
      influencing.

      Brandon | 2j8TWGsIiUl4G3kj | en | us | Young Adult | Masculine | A
      high-pitched joyful American young adult voice that sounds like your
      friendliest colleague.

      Tyler | Ow5IKhni2ED3Xxhl | en | gb | Adult | Masculine | A warm and smooth
      British adult voice that blends tech-savviness with a friendly radio
      persona.

      Nicholas | n2Gv34jje2ZiiNzK | en | us | Adult | Masculine | A joyful
      American adult voice with a relatable slightly clumsy charm perfect for
      sitcom-style scripts.

      Ashley | QZMzHBlnJRjll_71 | en | us | Adult | Feminine | A warm
      low-pitched American adult voice that feels like a cool supportive friend
      or aunt.

      Joshua | bDlMqRew31ZJwrD- | en | us | Adult | Masculine | A joyful and
      resonant American adult voice that brings the classic energy of a radio
      host.

      Jessica | wYY8mXKrKtwKsaXZ | en | us | Adult | Feminine | A consistent and
      smooth American adult voice that handles customer service with patience
      and clarity.

      Jacob | ixaCTlZ5Xqf2XzQH | en | us | Mature | Masculine | A steady
      American mature voice with a unique old-timey texture for distinct
      conversational roles.

      Christopher | fs2Qj_X2Z2WvWJSU | en | gb | Adult | Masculine | A smooth
      British adult voice that conveys the trustworthy tone of a reliable
      expert.

      Matthew | X-wgJsZwQKhfebgK | en | us | Adult | Masculine | A high-pitched
      joyful American adult voice that pops with energy perfect for reading ads.

      Michael | Mj0Pzs94jCw8oVOC | en | us | Adult | Masculine | A low-pitched
      casual American adult voice with a sporty vibe for conversational content.

      Olivier | vMYQUSzm6GRkJX6d | fr | fr | Adult | Masculine | Friendly male
      voice tone is warm and welcoming.

      Manon | p1fSBpcmVWngBqVd | fr | fr | Young Adult | Feminine | A gentle and
      warm voice with a calm and measured pace.

      Jade | 3mM3xaoFjNMQa22C | fr | fr | Young Adult | Feminine | A young
      female speaker with a clear high-pitched and smooth voice.

      Amélie | J4XbCGPYNMigXcfZ | fr | fr | Young Adult | Feminine | A friendly
      voice with a clear tone and pleasant pitch.

      Adrien | 0LMAi0x_YVG_GLeM | fr | fr | Young Adult | Masculine | Clear
      smooth and moderately paced voice with a warm tone.

      Sarah | -dOnYAX4N4GqSOee | fr | fr | Young Adult | Feminine | A warm and
      smooth French young adult voice perfect for friendly interactions and
      welcoming service.

      Jennifer | N8xxxD_d-ZinGVI4 | fr | fr | Young Adult | Feminine | A warm
      and smooth French young adult voice ideal for friendly support and
      welcoming conversation.

      Élodie | zba0owtqy4Gnewn9 | fr | fr | Adult | Feminine | A confident
      French adult voice that excels in corporate training compliance and
      narration.

      Justine | TJv-kucMsUo24VQe | fr | fr | Young Adult | Feminine | A
      confident and upbeat French young adult voice perfect for youth brands and
      energetic explanations.

      Océane | YE0-JPiElafJrZaC | fr | fr | Young Adult | Feminine | A polished
      French young adult voice designed for professional broadcasting and
      reporting.

      Léa | QY_BJKHMElKDO12- | fr | fr | Adult | Feminine | A formal French
      adult voice that delivers financial reports and news with absolute
      precision.

      Sarah | QkmUhBH4hIV2_BkY | fr | fr | Adult | Feminine | A confident and
      compassionate French adult voice ideal for biographies support and
      non-fiction.

      Mathieu | D-IpHY1UI0iX9xQD | fr | fr | Adult | Masculine | An assertive
      and energetic French adult voice perfect for high-stakes promos and
      executive presentations.

      Clément | twLGV8mrH_ycNpUn | fr | fr | Adult | Masculine | A confident and
      sincere French adult voice that lends credibility to expert topics and
      emotional appeals.

      Julie | k1wgs3k8-wRxTJO6 | fr | fr | Adult | Feminine | A joyful and
      enthusiastic French adult voice that makes news and education feel fresh
      and engaging.

      Dylan | Hdf5cdfaGrLDTD63 | fr | fr | Adult | Masculine | A sincere and
      emotional French adult voice that offers genuine support and relatable
      warmth.

      Marion | 1VAVLmmbQFDw7TMn | fr | fr | Adult | Feminine | A warm and
      trustworthy French adult voice that shines in storytelling education and
      fantasy roles.

      Pauline | 2AtP1urAQkZaeI2U | fr | fr | Adult | Feminine | A professional
      and articulate French adult voice suited for serious journalism and formal
      announcements.

      Vincent | B09t5S64xLaKwXeW | fr | fr | Adult | Masculine | A warm and wise
      French adult voice perfect for historical narration and supportive
      guidance.

      Pierre | AroCL6f1qizjiZ_a | fr | fr | Young Adult | Masculine | An
      energetic French young adult voice that brings a lively journalistic flair
      to news and updates.

      Guillaume | qTA0lxFpynJdoxx7 | fr | fr | Young Adult | Masculine | A
      joyful and adventurous French young adult voice ideal for dynamic
      storytelling and sports reporting.

      Romain | zpmn3GOfiU_i5QGo | fr | fr | Adult | Masculine | A warm and
      steady French adult voice that delivers quick instructions and interviews
      with clarity.

      Kévin | IB53xJtufx1sbfbt | fr | fr | Adult | Masculine | A sincere and
      emotional French adult voice that brings depth and wisdom to narratives
      and heartfelt ads.

      Florian | kw_VWSocR7vyA9Ty | fr | fr | Adult | Masculine | A joyful and
      relatable French adult voice that sounds like a friendly journalist or the
      guy next door.

      Antoine | hx1RAC4Lqd9xyTAr | fr | fr | Adult | Masculine | A gritty and
      confident French adult voice perfect for intense narration and expert
      instruction.

      Quentin | pdcyd1mLmo0fcg3O | fr | fr | Adult | Masculine | A confident and
      sincere French adult voice that connects effortlessly in tech explainers
      and documentaries.

      Mélanie | xynYWquoAsrvM7UY | fr | ca | Adult | Feminine | A warm and clear
      Canadian French adult voice designed for friendly assistance and
      educational guidance.

      Adam | aNiSRZ0BhQxO1FPx | fr | fr | Adult | Masculine | A warm and formal
      French adult voice that brings a calm professional touch to corporate
      communications.

      Anaïs | ImBVnxSeLsdCfNIV | fr | fr | Young Adult | Feminine | A
      distinctive French young adult voice with a sharp tone perfect for
      lifestyle and character roles.

      Marine | GmGF_3ETsY2Zq7_w | fr | fr | Adult | Feminine | A warm and
      nurturing French adult voice ideal for storytelling education and
      empathetic support.

      Maxime | s0PhgjzOTRD5wo5L | fr | ca | Adult | Masculine | A joyful and
      instructional Canadian French voice that makes learning and support feel
      effortless.

      Alexandre | HBfu9XA3QfzAG1MN | fr | ca | Adult | Masculine | A high-energy
      and assertive Canadian French voice perfect for fast-paced promos and
      clear instructions.

      Camille | w9V1722uEmTkWqnR | fr | fr | Adult | Feminine | A joyful and
      professional French adult voice that delivers corporate and journalistic
      scripts with energy.

      Marie | BbLb4TxdlrldgpHI | fr | fr | Adult | Feminine | A warm and
      professional French adult voice ideal for calm instruction and empathetic
      communication.

      Thomas | 8nsAoui8Y5RK9PYw | fr | fr | Adult | Masculine | A confident and
      sincere French adult voice that drives action in commercials and
      educational explainers.

      Chloé | rIYDMY3dLccdauWA | fr | fr | Adult | Feminine | A bright and
      versatile French adult voice perfect for friendly assistance education and
      lifestyle content.

      Nicolas | mxcKXLymdLQCdlEq | fr | fr | Adult | Masculine | An assertive
      and warm French adult voice that brings strength and character to
      narration and promos.

      Laura | Jlh1B0PKQJyup0sQ | fr | fr | Adult | Feminine | A helpful and
      clear French adult voice that excels in both educational content and
      empathetic service.

      Amandine | NvHEAMGiPT4u8iT- | fr | fr | Adult | Feminine | A versatile and
      joyful French adult voice capable of shifting from warm education to
      playful character work.

      Valentin | WWHSNJCSTm77dyGd | fr | fr | Adult | Masculine | A warm and
      lively French adult voice that brings a spark of genuine enthusiasm to any
      script.

      Manu | L6OaiBybqikfCBk0 | fr | fr | Young Adult | Masculine | A pleasant
      voice with a low pitch and smooth texture.

      Sofia | s4CzgVHP5cEkB9LD | es | es | Adult | Feminine | Soft low-pitched
      and smooth with a slow and measured pace.

      Pablo | aCWBiYUiQ4VwW8_b | es | es | Adult | Masculine | A warm
      low-pitched Spanish adult voice that brings a calm smooth authority to any
      script.

      Carlos | yPxeHKlCzaHeKd_V | es | es | Adult | Masculine | A warm and
      versatile Spanish adult voice that adapts seamlessly from ads to
      professional settings.

      Adrián | r5WB0b126tlHSrku | es | mx | Young Adult | Masculine | A warm and
      smooth Mexican young adult voice that naturally bridges journalism and
      conversation.

      Alberto | h39kz1iyoymcjcqh | es | es | Young Adult | Masculine | A warm
      Spanish young adult voice with a hosting flair perfect for media and
      customer engagement.

      Elena | PqjKPYFyGNsg1YU- | es | es | Young Adult | Feminine | A warm and
      engaging Spanish young adult voice that makes journalism and education
      feel accessible.

      Javier | wGhY_zZCoQ5gB0ce | es | ar | Adult | Masculine | A warm and
      smooth Argentine adult voice that delivers professional and social content
      with charm.

      Sergio | -8ZoUJpVU98rxpv9 | es | mx | Young Adult | Masculine | An
      energetic Mexican young adult voice that brings a bright modern feel to
      customer service and ads.

      David | zdE2H9vw2vcMl_Pt | es | mx | Adult | Masculine | A joyful and
      smooth Mexican adult voice that fits perfectly in both casual chats and
      formal spots.

      Ana | ynR4CAbXMiOv-vGC | es | es | Young Adult | Feminine | A warm and
      versatile Spanish young adult voice ideal for everything from ads to
      professional service.

      Sara | lPCVUcicz2XRaLE3 | es | es | Adult | Feminine | A warm and
      knowledgeable Spanish adult voice that balances journalistic clarity with
      conversational ease.

      Marta | VAb2M8nKHlUUZBk4 | es | mx | Young Adult | Feminine | A warm and
      relatable Mexican young adult voice perfect for connecting with Gen Z
      audiences.

      Daniel | R3L8t75ZEoZCPUA9 | es | es | Adult | Masculine | A confident
      low-pitched Spanish adult voice that commands respect in professional and
      service contexts.

      Alejandro | eorxD0DWv--n7l3p | es | es | Young Adult | Masculine | A
      joyful and smooth Spanish young adult voice that adds a fresh energy to
      advertisements.

      Cristina | Bwl2KLUPxf82_ZaJ | es | mx | Adult | Feminine | A joyful and
      resonant Mexican adult voice ideal for vibrant social media and character
      work.

      Carmen | zhH3lPUo-JxmlOJT | es | co | Young Adult | Feminine | An
      energetic Colombian young adult voice that captures the lively spirit of a
      millennial streamer.

      María | k2B3TJiffePxjeBn | es | co | Young Adult | Feminine | A warm and
      smooth Colombian young adult voice that brings a friendly touch to
      education and ads.

      Miguel | Gijj_GPBfJVcP-FZ | es | es | Adult | Masculine | A steady Spanish
      adult voice with a robotic edge perfect for automated customer service.

      Laura | xB86uC_i8sO2U41- | pt | br | Adult | Feminine | A smooth and
      pleasant voice perfect for a nice chat.

      Frederico | L7890s1B44FqSiGC | pt | br | Adult | Masculine | A clear
      low-pitched voice spoken with a smooth texture

      Eduardo | hAdJ9w9xBQkFgrRl | pt | br | Adult | Masculine | A clear
      low-pitched voice with a smooth texture.

      Rodrigo | EzmLkNorEpZG_oNv | pt | pt | Young Adult | Masculine | A
      low-pitched Portuguese young adult voice that delivers information with
      calm confidence.

      Bruna | Du_Dcv4fgXBDdubR | pt | pt | Adult | Feminine | A high-pitched
      energetic Portuguese adult voice perfect for engaging corporate training
      and narration.

      Daniel | _cP-0vSYfMmzR4al | pt | br | Adult | Masculine | A joyful and
      dynamic Brazilian adult voice that brings excitement to radio hosting and
      promos.

      Leonardo | YUKEEk7Y4Igsj1Ts | pt | pt | Adult | Masculine | An energetic
      and varied Portuguese adult voice ideal for lively radio spots and
      character work.

      Thiago | QZtWUy8jmIroWiOu | pt | br | Adult | Masculine | A warm and
      versatile Brazilian adult voice that balances professional hosting with
      genuine kindness.

      Pedro | Yee42wDKxEFHi0BS | pt | br | Young Adult | Masculine | A smooth
      low-pitched Brazilian young adult voice with a cool steady tone for
      scripts.

      Matheus | wT1bHy1Vq_0Bn73I | pt | pt | Adult | Masculine | A resonant and
      warm Portuguese adult voice that brings authority and kindness to
      educational content.

      Jéssica | Fmt16x6anKfMMeSx | pt | br | Adult | Feminine | A smooth
      Brazilian adult voice designed for clear and professional customer
      service.

      Fernando | 8QUaJGjSFdgHkuI8 | pt | br | Young Adult | Masculine | A warm
      and friendly Brazilian young adult voice that sounds like the approachable
      guy next door.

      Juliana | B6aHVROMF8FuKR07 | pt | pt | Young Adult | Feminine | A
      high-pitched energetic Portuguese young adult voice perfect for animated
      characters and lively dialogue.

      Ana | 24cfpJbYGXZLE39T | pt | br | Adult | Feminine | A joyful and
      neighborly Brazilian adult voice that feels instantly familiar and
      welcoming.

      Gustavo | T4yRIRCLji61Fz-N | pt | br | Adult | Masculine | A high-pitched
      friendly Brazilian adult voice ideal for approachable and caring roles.

      Bruno | isyT17KHEj84P9w9 | pt | br | Adult | Masculine | A warm and
      helpful Brazilian adult voice that conveys genuine reliability and
      kindness.

      Maria | 73lMH7Zcc411nxJz | pt | pt | Adult | Feminine | A cheerful and
      helpful Portuguese adult voice that brightens any conversational script.

      Letícia | h6qFHXR3-bqPg_PE | pt | br | Adult | Feminine | A warm and
      empathetic Brazilian adult voice perfect for podcasting and supportive
      messaging.

      Rafael | KpDAXeGeen7P9Uri | pt | pt | Adult | Masculine | A warm and
      friendly Portuguese adult voice ideal for relatable radio hosting and
      conversation.

      Gabriel | 4ubKCfFxLeBg-cbl | pt | br | Adult | Masculine | An energetic
      and joyful Brazilian adult voice that commands attention with charismatic
      flair.

      Lucas | AaTW_13X1yYe_OnX | pt | br | Adult | Masculine | A warm
      low-pitched Brazilian adult voice that adds a kind educational tone to any
      project.

      João | YHOBjtajNBEHUI_K | pt | br | Adult | Masculine | A smooth and clear
      Brazilian adult voice perfect for conversational delivery.

      Moritz | IIZIkBSZAmb9nFZb | de | de | Adult | Masculine | Clear
      low-pitched male voice with a smooth texture and a slow measured pace.

      Lisa | kAoOc9Yb5EQDzA-N | de | de | Adult | Feminine | A soft and clear
      voice with a varied pitch.

      Hans | vbg20SqFS_gBntTQ | de | at | Adult | Masculine | A calm low-pitched
      male delivery with a pleasant tone.

      Franziska | VXA4-0_ZN4o8q3vK | de | de | Adult | Feminine | A warm and
      smooth German adult voice that offers deep support with kindness.

      David | zyla-_bhVQtNTBdT | de | de | Adult | Masculine | A smooth German
      adult voice that educates with a calm low tone.

      Lea | lSVEPWl_N_7MtcHe | de | de | Adult | Feminine | A warm and smooth
      German adult voice that teaches with a friendly approachable style.

      Stefanie | hXjVvZ6oDDGQAQFj | de | de | Young Adult | Feminine | A
      confident and airy German young adult voice that reads with sincerity and
      clarity.

      Tom | xq0vDziADfAmg6Uh | de | de | Adult | Masculine | An airy German
      adult voice that speaks publicly with a formal high pitch.

      Niklas | -qKylkN2UPxd7Mmg | de | de | Adult | Masculine | A joyful and
      smooth German adult voice that handles customer care with formal
      positivity.

      Michelle | fJDF4lEH590XplFv | de | de | Adult | Feminine | A joyful and
      smooth German adult voice that coaches with high energy and encouragement.

      Jasmin | h2o5CDDhV5wE3Bwi | de | de | Adult | Feminine | A balanced and
      airy German adult voice that makes book reading feel light and accessible.

      Dominik | ZOiGbnYdgKSBM_rH | de | de | Adult | Masculine | A balanced and
      smooth German adult voice designed for formal customer care.

      Sabrina | dK5Glio51HTxdMu0 | de | de | Adult | Feminine | A balanced and
      smooth German adult voice perfect for professional book reading.

      Dennis | YHkMHL6WppbXd42a | de | de | Adult | Masculine | An airy German
      adult voice that delivers technical information with formal grace.

      Julian | LAmPTQZkwYJKRCKt | de | de | Adult | Masculine | A balanced and
      resonant German adult voice that coaches with a calm steady presence.

      Jannik | RPw-aWdY8NBiIWeg | de | de | Adult | Masculine | A joyful and
      resonant German adult voice that motivates and coaches with authority.

      Melanie | bauuigqCZbJFfk5q | de | de | Adult | Feminine | A warm and
      smooth German adult voice that brings a professional deep perspective.

      Christian | WxHB2b5HxA0Kuq5u | de | de | Adult | Masculine | A joyful and
      smooth German adult voice that reports with energy and professionalism.

      Nadine | 9O8ZawShJ7UwURjK | de | de | Adult | Feminine | A warm and smooth
      German adult voice that educates with journalistic precision.

      Nicole | t1Y_yKjku5R46F9t | de | de | Adult | Feminine | A warm and airy
      German adult voice that delivers journalistic content with a kind touch.

      Sebastian | KEMqb7dQlTCAEUx6 | de | de | Mature | Masculine | A steady
      resonant German mature voice that brings the comforting wisdom of a
      grandfather.

      Lena | df4Al5gt14Am4Qaf | de | de | Adult | Feminine | A grounded and
      smooth German adult voice that reports the news with a steady tone.

      Fabian | 42-EbMFThYfhVB83 | de | de | Adult | Masculine | A warm German
      adult voice that teaches with a high engaging energy.

      Patrick | 3-pqEMoGtIq7wXtH | de | de | Adult | Masculine | A steady and
      smooth German adult voice that explains educational topics with
      journalistic clarity.

      Christina | 9LhjfdN9LOrygqDi | de | de | Adult | Feminine | A warm and
      smooth German adult voice that offers insightful guidance with a friendly
      tone.

      Jessica | --9DFXOPx8kJFsbe | de | de | Adult | Feminine | An airy German
      adult voice that delivers formal journalism with a light touch.

      Jennifer | XFttJvHwReWtWQNQ | de | de | Adult | Feminine | A steady and
      smooth German adult voice that reports professionally and formally.

      Vanessa | 8eZwfGLoSF2N0RB3 | de | de | Adult | Feminine | A warm and
      smooth German adult voice that engages listeners as a lively podcast host.

      Maria | sz-H9BxaRaqxQ2S0 | de | de | Adult | Feminine | A relaxed and airy
      German adult voice that hosts podcasts with a cool vibe.

      Jonas | 6tFmjkrmrdhO2bXV | de | de | Adult | Masculine | A warm German
      adult voice that contemplates and converses with philosophical insight.

      Anna | D8iRHK1qJhqfE00v | de | de | Adult | Feminine | A balanced airy
      German adult voice that brings deep empathy to conversation.

      Marcel | Cw79FL0p0J6UM9El | de | de | Adult | Masculine | A balanced
      German adult voice that handles customer care with a clear high-pitched
      tone.

      Kevin | AySdCEnP2nqRo1WM | de | de | Adult | Masculine | A steady and
      smooth German adult voice that maintains a formal journalistic standard.

      Tobias | uycTGmIXbw_Y83p9 | de | de | Adult | Masculine | A low-pitched
      German adult voice that delivers technical details with care and
      precision.

      Daniel | H0GE4TqfCQGmpQhL | de | de | Adult | Masculine | A warm and
      resonant German adult voice that sounds like a friendly student peer.

      Tim | -WFy9WtlQNE-dEV2 | de | de | Adult | Masculine | A steady and
      resonant German adult voice ideal for professional customer care
      interactions.

      Philipp | ZsVFAOnjnEPxJVDI | de | de | Adult | Masculine | A balanced
      German adult voice that reads books with a smooth immersive flow.

      Maximilian | H3Rh9kJcd4gZidvN | de | de | Adult | Masculine | A warm
      German adult voice that educates with a calm low-pitched authority.

      Sarah | ApPgTz3nMHOsWxhK | de | de | Adult | Feminine | A warm low-pitched
      German adult voice that offers the soothing understanding of a close
      confidant.

      Florian | XnSnbQW98he4aULg | de | de | Adult | Masculine | A warm German
      adult voice that delivers news with a high resonant clarity.

      Katharina | AEJ61XaIaRill4cJ | de | de | Adult | Feminine | A steady
      low-pitched German adult voice designed for steady and engaging book
      reading.

      Mona | T2NDxsof9FHYxgJj | de | de | Adult | Feminine | A warm and smooth
      German adult voice that brings a tutor's patience to any script.

      Laura | wBgI9XmASQwvQ13w | de | de | Adult | Feminine | A warm German
      adult voice that teaches and guides with a kind high-pitched tone.

      Felix | uF8PfAXrv6qU9UEM | de | de | Adult | Masculine | A smooth German
      adult voice perfect for straightforward journalistic reporting.

      Julia | FRTqjB2TL-Ix9GXW | de | de | Adult | Feminine | A warm and
      conversational German adult voice that sounds like a relatable student.

      Alexander | xki1DK6Ks6tuDmcb | de | de | Adult | Masculine | A warm German
      adult voice that reports with journalistic integrity and a resonant tone.

      Lukas | 5UkFVe2B8OqLo-5R | de | de | Adult | Masculine | A low-pitched
      German adult voice that conveys the authority of a seasoned expert.

      Jan | 1D38wv1wp-H7QcyM | de | de | Adult | Masculine | A balanced German
      adult voice with a high pitch ideal for clear customer care.
        

      </details>


      # Custom Voices


      Create and manage your own custom voice clones. Custom voices are passed
      to TTS using the `voice_id` parameter (not `voice`).


      ## List All Custom Voices


      ```python

      import json

      import gradium


      all_custom_voices = await gradium.voices.get(client)

      print(json.dumps(all_custom_voices, indent=2))

      ```


      ## Get Specific Voice


      ```python

      import json


      voice = await gradium.voices.get(client, voice_uid="abc123def456")

      print(json.dumps(voice, indent=2))

      ```


      ## Create Custom Voice


      ```python

      import json


      voice = await gradium.voices.create(
          client,
          audio_file="my_voice_sample.wav",
          name="My Custom Voice",
          description="A voice created from my recording",
          start_s=0.0,
      )

      print(json.dumps(voice, indent=2))

      ```


      ## Update Voice


      ```python

      await gradium.voices.update(
          client,
          voice_uid="abc123def456",
          name="Updated Voice Name",
          description="Updated description",
          start_s=1.5
      )

      ```


      ## Delete Voice


      ```python

      await gradium.voices.delete(client, voice_uid="abc123def456")

      ```


      # Credit Management


      Credits are consumed based on the audio generated: **1 credit equals 1
      character of TTS**.

      One minute is approximately 750 characters, so 1h of TTS generation is
      approximately 45 000 characters.


      ## Get Credit Information


      ```python

      import json


      credits_info = await gradium.usages.get(client)

      print(json.dumps(credits_info, indent=2))

      ```


      # Speech-to-Text (STT)


      The Speech-to-Text model converts audio input into text transcriptions,
      supporting real-time streaming and a semantic VAD.


      ## Basic Streaming Usage


      ```python

      import asyncio

      import gradium


      async def main():
          client = gradium.client.GradiumClient(api_key="your-api-key")

          # Audio generator that yields audio chunks
          async def audio_generator(audio_data, chunk_size=1920):
              for i in range(0, len(audio_data), chunk_size):
                  yield audio_data[i : i + chunk_size]

          # Create STT stream
          stream = await client.stt_stream(
              {"model_name": "default", "input_format": "pcm"},
              audio_generator(audio_data),
          )

          # Process transcription results
          async for message in stream.iter_text():
              print(message)

      if __name__ == "__main__":
          asyncio.run(main())
      ```


      ## Setup Parameters


      - **`model_name`**: The STT model to use (default: `"default"`)

      - **`input_format`**: Audio format of the input data (supported: `"pcm"`,
        `"wav"`, `"opus"`)

      When using `"pcm"` input format, the audio must adhere to the following

      specifications:

      - **Sample Rate**: 24000 Hz (24kHz)

      - **Format**: PCM (Pulse Code Modulation)

      - **Bit Depth**: 16-bit signed integer

      - **Channels**: Single channel (mono)

      - **Chunk Size**: Recommended 1920 samples per chunk (80ms at 24kHz)


      When using `"wav"` input format, the audio must be a valid WAV file using

      PCM data (so `AudioFormat` = 1 in the WAV header). Supported bits per
      sample

      are 16, 24 and 32 bits.


      When using `"opus"` input format, the audio must be some ogg wrapped opus
      data

      stream.


      ## Message Types


      The STT stream returns different types of messages:

      - **Text Messages** (`text`): Contain transcription results together with
      timestamps.

      - **VAD Messages** (`step`): Provide Voice Activity Detection information
      to determine
        when the speaker has finished speaking.

      ```python

      # Text messages containing transcription results

      async for msg in stream._stream:
          if msg.get("type") == "text":
              print(f"Transcription: {msg}")

          # VAD (Voice Activity Detection) messages
          elif msg.get("type") == "step":
              vad_info = msg.get("vad", {})
              # Use msg["vad"][2]["inactivity_prob"] to detect turn completion
              # VAD steps occur every 80ms
              inactivity_probability = msg["vad"][2].get("inactivity_prob")
              print(f"Inactivity probability: {inactivity_probability}")
      ```


      ## Advanced Options


      Some models support advanced options that can be passed using the
      `json_config`

      parameter. In the Python api, this parameter is passed as a dictionary
      mapping

      string to values (either float or string).


      This parameter can be used to control:

      - Stability of the generated speech via the `text` temperature parameter.

      - Expected language via the `language` parameter.

      - Delay to generate the text in audio frames via the `delay_in_frames`
      parameter.


      **Temperature Control** Sets the temperature used for text generation. The

      default value is 0 resulting in some greedy sampling. Higher values (up to
      1)

      result in more diverse outputs, in particular these can be helpful if no

      text is recognized.


      **Language Control** Sets the expected language of the audio. This can
      help

      grounding the model to a specific language and improve transcription
      quality.

      If multiple languages are expected, this can be set to the main language.


      **Delay Control** Sets the delay in audio frames (80ms each) before text

      is generated. Higher delays allow the model to gather more context before

      generating text, which can improve quality at the cost of latency.

      The allowed values are `7, 8, 10, 12, 14, 16, 20, 24, 36, 48`.


      # Text Rewriting Rules


      The text-to-speech API supports text rewriting rules that normalize and
      expand certain patterns in the input text before synthesis. These rules
      help the TTS model properly pronounce dates, times, numbers, email
      addresses, URLs, phone numbers, and alphanumeric codes.


      ## Configuration


      Rewrite rules can be enabled by adding a `rewrite_rules` field to the
      `json_config` in the setup message. The field accepts a comma-delimited
      string of rule names or language aliases.


      **Example setup message:**

      ```json

      {
        "json_config": {
          "rewrite_rules": "en"
        }
      }

      ```


      Or with specific rules:

      ```json

      {
        "json_config": {
          "rewrite_rules": "NumberEn,CurrencyEn,EmailEn"
        }
      }

      ```


      ## Language Aliases


      For convenience, language aliases are provided that enable all recommended
      rules for a specific language:


      | Alias | Enabled Rules |

      |-------|---------------|

      | `en` | AlNumEn, NumberEn, EmailEn, UrlEn, CurrencyEn |

      | `fr` | AlNumFr, NumberFr, EmailFr, UrlFr, CurrencyFr |

      | `fr-be` | DateFrBe, AlNumFr, NumberFrBe, EmailFr, UrlFr, CurrencyFrBe |

      | `fr-ch` | DateFrCh, AlNumFr, NumberFrCh, EmailFr, UrlFr, CurrencyFrCh |

      | `de` | AlNumDe, NumberDe, EmailDe, UrlDe, CurrencyDe |

      | `es` | AlNumEs, NumberEs, EmailEs, UrlEs, CurrencyEs |

      | `pt` | AlNumPt, NumberPt, EmailPt, UrlPt, CurrencyPt |


      ## Available Rewrite Rules


      ### Date Rules


      **Rule names:** `DateFrBe`, `DateFrCh`


      Numeric dates are handled by the model on its own, so no date rule is
      enabled for

      `en`, `fr`, `de`, `es` or `pt`. Belgian and Swiss French keep a dedicated
      rule,

      enabled by the `fr-be` and `fr-ch` aliases.


      ### Number Rules


      Number rules expand large numbers into word-based representations for
      better pronunciation. Years (1900-2100) and small numbers (< 1000) are
      kept as-is. The Belgian and Swiss rules are the exception: they also
      rewrite the tens that differ from metropolitan French, so those stay
      correct below 1000.


      **Rule names:** `NumberEn`, `NumberFr`, `NumberFrBe`, `NumberFrCh`,
      `NumberDe`, `NumberEs`, `NumberPt`


      **English examples:**

      - `123` → `123` (small numbers unchanged)

      - `1234` → `1 thousand 234`

      - `1000000` → `1 million`

      - `2500000` → `2 million 500 thousand`

      - `1002003004` → `1 billion 2 million 3 thousand 4`

      - `-4500` → `minus 4 thousand 500`


      **French examples:**

      - `1234` → `mille 234` (singular form for 1)

      - `2234` → `2 mille 234`

      - `2000000` → `2 millions`

      - `-4500` → `moins 4 mille 500`

      - `123456000789` → `123 milliards 456 millions 789`


      **Belgian French examples (`NumberFrBe`):**

      - `70` → `septante`

      - `80` → `quatre-vingts` (as in metropolitan French)

      - `90` → `nonante`


      **Swiss French examples (`NumberFrCh`):**

      - `70` → `septante`

      - `80` → `huitante`

      - `90` → `nonante`


      **Language-specific separators:**

      - **English:** thousand, million, billion

      - **French:** mille, million(s), milliard(s)

      - **German:** Tausend, Million(en), Milliarde(n)

      - **Spanish:** mil, millón/millones, mil millones

      - **Portuguese:** mil, milhão/milhões, bilhão/bilhões


      ### Email Rules


      Email rules spell out email addresses with language-specific words for
      special characters.


      **Rule names:** `EmailEn`, `EmailFr`, `EmailDe`, `EmailEs`, `EmailPt`


      **English examples:**

      - `foo.bar@gmail.com` → `foo dot bar at gmail dot com`


      **French examples:**

      - `foo@gmail.com` → `foo arobaze gmail point com`


      **Special character translations:**

      - `@` → "at" (en), "arobaze" (fr), "at" (de), "arroba" (es), "arroba" (pt)

      - `.` → "dot" (en), "point" (fr), "Punkt" (de), "punto" (es), "ponto" (pt)

      - `-` → "dash" (en), "tiret" (fr), "Bindestrich" (de), "guión" (es),
      "hífen" (pt)


      ### URL Rules


      URL rules spell out URLs including protocol, domain, path, and special
      characters.


      **Rule names:** `UrlEn`, `UrlFr`, `UrlDe`, `UrlEs`, `UrlPt`


      **English examples:**

      - `www.example.com` → `www dot example dot com`

      - `https://www.example.com/path` → `H-T-T-P-S colon slash slash www dot
      example dot com slash path`

      - `http://sub.domain.co.uk` → `H-T-T-P colon slash slash sub dot domain
      dot C-O dot U-K`


      **French examples:**

      - `https://www.kyutai.fr` → `H-T-T-P-S deux-points slash slash www point
      kyutai point F-R`

      - `www.it-management.com/promo` → `www point I-T tiret management point
      com slash promo`


      Two-letter top-level domains are spelled out (e.g., "UK" → "U-K", "FR" →
      "F-R").


      ### Currency Rules


      Currency amounts are expanded into words using the number expansion and
      the currency's

      name in the rule's language.


      **Rule names:** `CurrencyEn`, `CurrencyFr`, `CurrencyFrBe`,
      `CurrencyFrCh`, `CurrencyDe`, `CurrencyEs`, `CurrencyPt`


      **Examples:**

      - `It costs $1500 today.` → `It costs 1 thousand 500 dollars today.`
      (CurrencyEn)

      - `Ça coûte 500€ aujourd'hui.` → `Ça coûte 500 euros aujourd'hui.`
      (CurrencyFr)


      ### AlNum (Alphanumeric)


      **Rule names:** `AlNumEn` (alias `AlNum`), `AlNumFr`, `AlNumDe`,
      `AlNumEs`, `AlNumPt`


      Handles mixed uppercase letters and digits (e.g., license plates, product
      codes).


      **Examples:**

      - `AB12CD34!` → `A-B 1-2 C-D 3-4!`


      Characters are grouped by type (letters vs. digits) and joined with
      hyphens within each group.


      ## Best Practices


      1. **Use language aliases** when possible for comprehensive coverage in a
      single language

      2. **Combine specific rules** when you need fine-grained control or
      multi-language support

      3. **Preserve punctuation** - rules preserve trailing punctuation
      (periods, commas, etc.)

      4. **Year detection** - numbers between 1900-2100 are kept as-is and not
      expanded


      ## Implementation Notes


      - Rules are applied word-by-word to the input text

      - Only the first matching rule is applied to each word

      - Special characters like quotes, dashes, and brackets are normalized
      before processing

      - Colons (`:`) are handled specially to support time and URL formats

      - When no rules are specified, minimal text normalization is applied
    x-displayName: Documentation
  - name: FAQ
    description: >+
      Frequently Asked Questions

      =======================


      __What language do you support?__


      We currently support English, French, Spanish, Portuguese, and German,
      with more

      languages currently in development. Sign up to be updated when more
      languages

      become available!


      __What is the maximum session duration?__


      A session can last up to 300 seconds. If you want to generate longer
      chunks of

      text or transcribe longer audio, it's better to split it into different

      sessions.


      When using the free tier, there is an additional limitation of 1500
      characters

      per session.


      __How many credits do I need?__


      For Text-to-Speech, one minute of audio typically requires 750 characters,

      which corresponds to 750 credits. This may vary depending on the language
      and

      the speaker’s pace. For Speech-to-Text, each second of audio costs 3
      credits


      __Can I use my own voice?__


      Yes! We offer two levels of voice cloning. Our standard feature allows you
      to

      create a high-quality clone with just a 10-second audio sample. For those

      seeking even higher fidelity, we now offer Pro Voice Clones; by providing
      30

      minutes to a few hours of audio data, you can create a custom voice with

      unmatched quality and nuance.


      __What is an Instant Voice Clone?__


      Instant voice cloning enables you to create realistic digital replicas
      using just

      a few seconds of reference audio (typically 10 seconds). Depending on your

      subscription plan, you can clone up to 1,000 voices. Please note that
      explicit

      consent from the voice owner is required.


      __What is a Pro Voice Clone?__


      A Pro Voice Clone is a high-fidelity, hyper-realistic voice model created
      by

      fine-tuning our dedicated AI on a large dataset of your audio. Unlike
      standard

      cloning, this process captures the speaker's deepest emotional nuances,
      unique

      accents, and natural pacing, resulting in a digital voice
      indistinguishable from

      the original.


      __How do I generate a Pro Voice Clone?__


      To get started, navigate to the Pro Voice Clone tab in Gradium Studio and
      upload

      your audio dataset. You will receive a notification once the upload is
      processed. After

      training is complete, the voice will appear in your library and be ready
      for

      Text-to-Speech (TTS) generation.


      __How much audio do I need for a voice clone?__


      For an Instant Voice Clone, we get optimal results with only 10 seconds of
      data. For a

      Pro Voice Clone, we require a minimum of 30 minutes of clean audio data.
      For optimal results

      where the voice captures full emotional range and stability, we recommend

      providing 2 hours of audio.

  - name: Release notes
    description: >
      ## 2026.02


      We're excited to announce major updates to the Gradium API and Gradium
      Studio, delivering enhanced text-to-speech (TTS) and speech-to-text (STT)
      capabilities for developers and enterprises.


      🎙️ **Advanced TTS and STT Models**


      Experience our latest text-to-speech model and speech recognition model
      with improved audio quality, accuracy, and natural-sounding voice
      generation. Perfect for voice applications, transcription services, and
      conversational AI. Now by default 


      📖 **Custom Pronunciation Dictionaries**


      Take control of speech synthesis with pronunciation dictionaries. Ensure
      brand names, technical terminology, and industry-specific acronyms are
      pronounced correctly every time. Ideal for healthcare, finance, and
      industry specific applications.


      ⚡ **WebSocket Multiplexing for Real-Time Audio**


      Boost performance with multiplexing support: process multiple TTS or STT
      requests simultaneously over a single WebSocket connection. Reduce
      latency, minimize connection overhead, and scale efficiently for
      high-volume applications.


      🎁 **Gradium Referral Program**


      Love Gradium? Join our referral program: share Gradium with your network
      and earn up to 9M API credits while your referrals get exclusive
      discounts. Win-win for developers and businesses alike.


      ☁️ **AWS Marketplace & SageMaker AI Deployment**


      Deploy Gradium TTS and ASR models directly on AWS SageMaker with full
      bidirectional streaming support. Accelerate your deployment timeline while
      keeping your voice AI infrastructure secure within your private cloud
      network. Now available on AWS Marketplace.


      Feedbacks are always welcome, do not hesitate to join our [discord
      channel](https://discord.com/invite/bcysuPRzXE)!
  - name: TTS
    description: Text-to-Speech endpoints for converting text to audio
  - name: STT
    description: Speech-to-Text endpoints for converting audio to text
  - name: Voices
    description: Manage custom voice clones
  - name: Pronunciations
    description: Manage pronunciation dictionaries for custom text rewriting
  - name: Credits
    description: Monitor API credit balance
paths:
  /speech/tts:
    get:
      tags:
        - TTS
      summary: TTS WebSocket Stream
      description: >
        Connect to this endpoint via WebSocket for real-time text-to-speech
        conversion with low latency audio streaming.


        **Connection URL:**


        ```

        wss://api.gradium.ai/api/speech/tts

        ```


        **Authentication:**

        Include your API key in the WebSocket connection header:

        - Header: `x-api-key: your_api_key`


        ---


        ## Quick Reference


        | Direction | Message Type | Example |

        |-----------|-------------|---------|

        | 🔵⬆️ Client→Server | Setup (first) | `{"type": "setup", "voice_id":
        "YTpq7expH9539ERJ", "model_name": "default", "output_format": "wav"}` |

        | 🟢⬇️ Server→Client | Ready | `{"type": "ready", "request_id": "uuid"}`
        |

        | 🔵⬆️ Client→Server | Text (stream) | `{"type": "text", "text": "Hello,
        world!"}` |

        | 🟢⬇️ Server→Client | Audio (stream) | `{"type": "audio", "audio":
        "base64..."}` |

        | 🟢⬇️ Server→Client | Text (stream) | `{"type": "text", "text":
        "Hello", "start_s": 0.2, "stop_s": 0.6}` |

        | 🔵⬆️ Client→Server | EndOfStream | `{"type": "end_of_stream"}` |

        | 🟢⬇️ Server→Client | AEndOfStream | `{"type": "end_of_stream"}` |

        | 🔴⬇️ Server→Client | Error | `{"type": "error", "message": "Error
        description", "code": 1008}` |


        ---


        ## Message Types


        ### 1. Setup Message (First Message)


        **Direction:** Client → Server

        **Format:** JSON Object


        ```json

        {
          "type": "setup",
          "model_name": "default",
          "voice_id": "YTpq7expH9539ERJ",
          "output_format": "wav"
        }

        ```


        **Fields:**

        - `type` (string, required): Must be "setup"

        - `model_name` (string, optional): The TTS model to use (default:
        "default")

        - `voice_id` (string, required): Voice ID from the library (e.g.,
        "YTpq7expH9539ERJ" for Emma's voice) or custom voice ID

        - `output_format` (string, optional): Audio format (default: "wav"). One
        of "wav", "pcm", "opus", "ulaw_8000", "mulaw_8000", "alaw_8000",
        "pcm_8000", "pcm_16000", "pcm_22050", "pcm_24000", "pcm_44100",
        "pcm_48000".


        **Important:** This must be the very first message sent after
        connection. The server will close the connection if any other message is
        sent first.


        ---


        ### 2. Ready Message


        **Direction:** Server → Client

        **Format:** JSON Object


        ```json

        {
          "type": "ready",
          "request_id": "550e8400-e29b-41d4-a716-446655440000"
        }

        ```


        **Fields:**

        - `type` (string): Will be "ready"

        - `request_id` (string): Unique identifier for the session


        This message is sent by the server after receiving the setup message,
        indicating that the connection is ready to receive text messages.


        ---


        ### 3. Text Message (Subsequent Messages)


        **Direction:** Client → Server

        **Format:** JSON Object


        ```json

        {
          "type": "text",
          "text": "Hello, world!"
        }

        ```


        **Fields:**

        - `type` (string, required): Must be "text"

        - `text` (string, required): The text to be converted to speech


        Send text messages to be converted to speech. You can send multiple text
        messages in sequence. The server will stream audio back as it's
        generated.


        **Important: split on whitespace, not inside words or before
        punctuation.** When you send multiple text messages, the server inserts
        a single whitespace between the contents of consecutive messages.
        Sending `"foo"` followed by `"bar"` is therefore equivalent to sending
        `"foo bar"` (a whitespace is added between them), not `"foobar"`.
        Splitting a word across two messages will change its pronunciation. For
        the same reason, do not split trailing punctuation into its own message:
        sending `"foo"` followed by `"."` yields `"foo ."` rather than `"foo."`.
        Keep each message aligned to a whitespace boundary, with any trailing
        punctuation attached to the preceding word.


        ---


        ### 4. Audio Response


        **Direction:** Server → Client

        **Format:** JSON Object


        ```json

        {
          "type": "audio",
          "audio": "base64_encoded_audio_data..."
        }

        ```


        **Fields:**

        - `type` (string): Will be "audio"

        - `audio` (string): Base64-encoded audio data in the requested format


        When using `"pcm"` output format, the audio will adhere to the following

        specifications:

        - **Sample Rate**: 48000 Hz (48kHz)

        - **Format**: PCM (Pulse Code Modulation)

        - **Bit Depth**: 16-bit signed integer

        - **Channels**: Single channel (mono)

        - **Chunk Size**: 3840 samples per chunk (80ms at 48kHz)


        When using the `"wav"` output format, the audio chunks are in WAV
        format,

        at 48kHz, 16-bit signed integer mono.


        When using the `"opus"` output format, the audio chunks use the Opus
        codec

        wrapped in an Ogg container.


        Alternative output formats include `"ulaw_8000"`, `"alaw_8000"`,
        `"pcm_8000"`,

        `"pcm_16000"`, and `"pcm_24000"`.


        **Important:** Multiple audio messages will be streamed for each text
        message. Continue receiving until you detect the end of speech or
        receive a new message type.


        ---


        ### 5. Text Response


        **Direction:** Server → Client

        **Format:** JSON Object


        ```json

        {
          "type": "text",
          "text": "Hello",
          "start_s": 0.2,
          "stop_s": 0.6
        }

        ```


        **Fields:**

        - `type` (string): Will be "text"

        - `text` (string): The portion of text that has been generated into
        speech

        - `start_s` (float): Start time in seconds of this text segment in the
        audio

        - `stop_s` (float): Stop time in seconds of this text segment in the
        audio


        The server sends text messages back to indicate which parts of the input
        text

        have been processed into speech as well as the associated timestamps in
        the

        audio stream.


        ---


        ### 6. End Of Stream


        **Direction:** Client → Server and Server → Client

        **Format:** JSON Object


        ```json

        {
          "type": "end_of_stream",
        }

        ```


        This message is sent by the client when it has submitted all the text
        that it

        wants to be considered. The server will then send back all the remaining
        audio

        until all the text has been processed, then an `EndOfStream` message,
        and then

        closes the websocket connection.


        ---


        ## Error Handling


        When errors occur, the server sends an error message as JSON before
        closing the connection:


        **Error Message Format:**

        ```json

        {
          "type": "error",
          "message": "Error description explaining what went wrong",
          "code": 1008
        }

        ```


        **Common Error Codes:**

        - `1008`: Policy Violation (e.g., invalid API key, missing setup
        message)

        - `1011`: Internal Server Error (unexpected server-side error)


        ---


        ## Best Practices


        1. **Always send setup first**: The server expects a setup message
        immediately after connection

        2. **Handle audio streaming**: Audio responses are streamed in chunks -
        buffer and process appropriately

        3. **Implement reconnection logic**: Network issues happen - build in
        automatic reconnection with exponential backoff

        4. **Monitor connection health**: Implement ping/pong or periodic checks
        to detect stale connections

        5. **Graceful error handling**: Parse error messages and handle
        different error codes appropriately

        6. **Reuse connections**: For multiple utterances, keep the connection
        alive and send multiple text messages

        7. **Close cleanly**: Always close WebSocket connections properly when
        done


        ---
      operationId: stream_text_to_speech
      parameters:
        - name: x-api-key
          in: header
          required: true
          schema:
            type: string
          description: Your Gradium API key
      responses:
        '101':
          description: WebSocket connection established
      x-codeSamples:
        - lang: cURL
          source: >
            wscat -c "wss://api.gradium.ai/api/speech/tts" \
              -H "x-api-key: your_api_key"
            # After connection, paste:

            #
            {"type":"setup","voice_id":"YTpq7expH9539ERJ","model_name":"default","output_format":"wav"}

            # {"type":"text","text":"Hello, world!"}

            # {"type":"end_of_stream"}
        - lang: Python
          source: >
            import asyncio

            import base64

            import json


            import websockets



            async def synthesise(api_key: str, voice_id: str, text: str) ->
            bytes:
                setup = {
                    "type": "setup",
                    "voice_id": voice_id,
                    "model_name": "default",
                    "output_format": "wav",
                }
                audio_chunks = []

                async with websockets.connect(
                    "wss://api.gradium.ai/api/speech/tts",
                    additional_headers={"x-api-key": api_key},
                ) as ws:
                    await ws.send(json.dumps(setup))
                    ready = json.loads(await ws.recv())
                    assert ready["type"] == "ready"

                    await ws.send(json.dumps({"type": "text", "text": text}))
                    await ws.send(json.dumps({"type": "end_of_stream"}))

                    while True:
                        msg = json.loads(await ws.recv())
                        if msg["type"] == "audio":
                            audio_chunks.append(base64.b64decode(msg["audio"]))
                        elif msg["type"] == "end_of_stream":
                            break
                        elif msg["type"] == "error":
                            raise RuntimeError(msg["message"])

                return b"".join(audio_chunks)


            audio = asyncio.run(synthesise("your_api_key", "YTpq7expH9539ERJ",
            "Hello, world!"))

            with open("output.wav", "wb") as f:
                f.write(audio)
components:
  securitySchemes:
    ApiKeyAuth:
      type: apiKey
      in: header
      name: x-api-key
      description: API key for authentication. Passed via the `x-api-key` header.

````