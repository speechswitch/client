> ## Documentation Index
> Fetch the complete documentation index at: https://platform.minimax.io/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# Text to Speech (T2A) WebSocket

> Use this API for synchronous t2a over WebSocket.

This example streams and plays the returned audio in real time while also saving the complete audio file.

Note: To enable real-time audio playback, you must first install the [mpv player](https://mpv.io/installation/).

Additionally, make sure to set your API Key in the environment variable `MINIMAX_API_KEY`.

```python theme={null}
import asyncio
import websockets
import json
import ssl
import subprocess
import os

model = "speech-2.8-hd"
file_format = "mp3"

class StreamAudioPlayer:
    def __init__(self):
        self.mpv_process = None

    def start_mpv(self):
        """Start MPV player process"""
        try:
            mpv_command = ["mpv", "--no-cache", "--no-terminal", "--", "fd://0"]
            self.mpv_process = subprocess.Popen(
                mpv_command,
                stdin=subprocess.PIPE,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            print("MPV player started")
            return True
        except FileNotFoundError:
            print("Error: mpv not found. Please install mpv")
            return False
        except Exception as e:
            print(f"Failed to start mpv: {e}")
            return False

    def play_audio_chunk(self, hex_audio):
        """Play audio chunk"""
        try:
            if self.mpv_process and self.mpv_process.stdin:
                audio_bytes = bytes.fromhex(hex_audio)
                self.mpv_process.stdin.write(audio_bytes)
                self.mpv_process.stdin.flush()
                return True
        except Exception as e:
            print(f"Play failed: {e}")
            return False
        return False

    def stop(self):
        """Stop player"""
        if self.mpv_process:
            if self.mpv_process.stdin and not self.mpv_process.stdin.closed:
                self.mpv_process.stdin.close()
            try:
                self.mpv_process.wait(timeout=20)
            except subprocess.TimeoutExpired:
                self.mpv_process.terminate()

async def establish_connection(api_key):
    """Establish WebSocket connection"""
    url = "wss://api.minimax.io/ws/v1/t2a_v2"
    headers = {"Authorization": f"Bearer {api_key}"}

    ssl_context = ssl.create_default_context()
    ssl_context.check_hostname = False
    ssl_context.verify_mode = ssl.CERT_NONE

    try:
        ws = await websockets.connect(url, additional_headers=headers, ssl=ssl_context)
        connected = json.loads(await ws.recv())
        if connected.get("event") == "connected_success":
            print("Connection successful")
            return ws
        return None
    except Exception as e:
        print(f"Connection failed: {e}")
        return None

async def start_task(websocket):
    """Send task start request"""
    start_msg = {
        "event": "task_start",
        "model": model,
        "voice_setting": {
            "voice_id": "male-qn-qingse",
            "speed": 1,
            "vol": 1,
            "pitch": 0,
            "english_normalization": False
        }
        "audio_setting": {
            "sample_rate": 32000,
            "bitrate": 128000,
            "format": file_format,
            "channel": 1
        }
    }
    await websocket.send(json.dumps(start_msg))
    response = json.loads(await websocket.recv())
    return response.get("event") == "task_started"

async def continue_task_with_stream_play(websocket, text, player):
    """Send continue request and stream play audio"""
    await websocket.send(json.dumps({
        "event": "task_continue",
        "text": text
    }))

    chunk_counter = 1
    total_audio_size = 0
    audio_data = b""

    while True:
        try:
            response = json.loads(await websocket.recv())

            if "data" in response and "audio" in response["data"]:
                audio = response["data"]["audio"]
                if audio:
                    print(f"Playing chunk #{chunk_counter}")
                    audio_bytes = bytes.fromhex(audio)
                    if player.play_audio_chunk(audio):
                        total_audio_size += len(audio_bytes)
                        audio_data += audio_bytes
                        chunk_counter += 1

            if response.get("is_final"):
                print(f"Audio synthesis completed: {chunk_counter-1} chunks")
                if player.mpv_process and player.mpv_process.stdin:
                    player.mpv_process.stdin.close()

                # Save audio to file
                with open(f"output.{file_format}", "wb") as f:
                    f.write(audio_data)
                print(f"Audio saved as output.{file_format}")

                estimated_duration = total_audio_size * 0.0625 / 1000
                wait_time = max(estimated_duration + 5, 10)
                return wait_time

        except Exception as e:
            print(f"Error: {e}")
            break

    return 10

async def close_connection(websocket):
    """Close connection"""
    if websocket:
        try:
            await websocket.send(json.dumps({"event": "task_finish"}))
            await websocket.close()
        except Exception:
            pass

async def main():
    API_KEY = os.getenv("MINIMAX_API_KEY")
    TEXT = "The real danger is not that computers start thinking like people(sighs), but that people start thinking like computers. Computers can only help us with simple tasks."

    player = StreamAudioPlayer()

    try:
        if not player.start_mpv():
            return

        ws = await establish_connection(API_KEY)
        if not ws:
            return

        if not await start_task(ws):
            print("Task startup failed")
            return

        wait_time = await continue_task_with_stream_play(ws, TEXT, player)
        await asyncio.sleep(wait_time)

    except Exception as e:
        print(f"Error: {e}")
    finally:
        player.stop()
        if 'ws' in locals():
            await close_connection(ws)

if __name__ == "__main__":
    asyncio.run(main())
```


## AsyncAPI

````yaml api-reference/speech/t2a/api/asyncapi.json t2a_v2_websocket
id: t2a_v2_websocket
title: T2a_v2_websocket
description: ''
servers:
  - id: production
    protocol: wss
    host: api.minimax.io
    bindings: []
    variables: []
address: /ws/v1/t2a_v2
parameters: []
bindings: []
operations:
  - &ref_2
    id: sendMessage
    title: Send message
    description: ''
    type: receive
    messages:
      - &ref_4
        id: send_task_start
        contentType: application/json
        payload:
          - name: Task Start Event
            description: >-
              Sending the `"task_start"` event officially begins the speech
              synthesis task. The task is considered successfully started when
              the server returns a `"task_started"` event. Only after receiving
              this event can you send `"task_continue"` or `"task_finish"`
              events to the server.
            type: object
            properties:
              - name: event
                type: string
                description: >-
                  Controls the instruction being sent. For this step, set to
                  `task_start`.
                enumValues:
                  - task_start
                required: true
              - name: model
                type: string
                description: >-
                  The model version to request. Options: `speech-2.8-hd`,
                  `speech-2.8-turbo`, `speech-2.6-hd`, `speech-2.6-turbo`,
                  `speech-02-hd`, `speech-02-turbo`, `speech-01-hd`,
                  `speech-01-turbo`.
                enumValues:
                  - speech-2.8-hd
                  - speech-2.8-turbo
                  - speech-2.6-hd
                  - speech-2.6-turbo
                  - speech-02-hd
                  - speech-02-turbo
                  - speech-01-hd
                  - speech-01-turbo
                required: true
              - name: voice_setting
                type: object
                required: true
                properties:
                  - name: voice_id
                    type: string
                    description: "The ID of the target voice.  \r\n- To apply mixed voices, configure the `timbre_weights` parameter and leave this value empty.  \r\n- Supports system voices, cloned voices, and AI-generated voices. Below is a selection of the latest system voices (IDs). The full list of available voices can be viewed on the [System Voice ID List](/faq/system-voice-id) or retrieved programmatically using the [Get Voice API](/api-reference/voice-management-get).  \r\n  - Chinese:\r\n    - moss_audio_ce44fc67-7ce3-11f0-8de5-96e35d26fb85\r\n    - moss_audio_aaa1346a-7ce7-11f0-8e61-2e6e3c7ee85d\r\n    - Chinese (Mandarin)_Lyrical_Voice\r\n    - Chinese (Mandarin)_HK_Flight_Attendant\r\n\r\n  - English:\r\n    - English_Graceful_Lady\r\n    - English_Insightful_Speaker\r\n    - English_radiant_girl\r\n    - English_Persuasive_Man\r\n    - moss_audio_6dc281eb-713c-11f0-a447-9613c873494c\r\n    - moss_audio_570551b1-735c-11f0-b236-0adeeecad052\r\n    - moss_audio_ad5baf92-735f-11f0-8263-fe5a2fe98ec8\r\n    - English_Lucky_Robot\r\n\r\n  - Japanese:\r\n    - Japanese_Whisper_Belle\r\n    - moss_audio_24875c4a-7be4-11f0-9359-4e72c55db738\r\n    - moss_audio_7f4ee608-78ea-11f0-bb73-1e2a4cfcd245\r\n    - moss_audio_c1a6a3ac-7be6-11f0-8e8e-36b92fbb4f95"
                    required: true
                  - name: speed
                    type: number
                    description: |-
                      Speech speed. Higher values result in faster speech.
                      Range: `[0.5, 2]` (default: 1.0).
                    required: false
                  - name: vol
                    type: number
                    description: |-
                      Speech volume. Higher values increase loudness.
                      Range: `(0, 10]` (default: `1.0`).
                    required: false
                  - name: pitch
                    type: integer
                    description: |-
                      Speech pitch adjustment.
                      Range: `[-12, 12]` (default: `0`, original pitch).
                    required: false
                  - name: emotion
                    type: string
                    description: "Emotion control for synthesized speech. Supported values:  `[\"happy\", \"sad\", \"angry\", \"fearful\", \"disgusted\", \"surprised\", \"calm\", \"fluent\", \"whisper\"]`.  \r\n- By default, the model automatically selects the most natural emotion based on text.  Manual specification is only recommended when explicitly needed.  \r\n- Available for models: `speech-2.8-hd`, `speech-2.8-turbo`, `speech-2.6-hd`, `speech-2.6-turbo`, `speech-02-hd`, `speech-02-turbo`, `speech-01-hd`, `speech-01-turbo`.  \r\n- Option `fluent`, `whisper` is only available for models: `speech-2.6-turbo`, `speech-2.6-hd`. `speech-2.8-hd` and `speech-2.8-turbo` do not support `whisper`."
                    enumValues:
                      - happy
                      - sad
                      - angry
                      - fearful
                      - disgusted
                      - surprised
                      - calm
                      - fluent
                      - whisper
                    required: false
                  - name: english_normalization
                    type: boolean
                    description: >-
                      Enable text normalization in English. Improves performance
                      in digit-reading scenarios at the cost of slightly higher
                      latency. Default: `false`.
                    required: false
                  - name: latex_read
                    type: boolean
                    description: >-
                      Enable LaTeX formula reading. Default: `false`.


                      - Only supports Chinese. When this parameter is enabled,
                      `language_boost` will be set to `Chinese`.

                      - Formulas must be wrapped with `$$`.

                      - If the request contains a formula with `"\"`, it must be
                      escaped as `"\\"`.


                      Example: The quadratic formula

                      ![The quadratic
                      formula](https://filecdn.minimax.chat/public/d6f62e9a-cd3f-4f55-a237-257eef531683.png)


                      should be written as `$$x = \\frac{-b \\pm \\sqrt{b^2 -
                      4ac}}{2a}$$`
                    required: false
              - name: audio_setting
                type: object
                required: false
                properties:
                  - name: sample_rate
                    type: integer
                    description: >-
                      Specifies the sampling rate of the generated audio.
                      Supported values: `[8000, 16000, 22050, 24000, 32000,
                      44100]`. Default is `32000`.
                    required: false
                  - name: bitrate
                    type: integer
                    description: >-
                      Specifies the bitrate of the generated audio. Supported
                      values: `[32000, 64000, 128000, 256000]`. Default is
                      `128000`.

                      *Note: This parameter only applies to audio in `mp3`
                      format.*
                    required: false
                  - name: format
                    type: string
                    description: >-
                      Specifies the format of the generated audio. Supported
                      values: `[mp3, pcm, flac, wav, pcmu_raw, pcmu_wav, opus]`.
                      Default is `mp3`.

                      *Note: `pcmu_raw` and `pcmu_wav` are G.711 μ-law encoded
                      (8 kHz sample rate; `pcmu_raw` is headerless raw,
                      `pcmu_wav` is wrapped in a WAV container). `opus` is
                      Ogg/Opus encoded; in streaming mode, audio chunks must be
                      reassembled in arrival order before decoding.*
                    enumValues:
                      - mp3
                      - wav
                      - flac
                      - pcm
                      - pcmu_raw
                      - pcmu_wav
                      - opus
                    required: false
                  - name: channel
                    type: integer
                    description: >-
                      Specifies the number of audio channels. Supported values:
                      `[1, 2]`.  `1` = mono, `2` = stereo. Default is `1`.
                    required: false
              - name: pronunciation_dict
                type: object
                required: false
                properties:
                  - name: tone
                    type: array
                    description: >-
                      Defines pronunciation rules for specific characters or
                      symbols.

                      For Chinese text, tones are represented numerically:  1 =
                      first tone, 2 = second tone, 3 = third tone, 4 = fourth
                      tone, 5 = neutral tone.

                      Example: `["omg/oh my god"]`
                    required: false
                    properties:
                      - name: item
                        type: string
                        required: false
              - name: timbre_weights
                type: object
                required: false
                properties:
                  - name: voice_id
                    type: string
                    description: >-
                      The ID of the voice used for synthesis. Must be specified
                      together with `weight`.

                      Supports system voices, cloned voices, and text-to-voice
                      generated voices.  The full list of available voices can
                      be viewed on the [System Voice ID
                      List](/faq/system-voice-id) or retrieved programmatically
                      using the [Get Voice
                      API](/api-reference/voice-management-get).  
                    required: false
                  - name: weight
                    type: integer
                    description: >-
                      The weight assigned to each voice. Must be specified
                      together with `voice_id`.

                      Supported range: `[1, 100]`. Up to 4 voices can be mixed.
                      A higher weight value increases similarity to the
                      corresponding voice.


                      Parameter Configuration Example:


                      ```json

                      "timbre_weights": [
                        {
                          "voice_id": "female-chengshu",
                          "weight": 30
                        },
                        {
                          "voice_id": "female-tianmei",
                          "weight": 70
                        }
                      ]

                      ```
                    required: false
              - name: language_boost
                type: string
                description: >-
                  Controls whether recognition for specific minority languages
                  and dialects is enhanced.  Default is `null`. If the language
                  type is unknown, set to `"auto"` and the model will
                  automatically detect it.  

                  Supported values:  

                  [`Chinese`, `Chinese,Yue`, `English`, `Arabic`, `Russian`,
                  `Spanish`, `French`, `Portuguese`, `German`, `Turkish`,
                  `Dutch`, `Ukrainian`, `Vietnamese`, `Indonesian`, `Japanese`,
                  `Italian`, `Korean`, `Thai`, `Polish`, `Romanian`, `Greek`,
                  `Czech`, `Finnish`, `Hindi`, `Bulgarian`, `Danish`, `Hebrew`,
                  `Malay`, `Persian`, `Slovak`, `Swedish`, `Croatian`,
                  `Filipino`, `Hungarian`, `Norwegian`, `Slovenian`, `Catalan`,
                  `Nynorsk`, `Tamil`, `Afrikaans`, `auto`]


                  Note: The speech-01 and speech-02 series models do not
                  currently support Persian, Filipino, or Tamil.
                enumValues:
                  - Chinese
                  - Chinese,Yue
                  - English
                  - Arabic
                  - Russian
                  - Spanish
                  - French
                  - Portuguese
                  - German
                  - Turkish
                  - Dutch
                  - Ukrainian
                  - Vietnamese
                  - Indonesian
                  - Japanese
                  - Italian
                  - Korean
                  - Thai
                  - Polish
                  - Romanian
                  - Greek
                  - Czech
                  - Finnish
                  - Hindi
                  - Bulgarian
                  - Danish
                  - Hebrew
                  - Malay
                  - Persian
                  - Slovak
                  - Swedish
                  - Croatian
                  - Filipino
                  - Hungarian
                  - Norwegian
                  - Slovenian
                  - Catalan
                  - Nynorsk
                  - Tamil
                  - Afrikaans
                  - auto
                required: false
              - name: voice_modify
                type: object
                description: |-
                  Voice effects configuration.
                  Supported audio formats:
                  1. Non-streaming: mp3, wav, flac
                  2. Streaming: mp3
                required: false
                properties:
                  - name: pitch
                    type: integer
                    description: >-
                      Corresponds to the “Deepen/Brighten” slider on the
                      official page. Range: [-100, 100]. Values closer to -100
                      produce a deeper voice, while values closer to 100 result
                      in a brighter tone.

                      ![pitch](https://filecdn.minimax.chat/public/75af719d-e126-4297-b3cb-416f382e04ec.png)
                    required: false
                  - name: intensity
                    type: integer
                    description: >-
                      Corresponds to the “Stronger/Softer” slider on the
                      official page. Range: [-100, 100]. Values closer to -100
                      create a stronger, more forceful sound, while values
                      closer to 100 yield a softer tone.

                      ![intensity](https://filecdn.minimax.chat/public/14015a81-d9c4-459b-9536-15c511aac6c0.png)
                    required: false
                  - name: timbre
                    type: integer
                    description: >-
                      Corresponds to the “Nasal/Crisp” slider on the official
                      page. Range: [-100, 100]. Values closer to -100 produce a
                      fuller, richer sound, while values closer to 100 generate
                      a crisper tone.

                      ![timbre](https://filecdn.minimax.chat/public/86ab8ff8-896c-4254-b181-017d9d14000e.png)
                    required: false
                  - name: sound_effects
                    type: string
                    description: >-
                      Sound effects. Only one can be applied at a time.
                      Options:  `spacious_echo`, `auditorium_echo`,
                      `lofi_telephone`,`robotic`
                    enumValues:
                      - spacious_echo
                      - auditorium_echo
                      - lofi_telephone
                      - robotic
                    required: false
              - name: subtitle_enable
                type: boolean
                description: >-
                  Controls whether subtitles are enabled. Default is `false`.
                  Available for models: `speech-2.8-hd`, `speech-2.8-turbo`,
                  `speech-2.6-hd`, `speech-2.6-turbo`, `speech-02-hd`,
                  `speech-02-turbo`, `speech-01-hd`, `speech-01-turbo`.
                required: false
              - name: subtitle_type
                type: string
                description: >-
                  Subtitle granularity. Default is `sentence`. Options:

                  - `sentence`: sentence-level timestamps

                  - `word`: word-level timestamps

                  - `word_streaming`: word-level timestamps optimized for
                  streaming
                enumValues:
                  - sentence
                  - word
                  - word_streaming
                required: false
              - name: continuous_sound
                type: boolean
                description: >-
                  Controls model-side text segmentation strategy. Only available
                  for `speech-2.8-hd` and `speech-2.8-turbo` models.

                  - `true`: model does not split the text and performs
                  continuous inference to generate audio (better prosody for
                  long text)

                  - `false`: model splits the text and runs concurrent inference
                  for each segment (lower latency)


                  Default is `false`.
                required: false
        headers: []
        jsonPayloadSchema:
          type: object
          required:
            - event
            - model
            - voice_setting
          properties:
            event:
              type: string
              enum:
                - task_start
              default:
                - task_start
              description: >-
                Controls the instruction being sent. For this step, set to
                `task_start`.
              x-parser-schema-id: <anonymous-schema-6>
            model:
              type: string
              description: >-
                The model version to request. Options: `speech-2.8-hd`,
                `speech-2.8-turbo`, `speech-2.6-hd`, `speech-2.6-turbo`,
                `speech-02-hd`, `speech-02-turbo`, `speech-01-hd`,
                `speech-01-turbo`.
              enum:
                - speech-2.8-hd
                - speech-2.8-turbo
                - speech-2.6-hd
                - speech-2.6-turbo
                - speech-02-hd
                - speech-02-turbo
                - speech-01-hd
                - speech-01-turbo
              x-parser-schema-id: <anonymous-schema-7>
            voice_setting:
              type: object
              required:
                - voice_id
              properties:
                voice_id:
                  type: string
                  description: "The ID of the target voice.  \r\n- To apply mixed voices, configure the `timbre_weights` parameter and leave this value empty.  \r\n- Supports system voices, cloned voices, and AI-generated voices. Below is a selection of the latest system voices (IDs). The full list of available voices can be viewed on the [System Voice ID List](/faq/system-voice-id) or retrieved programmatically using the [Get Voice API](/api-reference/voice-management-get).  \r\n  - Chinese:\r\n    - moss_audio_ce44fc67-7ce3-11f0-8de5-96e35d26fb85\r\n    - moss_audio_aaa1346a-7ce7-11f0-8e61-2e6e3c7ee85d\r\n    - Chinese (Mandarin)_Lyrical_Voice\r\n    - Chinese (Mandarin)_HK_Flight_Attendant\r\n\r\n  - English:\r\n    - English_Graceful_Lady\r\n    - English_Insightful_Speaker\r\n    - English_radiant_girl\r\n    - English_Persuasive_Man\r\n    - moss_audio_6dc281eb-713c-11f0-a447-9613c873494c\r\n    - moss_audio_570551b1-735c-11f0-b236-0adeeecad052\r\n    - moss_audio_ad5baf92-735f-11f0-8263-fe5a2fe98ec8\r\n    - English_Lucky_Robot\r\n\r\n  - Japanese:\r\n    - Japanese_Whisper_Belle\r\n    - moss_audio_24875c4a-7be4-11f0-9359-4e72c55db738\r\n    - moss_audio_7f4ee608-78ea-11f0-bb73-1e2a4cfcd245\r\n    - moss_audio_c1a6a3ac-7be6-11f0-8e8e-36b92fbb4f95"
                  x-parser-schema-id: <anonymous-schema-8>
                speed:
                  type: number
                  format: float
                  description: |-
                    Speech speed. Higher values result in faster speech.
                    Range: `[0.5, 2]` (default: 1.0).
                  minimum: 0.5
                  maximum: 2
                  default: 1
                  x-parser-schema-id: <anonymous-schema-9>
                vol:
                  type: number
                  format: float
                  description: |-
                    Speech volume. Higher values increase loudness.
                    Range: `(0, 10]` (default: `1.0`).
                  exclusiveMinimum: 0
                  maximum: 10
                  default: 1
                  x-parser-schema-id: <anonymous-schema-10>
                pitch:
                  type: integer
                  description: |-
                    Speech pitch adjustment.
                    Range: `[-12, 12]` (default: `0`, original pitch).
                  minimum: -12
                  maximum: 12
                  default: 0
                  x-parser-schema-id: <anonymous-schema-11>
                emotion:
                  type: string
                  description: "Emotion control for synthesized speech. Supported values:  `[\"happy\", \"sad\", \"angry\", \"fearful\", \"disgusted\", \"surprised\", \"calm\", \"fluent\", \"whisper\"]`.  \r\n- By default, the model automatically selects the most natural emotion based on text.  Manual specification is only recommended when explicitly needed.  \r\n- Available for models: `speech-2.8-hd`, `speech-2.8-turbo`, `speech-2.6-hd`, `speech-2.6-turbo`, `speech-02-hd`, `speech-02-turbo`, `speech-01-hd`, `speech-01-turbo`.  \r\n- Option `fluent`, `whisper` is only available for models: `speech-2.6-turbo`, `speech-2.6-hd`. `speech-2.8-hd` and `speech-2.8-turbo` do not support `whisper`."
                  enum:
                    - happy
                    - sad
                    - angry
                    - fearful
                    - disgusted
                    - surprised
                    - calm
                    - fluent
                    - whisper
                  x-parser-schema-id: <anonymous-schema-12>
                english_normalization:
                  type: boolean
                  description: >-
                    Enable text normalization in English. Improves performance
                    in digit-reading scenarios at the cost of slightly higher
                    latency. Default: `false`.
                  x-parser-schema-id: <anonymous-schema-13>
                latex_read:
                  type: boolean
                  description: >-
                    Enable LaTeX formula reading. Default: `false`.


                    - Only supports Chinese. When this parameter is enabled,
                    `language_boost` will be set to `Chinese`.

                    - Formulas must be wrapped with `$$`.

                    - If the request contains a formula with `"\"`, it must be
                    escaped as `"\\"`.


                    Example: The quadratic formula

                    ![The quadratic
                    formula](https://filecdn.minimax.chat/public/d6f62e9a-cd3f-4f55-a237-257eef531683.png)


                    should be written as `$$x = \\frac{-b \\pm \\sqrt{b^2 -
                    4ac}}{2a}$$`
                  x-parser-schema-id: <anonymous-schema-14>
              x-parser-schema-id: VoiceSetting
            audio_setting:
              type: object
              properties:
                sample_rate:
                  type: integer
                  description: >-
                    Specifies the sampling rate of the generated audio.
                    Supported values: `[8000, 16000, 22050, 24000, 32000,
                    44100]`. Default is `32000`.
                  x-parser-schema-id: <anonymous-schema-15>
                bitrate:
                  type: integer
                  description: >-
                    Specifies the bitrate of the generated audio. Supported
                    values: `[32000, 64000, 128000, 256000]`. Default is
                    `128000`.

                    *Note: This parameter only applies to audio in `mp3`
                    format.*
                  x-parser-schema-id: <anonymous-schema-16>
                format:
                  type: string
                  description: >-
                    Specifies the format of the generated audio. Supported
                    values: `[mp3, pcm, flac, wav, pcmu_raw, pcmu_wav, opus]`.
                    Default is `mp3`.

                    *Note: `pcmu_raw` and `pcmu_wav` are G.711 μ-law encoded (8
                    kHz sample rate; `pcmu_raw` is headerless raw, `pcmu_wav` is
                    wrapped in a WAV container). `opus` is Ogg/Opus encoded; in
                    streaming mode, audio chunks must be reassembled in arrival
                    order before decoding.*
                  enum:
                    - mp3
                    - wav
                    - flac
                    - pcm
                    - pcmu_raw
                    - pcmu_wav
                    - opus
                  x-parser-schema-id: <anonymous-schema-17>
                channel:
                  type: integer
                  description: >-
                    Specifies the number of audio channels. Supported values:
                    `[1, 2]`.  `1` = mono, `2` = stereo. Default is `1`.
                  x-parser-schema-id: <anonymous-schema-18>
              x-parser-schema-id: AudioSetting
            pronunciation_dict:
              type: object
              properties:
                tone:
                  type: array
                  items:
                    type: string
                    x-parser-schema-id: <anonymous-schema-20>
                  description: >-
                    Defines pronunciation rules for specific characters or
                    symbols.

                    For Chinese text, tones are represented numerically:  1 =
                    first tone, 2 = second tone, 3 = third tone, 4 = fourth
                    tone, 5 = neutral tone.

                    Example: `["omg/oh my god"]`
                  x-parser-schema-id: <anonymous-schema-19>
              x-parser-schema-id: PronunciationDict
            timbre_weights:
              type: object
              properties:
                voice_id:
                  type: string
                  description: >-
                    The ID of the voice used for synthesis. Must be specified
                    together with `weight`.

                    Supports system voices, cloned voices, and text-to-voice
                    generated voices.  The full list of available voices can be
                    viewed on the [System Voice ID List](/faq/system-voice-id)
                    or retrieved programmatically using the [Get Voice
                    API](/api-reference/voice-management-get).  
                  x-parser-schema-id: <anonymous-schema-21>
                weight:
                  type: integer
                  description: >-
                    The weight assigned to each voice. Must be specified
                    together with `voice_id`.

                    Supported range: `[1, 100]`. Up to 4 voices can be mixed. A
                    higher weight value increases similarity to the
                    corresponding voice.


                    Parameter Configuration Example:


                    ```json

                    "timbre_weights": [
                      {
                        "voice_id": "female-chengshu",
                        "weight": 30
                      },
                      {
                        "voice_id": "female-tianmei",
                        "weight": 70
                      }
                    ]

                    ```
                  minimum: 1
                  maximum: 100
                  x-parser-schema-id: <anonymous-schema-22>
              x-parser-schema-id: TimbreWeights
            language_boost:
              type: string
              description: >-
                Controls whether recognition for specific minority languages and
                dialects is enhanced.  Default is `null`. If the language type
                is unknown, set to `"auto"` and the model will automatically
                detect it.  

                Supported values:  

                [`Chinese`, `Chinese,Yue`, `English`, `Arabic`, `Russian`,
                `Spanish`, `French`, `Portuguese`, `German`, `Turkish`, `Dutch`,
                `Ukrainian`, `Vietnamese`, `Indonesian`, `Japanese`, `Italian`,
                `Korean`, `Thai`, `Polish`, `Romanian`, `Greek`, `Czech`,
                `Finnish`, `Hindi`, `Bulgarian`, `Danish`, `Hebrew`, `Malay`,
                `Persian`, `Slovak`, `Swedish`, `Croatian`, `Filipino`,
                `Hungarian`, `Norwegian`, `Slovenian`, `Catalan`, `Nynorsk`,
                `Tamil`, `Afrikaans`, `auto`]


                Note: The speech-01 and speech-02 series models do not currently
                support Persian, Filipino, or Tamil.
              enum:
                - Chinese
                - Chinese,Yue
                - English
                - Arabic
                - Russian
                - Spanish
                - French
                - Portuguese
                - German
                - Turkish
                - Dutch
                - Ukrainian
                - Vietnamese
                - Indonesian
                - Japanese
                - Italian
                - Korean
                - Thai
                - Polish
                - Romanian
                - Greek
                - Czech
                - Finnish
                - Hindi
                - Bulgarian
                - Danish
                - Hebrew
                - Malay
                - Persian
                - Slovak
                - Swedish
                - Croatian
                - Filipino
                - Hungarian
                - Norwegian
                - Slovenian
                - Catalan
                - Nynorsk
                - Tamil
                - Afrikaans
                - auto
              x-parser-schema-id: <anonymous-schema-23>
            voice_modify:
              type: object
              description: |-
                Voice effects configuration.
                Supported audio formats:
                1. Non-streaming: mp3, wav, flac
                2. Streaming: mp3
              properties:
                pitch:
                  type: integer
                  description: >-
                    Corresponds to the “Deepen/Brighten” slider on the official
                    page. Range: [-100, 100]. Values closer to -100 produce a
                    deeper voice, while values closer to 100 result in a
                    brighter tone.

                    ![pitch](https://filecdn.minimax.chat/public/75af719d-e126-4297-b3cb-416f382e04ec.png)
                  minimum: -100
                  maximum: 100
                  x-parser-schema-id: <anonymous-schema-24>
                intensity:
                  type: integer
                  description: >-
                    Corresponds to the “Stronger/Softer” slider on the official
                    page. Range: [-100, 100]. Values closer to -100 create a
                    stronger, more forceful sound, while values closer to 100
                    yield a softer tone.

                    ![intensity](https://filecdn.minimax.chat/public/14015a81-d9c4-459b-9536-15c511aac6c0.png)
                  minimum: -100
                  maximum: 100
                  x-parser-schema-id: <anonymous-schema-25>
                timbre:
                  type: integer
                  description: >-
                    Corresponds to the “Nasal/Crisp” slider on the official
                    page. Range: [-100, 100]. Values closer to -100 produce a
                    fuller, richer sound, while values closer to 100 generate a
                    crisper tone.

                    ![timbre](https://filecdn.minimax.chat/public/86ab8ff8-896c-4254-b181-017d9d14000e.png)
                  minimum: -100
                  maximum: 100
                  x-parser-schema-id: <anonymous-schema-26>
                sound_effects:
                  type: string
                  description: >-
                    Sound effects. Only one can be applied at a time. Options: 
                    `spacious_echo`, `auditorium_echo`,
                    `lofi_telephone`,`robotic`
                  enum:
                    - spacious_echo
                    - auditorium_echo
                    - lofi_telephone
                    - robotic
                  x-parser-schema-id: <anonymous-schema-27>
              x-parser-schema-id: VoiceModify
            subtitle_enable:
              type: boolean
              description: >-
                Controls whether subtitles are enabled. Default is `false`.
                Available for models: `speech-2.8-hd`, `speech-2.8-turbo`,
                `speech-2.6-hd`, `speech-2.6-turbo`, `speech-02-hd`,
                `speech-02-turbo`, `speech-01-hd`, `speech-01-turbo`.
              default: false
              x-parser-schema-id: <anonymous-schema-28>
            subtitle_type:
              type: string
              description: >-
                Subtitle granularity. Default is `sentence`. Options:

                - `sentence`: sentence-level timestamps

                - `word`: word-level timestamps

                - `word_streaming`: word-level timestamps optimized for
                streaming
              enum:
                - sentence
                - word
                - word_streaming
              default: sentence
              x-parser-schema-id: <anonymous-schema-29>
            continuous_sound:
              type: boolean
              description: >-
                Controls model-side text segmentation strategy. Only available
                for `speech-2.8-hd` and `speech-2.8-turbo` models.

                - `true`: model does not split the text and performs continuous
                inference to generate audio (better prosody for long text)

                - `false`: model splits the text and runs concurrent inference
                for each segment (lower latency)


                Default is `false`.
              default: false
              x-parser-schema-id: <anonymous-schema-30>
          x-parser-schema-id: SendTaskStartEvent
        title: Task Start Event
        description: >-
          Sending the `"task_start"` event officially begins the speech
          synthesis task. The task is considered successfully started when the
          server returns a `"task_started"` event. Only after receiving this
          event can you send `"task_continue"` or `"task_finish"` events to the
          server.
        example: |-
          {
            "event": "task_start",
            "model": "speech-2.8-turbo",
            "language_boost": "Chinese",
            "voice_setting": {
              "voice_id": "English_expressive_narrator",
              "speed": 1,
              "vol": 1,
              "pitch": 0
            },
            "pronunciation_dict": {
              "tone": [
                "Omg/Oh my god"
              ]
            },
            "audio_setting": {
              "sample_rate": 32000,
              "bitrate": 128000,
              "format": "mp3",
              "channel": 1
            }
          }
        bindings: []
        extensions:
          - id: x-parser-unique-object-id
            value: send_task_start
      - &ref_5
        id: send_task_continue
        contentType: application/json
        payload:
          - name: Task Continue Event
            description: >-
              After receiving the `"task_started"` event from the server, the
              task officially begins. You can send `"task_continue"` events to
              provide text for synthesis. Multiple `"task_continue"` events can
              be sent sequentially. If no new event is sent within 120 seconds
              after receiving the last result, the WebSocket connection will
              automatically close.
            type: object
            properties:
              - name: event
                type: string
                description: >-
                  The type of session event. For this step, set to
                  `task_continue`.
                enumValues:
                  - task_continue
                required: true
              - name: text
                type: string
                description: >-
                  Text to be synthesized into speech. Maximum length: 10,000
                  characters.

                  - Use line breaks (`\n`) to indicate paragraph changes.

                  - Pause control: Custom pauses between text segments can be
                  specified. Insert `<#x#>` in the text, where `x` is the pause
                  duration in seconds (range **[0.01, 99.99]**, up to two
                  decimal places). Pause markers must be placed between
                  pronounceable text segments; multiple consecutive pause
                  markers are not allowed.

                  - **Interjection tags**: Only supported when using
                  `speech-2.8-hd` or `speech-2.8-turbo` models. Supported
                  interjections: `(laughs)`, `(chuckle)`, `(coughs)`,
                  `(clear-throat)`, `(groans)`, `(breath)`, `(pant)`,
                  `(inhale)`, `(exhale)`, `(gasps)`, `(sniffs)`, `(sighs)`,
                  `(snorts)`, `(burps)`, `(lip-smacking)`, `(humming)`,
                  `(hissing)`, `(emm)`, `(sneezes)`.
                required: true
        headers: []
        jsonPayloadSchema:
          type: object
          required:
            - event
            - text
          properties:
            event:
              type: string
              description: >-
                The type of session event. For this step, set to
                `task_continue`.
              enum:
                - task_continue
              default:
                - task_continue
              x-parser-schema-id: <anonymous-schema-36>
            text:
              type: string
              description: >-
                Text to be synthesized into speech. Maximum length: 10,000
                characters.

                - Use line breaks (`\n`) to indicate paragraph changes.

                - Pause control: Custom pauses between text segments can be
                specified. Insert `<#x#>` in the text, where `x` is the pause
                duration in seconds (range **[0.01, 99.99]**, up to two decimal
                places). Pause markers must be placed between pronounceable text
                segments; multiple consecutive pause markers are not allowed.

                - **Interjection tags**: Only supported when using
                `speech-2.8-hd` or `speech-2.8-turbo` models. Supported
                interjections: `(laughs)`, `(chuckle)`, `(coughs)`,
                `(clear-throat)`, `(groans)`, `(breath)`, `(pant)`, `(inhale)`,
                `(exhale)`, `(gasps)`, `(sniffs)`, `(sighs)`, `(snorts)`,
                `(burps)`, `(lip-smacking)`, `(humming)`, `(hissing)`, `(emm)`,
                `(sneezes)`.
              x-parser-schema-id: <anonymous-schema-37>
          x-parser-schema-id: SendTaskContinueEvent
        title: Task Continue Event
        description: >-
          After receiving the `"task_started"` event from the server, the task
          officially begins. You can send `"task_continue"` events to provide
          text for synthesis. Multiple `"task_continue"` events can be sent
          sequentially. If no new event is sent within 120 seconds after
          receiving the last result, the WebSocket connection will automatically
          close.
        example: |-
          {
            "event": "task_continue",
            "text": "Omg(sighs), the real danger is not that computers start thinking like people, but that people start thinking like computers. Computers can only help us with simple tasks."
          }
        bindings: []
        extensions:
          - id: x-parser-unique-object-id
            value: send_task_continue
      - &ref_6
        id: send_task_finish
        contentType: application/json
        payload:
          - name: Task Finish Event
            description: >-
              When the server receives the `task_finish` event, it waits for all
              tasks in the current queue to complete, then closes the WebSocket
              connection and ends the session.
            type: object
            properties:
              - name: event
                type: string
                description: >-
                  The type of session event. For this step, set the value to
                  `task_finish`.
                enumValues:
                  - task_finish
                required: true
        headers: []
        jsonPayloadSchema:
          type: object
          required:
            - event
          properties:
            event:
              type: string
              enum:
                - task_finish
              default:
                - task_finish
              description: >-
                The type of session event. For this step, set the value to
                `task_finish`.
              x-parser-schema-id: <anonymous-schema-55>
          x-parser-schema-id: SendTaskFinishEvent
        title: Task Finish Event
        description: >-
          When the server receives the `task_finish` event, it waits for all
          tasks in the current queue to complete, then closes the WebSocket
          connection and ends the session.
        example: |-
          {
            "event": "task_finish"
          }
        bindings: []
        extensions:
          - id: x-parser-unique-object-id
            value: send_task_finish
    bindings: []
    extensions: &ref_1
      - id: x-parser-unique-object-id
        value: t2a_v2_websocket
  - &ref_3
    id: receiveMessage
    title: Receive message
    description: ''
    type: send
    messages:
      - &ref_7
        id: receive_connected_success
        contentType: application/json
        payload:
          - name: Connected Success Event
            description: Notification that T2A task has started
            type: object
            properties:
              - name: session_id
                type: string
                description: The ID of the entire session.
                required: false
              - name: event
                type: string
                description: >-
                  The type of session event. Returns `connected_success` upon
                  successful connection.
                required: false
              - name: trace_id
                type: string
                description: >-
                  The ID of a single request within the session, useful for
                  troubleshooting or feedback.
                required: false
              - name: base_resp
                type: object
                required: false
                properties:
                  - name: status_code
                    type: integer
                    description: >-
                      Status code, where `0` indicates a successful connection.

                      For more information, please refer to the [Error Code
                      Reference](/api-reference/errorcode).
                    required: false
                  - name: status_msg
                    type: string
                    description: Detailed status message.
                    required: false
        headers: []
        jsonPayloadSchema:
          type: object
          properties:
            session_id:
              type: string
              description: The ID of the entire session.
              x-parser-schema-id: <anonymous-schema-1>
            event:
              type: string
              const: connected_success
              description: >-
                The type of session event. Returns `connected_success` upon
                successful connection.
              x-parser-schema-id: <anonymous-schema-2>
            trace_id:
              type: string
              description: >-
                The ID of a single request within the session, useful for
                troubleshooting or feedback.
              x-parser-schema-id: <anonymous-schema-3>
            base_resp:
              type: object
              properties:
                status_code:
                  type: integer
                  description: >-
                    Status code, where `0` indicates a successful connection.

                    For more information, please refer to the [Error Code
                    Reference](/api-reference/errorcode).
                  x-parser-schema-id: <anonymous-schema-4>
                status_msg:
                  type: string
                  description: Detailed status message.
                  x-parser-schema-id: <anonymous-schema-5>
              x-parser-schema-id: BaseResp
          x-parser-schema-id: ReceiveConnectedSuccessEvent
        title: Connected Success Event
        description: Notification that T2A task has started
        example: |-
          {
            "session_id": "xxxx",
            "event": "connected_success",
            "trace_id": "0303a2882bf18235ae7a809ae0f3cca7",
            "base_resp": {
              "status_code": 0,
              "status_msg": "success"
            }
          }
        bindings: []
        extensions:
          - id: x-parser-unique-object-id
            value: receive_connected_success
      - &ref_8
        id: receive_task_started
        contentType: application/json
        payload:
          - name: Task Started Event
            description: Notification that T2A task has started
            type: object
            properties:
              - name: session_id
                type: string
                description: The id of the entire session.
                required: false
              - name: event
                type: string
                description: >-
                  The type of session event. For this step, a successful
                  response returns `task_started`.
                required: false
              - name: trace_id
                type: string
                description: >-
                  The ID of a single request within the session, useful for
                  troubleshooting or feedback.
                required: false
              - name: base_resp
                type: object
                required: false
                properties:
                  - name: status_code
                    type: integer
                    description: >-
                      - 0: success

                      - 2202: illegal event

                      For more information, please refer to the [Error Code
                      Reference](/api-reference/errorcode).
                    required: false
                  - name: status_msg
                    type: string
                    description: Detailed status message.
                    required: false
        headers: []
        jsonPayloadSchema:
          type: object
          properties:
            session_id:
              type: string
              description: The id of the entire session.
              x-parser-schema-id: <anonymous-schema-31>
            event:
              type: string
              const: >-
                The type of session event. For this step, a successful response
                returns `task_started`.
              x-parser-schema-id: <anonymous-schema-32>
            trace_id:
              type: string
              description: >-
                The ID of a single request within the session, useful for
                troubleshooting or feedback.
              x-parser-schema-id: <anonymous-schema-33>
            base_resp: &ref_0
              type: object
              properties:
                status_code:
                  type: integer
                  description: >-
                    - 0: success

                    - 2202: illegal event

                    For more information, please refer to the [Error Code
                    Reference](/api-reference/errorcode).
                  x-parser-schema-id: <anonymous-schema-34>
                status_msg:
                  type: string
                  description: Detailed status message.
                  x-parser-schema-id: <anonymous-schema-35>
              x-parser-schema-id: TaskStartFinishBaseResp
          x-parser-schema-id: ReceiveTaskStartedEvent
        title: Task Started Event
        description: Notification that T2A task has started
        example: |-
          {
            "session_id": "xxxx",
            "event": "task_started",
            "trace_id": "0303a2882bf18235ae7a809ae0f3cca7",
            "base_resp": {
              "status_code": 0,
              "status_msg": "success"
            }
          }
        bindings: []
        extensions:
          - id: x-parser-unique-object-id
            value: receive_task_started
      - &ref_9
        id: receive_task_continued
        contentType: application/json
        payload:
          - name: Task Continued Event
            description: Notification that T2A task is continuing
            type: object
            properties:
              - name: data
                type: object
                description: >-
                  `data` may return `null`. Please check for null when
                  referencing example code.
                required: false
                properties:
                  - name: audio
                    type: string
                    description: >-
                      Synthesized audio segment, hex-encoded, generated in the
                      format defined in the request (mp3/ pcm/ flac).
                    required: false
              - name: trace_id
                type: string
                description: >-
                  ID of the individual request within the session, useful for
                  troubleshooting or feedback.
                required: false
              - name: session_id
                type: string
                description: ID of the entire session.
                required: false
              - name: event
                type: string
                description: Session event type. On success, returns `"task_continued"`.
                required: false
              - name: is_final
                type: boolean
                description: Indicates whether this response is the final one.
                required: false
              - name: extra_info
                type: object
                description: Additional information.
                required: false
                properties:
                  - name: audio_length
                    type: integer
                    description: Audio duration in milliseconds
                    required: false
                  - name: audio_sample_rate
                    type: integer
                    description: Audio sample rate
                    required: false
                  - name: audio_size
                    type: integer
                    description: Audio file size in bytes
                    required: false
                  - name: bitrate
                    type: integer
                    description: Audio bitrate
                    required: false
                  - name: audio_format
                    type: string
                    description: 'Generated audio file format. Options: mp3/pcm/flac.'
                    required: false
                  - name: audio_channel
                    type: integer
                    description: 'Number of audio channels: 1 = mono, 2 = stereo.'
                    required: false
                  - name: invisible_character_ratio
                    type: integer
                    description: >-
                      Ratio of illegal characters. If ≤ 10%, audio is generated
                      normally with the ratio returned. Above 10%, an error is
                      triggered.
                    required: false
                  - name: usage_characters
                    type: integer
                    description: Number of billing characters for this speech generation.
                    required: false
                  - name: word_count
                    type: integer
                    description: >-
                      Count of pronounced characters, including Chinese
                      characters, digits, and letters (punctuation excluded).
                    required: false
              - name: base_resp
                type: object
                required: false
                properties:
                  - name: status_code
                    type: integer
                    description: >-
                      Status code.

                      - 0: Request successful

                      - 1000: Unknown error

                      - 1001: Request timeout

                      - 1002: Rate limit

                      - 1004: Authentication failed

                      - 1039: TPM rate limit triggered

                      - 1042: Illegal characters > 10%

                      - 2013: Invalid input parameters

                      - 2201: Timeout disconnect

                      - 2202: Illegal event

                      - 2203: Empty text, skipped

                      - 2204: Exceeded character limit, skipped

                      - 2205: Request limit exceeded

                      For more codes, see [Error
                      Codes](/api-reference/errorcode).
                    required: false
                  - name: status_msg
                    type: string
                    description: Detailed status message.
                    required: false
        headers: []
        jsonPayloadSchema:
          type: object
          properties:
            data:
              type: object
              description: >-
                `data` may return `null`. Please check for null when referencing
                example code.
              properties:
                audio:
                  type: string
                  description: >-
                    Synthesized audio segment, hex-encoded, generated in the
                    format defined in the request (mp3/ pcm/ flac).
                  x-parser-schema-id: <anonymous-schema-39>
              x-parser-schema-id: <anonymous-schema-38>
            trace_id:
              type: string
              description: >-
                ID of the individual request within the session, useful for
                troubleshooting or feedback.
              x-parser-schema-id: <anonymous-schema-40>
            session_id:
              type: string
              description: ID of the entire session.
              x-parser-schema-id: <anonymous-schema-41>
            event:
              type: string
              description: Session event type. On success, returns `"task_continued"`.
              x-parser-schema-id: <anonymous-schema-42>
            is_final:
              type: boolean
              description: Indicates whether this response is the final one.
              x-parser-schema-id: <anonymous-schema-43>
            extra_info:
              type: object
              description: Additional information.
              properties:
                audio_length:
                  type: integer
                  format: int64
                  description: Audio duration in milliseconds
                  x-parser-schema-id: <anonymous-schema-44>
                audio_sample_rate:
                  type: integer
                  format: int64
                  description: Audio sample rate
                  x-parser-schema-id: <anonymous-schema-45>
                audio_size:
                  type: integer
                  format: int64
                  description: Audio file size in bytes
                  x-parser-schema-id: <anonymous-schema-46>
                bitrate:
                  type: integer
                  format: int64
                  description: Audio bitrate
                  x-parser-schema-id: <anonymous-schema-47>
                audio_format:
                  type: string
                  description: 'Generated audio file format. Options: mp3/pcm/flac.'
                  x-parser-schema-id: <anonymous-schema-48>
                audio_channel:
                  type: integer
                  format: int64
                  description: 'Number of audio channels: 1 = mono, 2 = stereo.'
                  x-parser-schema-id: <anonymous-schema-49>
                invisible_character_ratio:
                  type: integer
                  format: float
                  description: >-
                    Ratio of illegal characters. If ≤ 10%, audio is generated
                    normally with the ratio returned. Above 10%, an error is
                    triggered.
                  x-parser-schema-id: <anonymous-schema-50>
                usage_characters:
                  type: integer
                  format: int64
                  description: Number of billing characters for this speech generation.
                  x-parser-schema-id: <anonymous-schema-51>
                word_count:
                  type: integer
                  format: int64
                  description: >-
                    Count of pronounced characters, including Chinese
                    characters, digits, and letters (punctuation excluded).
                  x-parser-schema-id: <anonymous-schema-52>
              x-parser-schema-id: ExtraInfo
            base_resp:
              type: object
              properties:
                status_code:
                  type: integer
                  description: |-
                    Status code.
                    - 0: Request successful
                    - 1000: Unknown error
                    - 1001: Request timeout
                    - 1002: Rate limit
                    - 1004: Authentication failed
                    - 1039: TPM rate limit triggered
                    - 1042: Illegal characters > 10%
                    - 2013: Invalid input parameters
                    - 2201: Timeout disconnect
                    - 2202: Illegal event
                    - 2203: Empty text, skipped
                    - 2204: Exceeded character limit, skipped
                    - 2205: Request limit exceeded
                    For more codes, see [Error Codes](/api-reference/errorcode).
                  x-parser-schema-id: <anonymous-schema-53>
                status_msg:
                  type: string
                  description: Detailed status message.
                  x-parser-schema-id: <anonymous-schema-54>
              x-parser-schema-id: TaskContinueBaseResp
          x-parser-schema-id: ReceiveTaskContinuedEvent
        title: Task Continued Event
        description: Notification that T2A task is continuing
        example: |-
          {
            "data": {
              "audio": "xxx"
            },
            "extra_info": {
              "audio_channel": 1,
              "audio_format": "mp3",
              "audio_length": 9914,
              "audio_sample_rate": 32000,
              "audio_size": 157869,
              "bitrate": 128000,
              "invisible_character_ratio": 0,
              "usage_characters": 158,
              "word_count": 158
            },
            "is_final": true,
            "session_id": "301871346491491",
            "trace_id": "04ee3794e2c9e4a6d5f99e77742f06fd",
            "base_resp": {
              "status_code": 0,
              "status_msg": "success"
            }
          }
        bindings: []
        extensions:
          - id: x-parser-unique-object-id
            value: receive_task_continued
      - &ref_10
        id: receive_task_finished
        contentType: application/json
        payload:
          - name: Task Finished Event
            description: Notification that T2A task has completed successfully
            type: object
            properties:
              - name: trace_id
                type: string
                description: >-
                  The ID of a single request within the session, useful for
                  troubleshooting or feedback.
                required: false
              - name: session_id
                type: string
                description: ID of the entire session.
                required: false
              - name: event
                type: string
                description: Session event type. On success, returns `"task_finished"`.
                required: false
              - name: base_resp
                type: object
                required: false
                properties:
                  - name: status_code
                    type: integer
                    description: >-
                      - 0: success

                      - 2202: illegal event

                      For more information, please refer to the [Error Code
                      Reference](/api-reference/errorcode).
                    required: false
                  - name: status_msg
                    type: string
                    description: Detailed status message.
                    required: false
        headers: []
        jsonPayloadSchema:
          type: object
          properties:
            trace_id:
              type: string
              description: >-
                The ID of a single request within the session, useful for
                troubleshooting or feedback.
              x-parser-schema-id: <anonymous-schema-56>
            session_id:
              type: string
              description: ID of the entire session.
              x-parser-schema-id: <anonymous-schema-57>
            event:
              type: string
              description: Session event type. On success, returns `"task_finished"`.
              x-parser-schema-id: <anonymous-schema-58>
            base_resp: *ref_0
          x-parser-schema-id: ReceiveTaskFinishedEvent
        title: Task Finished Event
        description: Notification that T2A task has completed successfully
        example: |-
          {
            "session_id": "xxxx",
            "event": "task_finished",
            "trace_id": "0303a2882bf18235ae7a809ae0f3cca7",
            "base_resp": {
              "status_code": 0,
              "status_msg": "success"
            }
          }
        bindings: []
        extensions:
          - id: x-parser-unique-object-id
            value: receive_task_finished
      - &ref_11
        id: receive_task_failed
        contentType: application/json
        payload:
          - name: Task Failed Event
            description: >-
              If the `task_failed` event is received, it indicates that the task
              has failed. In this case, the WebSocket connection must be closed,
              and the error should be handled.
            type: object
            properties:
              - name: trace_id
                type: string
                description: >-
                  The ID of a single request within the session, useful for
                  troubleshooting or feedback.
                required: false
              - name: session_id
                type: string
                description: ID of the entire session.
                required: false
              - name: event
                type: string
                description: Session event type. On success, returns `"task_finished"`.
                required: false
              - name: base_resp
                type: object
                required: false
                properties:
                  - name: status_code
                    type: integer
                    description: >-
                      The status code.

                      - `1000`: Unknown error

                      - `1001`: Timeout

                      - `1002`: Rate limit exceeded

                      - `1004`: Authentication failed

                      - `1039`: TPM rate limit triggered

                      - `1042`: More than 10% invalid characters

                      - `2013`: Invalid input format

                      - `2201`: Timeout disconnection

                      For more codes, see [Error
                      Codes](/api-reference/errorcode).
                    required: false
                  - name: status_msg
                    type: string
                    description: Detailed status message.
                    required: false
        headers: []
        jsonPayloadSchema:
          type: object
          properties:
            trace_id:
              type: string
              description: >-
                The ID of a single request within the session, useful for
                troubleshooting or feedback.
              x-parser-schema-id: <anonymous-schema-59>
            session_id:
              type: string
              description: ID of the entire session.
              x-parser-schema-id: <anonymous-schema-60>
            event:
              type: string
              description: Session event type. On success, returns `"task_finished"`.
              x-parser-schema-id: <anonymous-schema-61>
            base_resp:
              type: object
              properties:
                status_code:
                  type: integer
                  description: |-
                    The status code.
                    - `1000`: Unknown error
                    - `1001`: Timeout
                    - `1002`: Rate limit exceeded
                    - `1004`: Authentication failed
                    - `1039`: TPM rate limit triggered
                    - `1042`: More than 10% invalid characters
                    - `2013`: Invalid input format
                    - `2201`: Timeout disconnection
                    For more codes, see [Error Codes](/api-reference/errorcode).
                  x-parser-schema-id: <anonymous-schema-62>
                status_msg:
                  type: string
                  description: Detailed status message.
                  x-parser-schema-id: <anonymous-schema-63>
              x-parser-schema-id: TaskFailedBaseResp
          x-parser-schema-id: ReceiveTaskFailedEvent
        title: Task Failed Event
        description: >-
          If the `task_failed` event is received, it indicates that the task has
          failed. In this case, the WebSocket connection must be closed, and the
          error should be handled.
        example: |-
          {
            "session_id": "xxxx",
            "event": "task_failed",
            "trace_id": "0303a2882bf18235ae7a809ae0f3cca7",
            "base_resp": {
              "status_code": 1004,
              "status_msg": "XXXXXXX"
            }
          }
        bindings: []
        extensions:
          - id: x-parser-unique-object-id
            value: receive_task_failed
    bindings: []
    extensions: *ref_1
sendOperations:
  - *ref_2
receiveOperations:
  - *ref_3
sendMessages:
  - *ref_4
  - *ref_5
  - *ref_6
receiveMessages:
  - *ref_7
  - *ref_8
  - *ref_9
  - *ref_10
  - *ref_11
extensions:
  - id: x-parser-unique-object-id
    value: t2a_v2_websocket
securitySchemes: []

````