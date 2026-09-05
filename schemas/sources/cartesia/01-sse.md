> ## Documentation Index
> Fetch the complete documentation index at: https://docs.cartesia.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Text-to-Speech (SSE)

> Stream audio with extra metadata from a complete transcript



## OpenAPI

````yaml latest.yml POST /tts/sse
openapi: 3.0.1
info:
  title: Cartesia API
  version: 0.0.1
servers:
  - url: https://api.cartesia.ai
    description: Production
security: []
paths:
  /tts/sse:
    post:
      tags:
        - Tts
      summary: Text-to-Speech (SSE)
      description: Stream audio with extra metadata from a complete transcript
      operationId: tts_sse
      parameters:
        - $ref: '#/components/parameters/CartesiaVersionHeader'
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/TTSSSERequest'
      responses:
        '200':
          description: >-
            Server-sent events stream. Each frame is `data: <json>\n\n` where
            the JSON payload matches `TTSSSEEvent`.
          content:
            text/event-stream:
              schema:
                $ref: '#/components/schemas/TTSSSEEvent'
      security:
        - APIKeyAuth: []
        - AccessTokenAuth: []
components:
  parameters:
    CartesiaVersionHeader:
      name: Cartesia-Version
      in: header
      description: API version header.
      required: true
      schema:
        type: string
        format: date
        example: '2026-08-14'
        default: '2026-08-14'
        enum:
          - '2026-08-14'
  schemas:
    TTSSSERequest:
      title: TTSSSERequest
      type: object
      properties:
        model_id:
          $ref: '#/components/schemas/TTSModelID'
        transcript:
          type: string
          default: Hi there, it's awesome to meet you.
        voice:
          $ref: '#/components/schemas/TTSRequestVoiceSpecifier'
        output_format:
          $ref: '#/components/schemas/SSEOutputFormat'
        language:
          $ref: '#/components/schemas/SupportedLanguage'
        locale:
          type: string
          nullable: true
          description: >-
            Prefer `locale` over `language` (for example `en-GB`). `language`
            only accepts base codes like `en`. `locale` also accepts regional
            codes like `en-GB`. Locale codes need Sonic 3.6+. A request may set
            `language` or `locale`, never both.
        accent:
          type: string
          nullable: true
          description: >-
            Usually unnecessary: Cartesia picks the closest accent the voice
            supports for the requested `language` or `locale`. Set it only to
            make a [multilingual
            voice](/build-with-cartesia/capability-guides/multilingual-voices)
            sound accented (e.g. speak English with a French accent). Must come
            from the voice's [Get Voice `accents`
            field](/api-reference/voices/get#response-accents). Learn more
            [here](/build-with-cartesia/capability-guides/multilingual-voices#using-a-multilingual-voice).
        normalization:
          type: string
          nullable: true
          description: >-
            Text normalization. `auto` (default) runs the locale-aware
            normalizer, `off` skips it, or pass a locale code (for example
            `en-IN`) to pin the normalizer independently of the generation
            language. See [Text
            Normalization](/build-with-cartesia/capability-guides/text-normalization).
        add_timestamps:
          type: boolean
          nullable: true
          default: false
          description: >-
            Whether to return word-level timestamps. If `false` (default), no
            word timestamps will be produced at all. If `true`, the server will
            return timestamp events containing word-level timing information.
        add_phoneme_timestamps:
          type: boolean
          nullable: true
          default: false
          description: >-
            Whether to return phoneme-level timestamps. If `false` (default), no
            phoneme timestamps will be produced. If `true`, the server will
            return timestamp events containing phoneme-level timing information.
        use_normalized_timestamps:
          type: boolean
          nullable: true
          description: >-
            Whether to use normalized timestamps (True) or original timestamps
            (False).
        pronunciation_dict_id:
          type: string
          nullable: true
          description: >-
            The ID of a pronunciation dictionary to use for the generation.
            Pronunciation dictionaries are supported by `sonic-3` models and
            newer.
        generation_config:
          $ref: '#/components/schemas/GenerationConfig'
        context_id:
          $ref: '#/components/schemas/SSEContextID'
          description: >-
            This can be any string value you find useful. The server will echo
            back the same `context_id` in events that it sends.

            > Contexts on the [TTS (WebSocket)](/api-reference/tts/websocket)
            endpoint are used for
            [continuations](/build-with-cartesia/capability-guides/stream-inputs-using-continuations).  
            > The TTS (SSE) endpoint does not support continuations, so most
            users just ignore this property.
      required:
        - model_id
        - transcript
        - voice
        - output_format
    TTSSSEEvent:
      title: TTSSSEEvent
      description: An event emitted by the TTS SSE stream.
      oneOf:
        - $ref: '#/components/schemas/TTSSSEChunkEvent'
        - $ref: '#/components/schemas/TTSSSETimestampsEvent'
        - $ref: '#/components/schemas/TTSSSEPhonemeTimestampsEvent'
        - $ref: '#/components/schemas/TTSSSEDoneEvent'
        - $ref: '#/components/schemas/TTSSSEErrorEvent'
      discriminator:
        propertyName: type
        mapping:
          chunk:
            $ref: '#/components/schemas/TTSSSEChunkEvent'
          timestamps:
            $ref: '#/components/schemas/TTSSSETimestampsEvent'
          phoneme_timestamps:
            $ref: '#/components/schemas/TTSSSEPhonemeTimestampsEvent'
          done:
            $ref: '#/components/schemas/TTSSSEDoneEvent'
          error:
            $ref: '#/components/schemas/TTSSSEErrorEvent'
    TTSModelID:
      title: TTSModelID
      type: string
      enum:
        - sonic-3.6
        - sonic-3.5
        - sonic-3
        - sonic-latest
      example: sonic-3.6
      default: sonic-3.6
      description: |-
        The ID of the model to use for the generation.
        See [Models](/build-with-cartesia/tts-models/latest) all options.
    TTSRequestVoiceSpecifier:
      title: TTSRequestVoiceSpecifier
      description: >-
        The voice to use for generation. Pass either a voice ID string or an
        object with a required `id` (additional object fields may be added in
        future API versions). Find a voice in the [Voice
        Library](https://play.cartesia.ai/voices) or via [List
        Voices](/api-reference/voices/list). Embeddings are not accepted in this
        API version.
      oneOf:
        - type: string
          title: TTSRequestVoiceId
          description: The ID of the voice.
          example: db6b0ed5-d5d3-463d-ae85-518a07d3c2b4
        - type: object
          title: TTSRequestVoiceObject
          description: >-
            Voice object. `id` is required; other fields may be added in future
            API versions.
          required:
            - id
          properties:
            id:
              type: string
              description: The ID of the voice.
              example: db6b0ed5-d5d3-463d-ae85-518a07d3c2b4
          additionalProperties: true
    SSEOutputFormat:
      title: SSEOutputFormat
      type: object
      properties:
        container:
          type: string
          enum:
            - raw
          default: raw
        encoding:
          $ref: '#/components/schemas/RawEncoding'
        sample_rate:
          type: integer
          enum:
            - 8000
            - 16000
            - 22050
            - 24000
            - 44100
            - 48000
      required:
        - container
        - encoding
        - sample_rate
    SupportedLanguage:
      title: SupportedLanguage
      type: string
      enum:
        - en
        - fr
        - de
        - es
        - pt
        - zh
        - ja
        - hi
        - it
        - ko
        - nl
        - pl
        - ru
        - sv
        - tr
        - tl
        - bg
        - ro
        - ar
        - cs
        - el
        - fi
        - hr
        - ms
        - sk
        - da
        - ta
        - uk
        - hu
        - 'no'
        - vi
        - bn
        - th
        - he
        - ka
        - id
        - te
        - gu
        - kn
        - ml
        - mr
        - pa
        - or
        - ur
      description: >-
        The language that the given voice should speak the transcript in. This
        may depend on the model you're using. See
        [Models](/build-with-cartesia/tts-models/latest) for details.
    GenerationConfig:
      title: GenerationConfig
      type: object
      description: >-
        Configure the various attributes of the generated speech. Available on
        `sonic-3` and newer models; not available on earlier models.


        See [Volume, Speed, and
        Emotion](/build-with-cartesia/capability-guides/volume-speed-emotion)
        for a guide on this option.
      properties:
        volume:
          type: number
          format: double
          default: 1
          description: >-
            Adjust the volume of the generated speech between 0.5x and 2.0x the
            default volume. Valid values are between [0.5, 2.0] inclusive.
        speed:
          type: number
          format: double
          default: 1
          description: >-
            Adjust the speed of the generated speech between 0.6x and 1.5x the
            default speed. Valid values are between [0.6, 1.5] inclusive.
        emotion:
          $ref: '#/components/schemas/Emotion'
          description: >-
            Optional. Guide the emotion of the generated speech. If omitted, the
            model interprets the emotional subtext of the transcript.
    SSEContextID:
      title: SSEContextID
      type: string
      nullable: true
    TTSSSEChunkEvent:
      title: TTSSSEChunkEvent
      description: Audio data chunk.
      type: object
      example:
        type: chunk
        done: false
        status_code: 206
        step_time: 123
        context_id: 50dc3b5e-5841-4aa1-9f94-60cfb9aead79
        data: aSDinaTvuI8gbWludGxpZnk=
      properties:
        type:
          type: string
          enum:
            - chunk
          description: Event type identifier.
        done:
          type: boolean
          enum:
            - false
          description: >-
            Whether this is the final event for the request. Always `false` for
            chunk events.
        context_id:
          $ref: '#/components/schemas/SSEContextID'
          description: The context ID echoed back from the request, if one was provided.
        data:
          type: string
          description: Base64-encoded audio data.
        step_time:
          type: number
          description: Server-side processing time for this chunk in milliseconds.
        status_code:
          type: integer
          description: HTTP-style status code.
      required:
        - type
        - done
        - data
        - step_time
        - status_code
    TTSSSETimestampsEvent:
      title: TTSSSETimestampsEvent
      description: Word-level timing information.
      type: object
      example:
        type: timestamps
        done: false
        status_code: 206
        context_id: 872ec12d-bc63-4e1e-a241-4f58c879d105
        word_timestamps:
          words:
            - Hello
            - world
          start:
            - 0
            - 0.5
          end:
            - 0.4
            - 0.9
      properties:
        type:
          type: string
          enum:
            - timestamps
          description: Event type identifier.
        done:
          type: boolean
          enum:
            - false
          description: >-
            Whether this is the final event for the request. Always `false` for
            timestamps events.
        context_id:
          $ref: '#/components/schemas/SSEContextID'
          description: The context ID echoed back from the request, if one was provided.
        word_timestamps:
          type: object
          description: Word-level timing information.
          properties:
            words:
              type: array
              items:
                type: string
              description: List of words in order.
            start:
              type: array
              items:
                type: number
              description: Start times in seconds for each word.
            end:
              type: array
              items:
                type: number
              description: End times in seconds for each word.
          required:
            - words
            - start
            - end
        status_code:
          type: integer
          description: HTTP-style status code.
      required:
        - type
        - done
        - word_timestamps
        - status_code
    TTSSSEPhonemeTimestampsEvent:
      title: TTSSSEPhonemeTimestampsEvent
      description: Phoneme-level timing information.
      type: object
      example:
        type: phoneme_timestamps
        done: false
        status_code: 206
        context_id: 872ec12d-bc63-4e1e-a241-4f58c879d105
        phoneme_timestamps:
          phonemes:
            - h
            - ə
            - l
            - oʊ
          start:
            - 0.093
            - 0.174
            - 0.255
            - 0.337
          end:
            - 0.174
            - 0.255
            - 0.337
            - 0.418
      properties:
        type:
          type: string
          enum:
            - phoneme_timestamps
          description: Event type identifier.
        done:
          type: boolean
          enum:
            - false
          description: >-
            Whether this is the final event for the request. Always `false` for
            phoneme_timestamps events.
        context_id:
          $ref: '#/components/schemas/SSEContextID'
          description: The context ID echoed back from the request, if one was provided.
        phoneme_timestamps:
          type: object
          description: Phoneme-level timing information.
          properties:
            phonemes:
              type: array
              items:
                type: string
              description: List of phonemes in order.
            start:
              type: array
              items:
                type: number
              description: Start times in seconds for each phoneme.
            end:
              type: array
              items:
                type: number
              description: End times in seconds for each phoneme.
          required:
            - phonemes
            - start
            - end
        status_code:
          type: integer
          description: HTTP-style status code.
      required:
        - type
        - done
        - phoneme_timestamps
        - status_code
    TTSSSEDoneEvent:
      title: TTSSSEDoneEvent
      description: Generation completion signal. Final event in the stream.
      type: object
      example:
        type: done
        done: true
        status_code: 206
        context_id: 50dc3b5e-5841-4aa1-9f94-60cfb9aead79
      properties:
        type:
          type: string
          enum:
            - done
          description: Event type identifier.
        done:
          type: boolean
          enum:
            - true
          description: Whether generation is complete. Always `true` for done events.
        context_id:
          $ref: '#/components/schemas/SSEContextID'
          description: The context ID echoed back from the request, if one was provided.
        status_code:
          type: integer
          description: HTTP-style status code.
      required:
        - type
        - done
        - status_code
    TTSSSEErrorEvent:
      title: TTSSSEErrorEvent
      description: Error information for the TTS SSE request.
      type: object
      example:
        type: error
        done: true
        title: Invalid model
        message: The model is not valid, make sure it is a valid model ID.
        error_code: model_not_found
        status_code: 400
        doc_url: https://docs.cartesia.ai/build-with-cartesia/tts-models/latest
        request_id: 2ff8af53-4d38-479d-8287-58940f01c701
      properties:
        type:
          type: string
          enum:
            - error
          description: Event type identifier.
        done:
          type: boolean
          description: Whether generation is complete.
        status_code:
          type: integer
          description: An HTTP response status code.
        title:
          type: string
          description: Human-readable error title.
        message:
          type: string
          description: Human-readable error message.
        error_code:
          type: string
          nullable: true
          description: Machine-readable error code.
        request_id:
          type: string
          description: Unique identifier for this request.
        doc_url:
          type: string
          nullable: true
          description: URL to relevant documentation.
      required:
        - type
        - done
        - status_code
        - title
        - message
        - request_id
    RawEncoding:
      title: RawEncoding
      type: string
      description: >-
        The encoding format for output audio. See [TTS Output Audio
        Format](/build-with-cartesia/capability-guides/tts-output-audio-format)
        if you're unsure what to use.
      enum:
        - pcm_f32le
        - pcm_s16le
        - pcm_mulaw
        - pcm_alaw
    Emotion:
      title: Emotion
      type: string
      description: >-
        The primary emotions are `neutral`, `calm`, `angry`, `content`, `sad`,
        `scared`. For more options, see [Volume, Speed, and
        Emotion](/build-with-cartesia/capability-guides/volume-speed-emotion#emotion-controls-beta).
      enum:
        - neutral
        - happy
        - excited
        - enthusiastic
        - elated
        - euphoric
        - triumphant
        - amazed
        - surprised
        - flirtatious
        - curious
        - content
        - peaceful
        - serene
        - calm
        - grateful
        - affectionate
        - trust
        - sympathetic
        - anticipation
        - mysterious
        - angry
        - mad
        - outraged
        - frustrated
        - agitated
        - threatened
        - disgusted
        - contempt
        - envious
        - sarcastic
        - ironic
        - sad
        - dejected
        - melancholic
        - disappointed
        - hurt
        - guilty
        - bored
        - tired
        - rejected
        - nostalgic
        - wistful
        - apologetic
        - hesitant
        - insecure
        - confused
        - resigned
        - anxious
        - panicked
        - alarmed
        - scared
        - proud
        - confident
        - distant
        - skeptical
        - contemplative
        - determined
  securitySchemes:
    APIKeyAuth:
      type: http
      scheme: bearer
      bearerFormat: API Key
      description: >-
        Cartesia API key (`sk_car_...`). Get one at
        [play.cartesia.ai/keys](https://play.cartesia.ai/keys).
      x-default: $CARTESIA_API_KEY
    AccessTokenAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT
      description: >-
        A short-lived access token to make API requests from a client. Generate
        the token via [this
        API](https://docs.cartesia.ai/api-reference/auth/access-token).

````