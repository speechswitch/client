> ## Documentation Index
> Fetch the complete documentation index at: https://docs.fish.audio/llms.txt
> Use this file to discover all available pages before exploring further.

# WebSocket TTS Streaming

> Real-time text-to-speech streaming via WebSocket

<Note>
  The WebSocket TTS endpoint enables bidirectional streaming for low-latency text-to-speech generation with MessagePack serialization.
</Note>

<Note>
  The `request` payload inside `StartEvent` uses the same parameters as the HTTP [Text to Speech API](/api-reference/endpoint/openapi-v1/text-to-speech). For more detailed field guidance, model-specific behavior, and examples, see that page. In WebSocket mode, `request.text` is typically empty in `StartEvent`, and the text content is sent through subsequent `TextEvent` messages.
</Note>


## AsyncAPI

````yaml api-reference/asyncapi.yml ttsLive
id: ttsLive
title: Tts live
description: >
  Real-time TTS streaming channel. Clients send text chunks and receive audio
  chunks concurrently.


  ## Connection Headers

  - `Authorization: Bearer <api_key>` - Required for authentication (see
  security section)

  - `model: <model_name>` - Optional; specifies which TTS model to use (see
  bindings). Falls back to `s2.1-pro` when omitted or unrecognized
servers:
  - id: production
    protocol: wss
    host: api.fish.audio
    bindings: []
    variables: []
address: /v1/tts/live
parameters: []
bindings:
  - protocol: ws
    version: latest
    value:
      headers:
        type: object
        properties:
          model:
            type: string
            enum:
              - s1
              - s2-pro
              - s2.1-pro
              - s2.1-pro-free
            description: >-
              TTS model to use for this session. If omitted or set to an
              unrecognized value, the session falls back to `s2.1-pro`. Use
              `s2-pro` or an S2.1-Pro model for multi-speaker dialogue
              synthesis.
    schemaProperties:
      - name: headers
        type: object
        required: false
        properties:
          - name: model
            type: string
            description: >-
              TTS model to use for this session. If omitted or set to an
              unrecognized value, the session falls back to `s2.1-pro`. Use
              `s2-pro` or an S2.1-Pro model for multi-speaker dialogue
              synthesis.
            enumValues:
              - s1
              - s2-pro
              - s2.1-pro
              - s2.1-pro-free
            required: false
operations:
  - &ref_3
    id: receiveText
    title: Receive text
    description: >
      Server receives text and control events from the client.


      **Event Sequence:**

      1. Client sends StartEvent once at the beginning with TTS configuration

      2. Client sends TextEvent for each text chunk to synthesize

      3. Client optionally sends FlushEvent to force immediate synthesis of
      buffered text

      4. Client sends CloseEvent when all text has been sent
    type: receive
    messages:
      - &ref_5
        id: startEvent
        contentType: application/msgpack
        payload:
          - name: Start TTS Session
            description: >
              Initiates a TTS streaming session with configuration.


              This must be the first message sent after connecting. It contains
              all the

              configuration for voice, audio format, and generation parameters.


              The `request` payload uses the same fields as the HTTP TTS API. In

              WebSocket mode, `request.text` is typically empty in the
              StartEvent and

              the actual text is streamed through subsequent TextEvent messages.


              For full parameter details, examples, and model-specific guidance,
              see

              the HTTP [Text to Speech
              API](/api-reference/endpoint/openapi-v1/text-to-speech).
            type: object
            properties:
              - name: event
                type: string
                description: Event type identifier
                required: true
              - name: request
                type: object
                description: >
                  Request payload for text-to-speech synthesis in WebSocket
                  StartEvent.

                  It uses the same parameters as the HTTP [Text to Speech
                  API](/api-reference/endpoint/openapi-v1/text-to-speech).

                  Supports single-speaker synthesis on all compatible TTS
                  models.

                  Multi-speaker dialogue synthesis is available with `s2-pro`
                  and the S2.1-Pro family.

                  In WebSocket mode, `text` is usually empty in StartEvent and
                  the actual

                  content is sent through subsequent TextEvent messages.
                required: true
                properties:
                  - name: text
                    type: string
                    description: >
                      Text to convert to speech. For WebSocket streaming, this
                      is

                      typically empty in the StartEvent and the actual text is
                      sent via

                      TextEvent messages.
                    required: true
                  - name: max_new_tokens
                    type: integer
                    description: |
                      Maximum audio tokens to generate per text chunk.
                    required: false
                  - name: temperature
                    type: number
                    description: >
                      Controls expressiveness. Higher is more varied, lower is
                      more

                      consistent.
                    required: false
                  - name: top_p
                    type: number
                    description: |
                      Controls diversity via nucleus sampling.
                    required: false
                  - name: repetition_penalty
                    type: number
                    description: >
                      Penalty for repeating audio patterns. Values above 1.0
                      reduce

                      repetition.
                    required: false
                  - name: min_chunk_length
                    type: integer
                    description: |
                      Minimum characters before splitting into a new chunk.
                    required: false
                  - name: references
                    type: array
                    description: >
                      Inline voice references for zero-shot cloning.
                      Single-speaker uses

                      an array of ReferenceAudio. Multi-speaker uses an array of
                      speaker

                      arrays. Multi-speaker dialogue is available with `s2-pro`
                      and the S2.1-Pro family.

                      See the HTTP Text to Speech API page for detailed
                      examples.
                    required: false
                    properties:
                      - name: audio
                        type: string
                        description: Audio file bytes for the reference sample
                        required: true
                      - name: text
                        type: string
                        description: >
                          Transcription of what is spoken in the reference
                          audio. Should match

                          exactly what's spoken and include punctuation for
                          proper prosody.
                        required: true
                  - name: reference_id
                    type: anyOf
                    description: >
                      Voice model ID from Fish Audio or your custom models. Use
                      a string

                      for single-speaker synthesis, or an array of model IDs for

                      multi-speaker dialogue on `s2-pro` or an S2.1-Pro model.
                      When using multiple speakers,

                      add speaker tags in `text`. See the HTTP Text to Speech
                      API page

                      for full examples.
                    required: false
                  - name: prosody
                    type: object
                    description: Speed and volume adjustments for the output.
                    required: false
                    properties:
                      - name: speed
                        type: number
                        description: >
                          Speaking rate multiplier. Valid range: 0.5 to 2.0. 1.0
                          = normal

                          speed, 0.5 = half speed, 2.0 = double speed. Useful
                          for adjusting

                          pacing without regenerating audio.
                        required: false
                      - name: volume
                        type: number
                        description: >
                          Volume adjustment in decibels (dB). 0 = no change,
                          positive values

                          = louder, negative values = quieter.
                        required: false
                      - name: normalize_loudness
                        type: boolean
                        description: >
                          Normalize output loudness for more consistent
                          perceived volume.

                          Supported on `s2-pro` and the S2.1-Pro family.
                        required: false
                  - name: chunk_length
                    type: integer
                    description: |
                      Text segment size for processing.
                    required: false
                  - name: condition_on_previous_chunks
                    type: boolean
                    description: |
                      Use previous audio as context for voice consistency.
                    required: false
                  - name: normalize
                    type: boolean
                    description: >
                      Normalizes text for English and Chinese, improving
                      stability for

                      numbers.
                    required: false
                  - name: early_stop_threshold
                    type: number
                    description: |
                      Early stopping threshold for batch processing.
                    required: false
                  - name: format
                    type: string
                    description: Output audio format.
                    enumValues:
                      - wav
                      - pcm
                      - mp3
                      - opus
                    required: false
                  - name: sample_rate
                    type: &ref_1
                      - integer
                      - 'null'
                    description: >
                      Audio sample rate in Hz. When null, uses the format's
                      default

                      (44100 Hz for most formats, 48000 Hz for opus).
                    required: false
                  - name: mp3_bitrate
                    type: integer
                    description: |
                      MP3 bitrate in kbps. Only applies when format is mp3.
                    enumValues:
                      - 64
                      - 128
                      - 192
                    required: false
                  - name: opus_bitrate
                    type: integer
                    description: >
                      Opus bitrate in bps. -1000 for automatic. Only applies
                      when format

                      is opus.
                    enumValues:
                      - -1000
                      - 24000
                      - 32000
                      - 48000
                      - 64000
                    required: false
                  - name: latency
                    type: string
                    description: >
                      Latency-quality trade-off. normal: best quality, balanced:
                      reduced

                      latency, low: lowest latency.
                    enumValues:
                      - low
                      - normal
                      - balanced
                    required: false
        headers: []
        jsonPayloadSchema:
          type: object
          required:
            - event
            - request
          properties:
            event:
              type: string
              const: start
              description: Event type identifier
              x-parser-schema-id: <anonymous-schema-2>
            request:
              type: object
              description: >
                Request payload for text-to-speech synthesis in WebSocket
                StartEvent.

                It uses the same parameters as the HTTP [Text to Speech
                API](/api-reference/endpoint/openapi-v1/text-to-speech).

                Supports single-speaker synthesis on all compatible TTS models.

                Multi-speaker dialogue synthesis is available with `s2-pro` and
                the S2.1-Pro family.

                In WebSocket mode, `text` is usually empty in StartEvent and the
                actual

                content is sent through subsequent TextEvent messages.
              required:
                - text
              properties:
                text:
                  type: string
                  description: >
                    Text to convert to speech. For WebSocket streaming, this is

                    typically empty in the StartEvent and the actual text is
                    sent via

                    TextEvent messages.
                  x-parser-schema-id: <anonymous-schema-3>
                max_new_tokens:
                  type: integer
                  default: 1024
                  description: |
                    Maximum audio tokens to generate per text chunk.
                  x-parser-schema-id: <anonymous-schema-4>
                temperature:
                  type: number
                  minimum: 0
                  maximum: 1
                  default: 0.7
                  description: >
                    Controls expressiveness. Higher is more varied, lower is
                    more

                    consistent.
                  x-parser-schema-id: <anonymous-schema-5>
                top_p:
                  type: number
                  minimum: 0
                  maximum: 1
                  default: 0.7
                  description: |
                    Controls diversity via nucleus sampling.
                  x-parser-schema-id: <anonymous-schema-6>
                repetition_penalty:
                  type: number
                  default: 1.2
                  description: >
                    Penalty for repeating audio patterns. Values above 1.0
                    reduce

                    repetition.
                  x-parser-schema-id: <anonymous-schema-7>
                min_chunk_length:
                  type: integer
                  minimum: 0
                  maximum: 100
                  default: 50
                  description: |
                    Minimum characters before splitting into a new chunk.
                  x-parser-schema-id: <anonymous-schema-8>
                references:
                  anyOf:
                    - description: 'Single speaker: array of reference audio samples'
                      type: array
                      items: &ref_0
                        type: object
                        required:
                          - audio
                          - text
                        properties:
                          audio:
                            type: string
                            format: binary
                            description: Audio file bytes for the reference sample
                            x-parser-schema-id: <anonymous-schema-11>
                          text:
                            type: string
                            description: >
                              Transcription of what is spoken in the reference
                              audio. Should match

                              exactly what's spoken and include punctuation for
                              proper prosody.
                            x-parser-schema-id: <anonymous-schema-12>
                        x-parser-schema-id: WebSocketReferenceAudio
                      x-parser-schema-id: <anonymous-schema-10>
                    - description: >-
                        Multiple speakers: array of arrays, where each inner
                        array contains reference samples for one speaker
                      type: array
                      items:
                        type: array
                        items: *ref_0
                        x-parser-schema-id: <anonymous-schema-14>
                      x-parser-schema-id: <anonymous-schema-13>
                    - type: 'null'
                      x-parser-schema-id: <anonymous-schema-15>
                  description: >
                    Inline voice references for zero-shot cloning.
                    Single-speaker uses

                    an array of ReferenceAudio. Multi-speaker uses an array of
                    speaker

                    arrays. Multi-speaker dialogue is available with `s2-pro`
                    and the S2.1-Pro family.

                    See the HTTP Text to Speech API page for detailed examples.
                  x-parser-schema-id: <anonymous-schema-9>
                reference_id:
                  anyOf:
                    - description: 'Single speaker: voice model ID string'
                      type: string
                      x-parser-schema-id: <anonymous-schema-17>
                    - description: >-
                        Multiple speakers: array of voice model IDs, one per
                        speaker
                      type: array
                      items:
                        type: string
                        x-parser-schema-id: <anonymous-schema-19>
                      x-parser-schema-id: <anonymous-schema-18>
                    - type: 'null'
                      x-parser-schema-id: <anonymous-schema-20>
                  default: null
                  description: >
                    Voice model ID from Fish Audio or your custom models. Use a
                    string

                    for single-speaker synthesis, or an array of model IDs for

                    multi-speaker dialogue on `s2-pro` or an S2.1-Pro model.
                    When using multiple speakers,

                    add speaker tags in `text`. See the HTTP Text to Speech API
                    page

                    for full examples.
                  x-parser-schema-id: <anonymous-schema-16>
                prosody:
                  oneOf:
                    - type: object
                      properties:
                        speed:
                          type: number
                          minimum: 0.5
                          maximum: 2
                          default: 1
                          description: >
                            Speaking rate multiplier. Valid range: 0.5 to 2.0.
                            1.0 = normal

                            speed, 0.5 = half speed, 2.0 = double speed. Useful
                            for adjusting

                            pacing without regenerating audio.
                          x-parser-schema-id: <anonymous-schema-22>
                        volume:
                          type: number
                          minimum: -20
                          maximum: 20
                          default: 0
                          description: >
                            Volume adjustment in decibels (dB). 0 = no change,
                            positive values

                            = louder, negative values = quieter.
                          x-parser-schema-id: <anonymous-schema-23>
                        normalize_loudness:
                          type: boolean
                          default: true
                          description: >
                            Normalize output loudness for more consistent
                            perceived volume.

                            Supported on `s2-pro` and the S2.1-Pro family.
                          x-parser-schema-id: <anonymous-schema-24>
                      x-parser-schema-id: WebSocketProsodyControl
                    - type: 'null'
                      x-parser-schema-id: <anonymous-schema-25>
                  default: null
                  description: Speed and volume adjustments for the output.
                  x-parser-schema-id: <anonymous-schema-21>
                chunk_length:
                  type: integer
                  minimum: 100
                  maximum: 300
                  default: 300
                  description: |
                    Text segment size for processing.
                  x-parser-schema-id: <anonymous-schema-26>
                condition_on_previous_chunks:
                  type: boolean
                  default: true
                  description: |
                    Use previous audio as context for voice consistency.
                  x-parser-schema-id: <anonymous-schema-27>
                normalize:
                  type: boolean
                  default: true
                  description: >
                    Normalizes text for English and Chinese, improving stability
                    for

                    numbers.
                  x-parser-schema-id: <anonymous-schema-28>
                early_stop_threshold:
                  type: number
                  minimum: 0
                  maximum: 1
                  default: 1
                  description: |
                    Early stopping threshold for batch processing.
                  x-parser-schema-id: <anonymous-schema-29>
                format:
                  type: string
                  enum:
                    - wav
                    - pcm
                    - mp3
                    - opus
                  default: mp3
                  description: Output audio format.
                  x-parser-schema-id: <anonymous-schema-30>
                sample_rate:
                  type: *ref_1
                  default: null
                  description: >
                    Audio sample rate in Hz. When null, uses the format's
                    default

                    (44100 Hz for most formats, 48000 Hz for opus).
                  x-parser-schema-id: <anonymous-schema-31>
                mp3_bitrate:
                  type: integer
                  enum:
                    - 64
                    - 128
                    - 192
                  default: 128
                  description: |
                    MP3 bitrate in kbps. Only applies when format is mp3.
                  x-parser-schema-id: <anonymous-schema-32>
                opus_bitrate:
                  type: integer
                  enum:
                    - -1000
                    - 24000
                    - 32000
                    - 48000
                    - 64000
                  default: -1000
                  description: >
                    Opus bitrate in bps. -1000 for automatic. Only applies when
                    format

                    is opus.
                  x-parser-schema-id: <anonymous-schema-33>
                latency:
                  type: string
                  enum:
                    - low
                    - normal
                    - balanced
                  default: normal
                  description: >
                    Latency-quality trade-off. normal: best quality, balanced:
                    reduced

                    latency, low: lowest latency.
                  x-parser-schema-id: <anonymous-schema-34>
              x-parser-schema-id: WebSocketTTSRequest
          x-parser-schema-id: <anonymous-schema-1>
        title: Start TTS Session
        description: >
          Initiates a TTS streaming session with configuration.


          This must be the first message sent after connecting. It contains all
          the

          configuration for voice, audio format, and generation parameters.


          The `request` payload uses the same fields as the HTTP TTS API. In

          WebSocket mode, `request.text` is typically empty in the StartEvent
          and

          the actual text is streamed through subsequent TextEvent messages.


          For full parameter details, examples, and model-specific guidance, see

          the HTTP [Text to Speech
          API](/api-reference/endpoint/openapi-v1/text-to-speech).
        example: |-
          {
            "event": "start",
            "request": {
              "text": "",
              "format": "mp3",
              "chunk_length": 300,
              "reference_id": "9a9cf47702da476aa4629e2506d4a857",
              "latency": "normal"
            }
          }
        bindings: []
        extensions:
          - id: x-parser-unique-object-id
            value: startEvent
      - &ref_6
        id: textEvent
        contentType: application/msgpack
        payload:
          - name: Send Text Chunk
            description: >
              Sends a chunk of text for synthesis.


              You can send multiple TextEvent messages in sequence. The server
              will buffer

              and synthesize text according to the chunk_length parameter from
              StartEvent.
            type: object
            properties:
              - name: event
                type: string
                description: Event type identifier
                required: true
              - name: text
                type: string
                description: Text chunk to synthesize
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
              const: text
              description: Event type identifier
              x-parser-schema-id: <anonymous-schema-36>
            text:
              type: string
              description: Text chunk to synthesize
              x-parser-schema-id: <anonymous-schema-37>
          x-parser-schema-id: <anonymous-schema-35>
        title: Send Text Chunk
        description: >
          Sends a chunk of text for synthesis.


          You can send multiple TextEvent messages in sequence. The server will
          buffer

          and synthesize text according to the chunk_length parameter from
          StartEvent.
        example: |-
          {
            "event": "text",
            "text": "Hello, this is streaming text. "
          }
        bindings: []
        extensions:
          - id: x-parser-unique-object-id
            value: textEvent
      - &ref_7
        id: flushEvent
        contentType: application/msgpack
        payload:
          - name: Flush Buffered Text
            description: >
              Forces immediate synthesis of all buffered text.


              Use this when you want audio generated immediately without waiting
              for more

              text or for the buffer to fill up. Useful for ensuring low latency
              in

              interactive applications.
            type: object
            properties:
              - name: event
                type: string
                description: Event type identifier
                required: true
        headers: []
        jsonPayloadSchema:
          type: object
          required:
            - event
          properties:
            event:
              type: string
              const: flush
              description: Event type identifier
              x-parser-schema-id: <anonymous-schema-39>
          x-parser-schema-id: <anonymous-schema-38>
        title: Flush Buffered Text
        description: >
          Forces immediate synthesis of all buffered text.


          Use this when you want audio generated immediately without waiting for
          more

          text or for the buffer to fill up. Useful for ensuring low latency in

          interactive applications.
        example: |-
          {
            "event": "flush"
          }
        bindings: []
        extensions:
          - id: x-parser-unique-object-id
            value: flushEvent
      - &ref_8
        id: closeEvent
        contentType: application/msgpack
        payload:
          - name: End TTS Session
            description: >
              Signals the end of the text stream.


              After sending this event, the server will finish synthesizing any
              remaining

              buffered text and send a FinishEvent before closing the
              connection.
            type: object
            properties:
              - name: event
                type: string
                description: Event type identifier (note 'stop', not 'close')
                required: true
        headers: []
        jsonPayloadSchema:
          type: object
          required:
            - event
          properties:
            event:
              type: string
              const: stop
              description: Event type identifier (note 'stop', not 'close')
              x-parser-schema-id: <anonymous-schema-41>
          x-parser-schema-id: <anonymous-schema-40>
        title: End TTS Session
        description: >
          Signals the end of the text stream.


          After sending this event, the server will finish synthesizing any
          remaining

          buffered text and send a FinishEvent before closing the connection.
        example: |-
          {
            "event": "stop"
          }
        bindings: []
        extensions:
          - id: x-parser-unique-object-id
            value: closeEvent
    bindings: []
    extensions: &ref_2
      - id: x-parser-unique-object-id
        value: ttsLive
  - &ref_4
    id: sendAudio
    title: Send audio
    description: >
      Server sends audio chunks and completion events to the client.


      **Event Flow:**

      - Server sends AudioEvent messages as audio is generated (multiple times)

      - Server sends FinishEvent once when synthesis completes

      - Clients should ignore unknown events to support future protocol
      extensions
    type: send
    messages:
      - &ref_9
        id: audioEvent
        contentType: application/msgpack
        payload:
          - name: Audio Chunk
            description: >
              Contains generated audio bytes.


              You will receive multiple AudioEvent messages as audio is
              generated. Each

              message contains a chunk of audio in the format you specified.
              Concatenate

              all chunks to get the complete audio.
            type: object
            properties:
              - name: event
                type: string
                description: Event type identifier
                required: true
              - name: audio
                type: string
                description: >-
                  Audio bytes in the format specified in StartEvent (mp3, wav,
                  pcm, or opus)
                required: true
        headers: []
        jsonPayloadSchema:
          type: object
          required:
            - event
            - audio
          properties:
            event:
              type: string
              const: audio
              description: Event type identifier
              x-parser-schema-id: <anonymous-schema-43>
            audio:
              type: string
              format: binary
              description: >-
                Audio bytes in the format specified in StartEvent (mp3, wav,
                pcm, or opus)
              x-parser-schema-id: <anonymous-schema-44>
          x-parser-schema-id: <anonymous-schema-42>
        title: Audio Chunk
        description: >
          Contains generated audio bytes.


          You will receive multiple AudioEvent messages as audio is generated.
          Each

          message contains a chunk of audio in the format you specified.
          Concatenate

          all chunks to get the complete audio.
        example: |-
          {
            "event": "audio",
            "audio": "<binary audio data>"
          }
        bindings: []
        extensions:
          - id: x-parser-unique-object-id
            value: audioEvent
      - &ref_10
        id: finishEvent
        contentType: application/msgpack
        payload:
          - name: Session Complete
            description: >
              Signals that the TTS session has completed.


              - If reason='stop', synthesis completed successfully

              - If reason='error', an error occurred (client should handle
              gracefully)


              The WebSocket connection will close after this event.
            type: object
            properties:
              - name: event
                type: string
                description: Event type identifier
                required: true
              - name: reason
                type: string
                description: |
                  Completion reason:
                  - 'stop': Normal completion
                  - 'error': An error occurred during synthesis
                enumValues:
                  - stop
                  - error
                required: true
        headers: []
        jsonPayloadSchema:
          type: object
          required:
            - event
            - reason
          properties:
            event:
              type: string
              const: finish
              description: Event type identifier
              x-parser-schema-id: <anonymous-schema-46>
            reason:
              type: string
              enum:
                - stop
                - error
              description: |
                Completion reason:
                - 'stop': Normal completion
                - 'error': An error occurred during synthesis
              x-parser-schema-id: <anonymous-schema-47>
          x-parser-schema-id: <anonymous-schema-45>
        title: Session Complete
        description: >
          Signals that the TTS session has completed.


          - If reason='stop', synthesis completed successfully

          - If reason='error', an error occurred (client should handle
          gracefully)


          The WebSocket connection will close after this event.
        example: |-
          {
            "event": "finish",
            "reason": "stop"
          }
        bindings: []
        extensions:
          - id: x-parser-unique-object-id
            value: finishEvent
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
receiveMessages:
  - *ref_9
  - *ref_10
extensions:
  - id: x-parser-unique-object-id
    value: ttsLive
securitySchemes:
  - id: bearerAuth
    name: bearerAuth
    type: http
    description: |
      API key authentication using Bearer token.

      Get your API key from https://fish.audio/app/api-keys

      Pass the token in the Authorization header:
      `Authorization: Bearer YOUR_API_KEY`
    scheme: bearer
    extensions: []

````