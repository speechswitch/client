> ## Documentation Index
> Fetch the complete documentation index at: https://docs.cartesia.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Generate a New Access Token

> Generates a short-lived access token to make API requests from authenticated clients.



## OpenAPI

````yaml latest.yml POST /access-token
openapi: 3.0.1
info:
  title: Cartesia API
  version: 0.0.1
servers:
  - url: https://api.cartesia.ai
    description: Production
security: []
paths:
  /access-token:
    post:
      tags:
        - Auth
      summary: Generate a New Access Token
      description: >-
        Generates a short-lived access token to make API requests from
        authenticated clients.
      operationId: auth_access-token
      parameters:
        - $ref: '#/components/parameters/CartesiaVersionHeader'
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/TokenRequest'
      responses:
        '200':
          description: ''
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/TokenResponse'
      security:
        - APIKeyAuth: []
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
    TokenRequest:
      title: TokenRequest
      type: object
      properties:
        grants:
          $ref: '#/components/schemas/TokenGrant'
          nullable: true
          description: >-
            The permissions to be granted via the token. Both TTS and STT grants
            are optional - specify only the capabilities you need.
        expires_in:
          type: integer
          nullable: true
          description: >-
            The number of seconds the token will be valid for since the time of
            generation. The maximum is 1 hour (3600 seconds).
    TokenResponse:
      title: TokenResponse
      type: object
      properties:
        token:
          type: string
          description: The generated Access Token.
      required:
        - token
    TokenGrant:
      title: TokenGrant
      type: object
      properties:
        tts:
          type: boolean
          nullable: true
          description: >-
            The `tts` grant allows the token to be used to access any TTS
            endpoint.
        stt:
          type: boolean
          nullable: true
          description: >-
            The `stt` grant allows the token to be used to access any STT
            endpoint.
        agent:
          type: boolean
          nullable: true
          description: >-
            The `agent` grant allows the token to be used to access the Agent
            websocket calling
            [endpoint](/line/integrations/web-calls#connection).
  securitySchemes:
    APIKeyAuth:
      type: http
      scheme: bearer
      bearerFormat: API Key
      description: >-
        Cartesia API key (`sk_car_...`). Get one at
        [play.cartesia.ai/keys](https://play.cartesia.ai/keys).
      x-default: $CARTESIA_API_KEY

````