> For clean Markdown of any page, append .md to the page URL.
> For a complete documentation index, see https://space.respeecher.com/docs/llms.txt.
> For AI client integration (Claude Code, Cursor, etc.), connect to the MCP server at https://space.respeecher.com/_mcp/server.

# WebSocket

GET /tts/websocket

A single connection for multiple concurrent text-to-speech generations, with input and output streaming. Provides the best latency and performance out of the text-to-speech endpoints. See also the [WebSockets Guide](./web-sockets-guide).

Reference: https://space.respeecher.com/docs/space/api/tts/web-socket

## AsyncAPI Specification

```yaml
asyncapi: 2.6.0
info:
  title: WebSocket
  version: subpackage_tts.WebSocket
  description: >-
    A single connection for multiple concurrent text-to-speech generations, with
    input and output streaming. Provides the best latency and performance out of
    the text-to-speech endpoints. See also the [WebSockets
    Guide](./web-sockets-guide).
channels:
  /tts/websocket:
    description: >-
      A single connection for multiple concurrent text-to-speech generations,
      with input and output streaming. Provides the best latency and performance
      out of the text-to-speech endpoints. See also the [WebSockets
      Guide](./web-sockets-guide).
    publish:
      operationId: web-socket-publish
      summary: Server message
      description: Audio chunk, finished context notification, or an error.
      message:
        name: response
        description: Audio chunk, finished context notification, or an error.
        payload:
          $ref: '#/components/schemas/type_tts:Response'
    subscribe:
      operationId: web-socket-subscribe
      summary: Client messages
      message:
        oneOf:
          - $ref: '#/components/messages/subpackage_tts.WebSocket-client-0-generate'
          - $ref: '#/components/messages/subpackage_tts.WebSocket-client-1-cancel'
servers:
  public-en-rt:
    url: wss://api.respeecher.com/v1/public/tts/en-rt
    protocol: wss
    x-default: true
  public-ua-rt:
    url: wss://api.respeecher.com/v1/public/tts/ua-rt
    protocol: wss
components:
  messages:
    subpackage_tts.WebSocket-client-0-generate:
      name: generate
      description: Text-to-speech generation request.
      payload:
        $ref: '#/components/schemas/type_tts:ContextfulGenerationRequest'
    subpackage_tts.WebSocket-client-1-cancel:
      name: cancel
      description: >-
        Stop receiving audio for a particular context ID. Credits for already
        generated yet unstreamed audio will still be charged.
      payload:
        $ref: '#/components/schemas/type_tts:CancellationRequest'
  schemas:
    type_tts:Response:
      oneOf:
        - type: object
          properties:
            type:
              type: string
              enum:
                - chunk
              description: 'Discriminator value: chunk'
            data:
              type: string
              format: base64
              description: Speech audio (raw PCM).
            context_id:
              type: string
          required:
            - type
            - data
            - context_id
        - type: object
          properties:
            type:
              type: string
              enum:
                - done
              description: 'Discriminator value: done'
            context_id:
              type: string
              description: ID of the context that has finished generating audio.
          required:
            - type
            - context_id
        - type: object
          properties:
            type:
              type: string
              enum:
                - error
              description: 'Discriminator value: error'
            error:
              type: string
              description: Error message.
            status_code:
              type: integer
              description: HTTP status code most appropriate for this error.
            context_id:
              type: string
          required:
            - type
            - error
            - status_code
      discriminator:
        propertyName: type
      title: Response
    type_voices:SamplingParams:
      type: object
      properties:
        seed:
          type: integer
          description: >-
            Generations with the same parameters _including_ a non-null `seed`
            are identical.
        temperature:
          type: number
          format: double
          description: >-
            Smaller values correspond to more stable but less expressive speech.
            Must be greater than or equal to 0.
        top_k:
          type: integer
          description: Must be -1 or greater than 0.
        top_p:
          type: number
          format: double
          description: Must be greater than 0 and less than or equal to 1.
        min_p:
          type: number
          format: double
          description: Must be between 0 and 1, inclusive.
        presence_penalty:
          type: number
          format: double
          description: Must be between 0 and 2, inclusive.
        repetition_penalty:
          type: number
          format: double
          description: Must be between 1 and 2, inclusive.
        frequency_penalty:
          type: number
          format: double
          description: Must be between 0 and 2, inclusive.
      title: SamplingParams
    type_tts:Voice:
      type: object
      properties:
        id:
          type: string
        sampling_params:
          $ref: '#/components/schemas/type_voices:SamplingParams'
          description: >-
            Optional sampling params overrides. The defaults for this voice can
            be obtained through the
            [Voices](../voices/list#response.body.sampling_params) endpoint. See
            also the [Sampling Params Guide](../tts/sampling-params-guide).
      required:
        - id
      title: Voice
    type_tts:StreamingEncoding:
      type: string
      enum:
        - pcm_f32le
        - pcm_s16le
        - pcm_mulaw
      title: StreamingEncoding
    type_tts:StreamingOutputFormat:
      type: object
      properties:
        sample_rate:
          type: integer
          description: Audio sample rate, defaults to 22050.
        encoding:
          $ref: '#/components/schemas/type_tts:StreamingEncoding'
      title: StreamingOutputFormat
    type_tts:ContextfulGenerationRequest:
      type: object
      properties:
        transcript:
          type: string
          description: Text for narration.
        voice:
          $ref: '#/components/schemas/type_tts:Voice'
          description: Voice for narration.
        output_format:
          $ref: '#/components/schemas/type_tts:StreamingOutputFormat'
          description: Audio format specification.
        context_id:
          type: string
          description: >-
            Use different context IDs for different generations over one
            WebSocket connection.
        continue:
          type: boolean
          description: >-
            Set to `true` for smooth prosody if text is streamed in chunks and
            this is not the last chunk.
      required:
        - transcript
        - voice
        - context_id
      title: ContextfulGenerationRequest
    type_tts:CancellationRequest:
      type: object
      properties:
        context_id:
          type: string
          description: >-
            Use different context IDs for different generations over one
            WebSocket connection.
        cancel:
          type: boolean
          enum:
            - true
      required:
        - context_id
        - cancel
      title: CancellationRequest

```