> ## Documentation Index
> Fetch the complete documentation index at: https://docs.cartesia.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Text-to-Speech (Bytes)

> Stream audio from a complete transcript



## OpenAPI

````yaml latest.yml POST /tts/bytes
openapi: 3.0.1
info:
  title: Cartesia API
  version: 0.0.1
servers:
  - url: https://api.cartesia.ai
    description: Production
security: []
paths:
  /tts/bytes:
    post:
      tags:
        - Tts
      summary: Text-to-Speech (Bytes)
      description: Stream audio from a complete transcript
      operationId: tts_bytes
      parameters:
        - $ref: '#/components/parameters/CartesiaVersionHeader'
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/TTSRequest'
      responses:
        '200':
          description: Audio bytes
          content:
            audio/*:
              schema:
                type: string
                format: binary
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
    TTSRequest:
      title: TTSRequest
      type: object
      properties:
        model_id:
          $ref: '#/components/schemas/TTSModelID'
        transcript:
          type: string
          default: Hi there, it's awesome to meet you.
        voice:
          $ref: '#/components/schemas/TTSRequestVoiceSpecifier'
        language:
          $ref: '#/components/schemas/SupportedLanguage'
          nullable: true
          description: >-
            Prefer `locale` when you can. `language` only accepts base ISO codes
            like `en`. A request may set `language` or `locale`, never both.
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
        output_format:
          $ref: '#/components/schemas/OutputFormat'
        pronunciation_dict_id:
          type: string
          nullable: true
          description: >-
            The ID of a pronunciation dictionary to use for the generation.
            Pronunciation dictionaries are supported by `sonic-3` models and
            newer.
        generation_config:
          $ref: '#/components/schemas/GenerationConfig'
      required:
        - model_id
        - transcript
        - voice
        - output_format
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
    OutputFormat:
      title: OutputFormat
      oneOf:
        - type: object
          title: WAVOutputFormat
          allOf:
            - type: object
              properties:
                container:
                  type: string
                  enum:
                    - wav
                  default: wav
            - $ref: '#/components/schemas/WAVOutputFormat'
          required:
            - container
        - type: object
          title: MP3OutputFormat
          allOf:
            - type: object
              properties:
                container:
                  type: string
                  enum:
                    - mp3
                  default: mp3
            - $ref: '#/components/schemas/MP3OutputFormat'
          required:
            - container
        - type: object
          title: RAWOutputFormat
          allOf:
            - type: object
              properties:
                container:
                  type: string
                  enum:
                    - raw
                  default: raw
            - $ref: '#/components/schemas/RawOutputFormat'
          required:
            - container
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
    WAVOutputFormat:
      title: WAVOutputFormat
      type: object
      properties:
        encoding:
          allOf:
            - $ref: '#/components/schemas/RawEncoding'
          default: pcm_s16le
        sample_rate:
          type: integer
          enum:
            - 8000
            - 16000
            - 22050
            - 24000
            - 44100
            - 48000
          default: 44100
      allOf:
        - $ref: '#/components/schemas/RawOutputFormat'
    MP3OutputFormat:
      title: MP3OutputFormat
      type: object
      properties:
        sample_rate:
          type: integer
          enum:
            - 8000
            - 16000
            - 22050
            - 24000
            - 44100
            - 48000
          default: 44100
        bit_rate:
          type: integer
          enum:
            - 32000
            - 64000
            - 96000
            - 128000
            - 192000
          default: 128000
      required:
        - sample_rate
        - bit_rate
    RawOutputFormat:
      title: RawOutputFormat
      type: object
      properties:
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
        - encoding
        - sample_rate
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