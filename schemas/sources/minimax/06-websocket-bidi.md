> ## Documentation Index
> Fetch the complete documentation index at: https://platform.minimax.io/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# Text to Speech (T2A) WebSocket (Bidirectional)

> WebSocket text-to-speech with streaming text input: send text character by character and let the server buffer it into sentences.

## Differences from `/ws/v1/t2a_v2`

This API targets **streaming text input** — piping an LLM's streaming output straight into speech, token by token.

|                                  | [`/ws/v1/t2a_v2`](/docs/api-reference/speech-t2a-websocket) | `/ws/v1/t2a_v2_bidi` (this API)                |
| -------------------------------- | ------------------------------------------------------ | ---------------------------------------------- |
| Sentence buffering               | **Client** must detect sentence boundaries             | **Server** buffers automatically               |
| Sending text char by char        | One synthesis per character, choppy audio              | Buffered into full sentences first             |
| Interruption                     | Not supported, must close the connection               | `task_cancel`, and you can continue afterwards |
| Sentence boundary events         | None                                                   | `sentence_start` / `sentence_end`              |
| `task_finish`                    | Closes the connection immediately                      | Flushes the buffer first, then closes          |
| Flush without ending the session | None                                                   | `task_flush`                                   |

The voice, audio and pronunciation parameters of `task_start` are **identical** to `/ws/v1/t2a_v2`, so an existing integration can reuse them as-is.

## Event flow

1. Establish the connection and receive `connected_success`
2. Send `task_start` and receive `task_started`
3. Send `task_continue` (**at any granularity, including a single character**); the server buffers the text and starts synthesizing
   * `sentence_start` is returned when a sentence starts synthesizing
   * audio arrives in chunks via `task_continued`
   * `sentence_end` is returned when that sentence is done
4. Send `task_cancel` to interrupt; after `task_canceled` you may keep sending `task_continue`
5. When a turn is over and you want its tail audio right away, send `task_flush`; the session continues after `task_flushed`
6. Send `task_finish`; the server synthesizes any leftover buffered text, then returns `task_finished` and closes the connection

<Note>
  Do not conflate the three levels of completion: `is_final` marks the end of audio for one request, `sentence_end` marks the end of the current sentence, and `task_finished` marks the end of the whole session.
</Note>

<Note>
  A connection can host only one synthesis session at a time. Sending `task_start` again after the task has started returns `2206` (illegal event order) and closes the connection.
</Note>

## Sentence buffering and latency

The server detects sentence boundaries from punctuation, so **the punctuation in the text you send directly affects how natural the audio sounds**:

| Text situation                                                | Server behaviour                                                                                                    |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Ends with sentence-final punctuation (`。！？…!?.` or a newline) | Synthesized **immediately**, no added latency                                                                       |
| Contains secondary punctuation (`，、；：,;:`)                    | Splits only once enough text has accumulated, so it never emits tiny fragments                                      |
| Long text with no punctuation at all                          | Force-split once it hits the length cap; the boundary is then unrelated to meaning and the audio will sound clipped |
| Ends without punctuation, but enough text has accumulated     | Flushed after a short silence window                                                                                |
| Ends without punctuation and is short                         | **Keeps waiting** — the server will not synthesize half a word just to lower latency                                |

<Warning>
  The last row has a practical consequence for multi-turn conversations.

  If a turn ends with text that is both short and unpunctuated, it is not flushed by the short silence window and instead waits for a longer backstop window. Two ways to avoid that wait: **end the last piece with sentence-final punctuation**, or **send `task_flush`** to push it out explicitly.

  Note that `task_finish` is not a substitute — it closes the connection, so it cannot be used when running multiple turns over one connection.
</Warning>

<Warning>
  If your application sanitizes an LLM's output before forwarding it, **keep the original punctuation**. Without punctuation the server falls back to splitting purely by length, so pauses land in the wrong places and the audio sounds noticeably unnatural.
</Warning>

<Note>
  When the upstream source (for example an LLM) stalls, the audio will contain a matching gap — that is unavoidable. The server will not flush a half-finished sentence to fill the gap, because that would only make the listener hear half a word and then wait anyway.
</Note>

## Keeping the connection alive

A connection that stays idle for roughly 120 seconds is closed by the server with `2201`. "Idle" means the server is neither receiving upstream events nor sending audio.

<Warning>
  The server **does not send** WebSocket ping frames on its own. If your session has long silent periods (for example while waiting for the user to speak), send pings from the client — the server replies with pong and refreshes the activity timer. Keeping the TCP connection open is not enough to avoid `2201`.
</Warning>

## Send rate and retries

`2205` means too much text is queued for synthesis on the server, usually because you are sending faster than synthesis can keep up.

<Note>
  `2205` is **not a quota rate limit**, and it is a soft failure: neither the connection nor the session is closed. Just resend that `task_continue` a moment later — **no reconnect and no second `task_start` are needed**.
</Note>

A single `task_continue` longer than 10,000 characters returns `2204`; that piece is skipped and the connection and session likewise stay open.


## AsyncAPI

````yaml api-reference/speech/t2a/api/asyncapi-bidi.json t2a_v2_bidi_websocket
id: t2a_v2_bidi_websocket
title: T2a_v2_bidi_websocket
description: ''
servers:
  - id: production
    protocol: wss
    host: api.minimax.io
    bindings: []
    variables: []
address: /ws/v1/t2a_v2_bidi
parameters: []
bindings: []
operations:
  - &ref_3
    id: sendMessage
    title: Send message
    description: ''
    type: receive
    messages:
      - &ref_5
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
              - name: session_id
                type: string
                description: >-
                  Session id generated by the client to identify this synthesis
                  session. Optional; when omitted the server falls back to
                  `connect_id`. It is echoed back unchanged so the client can
                  correlate its own session context
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
              x-parser-schema-id: <anonymous-schema-7>
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
              x-parser-schema-id: <anonymous-schema-8>
            voice_setting:
              type: object
              required:
                - voice_id
              properties:
                voice_id:
                  type: string
                  description: "The ID of the target voice.  \r\n- To apply mixed voices, configure the `timbre_weights` parameter and leave this value empty.  \r\n- Supports system voices, cloned voices, and AI-generated voices. Below is a selection of the latest system voices (IDs). The full list of available voices can be viewed on the [System Voice ID List](/faq/system-voice-id) or retrieved programmatically using the [Get Voice API](/api-reference/voice-management-get).  \r\n  - Chinese:\r\n    - moss_audio_ce44fc67-7ce3-11f0-8de5-96e35d26fb85\r\n    - moss_audio_aaa1346a-7ce7-11f0-8e61-2e6e3c7ee85d\r\n    - Chinese (Mandarin)_Lyrical_Voice\r\n    - Chinese (Mandarin)_HK_Flight_Attendant\r\n\r\n  - English:\r\n    - English_Graceful_Lady\r\n    - English_Insightful_Speaker\r\n    - English_radiant_girl\r\n    - English_Persuasive_Man\r\n    - moss_audio_6dc281eb-713c-11f0-a447-9613c873494c\r\n    - moss_audio_570551b1-735c-11f0-b236-0adeeecad052\r\n    - moss_audio_ad5baf92-735f-11f0-8263-fe5a2fe98ec8\r\n    - English_Lucky_Robot\r\n\r\n  - Japanese:\r\n    - Japanese_Whisper_Belle\r\n    - moss_audio_24875c4a-7be4-11f0-9359-4e72c55db738\r\n    - moss_audio_7f4ee608-78ea-11f0-bb73-1e2a4cfcd245\r\n    - moss_audio_c1a6a3ac-7be6-11f0-8e8e-36b92fbb4f95"
                  x-parser-schema-id: <anonymous-schema-9>
                speed:
                  type: number
                  format: float
                  description: |-
                    Speech speed. Higher values result in faster speech.
                    Range: `[0.5, 2]` (default: 1.0).
                  minimum: 0.5
                  maximum: 2
                  default: 1
                  x-parser-schema-id: <anonymous-schema-10>
                vol:
                  type: number
                  format: float
                  description: |-
                    Speech volume. Higher values increase loudness.
                    Range: `(0, 10]` (default: `1.0`).
                  exclusiveMinimum: 0
                  maximum: 10
                  default: 1
                  x-parser-schema-id: <anonymous-schema-11>
                pitch:
                  type: integer
                  description: |-
                    Speech pitch adjustment.
                    Range: `[-12, 12]` (default: `0`, original pitch).
                  minimum: -12
                  maximum: 12
                  default: 0
                  x-parser-schema-id: <anonymous-schema-12>
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
                  x-parser-schema-id: <anonymous-schema-13>
                english_normalization:
                  type: boolean
                  description: >-
                    Enable text normalization in English. Improves performance
                    in digit-reading scenarios at the cost of slightly higher
                    latency. Default: `false`.
                  x-parser-schema-id: <anonymous-schema-14>
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
                  x-parser-schema-id: <anonymous-schema-15>
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
                  x-parser-schema-id: <anonymous-schema-16>
                bitrate:
                  type: integer
                  description: >-
                    Specifies the bitrate of the generated audio. Supported
                    values: `[32000, 64000, 128000, 256000]`. Default is
                    `128000`.

                    *Note: This parameter only applies to audio in `mp3`
                    format.*
                  x-parser-schema-id: <anonymous-schema-17>
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
                  x-parser-schema-id: <anonymous-schema-18>
                channel:
                  type: integer
                  description: >-
                    Specifies the number of audio channels. Supported values:
                    `[1, 2]`.  `1` = mono, `2` = stereo. Default is `1`.
                  x-parser-schema-id: <anonymous-schema-19>
              x-parser-schema-id: AudioSetting
            pronunciation_dict:
              type: object
              properties:
                tone:
                  type: array
                  items:
                    type: string
                    x-parser-schema-id: <anonymous-schema-21>
                  description: >-
                    Defines pronunciation rules for specific characters or
                    symbols.

                    For Chinese text, tones are represented numerically:  1 =
                    first tone, 2 = second tone, 3 = third tone, 4 = fourth
                    tone, 5 = neutral tone.

                    Example: `["omg/oh my god"]`
                  x-parser-schema-id: <anonymous-schema-20>
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
                  x-parser-schema-id: <anonymous-schema-22>
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
                  x-parser-schema-id: <anonymous-schema-23>
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
              x-parser-schema-id: <anonymous-schema-24>
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
                  x-parser-schema-id: <anonymous-schema-25>
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
                  x-parser-schema-id: <anonymous-schema-26>
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
                  x-parser-schema-id: <anonymous-schema-27>
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
                  x-parser-schema-id: <anonymous-schema-28>
              x-parser-schema-id: VoiceModify
            subtitle_enable:
              type: boolean
              description: >-
                Controls whether subtitles are enabled. Default is `false`.
                Available for models: `speech-2.8-hd`, `speech-2.8-turbo`,
                `speech-2.6-hd`, `speech-2.6-turbo`, `speech-02-hd`,
                `speech-02-turbo`, `speech-01-hd`, `speech-01-turbo`.
              default: false
              x-parser-schema-id: <anonymous-schema-29>
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
              x-parser-schema-id: <anonymous-schema-30>
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
              x-parser-schema-id: <anonymous-schema-31>
            session_id:
              type: string
              description: >-
                Session id generated by the client to identify this synthesis
                session. Optional; when omitted the server falls back to
                `connect_id`. It is echoed back unchanged so the client can
                correlate its own session context
              x-parser-schema-id: <anonymous-schema-32>
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
            },
            "session_id": "my-session-001"
          }
        bindings: []
        extensions:
          - id: x-parser-unique-object-id
            value: send_task_start
      - &ref_6
        id: send_task_continue
        contentType: application/json
        payload:
          - name: Task Continue Event
            description: >-
              After receiving the `task_started` event from the server, the task
              officially begins and you can send `task_continue` events carrying
              the text to synthesize.


              Key difference from `/ws/v1/t2a_v2`: **text is not synthesized one
              message at a time**. It enters a server-side sentence buffer and
              is only sent for synthesis once it forms a sentence, so it is safe
              to send text character by character (or token by token):

              - flushed immediately on sentence-ending punctuation (`。！？…；!?.`
              and newline)

              - flushed on secondary punctuation (`，、：,;:`) once the buffered
              segment is long enough

              - force-split when the buffer reaches its length limit

              - after you stop sending for a short while, the leftover buffer is
              flushed automatically


              Whitespace-only text is discarded silently and returns no error.

              If no new event is sent within 120s after the last server
              response, the WebSocket connection closes automatically.
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
                  Text to synthesize, limited to fewer than 10,000 characters.


                  **May be sent at any granularity** (including a single
                  character) — the server handles sentence buffering, so the
                  client does not need to detect sentence boundaries itself.


                  - Use newline characters to mark paragraph breaks

                  - Pause control: insert `<#x#>` where `x` is the pause length
                  in seconds, range **[0.01, 99.99]** with at most two decimals.
                  A pause marker must sit between two pronounceable pieces of
                  text; consecutive markers are not allowed

                  - Paralinguistic tags: only supported when the model is
                  `speech-2.8-hd` or `speech-2.8-turbo`. Supported tags:
                  `(laughs)`, `(chuckle)`, `(coughs)`, `(clear-throat)`,
                  `(groans)`, `(breath)`, `(pant)`, `(inhale)`, `(exhale)`,
                  `(gasps)`, `(sniffs)`, `(sighs)`, `(snorts)`, `(burps)`,
                  `(lip-smacking)`, `(humming)`, `(hissing)`, `(emm)`,
                  `(sneezes)`
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
              x-parser-schema-id: <anonymous-schema-39>
            text:
              type: string
              description: >-
                Text to synthesize, limited to fewer than 10,000 characters.


                **May be sent at any granularity** (including a single
                character) — the server handles sentence buffering, so the
                client does not need to detect sentence boundaries itself.


                - Use newline characters to mark paragraph breaks

                - Pause control: insert `<#x#>` where `x` is the pause length in
                seconds, range **[0.01, 99.99]** with at most two decimals. A
                pause marker must sit between two pronounceable pieces of text;
                consecutive markers are not allowed

                - Paralinguistic tags: only supported when the model is
                `speech-2.8-hd` or `speech-2.8-turbo`. Supported tags:
                `(laughs)`, `(chuckle)`, `(coughs)`, `(clear-throat)`,
                `(groans)`, `(breath)`, `(pant)`, `(inhale)`, `(exhale)`,
                `(gasps)`, `(sniffs)`, `(sighs)`, `(snorts)`, `(burps)`,
                `(lip-smacking)`, `(humming)`, `(hissing)`, `(emm)`, `(sneezes)`
              x-parser-schema-id: <anonymous-schema-40>
          x-parser-schema-id: SendTaskContinueEvent
        title: Task Continue Event
        description: >-
          After receiving the `task_started` event from the server, the task
          officially begins and you can send `task_continue` events carrying the
          text to synthesize.


          Key difference from `/ws/v1/t2a_v2`: **text is not synthesized one
          message at a time**. It enters a server-side sentence buffer and is
          only sent for synthesis once it forms a sentence, so it is safe to
          send text character by character (or token by token):

          - flushed immediately on sentence-ending punctuation (`。！？…；!?.` and
          newline)

          - flushed on secondary punctuation (`，、：,;:`) once the buffered
          segment is long enough

          - force-split when the buffer reaches its length limit

          - after you stop sending for a short while, the leftover buffer is
          flushed automatically


          Whitespace-only text is discarded silently and returns no error.

          If no new event is sent within 120s after the last server response,
          the WebSocket connection closes automatically.
        example: |-
          {
            "event": "task_continue",
            "text": "Omg(sighs), the real danger is not that computers start thinking like people, but that people start thinking like computers. Computers can only help us with simple tasks."
          }
        bindings: []
        extensions:
          - id: x-parser-unique-object-id
            value: send_task_continue
      - &ref_7
        id: send_task_cancel
        contentType: application/json
        payload:
          - name: Cancel Synthesis Event
            description: >-
              Send `task_cancel` to interrupt synthesis immediately: the server
              discards any text still in the sentence buffer, aborts the
              in-flight synthesis, and replies with `task_canceled`.


              Audio already delivered to the client is not revoked.


              After cancelling, the session returns to the `task_started` state
              and **you may keep sending `task_continue`** without reconnecting.
              This is intended for barge-in during real-time conversation.
            type: object
            properties:
              - name: event
                type: string
                description: Event type for this step; must be `task_cancel`
                enumValues:
                  - task_cancel
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
                - task_cancel
              default:
                - task_cancel
              description: Event type for this step; must be `task_cancel`
              x-parser-schema-id: <anonymous-schema-75>
          x-parser-schema-id: SendTaskCancelEvent
        title: Cancel Synthesis Event
        description: >-
          Send `task_cancel` to interrupt synthesis immediately: the server
          discards any text still in the sentence buffer, aborts the in-flight
          synthesis, and replies with `task_canceled`.


          Audio already delivered to the client is not revoked.


          After cancelling, the session returns to the `task_started` state and
          **you may keep sending `task_continue`** without reconnecting. This is
          intended for barge-in during real-time conversation.
        example: |-
          {
            "event": "task_cancel"
          }
        bindings: []
        extensions:
          - id: x-parser-unique-object-id
            value: send_task_cancel
      - &ref_8
        id: send_task_flush
        contentType: application/json
        payload:
          - name: Flush pending text (without ending the session)
            description: >-
              Send `task_flush` to make the server synthesize whatever text is
              still buffered, **without ending the session or closing the
              connection**. `task_flushed` is returned once that audio has been
              sent.


              Use it when a turn is over but its last piece of text is short and
              unpunctuated. Such a remainder is not flushed by the short silence
              window (that would risk cutting mid-word), so it otherwise waits
              for a longer backstop window. `task_flush` gets that audio out
              immediately.


              Difference from `task_finish`: `task_finish` closes the
              connection, so it cannot be used to flush one turn's tail when you
              run multiple turns over a single connection. After `task_flush`
              the session stays in `task_started` and you may keep sending
              `task_continue`.


              If the buffer happens to be empty, `task_flushed` is still
              returned normally; that is not an error.
            type: object
            properties:
              - name: event
                type: string
                description: The session event type; use `task_flush` for this step
                enumValues:
                  - task_flush
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
                - task_flush
              default:
                - task_flush
              description: The session event type; use `task_flush` for this step
              x-parser-schema-id: <anonymous-schema-59>
          x-parser-schema-id: SendTaskFlushEvent
        title: Flush pending text (without ending the session)
        description: >-
          Send `task_flush` to make the server synthesize whatever text is still
          buffered, **without ending the session or closing the connection**.
          `task_flushed` is returned once that audio has been sent.


          Use it when a turn is over but its last piece of text is short and
          unpunctuated. Such a remainder is not flushed by the short silence
          window (that would risk cutting mid-word), so it otherwise waits for a
          longer backstop window. `task_flush` gets that audio out immediately.


          Difference from `task_finish`: `task_finish` closes the connection, so
          it cannot be used to flush one turn's tail when you run multiple turns
          over a single connection. After `task_flush` the session stays in
          `task_started` and you may keep sending `task_continue`.


          If the buffer happens to be empty, `task_flushed` is still returned
          normally; that is not an error.
        example: |-
          {
            "event": "task_flush"
          }
        bindings: []
        extensions:
          - id: x-parser-unique-object-id
            value: send_task_flush
      - &ref_9
        id: send_task_finish
        contentType: application/json
        payload:
          - name: Task Finish Event
            description: >-
              On receiving `task_finish`, the server first flushes any text
              still sitting in the sentence buffer, waits until all of that
              audio has been returned, and only then replies with
              `task_finished` and closes the connection.


              As a result **a trailing incomplete sentence is never dropped**,
              and the client does not need to append punctuation before
              finishing.
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
              x-parser-schema-id: <anonymous-schema-64>
          x-parser-schema-id: SendTaskFinishEvent
        title: Task Finish Event
        description: >-
          On receiving `task_finish`, the server first flushes any text still
          sitting in the sentence buffer, waits until all of that audio has been
          returned, and only then replies with `task_finished` and closes the
          connection.


          As a result **a trailing incomplete sentence is never dropped**, and
          the client does not need to append punctuation before finishing.
        example: |-
          {
            "event": "task_finish"
          }
        bindings: []
        extensions:
          - id: x-parser-unique-object-id
            value: send_task_finish
    bindings: []
    extensions: &ref_2
      - id: x-parser-unique-object-id
        value: t2a_v2_bidi_websocket
  - &ref_4
    id: receiveMessage
    title: Receive message
    description: ''
    type: send
    messages:
      - &ref_10
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
              - name: connect_id
                type: string
                description: >-
                  Id of the current WebSocket connection. Distinct from
                  `session_id`: one connection has one `connect_id`, while
                  `session_id` identifies a synthesis session inside that
                  connection
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
            base_resp: &ref_0
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
            connect_id:
              type: string
              description: >-
                Id of the current WebSocket connection. Distinct from
                `session_id`: one connection has one `connect_id`, while
                `session_id` identifies a synthesis session inside that
                connection
              x-parser-schema-id: <anonymous-schema-6>
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
            },
            "connect_id": "301871346491491"
          }
        bindings: []
        extensions:
          - id: x-parser-unique-object-id
            value: receive_connected_success
      - &ref_11
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
              - name: connect_id
                type: string
                description: >-
                  Id of the current WebSocket connection. Distinct from
                  `session_id`: one connection has one `connect_id`, while
                  `session_id` identifies a synthesis session inside that
                  connection
                required: false
        headers: []
        jsonPayloadSchema:
          type: object
          properties:
            session_id:
              type: string
              description: The id of the entire session.
              x-parser-schema-id: <anonymous-schema-33>
            event:
              type: string
              const: >-
                The type of session event. For this step, a successful response
                returns `task_started`.
              x-parser-schema-id: <anonymous-schema-34>
            trace_id:
              type: string
              description: >-
                The ID of a single request within the session, useful for
                troubleshooting or feedback.
              x-parser-schema-id: <anonymous-schema-35>
            base_resp: &ref_1
              type: object
              properties:
                status_code:
                  type: integer
                  description: >-
                    - 0: success

                    - 2202: illegal event

                    For more information, please refer to the [Error Code
                    Reference](/api-reference/errorcode).
                  x-parser-schema-id: <anonymous-schema-36>
                status_msg:
                  type: string
                  description: Detailed status message.
                  x-parser-schema-id: <anonymous-schema-37>
              x-parser-schema-id: TaskStartFinishBaseResp
            connect_id:
              type: string
              description: >-
                Id of the current WebSocket connection. Distinct from
                `session_id`: one connection has one `connect_id`, while
                `session_id` identifies a synthesis session inside that
                connection
              x-parser-schema-id: <anonymous-schema-38>
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
            },
            "connect_id": "301871346491491"
          }
        bindings: []
        extensions:
          - id: x-parser-unique-object-id
            value: receive_task_started
      - &ref_12
        id: receive_sentence_start
        contentType: application/json
        payload:
          - name: Sentence Start Event
            description: >-
              Returned when the server has buffered a complete sentence and
              starts synthesizing it. The audio for that sentence then arrives
              in chunks via `task_continued` until `sentence_end`.


              Use it to count how many sentences the server actually grouped the
              text into
            type: object
            properties:
              - name: session_id
                type: string
                description: The id of the entire session.
                required: false
              - name: connect_id
                type: string
                description: >-
                  Id of the current WebSocket connection. Distinct from
                  `session_id`: one connection has one `connect_id`, while
                  `session_id` identifies a synthesis session inside that
                  connection
                required: false
              - name: event
                type: string
                description: >-
                  Event type returned when a buffered sentence starts
                  synthesizing: `sentence_start`
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
              description: The id of the entire session.
              x-parser-schema-id: <anonymous-schema-80>
            connect_id:
              type: string
              description: >-
                Id of the current WebSocket connection. Distinct from
                `session_id`: one connection has one `connect_id`, while
                `session_id` identifies a synthesis session inside that
                connection
              x-parser-schema-id: <anonymous-schema-81>
            event:
              type: string
              const: sentence_start
              description: >-
                Event type returned when a buffered sentence starts
                synthesizing: `sentence_start`
              x-parser-schema-id: <anonymous-schema-82>
            trace_id:
              type: string
              description: >-
                The ID of a single request within the session, useful for
                troubleshooting or feedback.
              x-parser-schema-id: <anonymous-schema-83>
            base_resp: *ref_0
          x-parser-schema-id: ReceiveSentenceStartEvent
        title: Sentence Start Event
        description: >-
          Returned when the server has buffered a complete sentence and starts
          synthesizing it. The audio for that sentence then arrives in chunks
          via `task_continued` until `sentence_end`.


          Use it to count how many sentences the server actually grouped the
          text into
        example: |-
          {
            "session_id": "my-session-001",
            "connect_id": "301871346491491",
            "event": "sentence_start",
            "trace_id": "0303a2882bf18235ae7a809ae0f3cca7",
            "base_resp": {
              "status_code": 0,
              "status_msg": "success"
            }
          }
        bindings: []
        extensions:
          - id: x-parser-unique-object-id
            value: receive_sentence_start
      - &ref_13
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
                      Status code

                      - 0: success

                      - 1000: unknown error

                      - 1001: timeout

                      - 1002: rate limited

                      - 1004: authentication failed

                      - 1039: TPM rate limited

                      - 1042: invalid characters exceed 10%

                      - 2013: invalid input parameters

                      - 2201: connection closed because it was idle for too long
                      (see the Keeping the connection alive section)

                      - 2202: invalid event

                      - 2204: a single `task_continue` text exceeded 10,000
                      characters and was skipped; the connection and session
                      stay open

                      - 2205: too much text is queued for synthesis (you are
                      sending faster than synthesis can keep up). **This is not
                      a quota rate limit**: the connection and session stay
                      open, so just resend that `task_continue` a moment later.
                      Do not reconnect or send `task_start` again

                      - 2206: illegal event order (for example sending
                      `task_start` again after the task already started)


                      Note: this API discards whitespace-only text silently and
                      never returns `2203`.

                      See the [error code list](/api-reference/errorcode) for
                      details
                    required: false
                  - name: status_msg
                    type: string
                    description: Detailed status message.
                    required: false
              - name: connect_id
                type: string
                description: >-
                  Id of the current WebSocket connection. Distinct from
                  `session_id`: one connection has one `connect_id`, while
                  `session_id` identifies a synthesis session inside that
                  connection
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
                  x-parser-schema-id: <anonymous-schema-42>
              x-parser-schema-id: <anonymous-schema-41>
            trace_id:
              type: string
              description: >-
                ID of the individual request within the session, useful for
                troubleshooting or feedback.
              x-parser-schema-id: <anonymous-schema-43>
            session_id:
              type: string
              description: ID of the entire session.
              x-parser-schema-id: <anonymous-schema-44>
            event:
              type: string
              description: Session event type. On success, returns `"task_continued"`.
              x-parser-schema-id: <anonymous-schema-45>
            is_final:
              type: boolean
              description: Indicates whether this response is the final one.
              x-parser-schema-id: <anonymous-schema-46>
            extra_info:
              type: object
              description: Additional information.
              properties:
                audio_length:
                  type: integer
                  format: int64
                  description: Audio duration in milliseconds
                  x-parser-schema-id: <anonymous-schema-47>
                audio_sample_rate:
                  type: integer
                  format: int64
                  description: Audio sample rate
                  x-parser-schema-id: <anonymous-schema-48>
                audio_size:
                  type: integer
                  format: int64
                  description: Audio file size in bytes
                  x-parser-schema-id: <anonymous-schema-49>
                bitrate:
                  type: integer
                  format: int64
                  description: Audio bitrate
                  x-parser-schema-id: <anonymous-schema-50>
                audio_format:
                  type: string
                  description: 'Generated audio file format. Options: mp3/pcm/flac.'
                  x-parser-schema-id: <anonymous-schema-51>
                audio_channel:
                  type: integer
                  format: int64
                  description: 'Number of audio channels: 1 = mono, 2 = stereo.'
                  x-parser-schema-id: <anonymous-schema-52>
                invisible_character_ratio:
                  type: integer
                  format: float
                  description: >-
                    Ratio of illegal characters. If ≤ 10%, audio is generated
                    normally with the ratio returned. Above 10%, an error is
                    triggered.
                  x-parser-schema-id: <anonymous-schema-53>
                usage_characters:
                  type: integer
                  format: int64
                  description: Number of billing characters for this speech generation.
                  x-parser-schema-id: <anonymous-schema-54>
                word_count:
                  type: integer
                  format: int64
                  description: >-
                    Count of pronounced characters, including Chinese
                    characters, digits, and letters (punctuation excluded).
                  x-parser-schema-id: <anonymous-schema-55>
              x-parser-schema-id: ExtraInfo
            base_resp:
              type: object
              properties:
                status_code:
                  type: integer
                  description: >-
                    Status code

                    - 0: success

                    - 1000: unknown error

                    - 1001: timeout

                    - 1002: rate limited

                    - 1004: authentication failed

                    - 1039: TPM rate limited

                    - 1042: invalid characters exceed 10%

                    - 2013: invalid input parameters

                    - 2201: connection closed because it was idle for too long
                    (see the Keeping the connection alive section)

                    - 2202: invalid event

                    - 2204: a single `task_continue` text exceeded 10,000
                    characters and was skipped; the connection and session stay
                    open

                    - 2205: too much text is queued for synthesis (you are
                    sending faster than synthesis can keep up). **This is not a
                    quota rate limit**: the connection and session stay open, so
                    just resend that `task_continue` a moment later. Do not
                    reconnect or send `task_start` again

                    - 2206: illegal event order (for example sending
                    `task_start` again after the task already started)


                    Note: this API discards whitespace-only text silently and
                    never returns `2203`.

                    See the [error code list](/api-reference/errorcode) for
                    details
                  x-parser-schema-id: <anonymous-schema-56>
                status_msg:
                  type: string
                  description: Detailed status message.
                  x-parser-schema-id: <anonymous-schema-57>
              x-parser-schema-id: TaskContinueBaseResp
            connect_id:
              type: string
              description: >-
                Id of the current WebSocket connection. Distinct from
                `session_id`: one connection has one `connect_id`, while
                `session_id` identifies a synthesis session inside that
                connection
              x-parser-schema-id: <anonymous-schema-58>
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
            },
            "connect_id": "301871346491491"
          }
        bindings: []
        extensions:
          - id: x-parser-unique-object-id
            value: receive_task_continued
      - &ref_14
        id: receive_sentence_end
        contentType: application/json
        payload:
          - name: Sentence End Event
            description: >-
              Returned when all audio for the current sentence has been
              delivered.


              Note the three levels of completion: `is_final` marks the end of
              audio for one request, `sentence_end` marks the end of the current
              sentence, and `task_finished` marks the end of the whole session
            type: object
            properties:
              - name: session_id
                type: string
                description: The id of the entire session.
                required: false
              - name: connect_id
                type: string
                description: >-
                  Id of the current WebSocket connection. Distinct from
                  `session_id`: one connection has one `connect_id`, while
                  `session_id` identifies a synthesis session inside that
                  connection
                required: false
              - name: event
                type: string
                description: >-
                  Event type returned when a sentence finishes synthesizing:
                  `sentence_end`
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
              description: The id of the entire session.
              x-parser-schema-id: <anonymous-schema-84>
            connect_id:
              type: string
              description: >-
                Id of the current WebSocket connection. Distinct from
                `session_id`: one connection has one `connect_id`, while
                `session_id` identifies a synthesis session inside that
                connection
              x-parser-schema-id: <anonymous-schema-85>
            event:
              type: string
              const: sentence_end
              description: >-
                Event type returned when a sentence finishes synthesizing:
                `sentence_end`
              x-parser-schema-id: <anonymous-schema-86>
            trace_id:
              type: string
              description: >-
                The ID of a single request within the session, useful for
                troubleshooting or feedback.
              x-parser-schema-id: <anonymous-schema-87>
            base_resp: *ref_0
          x-parser-schema-id: ReceiveSentenceEndEvent
        title: Sentence End Event
        description: >-
          Returned when all audio for the current sentence has been delivered.


          Note the three levels of completion: `is_final` marks the end of audio
          for one request, `sentence_end` marks the end of the current sentence,
          and `task_finished` marks the end of the whole session
        example: |-
          {
            "session_id": "my-session-001",
            "connect_id": "301871346491491",
            "event": "sentence_end",
            "trace_id": "0303a2882bf18235ae7a809ae0f3cca7",
            "base_resp": {
              "status_code": 0,
              "status_msg": "success"
            }
          }
        bindings: []
        extensions:
          - id: x-parser-unique-object-id
            value: receive_sentence_end
      - &ref_15
        id: receive_task_canceled
        contentType: application/json
        payload:
          - name: Cancelled Event
            description: >-
              The server returns `task_canceled` to confirm the interruption
              took effect. You may continue sending `task_continue` afterwards
            type: object
            properties:
              - name: session_id
                type: string
                description: The id of the entire session.
                required: false
              - name: connect_id
                type: string
                description: >-
                  Id of the current WebSocket connection. Distinct from
                  `session_id`: one connection has one `connect_id`, while
                  `session_id` identifies a synthesis session inside that
                  connection
                required: false
              - name: event
                type: string
                description: >-
                  Event type returned once the cancellation takes effect:
                  `task_canceled`
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
              description: The id of the entire session.
              x-parser-schema-id: <anonymous-schema-76>
            connect_id:
              type: string
              description: >-
                Id of the current WebSocket connection. Distinct from
                `session_id`: one connection has one `connect_id`, while
                `session_id` identifies a synthesis session inside that
                connection
              x-parser-schema-id: <anonymous-schema-77>
            event:
              type: string
              const: task_canceled
              description: >-
                Event type returned once the cancellation takes effect:
                `task_canceled`
              x-parser-schema-id: <anonymous-schema-78>
            trace_id:
              type: string
              description: >-
                The ID of a single request within the session, useful for
                troubleshooting or feedback.
              x-parser-schema-id: <anonymous-schema-79>
            base_resp: *ref_0
          x-parser-schema-id: ReceiveTaskCanceledEvent
        title: Cancelled Event
        description: >-
          The server returns `task_canceled` to confirm the interruption took
          effect. You may continue sending `task_continue` afterwards
        example: |-
          {
            "session_id": "my-session-001",
            "connect_id": "301871346491491",
            "event": "task_canceled",
            "trace_id": "0303a2882bf18235ae7a809ae0f3cca7",
            "base_resp": {
              "status_code": 0,
              "status_msg": "success"
            }
          }
        bindings: []
        extensions:
          - id: x-parser-unique-object-id
            value: receive_task_canceled
      - &ref_16
        id: receive_task_flushed
        contentType: application/json
        payload:
          - name: Pending text flushed
            description: >-
              The server returns `task_flushed` to indicate that all audio for
              this `task_flush` has been sent. It is ordered after the audio
              frames produced by the flush, so receiving it means this turn's
              audio is complete. You may keep sending `task_continue`
              afterwards.
            type: object
            properties:
              - name: session_id
                type: string
                description: The id of the whole session
                required: false
              - name: connect_id
                type: string
                description: >-
                  The id of the current WebSocket connection. Unlike
                  `session_id`, there is one `connect_id` per connection while
                  `session_id` identifies the synthesis session inside it
                required: false
              - name: event
                type: string
                description: >-
                  The session event type; `task_flushed` is returned once the
                  pending text has been flushed
                required: false
              - name: trace_id
                type: string
                description: >-
                  The id of a single request within the session, useful when
                  reporting issues
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
              description: The id of the whole session
              x-parser-schema-id: <anonymous-schema-60>
            connect_id:
              type: string
              description: >-
                The id of the current WebSocket connection. Unlike `session_id`,
                there is one `connect_id` per connection while `session_id`
                identifies the synthesis session inside it
              x-parser-schema-id: <anonymous-schema-61>
            event:
              type: string
              const: task_flushed
              description: >-
                The session event type; `task_flushed` is returned once the
                pending text has been flushed
              x-parser-schema-id: <anonymous-schema-62>
            trace_id:
              type: string
              description: >-
                The id of a single request within the session, useful when
                reporting issues
              x-parser-schema-id: <anonymous-schema-63>
            base_resp: *ref_0
          x-parser-schema-id: ReceiveTaskFlushedEvent
        title: Pending text flushed
        description: >-
          The server returns `task_flushed` to indicate that all audio for this
          `task_flush` has been sent. It is ordered after the audio frames
          produced by the flush, so receiving it means this turn's audio is
          complete. You may keep sending `task_continue` afterwards.
        example: |-
          {
            "session_id": "my-session-001",
            "connect_id": "301871346491491",
            "event": "task_flushed",
            "trace_id": "0303a2882bf18235ae7a809ae0f3cca7",
            "base_resp": {
              "status_code": 0,
              "status_msg": "success"
            }
          }
        bindings: []
        extensions:
          - id: x-parser-unique-object-id
            value: receive_task_flushed
      - &ref_17
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
              - name: connect_id
                type: string
                description: >-
                  Id of the current WebSocket connection. Distinct from
                  `session_id`: one connection has one `connect_id`, while
                  `session_id` identifies a synthesis session inside that
                  connection
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
              x-parser-schema-id: <anonymous-schema-65>
            session_id:
              type: string
              description: ID of the entire session.
              x-parser-schema-id: <anonymous-schema-66>
            event:
              type: string
              description: Session event type. On success, returns `"task_finished"`.
              x-parser-schema-id: <anonymous-schema-67>
            base_resp: *ref_1
            connect_id:
              type: string
              description: >-
                Id of the current WebSocket connection. Distinct from
                `session_id`: one connection has one `connect_id`, while
                `session_id` identifies a synthesis session inside that
                connection
              x-parser-schema-id: <anonymous-schema-68>
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
            },
            "connect_id": "301871346491491"
          }
        bindings: []
        extensions:
          - id: x-parser-unique-object-id
            value: receive_task_finished
      - &ref_18
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

                      - `2201`: Connection closed because it was idle for too
                      long (see the Keeping the connection alive section)

                      For more codes, see [Error
                      Codes](/api-reference/errorcode).
                    required: false
                  - name: status_msg
                    type: string
                    description: Detailed status message.
                    required: false
              - name: connect_id
                type: string
                description: >-
                  Id of the current WebSocket connection. Distinct from
                  `session_id`: one connection has one `connect_id`, while
                  `session_id` identifies a synthesis session inside that
                  connection
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
              x-parser-schema-id: <anonymous-schema-69>
            session_id:
              type: string
              description: ID of the entire session.
              x-parser-schema-id: <anonymous-schema-70>
            event:
              type: string
              description: Session event type. On success, returns `"task_finished"`.
              x-parser-schema-id: <anonymous-schema-71>
            base_resp:
              type: object
              properties:
                status_code:
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

                    - `2201`: Connection closed because it was idle for too long
                    (see the Keeping the connection alive section)

                    For more codes, see [Error Codes](/api-reference/errorcode).
                  x-parser-schema-id: <anonymous-schema-72>
                status_msg:
                  type: string
                  description: Detailed status message.
                  x-parser-schema-id: <anonymous-schema-73>
              x-parser-schema-id: TaskFailedBaseResp
            connect_id:
              type: string
              description: >-
                Id of the current WebSocket connection. Distinct from
                `session_id`: one connection has one `connect_id`, while
                `session_id` identifies a synthesis session inside that
                connection
              x-parser-schema-id: <anonymous-schema-74>
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
            },
            "connect_id": "301871346491491"
          }
        bindings: []
        extensions:
          - id: x-parser-unique-object-id
            value: receive_task_failed
    bindings: []
    extensions: *ref_2
sendOperations:
  - *ref_3
receiveOperations:
  - *ref_4
sendMessages:
  - *ref_5
  - *ref_6
  - *ref_7
  - *ref_8
  - *ref_9
receiveMessages:
  - *ref_10
  - *ref_11
  - *ref_12
  - *ref_13
  - *ref_14
  - *ref_15
  - *ref_16
  - *ref_17
  - *ref_18
extensions:
  - id: x-parser-unique-object-id
    value: t2a_v2_bidi_websocket
securitySchemes: []

````