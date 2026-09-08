> ## Documentation Index
> Fetch the complete documentation index at: https://voice.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Multi-Context WebSocket

> Multiple concurrent TTS streams over a single WebSocket connection. Each context has its own voice and settings. For multiple generations, use this instead of `/stream`.

**Authentication:** `Authorization: Bearer YOUR_API_KEY`



## AsyncAPI

````yaml docs/asyncapi.json /api/v1/tts/multi-stream
id: /api/v1/tts/multi-stream
title: Multi-Context WebSocket
description: >-
  Multiple concurrent TTS streams over a single WebSocket connection. Each
  context has its own voice and settings. For multiple generations, use this
  instead of `/stream`.


  **Authentication:** `Authorization: Bearer YOUR_API_KEY`
servers:
  - id: production
    protocol: wss
    host: dev.voice.ai
    bindings: []
    variables: []
address: /api/v1/tts/multi-stream
parameters: []
bindings: []
operations:
  - &ref_1
    id: sendInitMulti
    title: Send Context Initialization
    description: >-
      Send the first message to a context_id to initialize that context with
      voice, model, and language settings
    type: receive
    messages:
      - &ref_6
        id: initMessage
        contentType: application/json
        payload:
          - name: Context Initialization Message
            description: First message to a context_id to set up that context
            type: object
            properties:
              - name: context_id
                type: string
                description: Context identifier (auto-generated if omitted)
                required: false
              - name: voice_id
                type: string
                description: Voice ID to use. Omit to use the default built-in voice.
                required: false
              - name: text
                type: string
                description: Text to synthesize (buffered until flush)
                required: true
              - name: language
                type: string
                description: >-
                  Language code (ISO 639-1 format). Supported: en, ca, sv, es,
                  fr, de, it, pt, pl, ru, nl.
                enumValues:
                  - en
                  - ca
                  - sv
                  - es
                  - fr
                  - de
                  - it
                  - pt
                  - pl
                  - ru
                  - nl
                required: false
              - name: model
                type: string
                description: >-
                  TTS model to use. If not provided, automatically selected
                  based on language. English uses voiceai-tts-v1-latest; other
                  languages use voiceai-tts-multilingual-v1-latest. Lite models
                  are English-only and must be selected explicitly.
                enumValues:
                  - voiceai-tts-v1-latest
                  - voiceai-tts-v1-2026-02-10
                  - voiceai-tts-lite-v1-latest
                  - voiceai-tts-lite-v1-2026-04-15
                  - voiceai-tts-multilingual-v1-latest
                  - voiceai-tts-multilingual-v1-2026-02-10
                required: false
              - name: audio_format
                type: string
                description: >-
                  Audio output format. Basic formats (mp3, wav, pcm) use 32kHz
                  sample rate. Format-specific options allow control over sample
                  rate and bitrate. All PCM formats (pcm, pcm_*) use 16-bit
                  signed little-endian mono.
                enumValues:
                  - mp3
                  - wav
                  - pcm
                  - alaw_8000
                  - mp3_22050_32
                  - mp3_24000_48
                  - mp3_44100_32
                  - mp3_44100_64
                  - mp3_44100_96
                  - mp3_44100_128
                  - mp3_44100_192
                  - opus_48000_32
                  - opus_48000_64
                  - opus_48000_96
                  - opus_48000_128
                  - opus_48000_192
                  - pcm_8000
                  - pcm_16000
                  - pcm_22050
                  - pcm_24000
                  - pcm_32000
                  - pcm_44100
                  - pcm_48000
                  - ulaw_8000
                  - wav_16000
                  - wav_22050
                  - wav_24000
                required: false
              - name: temperature
                type: number
                description: Sampling temperature (0.0-2.0)
                required: false
              - name: top_p
                type: number
                description: Nucleus sampling (0.0-1.0)
                required: false
              - name: dictionary_id
                type: string
                description: Optional managed pronunciation dictionary identifier.
                required: false
              - name: dictionary_version
                type: integer
                description: >-
                  Optional managed dictionary version. Defaults to latest when
                  omitted.
                required: false
              - name: delivery_mode
                type: string
                description: >-
                  Delivery cadence mode: 'raw' (default) or 'paced'. Paced
                  delivery is applied only to PCM-based outputs ('pcm', 'pcm_*',
                  'ulaw_8000', 'alaw_8000'); other formats fall back to raw
                  cadence.
                enumValues:
                  - raw
                  - paced
                required: false
              - name: flush
                type: boolean
                description: Trigger audio generation from buffer
                required: false
              - name: auto_close
                type: boolean
                description: >-
                  If true, automatically close this context after flush
                  completes. Useful for fire-and-forget TTS generation where you
                  want to release the concurrent generation slot immediately.
                  Server sends context_closed after is_last when this is set.
                required: false
        headers: []
        jsonPayloadSchema:
          type: object
          properties:
            context_id:
              type: string
              description: Context identifier (auto-generated if omitted)
              x-parser-schema-id: <anonymous-schema-23>
            voice_id:
              type: string
              description: Voice ID to use. Omit to use the default built-in voice.
              x-parser-schema-id: <anonymous-schema-24>
            text:
              type: string
              description: Text to synthesize (buffered until flush)
              x-parser-schema-id: <anonymous-schema-25>
            language:
              type: string
              description: >-
                Language code (ISO 639-1 format). Supported: en, ca, sv, es, fr,
                de, it, pt, pl, ru, nl.
              default: en
              enum:
                - en
                - ca
                - sv
                - es
                - fr
                - de
                - it
                - pt
                - pl
                - ru
                - nl
              x-parser-schema-id: <anonymous-schema-26>
            model:
              type: string
              description: >-
                TTS model to use. If not provided, automatically selected based
                on language. English uses voiceai-tts-v1-latest; other languages
                use voiceai-tts-multilingual-v1-latest. Lite models are
                English-only and must be selected explicitly.
              enum:
                - voiceai-tts-v1-latest
                - voiceai-tts-v1-2026-02-10
                - voiceai-tts-lite-v1-latest
                - voiceai-tts-lite-v1-2026-04-15
                - voiceai-tts-multilingual-v1-latest
                - voiceai-tts-multilingual-v1-2026-02-10
              x-parser-schema-id: <anonymous-schema-27>
            audio_format:
              type: string
              description: >-
                Audio output format. Basic formats (mp3, wav, pcm) use 32kHz
                sample rate. Format-specific options allow control over sample
                rate and bitrate. All PCM formats (pcm, pcm_*) use 16-bit signed
                little-endian mono.
              enum:
                - mp3
                - wav
                - pcm
                - alaw_8000
                - mp3_22050_32
                - mp3_24000_48
                - mp3_44100_32
                - mp3_44100_64
                - mp3_44100_96
                - mp3_44100_128
                - mp3_44100_192
                - opus_48000_32
                - opus_48000_64
                - opus_48000_96
                - opus_48000_128
                - opus_48000_192
                - pcm_8000
                - pcm_16000
                - pcm_22050
                - pcm_24000
                - pcm_32000
                - pcm_44100
                - pcm_48000
                - ulaw_8000
                - wav_16000
                - wav_22050
                - wav_24000
              default: mp3
              x-enum-descriptions:
                mp3: MP3 format (32kHz)
                wav: WAV format (32kHz)
                pcm: PCM format (32kHz)
                alaw_8000: A-law telephony format (8kHz)
                mp3_22050_32: MP3 at 22.05kHz, 32kbps
                mp3_24000_48: MP3 at 24kHz, 48kbps
                mp3_44100_32: MP3 at 44.1kHz, 32kbps
                mp3_44100_64: MP3 at 44.1kHz, 64kbps
                mp3_44100_96: MP3 at 44.1kHz, 96kbps
                mp3_44100_128: MP3 at 44.1kHz, 128kbps
                mp3_44100_192: MP3 at 44.1kHz, 192kbps
                opus_48000_32: Opus at 48kHz, 32kbps
                opus_48000_64: Opus at 48kHz, 64kbps
                opus_48000_96: Opus at 48kHz, 96kbps
                opus_48000_128: Opus at 48kHz, 128kbps
                opus_48000_192: Opus at 48kHz, 192kbps
                pcm_8000: PCM at 8kHz
                pcm_16000: PCM at 16kHz
                pcm_22050: PCM at 22.05kHz
                pcm_24000: PCM at 24kHz
                pcm_32000: PCM at 32kHz
                pcm_44100: PCM at 44.1kHz
                pcm_48000: PCM at 48kHz
                ulaw_8000: μ-law telephony format (8kHz)
                wav_16000: WAV at 16kHz
                wav_22050: WAV at 22.05kHz
                wav_24000: WAV at 24kHz
              x-parser-schema-id: <anonymous-schema-28>
            temperature:
              type: number
              description: Sampling temperature (0.0-2.0)
              default: 1
              minimum: 0
              maximum: 2
              x-parser-schema-id: <anonymous-schema-29>
            top_p:
              type: number
              description: Nucleus sampling (0.0-1.0)
              default: 0.8
              minimum: 0
              maximum: 1
              x-parser-schema-id: <anonymous-schema-30>
            dictionary_id:
              type: string
              description: Optional managed pronunciation dictionary identifier.
              x-parser-schema-id: <anonymous-schema-31>
            dictionary_version:
              type: integer
              description: >-
                Optional managed dictionary version. Defaults to latest when
                omitted.
              minimum: 1
              x-parser-schema-id: <anonymous-schema-32>
            delivery_mode:
              type: string
              description: >-
                Delivery cadence mode: 'raw' (default) or 'paced'. Paced
                delivery is applied only to PCM-based outputs ('pcm', 'pcm_*',
                'ulaw_8000', 'alaw_8000'); other formats fall back to raw
                cadence.
              enum:
                - raw
                - paced
              default: raw
              x-parser-schema-id: <anonymous-schema-33>
            flush:
              type: boolean
              description: Trigger audio generation from buffer
              default: false
              x-parser-schema-id: <anonymous-schema-34>
            auto_close:
              type: boolean
              description: >-
                If true, automatically close this context after flush completes.
                Useful for fire-and-forget TTS generation where you want to
                release the concurrent generation slot immediately. Server sends
                context_closed after is_last when this is set.
              default: false
              x-parser-schema-id: <anonymous-schema-35>
          required:
            - text
          x-parser-schema-id: <anonymous-schema-22>
        title: Context Initialization Message
        description: First message to a context_id to set up that context
        example: |-
          {
            "context_id": "<string>",
            "voice_id": "<string>",
            "text": "<string>",
            "language": "<string>",
            "model": "<string>",
            "audio_format": "<string>",
            "temperature": 123,
            "top_p": 123,
            "dictionary_id": "<string>",
            "dictionary_version": 123,
            "delivery_mode": "<string>",
            "flush": true,
            "auto_close": true
          }
        bindings: []
        extensions:
          - id: x-parser-unique-object-id
            value: initMessage
    bindings: []
    extensions: &ref_0
      - id: x-parser-unique-object-id
        value: /api/v1/tts/multi-stream
  - &ref_2
    id: sendTextMulti
    title: Send Text to Context
    description: >-
      Send text-only messages to an existing context (voice settings are
      remembered for that context)
    type: receive
    messages:
      - &ref_7
        id: textMessage
        contentType: application/json
        payload:
          - name: Text-Only Message
            description: >-
              Subsequent messages to an existing context (text-only, no params).
              Can include close_context or close_socket to control
              context/connection lifecycle.
            type: object
            properties:
              - name: context_id
                type: string
                description: >-
                  Context identifier. Required to identify which context this
                  message belongs to.
                required: true
              - name: text
                type: string
                description: >-
                  Text to generate speech for. Will be accumulated until flush.
                  Optional if close_context is True.
                required: false
              - name: flush
                type: boolean
                description: >-
                  If true, generate speech for all buffered text. Optional if
                  close_context is True.
                required: false
              - name: close_context
                type: boolean
                description: >-
                  If true, close the specified context after processing this
                  message. Can be combined with text/flush - flush will complete
                  first, then context closes.
                required: false
              - name: close_socket
                type: boolean
                description: >-
                  If true, close the entire WebSocket connection after
                  processing this message.
                required: false
              - name: auto_close
                type: boolean
                description: >-
                  If true, automatically close this context after flush
                  completes. Useful for fire-and-forget TTS generation where you
                  want to release the concurrent generation slot immediately.
                  Server sends context_closed after is_last when this is set.
                required: false
        headers: []
        jsonPayloadSchema:
          type: object
          properties:
            context_id:
              type: string
              description: >-
                Context identifier. Required to identify which context this
                message belongs to.
              x-parser-schema-id: <anonymous-schema-37>
            text:
              type: string
              description: >-
                Text to generate speech for. Will be accumulated until flush.
                Optional if close_context is True.
              default: ''
              x-parser-schema-id: <anonymous-schema-38>
            flush:
              type: boolean
              description: >-
                If true, generate speech for all buffered text. Optional if
                close_context is True.
              default: false
              x-parser-schema-id: <anonymous-schema-39>
            close_context:
              type: boolean
              description: >-
                If true, close the specified context after processing this
                message. Can be combined with text/flush - flush will complete
                first, then context closes.
              default: false
              x-parser-schema-id: <anonymous-schema-40>
            close_socket:
              type: boolean
              description: >-
                If true, close the entire WebSocket connection after processing
                this message.
              default: false
              x-parser-schema-id: <anonymous-schema-41>
            auto_close:
              type: boolean
              description: >-
                If true, automatically close this context after flush completes.
                Useful for fire-and-forget TTS generation where you want to
                release the concurrent generation slot immediately. Server sends
                context_closed after is_last when this is set.
              default: false
              x-parser-schema-id: <anonymous-schema-42>
          required:
            - context_id
          x-parser-schema-id: <anonymous-schema-36>
        title: Text-Only Message
        description: >-
          Subsequent messages to an existing context (text-only, no params). Can
          include close_context or close_socket to control context/connection
          lifecycle.
        example: |-
          {
            "context_id": "<string>",
            "text": "<string>",
            "flush": true,
            "close_context": true,
            "close_socket": true,
            "auto_close": true
          }
        bindings: []
        extensions:
          - id: x-parser-unique-object-id
            value: textMessage
    bindings: []
    extensions: *ref_0
  - &ref_5
    id: receiveAudioMulti
    title: Receive Audio Chunks
    description: >-
      Receive base64-encoded audio chunks with context_id as they are generated
      (interleaved for multiple contexts). After each flush completes, you will
      receive an is_last message. The same context can be reused for multiple
      flushes.
    type: send
    messages:
      - &ref_10
        id: audioChunk
        contentType: application/json
        payload:
          - name: Audio Chunk Response
            description: Base64-encoded audio chunk with context_id (streamed immediately)
            type: object
            properties:
              - name: audio
                type: string
                description: Base64-encoded audio chunk (32kHz sample rate)
                required: true
              - name: context_id
                type: string
                description: Context identifier this audio belongs to
                required: true
        headers: []
        jsonPayloadSchema:
          type: object
          properties:
            audio:
              type: string
              description: Base64-encoded audio chunk (32kHz sample rate)
              format: byte
              x-parser-schema-id: <anonymous-schema-49>
            context_id:
              type: string
              description: Context identifier this audio belongs to
              x-parser-schema-id: <anonymous-schema-50>
          required:
            - audio
            - context_id
          x-parser-schema-id: <anonymous-schema-48>
        title: Audio Chunk Response
        description: Base64-encoded audio chunk with context_id (streamed immediately)
        example: |-
          {
            "audio": "<string>",
            "context_id": "<string>"
          }
        bindings: []
        extensions:
          - id: x-parser-unique-object-id
            value: audioChunk
      - &ref_11
        id: completionMessage
        contentType: application/json
        payload:
          - name: Flush Completion Signal
            description: >-
              Sent after all audio chunks for a flush operation (separate
              message). Indicates inference is complete for this flush. The
              context remains active and can receive more text/flushes. Each
              flush generates its own is_last message.
            type: object
            properties:
              - name: is_last
                type: boolean
                description: >-
                  Indicates all audio chunks for this flush have been sent. Sent
                  after each flush completes. The context remains active for
                  more flushes.
                required: true
              - name: context_id
                type: string
                description: Context identifier this completion belongs to
                required: true
        headers: []
        jsonPayloadSchema:
          type: object
          properties:
            is_last:
              type: boolean
              description: >-
                Indicates all audio chunks for this flush have been sent. Sent
                after each flush completes. The context remains active for more
                flushes.
              const: true
              x-parser-schema-id: <anonymous-schema-52>
            context_id:
              type: string
              description: Context identifier this completion belongs to
              x-parser-schema-id: <anonymous-schema-53>
          required:
            - is_last
            - context_id
          x-parser-schema-id: <anonymous-schema-51>
        title: Flush Completion Signal
        description: >-
          Sent after all audio chunks for a flush operation (separate message).
          Indicates inference is complete for this flush. The context remains
          active and can receive more text/flushes. Each flush generates its own
          is_last message.
        example: |-
          {
            "is_last": true,
            "context_id": "<string>"
          }
        bindings: []
        extensions:
          - id: x-parser-unique-object-id
            value: completionMessage
      - &ref_12
        id: contextClosedMessage
        contentType: application/json
        payload:
          - name: Context Closure Confirmation
            description: >-
              Sent when a context is explicitly closed via close_context. This
              is a separate message from is_last to distinguish context closure
              from flush completion.
            type: object
            properties:
              - name: context_closed
                type: boolean
                description: >-
                  Indicates the context has been closed. Sent as confirmation
                  after receiving a close_context message.
                required: true
              - name: context_id
                type: string
                description: Context identifier that was closed
                required: true
        headers: []
        jsonPayloadSchema:
          type: object
          properties:
            context_closed:
              type: boolean
              description: >-
                Indicates the context has been closed. Sent as confirmation
                after receiving a close_context message.
              const: true
              x-parser-schema-id: <anonymous-schema-55>
            context_id:
              type: string
              description: Context identifier that was closed
              x-parser-schema-id: <anonymous-schema-56>
          required:
            - context_closed
            - context_id
          x-parser-schema-id: <anonymous-schema-54>
        title: Context Closure Confirmation
        description: >-
          Sent when a context is explicitly closed via close_context. This is a
          separate message from is_last to distinguish context closure from
          flush completion.
        example: |-
          {
            "context_closed": true,
            "context_id": "<string>"
          }
        bindings: []
        extensions:
          - id: x-parser-unique-object-id
            value: contextClosedMessage
      - &ref_13
        id: errorMessage
        contentType: application/json
        payload:
          - name: Error Response
            description: Error message from server with context_id
            type: object
            properties:
              - name: error
                type: string
                description: Error message
                required: true
              - name: context_id
                type: string
                description: Context identifier (if applicable)
                required: false
        headers: []
        jsonPayloadSchema:
          type: object
          properties:
            error:
              type: string
              description: Error message
              x-parser-schema-id: <anonymous-schema-58>
            context_id:
              type: string
              description: Context identifier (if applicable)
              nullable: true
              x-parser-schema-id: <anonymous-schema-59>
          required:
            - error
          x-parser-schema-id: <anonymous-schema-57>
        title: Error Response
        description: Error message from server with context_id
        example: |-
          {
            "error": "<string>",
            "context_id": "<string>"
          }
        bindings: []
        extensions:
          - id: x-parser-unique-object-id
            value: errorMessage
    bindings: []
    extensions: *ref_0
  - &ref_3
    id: closeContextMulti
    title: Close Context
    description: >-
      Close a specific context. Server responds with context_closed message to
      confirm the context is closed.
    type: receive
    messages:
      - &ref_8
        id: closeContext
        contentType: application/json
        payload:
          - name: Close Context Message
            description: >-
              Close a specific context. Can be sent as a standalone message or
              included in any message. Server responds with context_closed
              message to confirm the context is closed.
            type: object
            properties:
              - name: context_id
                type: string
                description: Context identifier to close
                required: true
              - name: close_context
                type: boolean
                description: >-
                  Must be true to close this context. Can be included in any
                  message type. Server will send context_closed message as
                  confirmation.
                required: true
        headers: []
        jsonPayloadSchema:
          type: object
          properties:
            context_id:
              type: string
              description: Context identifier to close
              x-parser-schema-id: <anonymous-schema-44>
            close_context:
              type: boolean
              description: >-
                Must be true to close this context. Can be included in any
                message type. Server will send context_closed message as
                confirmation.
              const: true
              x-parser-schema-id: <anonymous-schema-45>
          required:
            - context_id
            - close_context
          x-parser-schema-id: <anonymous-schema-43>
        title: Close Context Message
        description: >-
          Close a specific context. Can be sent as a standalone message or
          included in any message. Server responds with context_closed message
          to confirm the context is closed.
        example: |-
          {
            "context_id": "<string>",
            "close_context": true
          }
        bindings: []
        extensions:
          - id: x-parser-unique-object-id
            value: closeContext
    bindings: []
    extensions: *ref_0
  - &ref_4
    id: closeSocketMulti
    title: Close WebSocket Connection
    description: >-
      Close the entire WebSocket connection and all contexts. Server closes the
      connection after processing.
    type: receive
    messages:
      - &ref_9
        id: closeSocket
        contentType: application/json
        payload:
          - name: Close Socket Message
            description: >-
              Close entire WebSocket connection and all contexts. Can be sent as
              a standalone message or included in any message. Server closes the
              connection after processing.
            type: object
            properties:
              - name: close_socket
                type: boolean
                description: >-
                  Must be true to close entire connection. Can be included in
                  any message type. All contexts are closed and the WebSocket
                  connection is terminated.
                required: true
        headers: []
        jsonPayloadSchema:
          type: object
          properties:
            close_socket:
              type: boolean
              description: >-
                Must be true to close entire connection. Can be included in any
                message type. All contexts are closed and the WebSocket
                connection is terminated.
              const: true
              x-parser-schema-id: <anonymous-schema-47>
          required:
            - close_socket
          x-parser-schema-id: <anonymous-schema-46>
        title: Close Socket Message
        description: >-
          Close entire WebSocket connection and all contexts. Can be sent as a
          standalone message or included in any message. Server closes the
          connection after processing.
        example: |-
          {
            "close_socket": true
          }
        bindings: []
        extensions:
          - id: x-parser-unique-object-id
            value: closeSocket
    bindings: []
    extensions: *ref_0
sendOperations:
  - *ref_1
  - *ref_2
  - *ref_3
  - *ref_4
receiveOperations:
  - *ref_5
sendMessages:
  - *ref_6
  - *ref_7
  - *ref_8
  - *ref_9
receiveMessages:
  - *ref_10
  - *ref_11
  - *ref_12
  - *ref_13
extensions:
  - id: x-parser-unique-object-id
    value: /api/v1/tts/multi-stream
securitySchemes:
  - id: bearerAuth
    name: bearerAuth
    type: http
    description: >-
      API key (vk_*). Include in Authorization header: 'Bearer YOUR_API_KEY'.
      Required for all WebSocket connections. See the [Authentication
      guide](/docs/guides/authentication) for details.
    scheme: bearer
    extensions: []

````