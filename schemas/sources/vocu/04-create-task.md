# Create Asynchronous Voice Generation Task

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /api/tts/generate:
    post:
      summary: Create Asynchronous Voice Generation Task
      deprecated: false
      description: >-
        How this differs from `/api/tts/simple-generate`: this endpoint
        **returns the job as soon as it is submitted**, supports multi-segment
        `contents`, mixed content types and SRT subtitles, and **requires
        neither an API key nor a paid plan**. simple-generate is the
        single-segment synchronous path with much stricter admission.


        **Three mutually exclusive request shapes** — mixing them returns 400
        `VALIDATION_CONFLICT`:


        1. `contents` — an array of content blocks, each declaring its `type`
        (`text` / `audio` / `sfx` / `music` / `scene` / `custom_audio` /
        `stem_separation`)

        2. `text` + `splitter` — the server compiles them into `contents`; both
        must be supplied together

        3. `text` + `splitterId` — the same, but the split rules are loaded from
        a saved config; `splitterId` and `splitter` cannot both be sent


        **`sync` does not mean "wait for the audio"**: it only waits for the job
        to **reach `processing`**, for at most 90 seconds, then returns
        `STREAM_TIMEOUT` (note that this code maps to **400**, not 408). You
        still fetch the audio by polling `GET /api/tts/generate/{id}` until
        `status === 'generated'`.


        **Validation strictness is the opposite of simple-generate:** nearly
        every invalid value inside `contents` collapses into one 400
        `TTS_CONTENTS_INVALID` with no indication of which field was at fault —
        including a `language` outside the synthesis value list (**a hard error
        here, unlike the silent drop in simple-generate**), an `emo_switch` that
        is not exactly 5 values in 0–10, an out-of-range `mos_score` or
        `sfx_length`, and audio URLs not uploaded through this platform. Expect
        to bisect your payload when debugging.


        :::warning

        Each `type` has its own list of usable parameters, and **keys outside
        that list are silently dropped without an error** — see the description
        of the `contents[].type` request field for the exact lists.

        :::


        May return `RATE_LIMIT_*` (HTTP 429). Read `Retry-After` and retry with
        exponential backoff. See the "Errors" document. Paid accounts' jobs are
        processed with higher priority.


        Credits are **frozen** before submission rather than deducted, and
        unfrozen if the job fails. SRT subtitles are a paid feature: `srt: true`
        from a free account is silently forced to `false`.


        :::info

        See the Errors document for the full code reference. Always use the
        `X-Vocu-App-Request-Id` response header when troubleshooting.

        :::
      tags:
        - Core/Voice Generation/Async jobs
        - Core/Voice Generation/Async jobs
      parameters: []
      requestBody:
        content:
          application/json:
            schema:
              type: object
              required:
                - contents
              properties:
                contents:
                  type: array
                  description: List of contents to be generated
                  items:
                    type: object
                    required:
                      - voiceId
                      - text
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
                          Content block type. Determines which other keys in
                          this object are meaningful.


                          - `text` — Text to speech (requires `voiceId`),
                          supports SRT. Accepted keys: `type`, `voiceId`,
                          `text`, `promptId`, `language`, `emo_switch`, `vivid`,
                          `break_clone`, `preset`, `seed`, `speechRate`,
                          `infinite_mode`, `post_processing`, `gamble`,
                          `interval`, `interval_head`, `interval_tail`,
                          `interval_range`, `instruct_mode`, `reference_mode`

                          - `audio` — Voice conversion (requires `voiceId`),
                          supports SRT. Accepted keys: `type`, `voiceId`,
                          `promptId`, `input_audio`, `speechRate`, `vc_mode`,
                          `high_quality`, `keep_prosody`, `cover_mode`,
                          `interval`, `interval_head`, `interval_tail`,
                          `interval_range`

                          - `sfx` — Sound-effect generation. Accepted keys:
                          `type`, `text`, `sfx_length`, `sfx_image`, `sfx_mode`,
                          `interval`, `interval_head`, `interval_tail`,
                          `interval_range`

                          - `music` — Music generation. Accepted keys: `type`,
                          `text`, `music_duration`, `music_instrumental`,
                          `music_lyrics`, `music_reference_audio`,
                          `music_reference_voice`, `music_task_type`,
                          `music_src_audio`, `music_cover_strength`, `interval`,
                          `interval_head`, `interval_tail`, `interval_range`

                          - `scene` — Scene-audio generation. Accepted keys:
                          `type`, `text`, `language`, `mentions`,
                          `enable_music`, `seed`, `reference_mode`, `interval`,
                          `interval_head`, `interval_tail`, `interval_range`

                          - `custom_audio` — User-supplied audio clip. Accepted
                          keys: `type`, `input_audio`, `interval`,
                          `interval_head`, `interval_tail`, `interval_range`

                          - `stem_separation` — Vocal / accompaniment stem
                          split. Accepted keys: `type`, `input_audio`,
                          `interval`, `interval_head`, `interval_tail`,
                          `interval_range`


                          **Keys outside a type's accepted list are silently
                          dropped — no error is raised.** If a parameter appears
                          to have no effect, check it against the list above
                          first.


                          Omitting `type` falls back to legacy inference from
                          the other fields; new integrations should always set
                          it explicitly.
                      voiceId:
                        type: string
                        description: Voice Character ID
                        x-apifox-mock: '{{$string.uuid}}'
                      text:
                        type: string
                        description: Text content to be generated
                        x-apifox-mock: '{{$lorem.sentence(locale=''zh_CN'')}}'
                      promptId:
                        type: string
                        description: Style ID for the Voice Character (default is default)
                        default: default
                        x-apifox-mock: '{{$string.uuid}}'
                      preset:
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
                      break_clone:
                        type: boolean
                        description: >-
                          Enable emotion style biased towards the text (default
                          is true. Filling this will override the corresponding
                          value in parameter presets)
                        default: true
                      language:
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
                          characters, default is auto, but Cantonese
                          auto-detection is not supported)


                          Note: values must match the list exactly (`en-us`, not
                          `en`; `fr-fr`, not `fr`). **A value outside the list
                          does not raise an error — it is silently downgraded to
                          `auto`**, so do not rely on short codes.
                      vivid:
                        type: boolean
                        default: false
                        description: >-
                          Vivid expression mode (only supported by V3.0
                          characters, default is false)
                      emo_switch:
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
                          Emotion control (only supported by V3.0 characters.
                          Must pass an array of 5 integers ranging from 0-10,
                          corresponding to [Anger, Happiness, Neutral, Sadness,
                          Contextual Match] from the 1st to 5th item,
                          respectively. E.g., [5, 0, 0, 2, 0] corresponds to a
                          relatively angry and somewhat sad emotion. Default is
                          0 for all items, meaning automatically following the
                          character sample emotion)
                      speechRate:
                        type: number
                        description: >-
                          Speech rate control (0.5-2.0, based on the resulting
                          duration. The larger the value, the slower the speech;
                          e.g., 2.0 will generate an audio result with 2 times
                          the duration. Default is 1.0)
                        minimum: 0.5
                        maximum: 2
                        default: 1
                      flash:
                        type: boolean
                        description: Low latency mode (default is false)
                        default: false
                      stream:
                        type: boolean
                        description: Enable streaming generation (default is false)
                        default: false
                      seed:
                        type: integer
                        format: int32
                        default: -1
                        minimum: -1
                        maximum: 2147483647
                        description: >-
                          Generation seed, maximum is Int32, -1 or null means
                          random (default is -1)
                        nullable: true
                      input_audio:
                        type: string
                        format: uri
                        description: >-
                          URL of the source audio for voice conversion. Must be
                          a URL returned by `POST /api/tts/upload-audio` (or an
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
                          `input_audio` is set. `high_quality` is honoured only
                          for `standard` / `similarity`. `similarity` currently
                          behaves the same as `standard`. Legacy booleans
                          `keep_prosody` / `cover_mode` are normalised into this
                          field.
                      high_quality:
                        type: boolean
                        description: >-
                          VC polish pass. Only takes effect for `standard` /
                          `similarity`; ignored for `prosody` / `cover`.
                    x-apifox-orders:
                      - type
                      - voiceId
                      - text
                      - promptId
                      - 01K4JFDJ1GQ0Z919KJTM574VCD
                      - input_audio
                      - vc_mode
                      - high_quality
                    x-apifox-refs:
                      01K4JFDJ1GQ0Z919KJTM574VCD: &ref_10
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
                srt:
                  type: boolean
                  default: false
                  description: >-
                    Whether to enable subtitle generation (incompatible with low
                    latency mode, defaults to false)
              x-apifox-orders:
                - contents
                - srt
              x-apifox-refs: {}
              x-apifox-ignore-properties: []
            example:
              contents:
                - voiceId: 46cc9a76-acd7-4af7-a13a-f8b1408b1848
                  text: Hello there, the weather is really nice today!
                  promptId: default
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
                - voiceId: b8511ce5-0860-4703-9be6-db6017668227
                  text: Yes, yes, I think so too, it's perfect for going out!
                  promptId: default
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
                - voiceId: 89506c35-c207-458b-95e1-3235cc2f3b6e
                  text: >-
                    What are you guys talking about? Oh, you're talking about
                    the weather!
                  promptId: default
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
              srt: false
      responses:
        '200':
          x-apifox-name: Asynchronous generation task successfully created
          x-apifox-ordering: 0
          description: >-
            Job created with `data.status` = `pending` (or `processing` when
            `sync=true`); poll the job detail endpoint for the audio
          content:
            application/json:
              schema:
                type: object
                properties:
                  status:
                    type: integer
                    description: Status Code
                    examples:
                      - 200
                    x-apifox-mock: '@pick([''200''])'
                  message:
                    type: string
                    description: Status Message
                    examples:
                      - OK
                    x-apifox-mock: OK
                  data:
                    description: Details of the created asynchronous generation task
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
                  id: 021e4a43-0898-4942-abd9-c9f6a4ff61d3
                  userId: f582d32e-a20f-406d-bbb5-534960d9aa89
                  status: generated
                  type: vocu-neural-voice-001
                  metadata:
                    contents:
                      - voiceId: bcbaf249-3a92-4cca-b53c-42d29e745751
                        text: >-
                          Fresh mixed greens tossed with mustard-rubbed pigeon,
                          fresh chillies, and a light dressing.
                        audio: >-
                          https://storage.vocu.ai/generate/7d06aeec-d9a6-4ccb-9cc0-737c76559c95/05137b6a-34b3-406a-a8d1-5ad488efcc82-1.mp3
                        generatedAt: '1961-07-30T23:58:39.042Z'
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
                      - voiceId: 6c76d3ca-913b-4b68-b233-dac212c4b63b
                        text: >-
                          A special blue strawberries from Puerto Rico. To
                          support the strong flavor it is sided with a
                          tablespoon of german chamomile.
                        audio: >-
                          https://storage.vocu.ai/generate/aa8f08ce-351b-4027-a2b7-892bbd3b7bfa/15eefb54-222a-4cea-836d-3cb54d8746cf-2.mp3
                        generatedAt: '1956-09-06T15:51:47.576Z'
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
                      - voiceId: c17911c5-4ef2-4145-bd62-e58535ddad4a
                        text: >-
                          Juicy turkey, grilled to your liking and drizzled with
                          a bold celery sauce, served alongside roasted green
                          pepper.
                        audio: >-
                          https://storage.vocu.ai/generate/3dfc1bbc-c4c0-4621-9a9e-87ae9c1019bd/ca4a2d33-2060-47a8-96d3-6f1e1f76b2c1-3.mp3
                        generatedAt: '2020-02-28T03:50:49.626Z'
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
                    characters: 66
                    voices:
                      - id: 8714ca7b-c28a-4710-accb-3a2baabcfcba
                        name: Shannon Bins
                        status: lora-success
                        metadata:
                          avatar: >-
                            https://loremflickr.com/3245/3989?lock=908384138534414
                          description: business owner, singer, writer
                          prompts:
                            - id: 2c1f0fa9-9ee2-4fcc-9bee-0fcea6ed7369
                              name: dark
                              promptOriginAudioStorageUrl: >-
                                https://storage.vocu.ai/prompt/406938/361072-playback-8oz3ag.mp3
                              playBackAudio: >-
                                https://storage.vocu.ai/prompt/480161/795831-playback-rucs5d.mp3
                              description: those emotional style
                              language: auto
                              vocalFilter: true
                        version: v3.0
                        from: market
                    isPremium: false
                    audio: >-
                      https://storage.vocu.ai/generate/fc036254-844e-4ff3-bff8-7ae4ef61a099/a8e005ea-8f8f-4f90-ae0b-972567236361-merged.mp3
                    generatedAt: '1963-06-10T13:23:07.949Z'
                    srt: false
          headers: {}
        '400':
          x-apifox-name: Bad request
          description: >-
            VALIDATION_CONFLICT / VALIDATION_MISSING_FIELD /
            VALIDATION_INVALID_FORMAT / VALIDATION_BAD_PARAMS / TTS_TEXT_EMPTY /
            TTS_SPLITTER_INVALID / TTS_CONTENTS_INVALID / VOICE_CREATE_FAILED /
            VOICE_INSTRUCT_PATH_ONLY / SAFETY_CHECK_FAILED /
            SAFETY_CONTENT_REJECTED / STREAM_TIMEOUT
          content:
            application/json:
              schema: &ref_0
                $ref: '#/components/schemas/ErrorResponse'
              examples:
                VALIDATION_CONFLICT:
                  summary: VALIDATION_CONFLICT — Parameter conflict detected.
                  value:
                    status: 400
                    code: VALIDATION_CONFLICT
                    message: Parameter conflict detected.
                VALIDATION_MISSING_FIELD:
                  summary: VALIDATION_MISSING_FIELD — Required field is missing.
                  value:
                    status: 400
                    code: VALIDATION_MISSING_FIELD
                    message: Required field is missing.
                VALIDATION_INVALID_FORMAT:
                  summary: VALIDATION_INVALID_FORMAT — Invalid parameter format.
                  value:
                    status: 400
                    code: VALIDATION_INVALID_FORMAT
                    message: Invalid parameter format.
                VALIDATION_BAD_PARAMS:
                  summary: >-
                    VALIDATION_BAD_PARAMS — Bad parameters. Please check your
                    request.
                  value:
                    status: 400
                    code: VALIDATION_BAD_PARAMS
                    message: Bad parameters. Please check your request.
                TTS_TEXT_EMPTY:
                  summary: TTS_TEXT_EMPTY — Text cannot be empty.
                  value:
                    status: 400
                    code: TTS_TEXT_EMPTY
                    message: Text cannot be empty.
                TTS_SPLITTER_INVALID:
                  summary: TTS_SPLITTER_INVALID — Invalid splitter configuration.
                  value:
                    status: 400
                    code: TTS_SPLITTER_INVALID
                    message: Invalid splitter configuration.
                TTS_CONTENTS_INVALID:
                  summary: TTS_CONTENTS_INVALID — Invalid contents array.
                  value:
                    status: 400
                    code: TTS_CONTENTS_INVALID
                    message: Invalid contents array.
                VOICE_CREATE_FAILED:
                  summary: >-
                    VOICE_CREATE_FAILED — Voice creation failed. Please create
                    the voice again.
                  value:
                    status: 400
                    code: VOICE_CREATE_FAILED
                    message: Voice creation failed. Please create the voice again.
                VOICE_INSTRUCT_PATH_ONLY:
                  summary: >-
                    VOICE_INSTRUCT_PATH_ONLY — This voice only supports
                    controllable (instruct) generation.
                  value:
                    status: 400
                    code: VOICE_INSTRUCT_PATH_ONLY
                    message: >-
                      This voice only supports controllable (instruct)
                      generation.
                SAFETY_CHECK_FAILED:
                  summary: >-
                    SAFETY_CHECK_FAILED — Content security check failed, please
                    try again later.
                  value:
                    status: 400
                    code: SAFETY_CHECK_FAILED
                    message: Content security check failed, please try again later.
                    requestId: 3f2504e0-4f89-41d3-9a0c-0305e82c3301
                SAFETY_CONTENT_REJECTED:
                  summary: >-
                    SAFETY_CONTENT_REJECTED — Risk content detected, the request
                    cannot be completed. If you have questi
                  value:
                    status: 400
                    code: SAFETY_CONTENT_REJECTED
                    message: >-
                      Risk content detected, the request cannot be completed. If
                      you have questions about this, please contact us and
                      provide the tracking ID for this request:
                      9f8c1d2e-77ab-4c31-9e0f-2b5a6c7d8e90
                    requestId: 3f2504e0-4f89-41d3-9a0c-0305e82c3301
                STREAM_TIMEOUT:
                  summary: STREAM_TIMEOUT — Stream timed out.
                  value:
                    status: 400
                    code: STREAM_TIMEOUT
                    message: Stream timed out.
                    requestId: 3f2504e0-4f89-41d3-9a0c-0305e82c3301
          headers: {}
        '401':
          x-apifox-name: Unauthorized
          description: AUTH_UNAUTHORIZED
          content:
            application/json:
              schema: *ref_0
              examples:
                AUTH_UNAUTHORIZED:
                  summary: AUTH_UNAUTHORIZED — Unauthorized.
                  value:
                    status: 401
                    code: AUTH_UNAUTHORIZED
                    message: Unauthorized.
          headers: {}
        '403':
          x-apifox-name: Forbidden
          description: BILLING_INSUFFICIENT_CREDIT
          content:
            application/json:
              schema: *ref_0
              examples:
                BILLING_INSUFFICIENT_CREDIT:
                  summary: >-
                    BILLING_INSUFFICIENT_CREDIT — Insufficient balance, please
                    go to the recharge store to top up.
                  value:
                    status: 403
                    code: BILLING_INSUFFICIENT_CREDIT
                    message: >-
                      Insufficient balance, please go to the recharge store to
                      top up.
                    requestId: 3f2504e0-4f89-41d3-9a0c-0305e82c3301
          headers: {}
        '404':
          x-apifox-name: Not found
          description: >-
            PROJECT_NOT_FOUND / SPLITTER_NOT_FOUND / USER_NOT_FOUND /
            GENERATE_NOT_FOUND
          content:
            application/json:
              schema: *ref_0
              examples:
                PROJECT_NOT_FOUND:
                  summary: PROJECT_NOT_FOUND — Project not found.
                  value:
                    status: 404
                    code: PROJECT_NOT_FOUND
                    message: Project not found.
                SPLITTER_NOT_FOUND:
                  summary: SPLITTER_NOT_FOUND — Splitter not found.
                  value:
                    status: 404
                    code: SPLITTER_NOT_FOUND
                    message: Splitter not found.
                USER_NOT_FOUND:
                  summary: USER_NOT_FOUND — User not found
                  value:
                    status: 404
                    code: USER_NOT_FOUND
                    message: User not found
                GENERATE_NOT_FOUND:
                  summary: GENERATE_NOT_FOUND — Generation record not found.
                  value:
                    status: 404
                    code: GENERATE_NOT_FOUND
                    message: Generation record not found.
          headers: {}
        '409':
          x-apifox-name: Conflict
          description: VOICE_CREATING
          content:
            application/json:
              schema: *ref_0
              examples:
                VOICE_CREATING:
                  summary: >-
                    VOICE_CREATING — This voice is still being created. Please
                    try again later.
                  value:
                    status: 409
                    code: VOICE_CREATING
                    message: This voice is still being created. Please try again later.
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
        '500':
          x-apifox-name: Server error
          description: TTS_SPLITTER_METADATA_INVALID / SYSTEM_INTERNAL_ERROR
          content:
            application/json:
              schema: *ref_0
              examples:
                TTS_SPLITTER_METADATA_INVALID:
                  summary: >-
                    TTS_SPLITTER_METADATA_INVALID — Invalid splitter config in
                    database.
                  value:
                    status: 500
                    code: TTS_SPLITTER_METADATA_INVALID
                    message: Invalid splitter config in database.
                    requestId: 3f2504e0-4f89-41d3-9a0c-0305e82c3301
                SYSTEM_INTERNAL_ERROR:
                  summary: >-
                    SYSTEM_INTERNAL_ERROR — Internal server error, please try
                    again later.
                  value:
                    status: 500
                    code: SYSTEM_INTERNAL_ERROR
                    message: Internal server error, please try again later.
                    requestId: 3f2504e0-4f89-41d3-9a0c-0305e82c3301
          headers: {}
        '503':
          x-apifox-name: Temporarily unavailable
          description: VOICE_UNAVAILABLE
          content:
            application/json:
              schema: *ref_0
              examples:
                VOICE_UNAVAILABLE:
                  summary: >-
                    VOICE_UNAVAILABLE — This voice is temporarily unavailable.
                    Please retry later or contact support.
                  value:
                    status: 503
                    code: VOICE_UNAVAILABLE
                    message: >-
                      This voice is temporarily unavailable. Please retry later
                      or contact support.
                    requestId: 3f2504e0-4f89-41d3-9a0c-0305e82c3301
          headers: {}
      security:
        - bearer: []
      x-apifox-folder: Core/Voice Generation/Async jobs
      x-apifox-status: released
      x-run-in-apifox: https://app.apifox.com/web/project/5878926/apis/api-373800504-run
components:
  schemas:
    General Generation Parameters (New):
      type: object
      properties:
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
            Enable emotion style biased towards the text (default is true.
            Filling this will override the corresponding value in parameter
            presets)
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
            Language to be generated (only supported by V3.0 characters, default
            is auto, but Cantonese auto-detection is not supported)


            Note: values must match the list exactly (`en-us`, not `en`;
            `fr-fr`, not `fr`). **A value outside the list does not raise an
            error — it is silently downgraded to `auto`**, so do not rely on
            short codes.
        vivid: &ref_4
          type: boolean
          default: false
          description: >-
            Vivid expression mode (only supported by V3.0 characters, default is
            false)
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
            Emotion control (only supported by V3.0 characters. Must pass an
            array of 5 integers ranging from 0-10, corresponding to [Anger,
            Happiness, Neutral, Sadness, Contextual Match] from the 1st to 5th
            item, respectively. E.g., [5, 0, 0, 2, 0] corresponds to a
            relatively angry and somewhat sad emotion. Default is 0 for all
            items, meaning automatically following the character sample emotion)
        speechRate: &ref_6
          type: number
          description: >-
            Speech rate control (0.5-2.0, based on the resulting duration. The
            larger the value, the slower the speech; e.g., 2.0 will generate an
            audio result with 2 times the duration. Default is 1.0)
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
            Generation seed, maximum is Int32, -1 or null means random (default
            is -1)
          nullable: true
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
                  preset: *ref_1
                  break_clone: *ref_2
                  language: *ref_3
                  vivid: *ref_4
                  emo_switch: *ref_5
                  speechRate: *ref_6
                  flash: *ref_7
                  stream: *ref_8
                  seed: *ref_9
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
                  01K4JFW70FSA3PE7ERVJS8EQQJ: *ref_10
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
