# One-shot synthesis returning an MP3 stream directly

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /api/tts/simple-generate.mp3:
    get:
      summary: One-shot synthesis returning an MP3 stream directly
      deprecated: false
      description: >-
        One-shot text-to-speech that **returns audio bytes directly as an
        `audio/mpeg` stream**, usable as `<audio src>` as-is.


        ## Relationship to `GET /api/tts/simple-generate`


        Both share the same parameters, auth, billing, and response headers,

        and both emit a byte stream with `direct_stream: true`. The `.mp3`
        suffix exists purely so browsers, players, and download tools

        recognize the content type by extension; **there is no difference in
        response shape**.


        For a JSON response (to obtain `streamUrl` and fetch later) use `POST
        /api/tts/simple-generate` without `direct_stream`.


        ## Preconditions


        - **Paying users only**, otherwise `TTS_PAID_ONLY`

        - By default **API Key calls only**: a session JWT returns
        `TTS_SESSION_TOKEN_NOT_ALLOWED`


        :::danger

        Over-limit requests **do not fail immediately**; they may wait about 330
        seconds before `RATE_LIMIT_CONCURRENT`. Set the client HTTP timeout
        above 330 seconds. See the "Text to speech" document.

        :::


        ## Two synthesis modes


        - **TTS**: pass `text`. When `instruct_mode=true` the
        emotion-controllable path is used,
          supporting `{{...}}` control markers (billing and duration estimates are computed after stripping markers), and **no SRT is produced**
        - **VC (voice conversion)**: pass `input_audio`. `text` and all TTS
        parameters are then ignored,
          billed by input-audio duration; `input_audio` must be an address under this platform's `/vc-input/` or `/generate/` path,
          or an authorized external address, otherwise `TTS_INPUT_AUDIO_INVALID`

        ## Error semantics


        All errors are decided **before** response headers are sent, so failures
        return a standard JSON error body (not an audio stream).

        Once bytes start flowing, a mid-stream failure can only appear as an
        early end of the stream.


        Synthesis failure **is not billed**; billing happens after audio is
        produced successfully.


        :::info

        See the Errors document for the full code reference. Always use the
        `X-Vocu-App-Request-Id` response header when troubleshooting.

        :::
      tags:
        - Core/Voice Generation/Synchronous
        - Core/Voice Generation/Synchronous
      parameters:
        - name: voiceId
          in: query
          description: >-
            Voice character ID. Market voices use the form
            `market:{marketVoiceId}`.
          required: true
          schema:
            type: string
        - name: text
          in: query
          description: >-
            Text to synthesise. Required in TTS mode. Ignored in VC mode (when
            you send `input_audio`).
          required: false
          schema:
            type: string
        - name: promptId
          in: query
          description: Reference-audio (prompt) ID. Prefix match is supported.
          required: false
          schema:
            type: string
            default: default
        - name: instruct_mode
          in: query
          description: >-
            Whether to enable emotion-controllable mode. When enabled, `{{...}}`
            control markers are supported and SRT is not produced.
          required: false
          schema:
            type: string
            enum:
              - 'true'
              - 'false'
              - '1'
              - '0'
        - name: reference_mode
          in: query
          description: >-
            Reference-audio orientation. Only takes effect when `instruct_mode`
            is true. Illegal values are treated as omitted.
          required: false
          schema:
            type: string
            enum:
              - similarity
              - balanced
              - expressive
        - name: preset
          in: query
          description: >-
            Synthesis parameter preset. See `GET /api/tts/presets` for allowed
            values.
          required: false
          schema:
            type: string
            default: balance
        - name: flash
          in: query
          description: >-
            Low-latency mode. Trades a little quality for faster first audio.
            SRT is not produced when this is on.
          required: false
          schema:
            type: string
            enum:
              - 'true'
              - 'false'
              - '1'
              - '0'
        - name: srt
          in: query
          description: >-
            Whether to also produce SRT subtitles. Mutually exclusive with
            `flash` and `instruct_mode`; if either of those is on, this field
            has no effect.
          required: false
          schema:
            type: string
            enum:
              - 'true'
              - 'false'
              - '1'
              - '0'
        - name: seed
          in: query
          description: Random seed. Fix it to reproduce the same audio.
          required: false
          schema:
            type: integer
        - name: speechRate
          in: query
          description: >-
            Speech-rate multiplier. Values outside `[0.5, 2]` are ignored rather
            than rejected.
          required: false
          schema:
            type: number
            minimum: 0.5
            maximum: 2
        - name: break_clone
          in: query
          description: Whether to clone the pause style of the reference audio
          required: false
          schema:
            type: string
            enum:
              - 'true'
              - 'false'
              - '1'
              - '0'
        - name: infinite_mode
          in: query
          description: Unbounded long-text mode
          required: false
          schema:
            type: string
            enum:
              - 'true'
              - 'false'
              - '1'
              - '0'
        - name: post_processing
          in: query
          description: >-
            Post-processing chain identifier, submitted with the synthesis
            request
          required: false
          schema:
            type: string
        - name: input_audio
          in: query
          description: >-
            Input audio URL for VC mode. Sending this field switches the call
            into voice-conversion mode; TTS parameters such as `text` are all
            ignored.
          required: false
          schema:
            type: string
            format: uri
        - name: vc_mode
          in: query
          description: >-
            VC conversion mode. Only takes effect in VC mode. Unified successor
            of `keep_prosody` / `cover_mode`.
          required: false
          schema:
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
                name: Similarity-first (currently behaves the same as `standard`)
                description: Similarity-first (currently behaves the same as `standard`)
              - value: prosody
                name: Preserve source-audio prosody
                description: Preserve source-audio prosody
              - value: cover
                name: Cover / singing mode
                description: Cover / singing mode
        - name: keep_prosody
          in: query
          description: >-
            (Legacy.) Keep the source-audio prosody. Normalised internally into
            `vc_mode`.
          required: false
          schema:
            type: string
            enum:
              - 'true'
              - 'false'
              - '1'
              - '0'
        - name: cover_mode
          in: query
          description: (Legacy.) Cover mode. Normalised internally into `vc_mode`.
          required: false
          schema:
            type: string
            enum:
              - 'true'
              - 'false'
              - '1'
              - '0'
        - name: high_quality
          in: query
          description: VC high-quality mode. Only takes effect in VC mode.
          required: false
          schema:
            type: string
            enum:
              - 'true'
              - 'false'
              - '1'
              - '0'
      responses:
        '200':
          x-apifox-name: Success
          description: >-
            MP3 audio byte stream. The response body is the audio itself.
            Accompanying metadata (audio ID, reusable stream URL, billing
            details) is sent as a JSON string in the `X-Reecho-Response-Data`
            response header.
          content:
            audio/mpeg:
              schema:
                type: object
                properties: {}
                x-apifox-orders: []
                x-apifox-ignore-properties: []
          headers:
            Content-Type:
              description: Always `audio/mpeg`
              schema:
                type: string
            Transfer-Encoding:
              description: Always `chunked` (non-instruct path)
              schema:
                type: string
            X-Accel-Buffering:
              description: >-
                Always `no`. Disables reverse-proxy buffering so the first
                packet arrives as soon as possible.
              schema:
                type: string
            X-Reecho-Audio-Id:
              description: >-
                Audio ID produced by this generation. You can replay it with
                `GET /api/tts/stream/{id}`.
              schema:
                type: string
                format: uuid
            X-Reecho-Response-Data:
              description: >-
                JSON string containing `id` / `audio` / `streamUrl` /
                `credit_used` / `billing`. `srt` and `estimatedDuration` appear
                when applicable.
              schema:
                type: string
            Accept-Ranges:
              description: >-
                Present only on the `instruct_mode` path. Value is `bytes`. This
                path supports Range requests (206 / 416).
              schema:
                type: string
            ETag:
              description: >-
                Present only on the `instruct_mode` path. Used with `If-Range`
                to check resource identity.
              schema:
                type: string
        '400':
          x-apifox-name: Bad request
          description: >-
            TTS_INPUT_AUDIO_INVALID / VOICE_CREATE_FAILED /
            VOICE_INSTRUCT_PATH_ONLY / VOICE_NOT_TTS_READY /
            VALIDATION_INVALID_VALUE / SAFETY_CHECK_FAILED /
            SAFETY_CONTENT_REJECTED / STREAM_FETCH_FAILED / STREAM_TIMEOUT
          content:
            application/json:
              schema: &ref_0
                $ref: '#/components/schemas/ErrorResponse'
              examples:
                TTS_INPUT_AUDIO_INVALID:
                  summary: TTS_INPUT_AUDIO_INVALID — Invalid input audio URL.
                  value:
                    status: 400
                    code: TTS_INPUT_AUDIO_INVALID
                    message: Invalid input audio URL.
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
                STREAM_FETCH_FAILED:
                  summary: STREAM_FETCH_FAILED — Failed to fetch stream audio.
                  value:
                    status: 400
                    code: STREAM_FETCH_FAILED
                    message: Failed to fetch stream audio.
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
          description: WATERMARK_PROCESS_FAILED / TTS_GENERATE_FAILED
          content:
            application/json:
              schema: *ref_0
              examples:
                WATERMARK_PROCESS_FAILED:
                  summary: WATERMARK_PROCESS_FAILED — Audio processing failed.
                  value:
                    status: 500
                    code: WATERMARK_PROCESS_FAILED
                    message: Audio processing failed.
                    requestId: 3f2504e0-4f89-41d3-9a0c-0305e82c3301
                TTS_GENERATE_FAILED:
                  summary: TTS_GENERATE_FAILED — Audio generation failed.
                  value:
                    status: 500
                    code: TTS_GENERATE_FAILED
                    message: Audio generation failed.
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
      x-run-in-apifox: https://app.apifox.com/web/project/5878926/apis/api-505321038-run
components:
  schemas:
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
