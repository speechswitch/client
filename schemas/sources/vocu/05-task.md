# Get the details of an asynchronous generation task by ID

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /api/tts/generate/{id}:
    get:
      summary: Get the details of an asynchronous generation task by ID
      deprecated: false
      description: >-
        Polls a job created by `POST /api/tts/generate`. The terminal values of
        `status` are `generated` (success) and `failed`; `pending` (waiting) and
        `processing` (synthesising) are intermediate. **The audio URL is only
        usable once the status is `generated`.**


        Pace your polling yourself. May return `RATE_LIMIT_*` (HTTP 429). Read
        `Retry-After` and retry with exponential backoff. See the "Errors"
        document.


        Passing `stream=1` swaps the audio address for a play-while-downloading
        stream URL (with an auth query parameter), which is useful for starting
        playback as soon as the job enters `processing`.


        You can only read your own jobs; someone else's job and a deleted job
        both return `GENERATE_NOT_FOUND` (404), with no distinction between
        "missing" and "forbidden".


        :::info

        See the Errors document for the full code reference. Always use the
        `X-Vocu-App-Request-Id` response header when troubleshooting.

        :::
      tags:
        - Core/Voice Generation/Async jobs
        - Core/Voice Generation/Async jobs
      parameters:
        - name: id
          in: path
          description: Generation task ID
          required: true
          example: ''
          schema:
            type: string
        - name: stream
          in: query
          description: >-
            Returns the streaming response address for the asynchronous task if
            available
          required: false
          schema:
            type: boolean
            default: false
      responses:
        '200':
          x-apifox-name: Successfully retrieved asynchronous generation task details
          x-apifox-ordering: 0
          description: >-
            Job details; the audio URL is only valid once `status ===
            "generated"`
          content:
            application/json:
              schema:
                type: object
                properties:
                  status:
                    type: integer
                    description: Status code
                    examples:
                      - 200
                    x-apifox-mock: '@pick([''200''])'
                  message:
                    type: string
                    description: Status message
                    examples:
                      - OK
                    x-apifox-mock: OK
                  data:
                    description: Asynchronous generation task details
                    $ref: '#/components/schemas/Generate'
                x-apifox-orders:
                  - status
                  - message
                  - data
                x-apifox-ignore-properties: []
              example:
                status: 200
                message: OK
                data:
                  id: 71f2d625-b99c-4654-9d24-337e18b2e3fd
                  userId: 76609c5e-53b8-4f4f-8d5c-839b5644a910
                  status: generated
                  type: vocu-neural-voice-001
                  metadata:
                    contents:
                      - voiceId: 5d040784-cc81-4459-aa1d-6c2168ddb845
                        text: A simple banana pie. No fancy stuff. Just pie.
                        audio: >-
                          https://storage.vocu.ai/generate/d8dd76c1-41a9-44fb-925c-8757b3fdd514/2dbda2bb-5d7e-43f0-a3df-490d99ee2f32-25.mp3
                        generatedAt: '1946-10-23T17:07:23.749Z'
                        preset: balance
                        break_clone: true
                        language: auto
                        vivid: false
                        emo_switch:
                          - 0
                          - 0
                          - 0
                          - 0
                          - 0
                        speechRate: 1
                        flash: false
                        stream: false
                        seed: -1
                    characters: 71
                    voices:
                      - id: 3076236f-5997-4aa1-a3ad-a90299023072
                        name: Alvin Schulist
                        status: lora-success
                        metadata:
                          avatar: https://picsum.photos/seed/6Q4nigq/1090/1383
                          description: veteran
                          prompts:
                            - id: 67dde895-bf07-4d07-8b7b-8c13b4f9d794
                              name: thorough
                              promptOriginAudioStorageUrl: >-
                                https://storage.vocu.ai/prompt/549994/384128-playback-vwu5sw.mp3
                              playBackAudio: >-
                                https://storage.vocu.ai/prompt/833000/424373-playback-4qezbk.mp3
                              description: The "eminent" emotion style
                              language: auto
                              vocalFilter: true
                            - id: 304613bd-a7c1-4d5a-b628-2de5f390cf50
                              name: calculating
                              promptOriginAudioStorageUrl: >-
                                https://storage.vocu.ai/prompt/785269/972304-playback-mamvfw.mp3
                              playBackAudio: >-
                                https://storage.vocu.ai/prompt/250415/359866-playback-zweh13.mp3
                              description: The "ill-fated" emotion style
                              language: auto
                              vocalFilter: true
                        version: v3.0
                        from: upload
                    isPremium: false
                    audio: >-
                      https://storage.vocu.ai/generate/6b4a0f6e-20f1-4c0c-b981-bb8191ec9cc3/076d704c-5315-4fdd-be55-340af9468c9e-merged.mp3
                    generatedAt: '2001-04-01T13:27:08.841Z'
                    srt: false
          headers: {}
        '401':
          x-apifox-name: Unauthorized
          description: AUTH_UNAUTHORIZED
          content:
            application/json:
              schema: &ref_0
                $ref: '#/components/schemas/ErrorResponse'
              examples:
                AUTH_UNAUTHORIZED:
                  summary: AUTH_UNAUTHORIZED — Unauthorized.
                  value:
                    status: 401
                    code: AUTH_UNAUTHORIZED
                    message: Unauthorized.
          headers: {}
        '404':
          x-apifox-name: Not found
          description: GENERATE_NOT_FOUND
          content:
            application/json:
              schema: *ref_0
              examples:
                GENERATE_NOT_FOUND:
                  summary: GENERATE_NOT_FOUND — Generation record not found.
                  value:
                    status: 404
                    code: GENERATE_NOT_FOUND
                    message: Generation record not found.
          headers: {}
        '429':
          x-apifox-name: Rate limited
          description: RATE_LIMIT_EXCEEDED
          content:
            application/json:
              schema: *ref_0
              examples:
                RATE_LIMIT_EXCEEDED:
                  summary: >-
                    RATE_LIMIT_EXCEEDED — Too many requests, please try again
                    later.
                  value:
                    status: 429
                    code: RATE_LIMIT_EXCEEDED
                    message: Too many requests, please try again later.
                    requestId: 3f2504e0-4f89-41d3-9a0c-0305e82c3301
          headers: {}
      security:
        - bearer: []
      x-apifox-folder: Core/Voice Generation/Async jobs
      x-apifox-status: released
      x-run-in-apifox: https://app.apifox.com/web/project/5878926/apis/api-373800507-run
components:
  schemas:
    Generate:
      type: object
      description: Asynchronous Generation Task Details
      properties:
        id:
          type: string
          description: Asynchronous Task ID
          x-apifox-mock: '{{$string.uuid}}'
        userId:
          type: string
          description: User ID who created the task
          x-apifox-mock: '{{$string.uuid}}'
        status:
          type: string
          description: >-
            Asynchronous task status, can be pending / processing / generated /
            failed
          enum:
            - pending
            - processing
            - generated
            - failed
          x-apifox-enum:
            - value: pending
              name: pending
              description: Queued, waiting to be processed
            - value: processing
              name: processing
              description: Synthesising
            - value: generated
              name: generated
              description: Finished; audio is available
            - value: failed
              name: failed
              description: Synthesis failed
        type:
          type: string
          description: Model ID used by the task
          default: reecho-neural-voice-001
          enum:
            - reecho-neural-voice-001
          x-apifox-enum:
            - value: reecho-neural-voice-001
              name: reecho-neural-voice-001
              description: Standard speech-synthesis job
        metadata:
          type: object
          description: Task Metadata
          properties:
            contents:
              type: array
              description: List of content included in the task
              items:
                type: object
                description: Task Content Details
                properties:
                  type:
                    type: string
                    enum:
                      - text
                      - audio
                      - sfx
                      - music
                      - scene
                      - custom_audio
                      - stem_separation
                    x-apifox-enum:
                      - value: text
                        name: Text to speech
                        description: Text to speech
                      - value: audio
                        name: Voice conversion (upload input audio first)
                        description: Voice conversion (upload input audio first)
                      - value: sfx
                        name: Sound-effect generation
                        description: Sound-effect generation
                      - value: music
                        name: Music generation
                        description: Music generation
                      - value: scene
                        name: Scene-audio generation
                        description: Scene-audio generation
                      - value: custom_audio
                        name: User-supplied audio clip
                        description: User-supplied audio clip
                      - value: stem_separation
                        name: Vocal / accompaniment stem split
                        description: Vocal / accompaniment stem split
                    description: >-
                      Content block type. Determines which other keys in this
                      object are meaningful.


                      - `text` — Text to speech (requires `voiceId`), supports
                      SRT. Accepted keys: `type`, `voiceId`, `text`, `promptId`,
                      `language`, `emo_switch`, `vivid`, `break_clone`,
                      `preset`, `seed`, `speechRate`, `infinite_mode`,
                      `post_processing`, `gamble`, `interval`, `interval_head`,
                      `interval_tail`, `interval_range`, `instruct_mode`,
                      `reference_mode`

                      - `audio` — Voice conversion (requires `voiceId`),
                      supports SRT. Accepted keys: `type`, `voiceId`,
                      `promptId`, `input_audio`, `speechRate`, `vc_mode`,
                      `high_quality`, `keep_prosody`, `cover_mode`, `interval`,
                      `interval_head`, `interval_tail`, `interval_range`

                      - `sfx` — Sound-effect generation. Accepted keys: `type`,
                      `text`, `sfx_length`, `sfx_image`, `sfx_mode`, `interval`,
                      `interval_head`, `interval_tail`, `interval_range`

                      - `music` — Music generation. Accepted keys: `type`,
                      `text`, `music_duration`, `music_instrumental`,
                      `music_lyrics`, `music_reference_audio`,
                      `music_reference_voice`, `music_task_type`,
                      `music_src_audio`, `music_cover_strength`, `interval`,
                      `interval_head`, `interval_tail`, `interval_range`

                      - `scene` — Scene-audio generation. Accepted keys: `type`,
                      `text`, `language`, `mentions`, `enable_music`, `seed`,
                      `reference_mode`, `interval`, `interval_head`,
                      `interval_tail`, `interval_range`

                      - `custom_audio` — User-supplied audio clip. Accepted
                      keys: `type`, `input_audio`, `interval`, `interval_head`,
                      `interval_tail`, `interval_range`

                      - `stem_separation` — Vocal / accompaniment stem split.
                      Accepted keys: `type`, `input_audio`, `interval`,
                      `interval_head`, `interval_tail`, `interval_range`


                      **Keys outside a type's accepted list are silently dropped
                      — no error is raised.** If a parameter appears to have no
                      effect, check it against the list above first.


                      Omitting `type` falls back to legacy inference from the
                      other fields; new integrations should always set it
                      explicitly.
                  voiceId:
                    type: string
                    description: Voice Character ID
                    x-apifox-mock: '{{$string.uuid}}'
                  text:
                    type: string
                    description: Text content used for generation
                    x-apifox-mock: '{{$food.description}}'
                  audio:
                    type: string
                    description: Generated audio URL
                    x-apifox-mock: >-
                      https://storage.vocu.ai/generate/{{$string.uuid}}/{{$string.uuid}}-{{$helper.autoIncrementEnvVar}}.mp3
                  generatedAt:
                    type: string
                    format: date-time
                    description: Generation completion time
                  preset: &ref_1
                    type: string
                    description: Parameter preset, default is balance
                    enum:
                      - creative
                      - balance
                      - stable
                    x-apifox-enum:
                      - value: creative
                        name: Creative
                        description: The most expressive generation style
                      - value: balance
                        name: Balanced
                        description: A relatively balanced generation style
                      - value: stable
                        name: Stable
                        description: The most stable generation style
                    default: balance
                  break_clone: &ref_2
                    type: boolean
                    description: >-
                      Enable emotion style biased towards the text (default is
                      true. Filling this will override the corresponding value
                      in parameter presets)
                    default: true
                  language: &ref_3
                    type: string
                    enum:
                      - auto
                      - zh
                      - en-us
                      - ja
                      - ko
                      - fr-fr
                      - pt
                      - de
                      - es
                      - yue
                    x-apifox-enum:
                      - value: auto
                        name: Auto-detect (Cantonese is not detected)
                        description: Auto-detect (Cantonese is not detected)
                      - value: zh
                        name: Chinese
                        description: Chinese
                      - value: en-us
                        name: English
                        description: English
                      - value: ja
                        name: Japanese
                        description: Japanese
                      - value: ko
                        name: Korean
                        description: Korean
                      - value: fr-fr
                        name: French
                        description: French
                      - value: pt
                        name: Portuguese
                        description: Portuguese
                      - value: de
                        name: German
                        description: German
                      - value: es
                        name: Spanish
                        description: Spanish
                      - value: yue
                        name: Cantonese
                        description: Cantonese
                    default: auto
                    description: >-
                      Language to be generated (only supported by V3.0
                      characters, default is auto, but Cantonese auto-detection
                      is not supported)


                      Note: values must match the list exactly (`en-us`, not
                      `en`; `fr-fr`, not `fr`). **A value outside the list does
                      not raise an error — it is silently downgraded to
                      `auto`**, so do not rely on short codes.
                  vivid: &ref_4
                    type: boolean
                    default: false
                    description: >-
                      Vivid expression mode (only supported by V3.0 characters,
                      default is false)
                  emo_switch: &ref_5
                    type: array
                    items:
                      type: integer
                      minimum: 0
                      maximum: 10
                      default: 0
                      description: Emotion item intensity
                    minItems: 5
                    maxItems: 5
                    description: >-
                      Emotion control (only supported by V3.0 characters. Must
                      pass an array of 5 integers ranging from 0-10,
                      corresponding to [Anger, Happiness, Neutral, Sadness,
                      Contextual Match] from the 1st to 5th item, respectively.
                      E.g., [5, 0, 0, 2, 0] corresponds to a relatively angry
                      and somewhat sad emotion. Default is 0 for all items,
                      meaning automatically following the character sample
                      emotion)
                  speechRate: &ref_6
                    type: number
                    description: >-
                      Speech rate control (0.5-2.0, based on the resulting
                      duration. The larger the value, the slower the speech;
                      e.g., 2.0 will generate an audio result with 2 times the
                      duration. Default is 1.0)
                    minimum: 0.5
                    maximum: 2
                    default: 1
                  flash: &ref_7
                    type: boolean
                    description: Low latency mode (default is false)
                    default: false
                  stream: &ref_8
                    type: boolean
                    description: Enable streaming generation (default is false)
                    default: false
                  seed: &ref_9
                    type: integer
                    format: int32
                    default: -1
                    minimum: -1
                    maximum: 2147483647
                    description: >-
                      Generation seed, maximum is Int32, -1 or null means random
                      (default is -1)
                    nullable: true
                  input_audio:
                    type: string
                    format: uri
                    description: >-
                      URL of the source audio for voice conversion. Must be a
                      URL returned by `POST /api/tts/upload-audio` (or an
                      authorized host). Sending this field switches the call
                      into VC mode and silently clears TTS-only parameters.
                  vc_mode:
                    type: string
                    enum:
                      - standard
                      - similarity
                      - prosody
                      - cover
                    default: standard
                    x-apifox-enum:
                      - value: standard
                        name: Standard mode (default)
                        description: Standard mode (default)
                      - value: similarity
                        name: >-
                          Similarity-first (currently behaves the same as
                          `standard`)
                        description: >-
                          Similarity-first (currently behaves the same as
                          `standard`)
                      - value: prosody
                        name: Preserve source-audio prosody
                        description: Preserve source-audio prosody
                      - value: cover
                        name: Cover / singing mode
                        description: Cover / singing mode
                    description: >-
                      Voice-conversion mode. Only takes effect when
                      `input_audio` is set. `high_quality` is honoured only for
                      `standard` / `similarity`. `similarity` currently behaves
                      the same as `standard`. Legacy booleans `keep_prosody` /
                      `cover_mode` are normalised into this field.
                  high_quality:
                    type: boolean
                    description: >-
                      VC polish pass. Only takes effect for `standard` /
                      `similarity`; ignored for `prosody` / `cover`.
                x-apifox-orders:
                  - type
                  - voiceId
                  - text
                  - audio
                  - generatedAt
                  - 01K4JFW70FSA3PE7ERVJS8EQQJ
                  - input_audio
                  - vc_mode
                  - high_quality
                required:
                  - voiceId
                  - text
                x-apifox-refs:
                  01K4JFW70FSA3PE7ERVJS8EQQJ:
                    $ref: >-
                      #/components/schemas/General%20Generation%20Parameters%20(New)
                x-apifox-ignore-properties:
                  - preset
                  - break_clone
                  - language
                  - vivid
                  - emo_switch
                  - speechRate
                  - flash
                  - stream
                  - seed
            characters:
              type: integer
              description: Total characters generated by the task
            voices:
              type: array
              description: List of voice characters used by the task
              items:
                description: Voice Character Details
                $ref: '#/components/schemas/Voice'
            isPremium:
              type: boolean
              description: Whether the user is a paid user
            audio:
              type: string
              description: Final generated audio URL (if any)
              x-apifox-mock: >-
                https://storage.vocu.ai/generate/{{$string.uuid}}/{{$string.uuid}}-merged.mp3
            generatedAt:
              type: string
              format: date-time
              description: Time when the final result generation is complete (if any)
            srt:
              type: boolean
              default: false
              description: >-
                Whether subtitle generation is enabled (incompatible with V3.0
                and low-latency mode)
          x-apifox-orders:
            - contents
            - characters
            - voices
            - isPremium
            - audio
            - generatedAt
            - srt
          required:
            - contents
            - characters
            - voices
            - isPremium
            - srt
          x-apifox-ignore-properties: []
      x-apifox-orders:
        - id
        - userId
        - status
        - type
        - metadata
      required:
        - id
        - userId
        - status
        - type
        - metadata
      title: Generation Task
      x-apifox-folder: ''
      x-apifox-ignore-properties: []
    Voice:
      type: object
      description: Voice Character Details
      properties:
        id:
          type: string
          description: Voice Character ID
          x-apifox-mock: '{{$string.uuid}}'
        name:
          type: string
          description: Voice Character Name
          x-apifox-mock: '{{$person.fullName}}'
        status:
          type: string
          description: >-
            Voice Character Status, can be pending (instant clone completed),
            lora-pending (professional clone training in progress), lora-success
            (professional clone completed), lora-failed (professional clone
            failed)


            Only `lora-success`, `pending`, `lora-awaiting-auto-reupload` can be
            used for generation. `creating` returns 409 and `failed` returns
            400. The list endpoint hides `lora-pending` / `lora-failed` /
            `lora-awaiting` unless `show=full` is passed.
          enum:
            - creating
            - failed
            - pending
            - lora-success
            - lora-pending
            - lora-failed
            - lora-awaiting
            - lora-awaiting-auto-reupload
            - lora-need-reupload
          x-apifox-enum:
            - value: creating
              name: creating
              description: >-
                Creating. Generation against this voice returns 409
                VOICE_CREATING
            - value: failed
              name: failed
              description: >-
                Creation failed. Generation against this voice returns 400
                VOICE_CREATE_FAILED
            - value: pending
              name: pending
              description: Instant clone ready; can be used for generation
            - value: lora-success
              name: lora-success
              description: Professional clone ready; can be used for generation
            - value: lora-pending
              name: lora-pending
              description: >-
                Professional clone training. Hidden from the list unless
                show=full
            - value: lora-failed
              name: lora-failed
              description: Professional clone failed. Hidden from the list unless show=full
            - value: lora-awaiting
              name: lora-awaiting
              description: >-
                Queued for professional cloning. Hidden from the list unless
                show=full
            - value: lora-awaiting-auto-reupload
              name: lora-awaiting-auto-reupload
              description: >-
                Waiting for automatic material re-upload; can still be used for
                generation
            - value: lora-need-reupload
              name: lora-need-reupload
              description: Manual re-upload of training material is required
          x-apifox-mock: '@pick([''pending'',''lora-success''])'
        metadata:
          type: object
          description: Voice Character Metadata
          properties:
            avatar:
              type: string
              description: Voice Character Avatar URL
              x-apifox-mock: '{{$image.url}}'
            description:
              type: string
              description: Voice Character Description
              x-apifox-mock: '{{$person.bio}}'
            prompts:
              type: array
              description: Voice Character Style List
              items:
                type: object
                description: Voice Character Style Details
                properties:
                  id:
                    type: string
                    description: Character Style ID
                    x-apifox-mock: '{{$string.uuid}}'
                  name:
                    type: string
                    description: Character Style Name
                    x-apifox-mock: '{{$word.adjective}}'
                  promptOriginAudioStorageUrl:
                    type: string
                    description: Character Style Original Sample Audio URL
                    x-apifox-mock: >-
                      https://storage.vocu.ai/prompt/{{$string.numeric(length=6)}}/{{$string.numeric(length=6)}}-playback-{{$string.alphanumeric(length=6,casing='lower')}}.mp3
                  playBackAudio:
                    type: string
                    description: Character Style Processed Preview Audio URL
                    x-apifox-mock: >-
                      https://storage.vocu.ai/prompt/{{$string.numeric(length=6)}}/{{$string.numeric(length=6)}}-playback-{{$string.alphanumeric(length=6,casing='lower')}}.mp3
                  description:
                    type: string
                    x-apifox-mock: Emotion style of {{$word.adjective(length=2)}}
                    description: Character Style Description
                  language:
                    type: string
                    enum:
                      - auto
                      - zh
                      - en-us
                      - ja
                      - ja-asmr
                      - ko
                      - fr-fr
                      - es
                      - de
                      - yue
                      - pt
                    x-apifox-enum:
                      - value: auto
                        name: Auto-detect (Cantonese is not detected)
                        description: Auto-detect (Cantonese is not detected)
                      - value: zh
                        name: Chinese
                        description: Chinese
                      - value: en-us
                        name: English
                        description: English
                      - value: ja
                        name: Japanese
                        description: Japanese
                      - value: ja-asmr
                        name: >-
                          Japanese ASMR (voice creation only; illegal for
                          synthesis)
                        description: >-
                          Japanese ASMR (voice creation only; illegal for
                          synthesis)
                      - value: ko
                        name: Korean
                        description: Korean
                      - value: fr-fr
                        name: French
                        description: French
                      - value: es
                        name: Spanish
                        description: Spanish
                      - value: de
                        name: German
                        description: German
                      - value: yue
                        name: Cantonese
                        description: Cantonese
                      - value: pt
                        name: Portuguese
                        description: Portuguese
                    default: auto
                    description: >-
                      Language of the character style sample (only supported by
                      V3.0 characters, default is auto, but Cantonese
                      auto-detection is not supported)


                      Note: values must match the list exactly (`en-us`, not
                      `en`; `fr-fr`, not `fr`). **A value outside the list does
                      not raise an error — it is silently downgraded to
                      `auto`**, so do not rely on short codes.
                  vocalFilter:
                    type: boolean
                    default: true
                    description: >-
                      Whether the character style has enabled background sound
                      function other than isolated vocals
                x-apifox-orders:
                  - id
                  - name
                  - promptOriginAudioStorageUrl
                  - playBackAudio
                  - description
                  - language
                  - vocalFilter
                required:
                  - id
                  - name
                  - promptOriginAudioStorageUrl
                  - playBackAudio
                  - language
                x-apifox-ignore-properties: []
          x-apifox-orders:
            - avatar
            - description
            - prompts
          required:
            - prompts
          x-apifox-ignore-properties: []
        version:
          type: string
          enum:
            - v1.0
            - v2.0
            - v3.0
            - v4.0
          x-apifox-enum:
            - value: v1.0
              name: v1.0
              description: Legacy; new voices can no longer be created on this version
            - value: v2.0
              name: v2.0
              description: V2 series (V2.0 – V2.7)
            - value: v3.0
              name: v3.0
              description: V3 series
            - value: v4.0
              name: v4.0
              description: V4 series. Instruct-only generation
          description: Model version of the voice character
        from:
          type: string
          description: Source of the voice character
          enum:
            - upload
            - market
          x-apifox-enum:
            - value: upload
              name: ''
              description: Uploaded by user
            - value: market
              name: ''
              description: From the voice market
      x-apifox-orders:
        - id
        - name
        - status
        - metadata
        - version
        - from
      required:
        - id
        - name
        - status
        - metadata
        - version
        - from
      title: Voice Character
      x-apifox-folder: ''
      x-apifox-ignore-properties: []
    General Generation Parameters (New):
      type: object
      properties:
        preset: *ref_1
        break_clone: *ref_2
        language: *ref_3
        vivid: *ref_4
        emo_switch: *ref_5
        speechRate: *ref_6
        flash: *ref_7
        stream: *ref_8
        seed: *ref_9
      x-apifox-orders:
        - preset
        - break_clone
        - language
        - vivid
        - emo_switch
        - speechRate
        - flash
        - stream
        - seed
      x-apifox-folder: ''
      x-apifox-ignore-properties: []
    ErrorResponse:
      type: object
      required:
        - status
        - code
        - message
      properties:
        status:
          type: integer
          description: HTTP status code. Same as the HTTP status line.
        code:
          type: string
          description: Error code. Branch on this field; do not depend on `message`.
        message:
          type: string
          description: >-
            Error description localised to the request language. You can show it
            to the end user as-is.
        requestId:
          type: string
          format: uuid
          description: >-
            Request trace ID. Attached to some error responses. The response
            header that is always available is X-Vocu-App-Request-Id.
        traceId:
          type: string
          description: >-
            Trace id when content safety rejects the request. Returned only for
            some errors.
        decline:
          type: object
          description: Rejection details. Returned only for some errors.
          x-apifox-orders: []
          properties: {}
          x-apifox-ignore-properties: []
      x-apifox-orders:
        - status
        - code
        - message
        - requestId
        - traceId
        - decline
      x-apifox-ignore-properties: []
      x-apifox-folder: ''
  securitySchemes:
    bearer:
      type: http
      scheme: bearer
servers:
  - url: https://v1.vocu.studio
    description: 后端StudioAPI
security:
  - bearer: []

```
