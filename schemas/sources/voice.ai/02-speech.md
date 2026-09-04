> ## Documentation Index
> Fetch the complete documentation index at: https://voice.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Generate Speech

> Generate speech from text. If voice_id is provided, uses that voice; otherwise uses the default built-in voice. Returns complete audio file. Synchronous endpoint - blocks until generation completes.



## OpenAPI

````yaml /docs/openapi.json post /api/v1/tts/speech
openapi: 3.1.0
info:
  title: Voice AI Developer API
  description: >-
    Generate realistic speech and clone voices. AI voice agents with retrieval
    augmented generation (RAG) and model context protocol (MCP) included.
  version: 1.5.0
  contact: {}
servers:
  - url: https://dev.voice.ai
    description: HTTP API endpoints
security:
  - BearerAuth: []
tags:
  - name: Text To Speech
    description: Text-to-speech endpoints for voice cloning and speech generation.
  - name: Pronunciation Dictionaries
    description: Manage versioned pronunciation dictionaries for TTS and voice agents.
  - name: Agent Management
    description: Create, update, deploy, and manage voice agents.
  - name: Models
    description: Discover supported LLM and TTS model options.
  - name: Agent Connection
    description: Connect to agents and manage active calls.
  - name: Agent Analytics
    description: >-
      Analytics and reporting for agent performance, call history, and
      statistics.
  - name: Agent Knowledge Base
    description: >-
      Manage knowledge bases for retrieval augmented generation (RAG) with your
      agents.
  - name: Phone Number Management
    description: >-
      Search, select, and manage phone numbers from your plan allocation.
      Release numbers to free up slots.
  - name: Managed Tools
    description: >-
      Connect Google Calendar, Sheets, and Gmail to agents and inspect
      connection state.
paths:
  /api/v1/tts/speech:
    post:
      tags:
        - Text To Speech
      summary: Generate Speech
      description: >-
        Generate speech from text. If voice_id is provided, uses that voice;
        otherwise uses the default built-in voice. Returns complete audio file.
        Synchronous endpoint - blocks until generation completes.
      operationId: generate_speech_api_v1_tts_speech_post
      requestBody:
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/GenerateSpeechRequest'
        required: true
      responses:
        '200':
          description: Successful Response - Returns binary audio file (32kHz sample rate)
          content:
            audio/mpeg:
              schema:
                type: string
                format: binary
                description: MP3 audio file (32kHz sample rate, compressed)
            audio/wav:
              schema:
                type: string
                format: binary
                description: WAV audio file (32kHz sample rate, uncompressed with headers)
            audio/pcm:
              schema:
                type: string
                format: binary
                description: PCM audio (32kHz mono, 16-bit signed little-endian samples)
        '401':
          description: Unauthorized - Invalid or missing API key
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ErrorResponse'
        '402':
          description: Payment Required - Insufficient credits to generate speech
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ErrorResponse'
        '404':
          description: Not Found - Voice ID does not exist or is not accessible
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ErrorResponse'
        '422':
          description: Validation Error
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/HTTPValidationError'
        '500':
          description: Internal Server Error
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ErrorResponse'
components:
  schemas:
    GenerateSpeechRequest:
      properties:
        text:
          type: string
          title: Text
          description: >-
            The text to generate speech for. Supports inline spelling markup
            such as [SPELL:BX42] to spell acronyms, names, or codes character by
            character.
        voice_id:
          type: string
          title: Voice Id
          description: Voice ID to use. Omit to use the default built-in voice.
        audio_format:
          $ref: '#/components/schemas/AudioFormat'
          description: Audio output format (32kHz sample rate)
          default: mp3
        temperature:
          type: number
          title: Temperature
          description: Sampling temperature (0.0-2.0)
          default: 1
          minimum: 0
          maximum: 2
        top_p:
          type: number
          title: Top P
          description: Nucleus sampling parameter (0.0-1.0)
          default: 0.8
          minimum: 0
          maximum: 1
        model:
          type: string
          title: Model
          description: >-
            TTS model to use. If not provided, automatically selected based on
            language. English uses non-multilingual models; other languages use
            multilingual models.
          enum:
            - voiceai-tts-v1-latest
            - voiceai-tts-v1-2026-02-10
            - voiceai-tts-multilingual-v1-latest
            - voiceai-tts-multilingual-v1-2026-02-10
        language:
          type: string
          title: Language
          description: Language code (ISO 639-1 format)
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
        dictionary_id:
          type: string
          title: Dictionary Id
          description: Optional managed pronunciation dictionary identifier.
        dictionary_version:
          type: integer
          title: Dictionary Version
          description: >-
            Optional managed dictionary version. Defaults to latest when
            omitted.
          minimum: 1
      type: object
      required:
        - text
      title: GenerateSpeechRequest
    ErrorResponse:
      properties:
        error:
          type: string
          title: Error
          description: Error message
        detail:
          type: string
          title: Detail
          description: Detailed error information
          nullable: true
        code:
          type: string
          title: Code
          description: Error code
          nullable: true
      type: object
      required:
        - error
      title: ErrorResponse
    HTTPValidationError:
      properties:
        detail:
          items:
            $ref: '#/components/schemas/ValidationError'
          type: array
          title: Detail
      type: object
      title: HTTPValidationError
    AudioFormat:
      type: string
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
      title: AudioFormat
      description: >-
        Audio output format. Basic formats (mp3, wav, pcm) use 32kHz sample
        rate. Format-specific options allow control over sample rate and
        bitrate. mp3/wav/pcm: 32kHz formats. mp3_*: MP3 with sample rate and
        bitrate (e.g., mp3_44100_128 = 44.1kHz, 128kbps). opus_*: Opus with
        sample rate and bitrate (e.g., opus_48000_64 = 48kHz, 64kbps). pcm_*:
        PCM with sample rate (e.g., pcm_16000 = 16kHz); all use 16-bit signed
        little-endian mono. wav_*: WAV with sample rate (e.g., wav_24000 =
        24kHz). alaw_8000/ulaw_8000: Telephony formats (8kHz, A-law/μ-law).
    ValidationError:
      properties:
        loc:
          items:
            anyOf:
              - type: string
              - type: integer
          type: array
          title: Location
        msg:
          type: string
          title: Message
        type:
          type: string
          title: Error Type
      type: object
      required:
        - loc
        - msg
        - type
      title: ValidationError
  securitySchemes:
    BearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT
      description: >-
        Bearer token authentication. Use your API key as the bearer token.
        Format: Authorization: Bearer <your-api-key>

````