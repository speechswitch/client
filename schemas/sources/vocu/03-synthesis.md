# Synchronous real-time voice generation

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /api/tts/simple-generate:
    post:
      summary: Synchronous real-time voice generation
      deprecated: false
      description: >-
        **This endpoint has two independent admission gates and is the only
        public endpoint that mandates an API key:**


        1. **An API key is required** (`Authorization: Bearer sk-...`). Calling
        with a logged-in session token returns 403
        `TTS_SESSION_TOKEN_NOT_ALLOWED`.

        2. **The account must be on a paid plan**, otherwise 403
        `TTS_PAID_ONLY`.


        :::info

        API keys are returned in plaintext only at creation time. See the
        "Authentication" document.

        :::


        :::danger

        When over concurrency budget the call **does not fail immediately**; it
        may wait about 330 seconds before `RATE_LIMIT_CONCURRENT`. Set the
        client HTTP timeout above 330 seconds. See the "Text to speech"
        document.

        :::


        Limits are `quota.syncBaseConcurrent` + `quota.syncPaidConcurrent` on
        `GET /api/account/info`.


        **Three mutually exclusive modes** (chosen by which fields you send):


        - `input_audio` → voice conversion. TTS fields are silently cleared; the
        URL must come from `POST /api/tts/upload-audio` or you get
        `TTS_INPUT_AUDIO_INVALID`.

        - `instruct_mode: true` → controllable synthesis, **no SRT**.

        - neither → regular TTS. Unsupported voices return
        `VOICE_INSTRUCT_PATH_ONLY`.


        **Invalid values are not always errors:** short `language` codes,
        out-of-range `speechRate` / `seed`, and all-zero `emo_switch` are
        dropped. Only a malformed `emo_switch` (length ≠ 5) is 400. See the
        "Text to speech" document.


        Output is MP3. There is no format / bitrate / sampleRate parameter. See
        the "Audio and formats" document. Billing is charged on success
        (`credit_used` / `billing`).


        :::info

        See the Errors document for the full code reference. Always use the
        `X-Vocu-App-Request-Id` response header when troubleshooting.

        :::
      tags:
        - Core/Voice Generation/Synchronous
        - Core/Voice Generation/Synchronous
      parameters: []
      requestBody:
        content:
          application/json:
            schema:
              type: object
              required:
                - voiceId
                - text
              properties:
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
                    Enable emotion style biased towards the text (default is
                    true. Filling this will override the corresponding value in
                    parameter presets)
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
                    Language to be generated (only supported by V3.0 characters,
                    default is auto, but Cantonese auto-detection is not
                    supported)


                    Note: values must match the list exactly (`en-us`, not `en`;
                    `fr-fr`, not `fr`). **A value outside the list does not
                    raise an error — it is silently downgraded to `auto`**, so
                    do not rely on short codes.
                vivid:
                  type: boolean
                  default: false
                  description: >-
                    Vivid expression mode (only supported by V3.0 characters,
                    default is false)
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
                    Emotion control (only supported by V3.0 characters. Must
                    pass an array of 5 integers ranging from 0-10, corresponding
                    to [Anger, Happiness, Neutral, Sadness, Contextual Match]
                    from the 1st to 5th item, respectively. E.g., [5, 0, 0, 2,
                    0] corresponds to a relatively angry and somewhat sad
                    emotion. Default is 0 for all items, meaning automatically
                    following the character sample emotion)
                speechRate:
                  type: number
                  description: >-
                    Speech rate control (0.5-2.0, based on the resulting
                    duration. The larger the value, the slower the speech; e.g.,
                    2.0 will generate an audio result with 2 times the duration.
                    Default is 1.0)
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
                    Generation seed, maximum is Int32, -1 or null means random
                    (default is -1)
                  nullable: true
                srt:
                  type: boolean
                  default: false
                  description: >-
                    Whether to enable subtitle generation (incompatible with low
                    latency mode, defaults to false)
                input_audio:
                  type: string
                  format: uri
                  description: >-
                    URL of the source audio for voice conversion. Must be a URL
                    returned by `POST /api/tts/upload-audio` (or an authorized
                    host). Sending this field switches the call into VC mode and
                    silently clears TTS-only parameters.
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
                    Voice-conversion mode. Only takes effect when `input_audio`
                    is set. `high_quality` is honoured only for `standard` /
                    `similarity`. `similarity` currently behaves the same as
                    `standard`. Legacy booleans `keep_prosody` / `cover_mode`
                    are normalised into this field.
                high_quality:
                  type: boolean
                  description: >-
                    VC polish pass. Only takes effect for `standard` /
                    `similarity`; ignored for `prosody` / `cover`.
              x-apifox-orders:
                - voiceId
                - text
                - promptId
                - 01K4JF9EWZDPE4FJ0FPY523S48
                - srt
                - input_audio
                - vc_mode
                - high_quality
              x-apifox-refs:
                01K4JF9EWZDPE4FJ0FPY523S48:
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
            example:
              voiceId: 6765cf49-c73a-4fae-985d-806b782ec4f2
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
              srt: false
      responses:
        '200':
          x-apifox-name: Audio successfully generated
          x-apifox-ordering: 0
          description: >-
            Synthesis complete; `data.audio` is the audio URL, or a pullable
            stream URL when `stream=true`
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
                    type: object
                    description: Generated audio details
                    properties:
                      id:
                        type: string
                        description: Generated Audio ID
                        x-apifox-mock: '{{$string.uuid}}'
                      audio:
                        type: string
                        description: Final generated audio URL
                        x-apifox-mock: >-
                          https://storage.vocu.ai/generate/{{$string.uuid}}/{{$string.uuid}}.mp3
                      streamUrl:
                        type: string
                        description: Streaming MP3 endpoint
                        x-apifox-mock: >-
                          https://storage.vocu.ai/generate/{{$string.uuid}}/stream.mp3?auth={{$string.uuid}}
                      credit_used:
                        type: integer
                        description: Points consumed
                    x-apifox-orders:
                      - id
                      - audio
                      - streamUrl
                      - credit_used
                    required:
                      - id
                      - audio
                      - credit_used
                    x-apifox-ignore-properties: []
                x-apifox-orders:
                  - status
                  - message
                  - data
                required:
                  - status
                  - message
                  - data
                x-apifox-ignore-properties: []
              example:
                status: 200
                message: OK
                data:
                  id: 6e2818f1-0817-4425-896b-13fed645a2ce
                  audio: >-
                    https://storage.vocu.ai/generate/f6d422f8-0d1c-4a26-8ee3-a255eb25ebeb/12a2dcfd-9aa8-42b6-bd47-5f6fa3a235cc.mp3
                  streamUrl: >-
                    https://storage.vocu.ai/generate/d590af82-4889-4ef2-91a5-1021022c85b6/stream.mp3?auth=1d105b1b-762a-4e86-8b3c-6c8c2d41b0fe
                  credit_used: 44
          headers: {}
        '400':
          x-apifox-name: Bad request
          description: >-
            VOICE_CREATE_FAILED / VOICE_INSTRUCT_PATH_ONLY / VOICE_NOT_TTS_READY
            / VALIDATION_INVALID_VALUE / TTS_INPUT_AUDIO_INVALID /
            SAFETY_CHECK_FAILED / SAFETY_CONTENT_REJECTED
          content:
            application/json:
              schema: &ref_0
                $ref: '#/components/schemas/ErrorResponse'
              examples:
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
                VOICE_NOT_TTS_READY:
                  summary: >-
                    VOICE_NOT_TTS_READY — Voice is not configured for TTS
                    synthesis.
                  value:
                    status: 400
                    code: VOICE_NOT_TTS_READY
                    message: Voice is not configured for TTS synthesis.
                VALIDATION_INVALID_VALUE:
                  summary: VALIDATION_INVALID_VALUE — Invalid parameter value.
                  value:
                    status: 400
                    code: VALIDATION_INVALID_VALUE
                    message: Invalid parameter value.
                TTS_INPUT_AUDIO_INVALID:
                  summary: TTS_INPUT_AUDIO_INVALID — Invalid input audio URL.
                  value:
                    status: 400
                    code: TTS_INPUT_AUDIO_INVALID
                    message: Invalid input audio URL.
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
          description: >-
            TTS_SESSION_TOKEN_NOT_ALLOWED / TTS_PAID_ONLY /
            BILLING_INSUFFICIENT_CREDIT
          content:
            application/json:
              schema: *ref_0
              examples:
                TTS_SESSION_TOKEN_NOT_ALLOWED:
                  summary: >-
                    TTS_SESSION_TOKEN_NOT_ALLOWED — Session token not allowed
                    for this endpoint.
                  value:
                    status: 403
                    code: TTS_SESSION_TOKEN_NOT_ALLOWED
                    message: Session token not allowed for this endpoint.
                TTS_PAID_ONLY:
                  summary: TTS_PAID_ONLY — This feature requires a paid account.
                  value:
                    status: 403
                    code: TTS_PAID_ONLY
                    message: This feature requires a paid account.
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
          description: VOICE_NOT_FOUND
          content:
            application/json:
              schema: *ref_0
              examples:
                VOICE_NOT_FOUND:
                  summary: VOICE_NOT_FOUND — Voice not found.
                  value:
                    status: 404
                    code: VOICE_NOT_FOUND
                    message: Voice not found.
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
          description: RATE_LIMIT_CONCURRENT / RATE_LIMIT_EXCEEDED
          content:
            application/json:
              schema: *ref_0
              examples:
                RATE_LIMIT_CONCURRENT:
                  summary: >-
                    RATE_LIMIT_CONCURRENT — Too many concurrent requests, please
                    try again later.
                  value:
                    status: 429
                    code: RATE_LIMIT_CONCURRENT
                    message: Too many concurrent requests, please try again later.
                    requestId: 3f2504e0-4f89-41d3-9a0c-0305e82c3301
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
          description: TTS_GENERATE_FAILED / WATERMARK_PROCESS_FAILED
          content:
            application/json:
              schema: *ref_0
              examples:
                TTS_GENERATE_FAILED:
                  summary: TTS_GENERATE_FAILED — Audio generation failed.
                  value:
                    status: 500
                    code: TTS_GENERATE_FAILED
                    message: Audio generation failed.
                    requestId: 3f2504e0-4f89-41d3-9a0c-0305e82c3301
                WATERMARK_PROCESS_FAILED:
                  summary: WATERMARK_PROCESS_FAILED — Audio processing failed.
                  value:
                    status: 500
                    code: WATERMARK_PROCESS_FAILED
                    message: Audio processing failed.
                    requestId: 3f2504e0-4f89-41d3-9a0c-0305e82c3301
          headers: {}
        '503':
          x-apifox-name: Temporarily unavailable
          description: VOICE_UNAVAILABLE / STORAGE_UNAVAILABLE / NO_WORKER_AVAILABLE
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
                STORAGE_UNAVAILABLE:
                  summary: >-
                    STORAGE_UNAVAILABLE — Storage service is temporarily
                    unavailable. Please try again later.
                  value:
                    status: 503
                    code: STORAGE_UNAVAILABLE
                    message: >-
                      Storage service is temporarily unavailable. Please try
                      again later.
                    requestId: 3f2504e0-4f89-41d3-9a0c-0305e82c3301
                NO_WORKER_AVAILABLE:
                  summary: >-
                    NO_WORKER_AVAILABLE — No worker is available right now.
                    Please try again later.
                  value:
                    status: 503
                    code: NO_WORKER_AVAILABLE
                    message: No worker is available right now. Please try again later.
                    requestId: 3f2504e0-4f89-41d3-9a0c-0305e82c3301
          headers: {}
      security:
        - bearer: []
      x-apifox-folder: Core/Voice Generation/Synchronous
      x-apifox-status: released
      x-run-in-apifox: https://app.apifox.com/web/project/5878926/apis/api-373800503-run
components:
  schemas:
    General Generation Parameters (New):
      type: object
      properties:
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
            Enable emotion style biased towards the text (default is true.
            Filling this will override the corresponding value in parameter
            presets)
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
            Language to be generated (only supported by V3.0 characters, default
            is auto, but Cantonese auto-detection is not supported)


            Note: values must match the list exactly (`en-us`, not `en`;
            `fr-fr`, not `fr`). **A value outside the list does not raise an
            error — it is silently downgraded to `auto`**, so do not rely on
            short codes.
        vivid:
          type: boolean
          default: false
          description: >-
            Vivid expression mode (only supported by V3.0 characters, default is
            false)
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
            Emotion control (only supported by V3.0 characters. Must pass an
            array of 5 integers ranging from 0-10, corresponding to [Anger,
            Happiness, Neutral, Sadness, Contextual Match] from the 1st to 5th
            item, respectively. E.g., [5, 0, 0, 2, 0] corresponds to a
            relatively angry and somewhat sad emotion. Default is 0 for all
            items, meaning automatically following the character sample emotion)
        speechRate:
          type: number
          description: >-
            Speech rate control (0.5-2.0, based on the resulting duration. The
            larger the value, the slower the speech; e.g., 2.0 will generate an
            audio result with 2 times the duration. Default is 1.0)
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
