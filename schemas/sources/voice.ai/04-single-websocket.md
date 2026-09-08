> ## Documentation Index
> Fetch the complete documentation index at: https://voice.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Single-Context WebSocket

> Single generation per connection. Text is buffered until flush, audio streams back, then server closes connection (code 1000). For multiple generations, use `/multi-stream`.

**Authentication:** `Authorization: Bearer YOUR_API_KEY`



## AsyncAPI

````yaml docs/asyncapi.json /api/v1/tts/stream
id: /api/v1/tts/stream
title: Single-Context WebSocket
description: >-
  Single generation per connection. Text is buffered until flush, audio streams
  back, then server closes connection (code 1000). For multiple generations, use
  `/multi-stream`.


  **Authentication:** `Authorization: Bearer YOUR_API_KEY`
servers:
  - id: production
    protocol: wss
    host: dev.voice.ai
    bindings: []
    variables: []
address: /api/v1/tts/stream
parameters: []
bindings: []
operations:
  - &ref_1
    id: sendInitSingle
    title: Send Initialization Message
    description: >-
      Send the first message to initialize the session with voice, model, and
      language settings. Include text and flush=true for immediate generation.
    type: receive
    messages:
      - &ref_4
        id: initMessage
        contentType: application/json
        payload:
          - name: Initialization Message
            description: First message to set up the session (sets voice, model, language)
            type: object
            properties:
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
        headers: []
        jsonPayloadSchema:
          type: object
          properties:
            voice_id:
              type: string
              description: Voice ID to use. Omit to use the default built-in voice.
              x-parser-schema-id: <anonymous-schema-2>
            text:
              type: string
              description: Text to synthesize (buffered until flush)
              x-parser-schema-id: <anonymous-schema-3>
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
              x-parser-schema-id: <anonymous-schema-4>
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
              x-parser-schema-id: <anonymous-schema-5>
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
              x-parser-schema-id: <anonymous-schema-6>
            temperature:
              type: number
              description: Sampling temperature (0.0-2.0)
              default: 1
              minimum: 0
              maximum: 2
              x-parser-schema-id: <anonymous-schema-7>
            top_p:
              type: number
              description: Nucleus sampling (0.0-1.0)
              default: 0.8
              minimum: 0
              maximum: 1
              x-parser-schema-id: <anonymous-schema-8>
            dictionary_id:
              type: string
              description: Optional managed pronunciation dictionary identifier.
              x-parser-schema-id: <anonymous-schema-9>
            dictionary_version:
              type: integer
              description: >-
                Optional managed dictionary version. Defaults to latest when
                omitted.
              minimum: 1
              x-parser-schema-id: <anonymous-schema-10>
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
              x-parser-schema-id: <anonymous-schema-11>
            flush:
              type: boolean
              description: Trigger audio generation from buffer
              default: false
              x-parser-schema-id: <anonymous-schema-12>
          required:
            - text
          x-parser-schema-id: <anonymous-schema-1>
        title: Initialization Message
        description: First message to set up the session (sets voice, model, language)
        example: |-
          {
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
            "flush": true
          }
        bindings: []
        extensions:
          - id: x-parser-unique-object-id
            value: initMessage
    bindings: []
    extensions: &ref_0
      - id: x-parser-unique-object-id
        value: /api/v1/tts/stream
  - &ref_2
    id: sendTextSingle
    title: Buffer Additional Text
    description: >-
      Buffer additional text before flush. Once flush=true is sent, audio
      generates and connection closes. No further messages possible after flush.
    type: receive
    messages:
      - &ref_5
        id: textMessage
        contentType: application/json
        payload:
          - name: Text Buffering Message
            description: >-
              Buffer additional text before flush (text-only, no params). After
              flush, connection closes.
            type: object
            properties:
              - name: text
                type: string
                description: Additional text to buffer (appended to existing buffer)
                required: true
              - name: flush
                type: boolean
                description: >-
                  Trigger audio generation. Once flushed, audio streams and
                  connection closes.
                required: false
        headers: []
        jsonPayloadSchema:
          type: object
          properties:
            text:
              type: string
              description: Additional text to buffer (appended to existing buffer)
              x-parser-schema-id: <anonymous-schema-14>
            flush:
              type: boolean
              description: >-
                Trigger audio generation. Once flushed, audio streams and
                connection closes.
              default: false
              x-parser-schema-id: <anonymous-schema-15>
          required:
            - text
          x-parser-schema-id: <anonymous-schema-13>
        title: Text Buffering Message
        description: >-
          Buffer additional text before flush (text-only, no params). After
          flush, connection closes.
        example: |-
          {
            "text": "<string>",
            "flush": true
          }
        bindings: []
        extensions:
          - id: x-parser-unique-object-id
            value: textMessage
    bindings: []
    extensions: *ref_0
  - &ref_3
    id: receiveAudioSingle
    title: Receive Audio Chunks
    description: >-
      Receive base64-encoded audio chunks. After is_last, server closes
      connection. Errors close connection with close code (no JSON error
      message).
    type: send
    messages:
      - &ref_6
        id: audioChunk
        contentType: application/json
        payload:
          - name: Audio Chunk Response
            description: Base64-encoded audio chunk (streamed immediately)
            type: object
            properties:
              - name: audio
                type: string
                description: Base64-encoded audio chunk (32kHz sample rate)
                required: true
        headers: []
        jsonPayloadSchema:
          type: object
          properties:
            audio:
              type: string
              description: Base64-encoded audio chunk (32kHz sample rate)
              format: byte
              x-parser-schema-id: <anonymous-schema-17>
          required:
            - audio
          x-parser-schema-id: <anonymous-schema-16>
        title: Audio Chunk Response
        description: Base64-encoded audio chunk (streamed immediately)
        example: |-
          {
            "audio": "<string>"
          }
        bindings: []
        extensions:
          - id: x-parser-unique-object-id
            value: audioChunk
      - &ref_7
        id: completionMessage
        contentType: application/json
        payload:
          - name: Completion Signal
            description: >-
              Sent after all audio chunks. Server then closes connection (code
              1000).
            type: object
            properties:
              - name: is_last
                type: boolean
                description: >-
                  Indicates all audio chunks have been sent. Connection will
                  close immediately after.
                required: true
        headers: []
        jsonPayloadSchema:
          type: object
          properties:
            is_last:
              type: boolean
              description: >-
                Indicates all audio chunks have been sent. Connection will close
                immediately after.
              const: true
              x-parser-schema-id: <anonymous-schema-19>
          required:
            - is_last
          x-parser-schema-id: <anonymous-schema-18>
        title: Completion Signal
        description: >-
          Sent after all audio chunks. Server then closes connection (code
          1000).
        example: |-
          {
            "is_last": true
          }
        bindings: []
        extensions:
          - id: x-parser-unique-object-id
            value: completionMessage
      - &ref_8
        id: errorMessage
        contentType: application/json
        payload:
          - name: Error Close Event
            description: Close event emitted on protocol/validation errors
            type: object
            properties:
              - name: error
                type: string
                description: Close reason text from server
                required: true
        headers: []
        jsonPayloadSchema:
          type: object
          properties:
            error:
              type: string
              description: Close reason text from server
              x-parser-schema-id: <anonymous-schema-21>
          required:
            - error
          x-parser-schema-id: <anonymous-schema-20>
        title: Error Close Event
        description: Close event emitted on protocol/validation errors
        example: |-
          {
            "error": "<string>"
          }
        bindings: []
        extensions:
          - id: x-parser-unique-object-id
            value: errorMessage
    bindings: []
    extensions: *ref_0
sendOperations:
  - *ref_1
  - *ref_2
receiveOperations:
  - *ref_3
sendMessages:
  - *ref_4
  - *ref_5
receiveMessages:
  - *ref_6
  - *ref_7
  - *ref_8
extensions:
  - id: x-parser-unique-object-id
    value: /api/v1/tts/stream
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