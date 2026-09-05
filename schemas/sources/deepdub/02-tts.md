> ## Documentation Index
> Fetch the complete documentation index at: https://docs.deepdub.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Generate and stream TTS audio

> Generate and stream TTS audio based on the provided text. Returns an audio stream in the specified format (default MP3). Supported formats: `mp3`, `opus`, `mulaw`. For `wav` or `s16le` output, use the WebSocket API.

## Supported languages

| Language                 | Locale code |
| ------------------------ | ----------- |
| Arabic (Lebanon)         | `ar-LB`     |
| Arabic (Qatar)           | `ar-QA`     |
| Arabic (Saudi)           | `ar-SA`     |
| Arabic (Standard)        | `ar-SA`     |
| Arabic (Syrian)          | `ar-SY`     |
| Czech (Standard)         | `cs-CZ`     |
| Danish (Standard)        | `da-DK`     |
| Dutch (Netherlands)      | `nl-NL`     |
| English (Generic)        | `en-GB`     |
| English (Standard)       | `en-AU`     |
| English (United States)  | `en-US`     |
| Estonian (Standard)      | `et-EE`     |
| Finnish (Standard)       | `fi-FI`     |
| French (Standard)        | `fr-FR`     |
| German (Standard)        | `de-DE`     |
| Greek (Standard)         | `el-GR`     |
| Hebrew (Standard)        | `he-IL`     |
| Hindi (Standard)         | `hi-IN`     |
| Hungarian (Standard)     | `hu-HU`     |
| Indonesian (Standard)    | `id-ID`     |
| Italian (Standard)       | `it-IT`     |
| Japanese (Standard)      | `ja-JP`     |
| Korean (Standard)        | `ko-KR`     |
| Macedonian (Standard)    | `mk-MK`     |
| Norwegian (Standard)     | `nb-NO`     |
| Polish (Standard)        | `pl-PL`     |
| Portuguese (Brazil)      | `pt-BR`     |
| Romanian (Standard)      | `ro-RO`     |
| Russian (Standard)       | `ru-RU`     |
| Spanish (Latam)          | `es-419`    |
| Spanish (Latam — Mexico) | `es-MX`     |
| Spanish (Standard)       | `es-ES`     |
| Swedish (Standard)       | `sv-SE`     |
| Tamil (Standard)         | `ta-IN`     |
| Thai (Standard)          | `th-TH`     |
| Turkish (Standard)       | `tr-TR`     |

## Supported output formats

The REST API streams audio as raw bytes in the HTTP response body. Supported formats:

| Format  | Description                                                                                           |
| ------- | ----------------------------------------------------------------------------------------------------- |
| `mp3`   | Compressed audio, smallest file size. **Default.**                                                    |
| `opus`  | High-quality compressed audio, efficient for streaming.                                               |
| `mulaw` | 8-bit µ-law encoding, commonly used in telephony. Defaults to 8000 Hz if no sample rate is specified. |

<Warning>
  The REST API supports `mp3`, `opus`, and `mulaw` only. For `wav` or `s16le` output, use the [WebSocket API](/api-reference/websocket/overview).
</Warning>

## Sample rates

The sample rate is passed through to the audio conversion layer. The internal generation runs at 48 kHz and is resampled to the requested rate. If no sample rate is specified, `mulaw` defaults to 8000 Hz.

### REST vs WebSocket comparison

| Feature                           | REST API                                      | WebSocket API                                                         |
| --------------------------------- | --------------------------------------------- | --------------------------------------------------------------------- |
| **Delivery**                      | Streaming HTTP response (chunked audio bytes) | Chunked audio delivered incrementally as base64-encoded JSON messages |
| **Formats**                       | `mp3`, `opus`, `mulaw`                        | `wav` (default), `mp3`, `opus`, `mulaw`, `s16le`                      |
| **Streaming input (ctx/isFinal)** | Not supported                                 | `wav`, `s16le`, `mulaw` only                                          |
| **Default format**                | `mp3`                                         | `wav`                                                                 |
| **Default mulaw sample rate**     | 8000 Hz                                       | 8000 Hz                                                               |
| **Best for**                      | Simple integrations, file generation          | Real-time playback, low-latency applications                          |


## OpenAPI

````yaml post /tts
openapi: 3.0.0
info:
  title: Deepdub API
  description: >-
    Deepdub's Text-to-Speech API enables high-quality, expressive speech
    generation with voice cloning, accent control, and real-time streaming
    capabilities.
  contact:
    email: support@deepdub.ai
  version: '1.0'
servers:
  - url: https://restapi.deepdub.ai/api/v1
    description: Production
security:
  - ApiKeyAuth: []
externalDocs:
  description: OpenAPI
  url: https://restapi.deepdub.ai/api/v1/swagger/index.html
paths:
  /tts:
    post:
      tags:
        - TTS
      summary: Generate and stream TTS audio
      description: >-
        Generate and stream TTS audio based on the provided text. Returns an
        audio stream in the specified format (default MP3). Supported formats:
        `mp3`, `opus`, `mulaw`. For `wav` or `s16le` output, use the WebSocket
        API.
      operationId: generateTTS
      parameters:
        - description: API Key
          name: x-api-key
          in: header
          required: true
          schema:
            type: string
            default: dd-00000000000000000000000065c9cbfe
          example: dd-00000000000000000000000065c9cbfe
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/model.GenerationRequest'
            example:
              model: dd-etts-3.0
              targetText: Hello world, welcome to Deepdub.
              locale: en-US
              voicePromptId: bd1b00bb-be1c-4679-8eaa-0fcbfd4ff773
      responses:
        '200':
          description: >-
            Audio stream in the requested format (MP3, Opus, or mulaw depending
            on `format` parameter). The response body is raw audio bytes.
        '400':
          description: Bad request — invalid or missing parameters
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/model.APIError'
              example:
                success: false
                message: 'Invalid request: missing required field ''targetText'''
        '401':
          description: Unauthorized — invalid or missing API key
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/model.APIError'
              example:
                success: false
                message: 'Unauthorized: invalid or missing API key'
        '402':
          description: Insufficient credits — your account has run out of TTS credits
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/model.APIError'
              example:
                success: false
                message: 'InsufficientCredits: your account has no remaining credits'
        '429':
          description: Rate limit exceeded — too many concurrent requests
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/model.APIError'
              example:
                success: false
                message: 'RateLimit: concurrent request limit exceeded'
        '500':
          description: Internal server error
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/model.APIError'
              example:
                success: false
                message: Internal server error
components:
  schemas:
    model.GenerationRequest:
      description: >-
        Request structure for TTS generation endpoints.


        **Optional parameters** (not shown in playground): `generationId`
        (string), `targetDuration` (number, seconds), `tempo` (number, 0.5–2.0),
        `variance` (number, 0.0–1.0), `seed` (integer — `dd-etts-1.1` only;
        newer models do not use it), `temperature` (number, 0.0–1.0),
        `sampleRate` (integer), `format` (string: mp3/opus/mulaw — default mp3),
        `promptBoost` (boolean), `superStretch` (boolean), `realtime` (boolean),
        `cleanAudio` (boolean, default true), `autoGain` (boolean), `publish`
        (boolean), `accentControl` (object with accentBaseLocale, accentLocale,
        accentRatio), `performanceReferencePromptId` (string), `voiceReference`
        (string, base64-encoded audio), `targetGender` (string: male/female —
        used for language-specific handling such as Hebrew diacritics; any other
        value returns 400).
      type: object
      required:
        - locale
        - model
        - targetText
        - voicePromptId
      properties:
        model:
          description: Model ID to use for generation
          type: string
          default: dd-etts-3.0
          example: dd-etts-3.0
        targetText:
          description: Text to be converted to speech
          type: string
          example: Hello world, welcome to Deepdub.
        locale:
          description: Language locale code (e.g., en-US, fr-FR)
          type: string
          example: en-US
        voicePromptId:
          description: ID of the voice prompt to use for generation
          type: string
          example: bd1b00bb-be1c-4679-8eaa-0fcbfd4ff773
      additionalProperties: true
    model.APIError:
      description: Error response returned for all non-2xx status codes
      type: object
      required:
        - success
        - message
      properties:
        success:
          description: Always false for error responses
          type: boolean
          example: false
        message:
          description: Human-readable error message
          type: string
          example: Invalid request parameters
  securitySchemes:
    ApiKeyAuth:
      type: apiKey
      in: header
      name: x-api-key
      description: API key for authentication. Must start with `dd-` prefix.

````