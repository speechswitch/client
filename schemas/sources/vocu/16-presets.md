# List synthesis parameter presets

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /api/tts/presets:
    get:
      summary: List synthesis parameter presets
      deprecated: false
      description: >-
        Return every synthesis parameter preset. A preset is a named combination
        of sampling parameters (`temperature` / `top_k` / `top_p`, etc.),

        referenced via the `preset` field in `/api/tts/generate`,
        `/api/tts/simple-generate`, and regular Turbo channels.


        `i18n_name` and `i18n_description` are **i18n resource keys, not
        display-ready copy**;

        the client must look them up for the current language; `config` is the
        sampling parameters actually applied for that preset.


        Presets are grouped by voice version (`v2_*` / `v3_*`; a `_pro` suffix
        is the professional clone variant).

        This endpoint does not check anything beyond authentication, and does
        not return business errors.


        :::info

        See the Errors document for the full code reference. Always use the
        `X-Vocu-App-Request-Id` response header when troubleshooting.

        :::
      tags:
        - Core/Voice Generation/Synchronous
        - Core/Voice Generation/Synchronous
      parameters: []
      responses:
        '200':
          x-apifox-name: Success
          description: Query succeeded
          content:
            application/json:
              schema:
                type: object
                properties:
                  status:
                    type: integer
                    description: HTTP status code. Always `200`.
                  data:
                    type: array
                    description: Preset list
                    items:
                      type: object
                      properties:
                        key:
                          type: string
                          description: >-
                            Preset identifier, the value you should pass as
                            `preset`
                        i18n_name:
                          type: string
                          description: >-
                            i18n resource key for the preset name. Look it up on
                            the client before display.
                        i18n_description:
                          type: string
                          description: >-
                            i18n resource key for the preset description. Look
                            it up on the client before display.
                        config:
                          type: object
                          description: >-
                            Sampling parameters this preset actually uses. The
                            field set is determined by the server configuration
                            file.
                          additionalProperties:
                            type: number
                          x-apifox-orders: []
                          properties: {}
                          x-apifox-ignore-properties: []
                      x-apifox-orders:
                        - key
                        - i18n_name
                        - i18n_description
                        - config
                      x-apifox-ignore-properties: []
                x-apifox-orders:
                  - status
                  - data
                x-apifox-ignore-properties: []
              example:
                status: 200
                data:
                  - key: v2_balance
                    i18n_name: v2_balance
                    i18n_description: v2_balanceDesc
                    config:
                      temperature: 0.9
                      top_k: 1024
                      top_p: 1
                      min_p: 0
                      frequency_penalty: 0
                      presence_penalty: 0
                      repetition_penalty: 1
                      volume: 1
                  - key: v3_balance_pro
                    i18n_name: v3_balance_pro
                    i18n_description: v3_balance_proDesc
                    config:
                      temperature: 1
                      top_k: 512
                      top_p: 1
                      min_p: 0
                      frequency_penalty: 0
                      presence_penalty: 0
                      repetition_penalty: 1
                      volume: 1
          headers: {}
        '401':
          x-apifox-name: Unauthorized
          description: AUTH_UNAUTHORIZED
          content:
            application/json:
              schema: &ref_0
                $ref: '#/components/schemas/ErrorResponse'
              examples:
                AUTH_UNAUTHORIZED:
                  summary: AUTH_UNAUTHORIZED — Unauthorized.
                  value:
                    status: 401
                    code: AUTH_UNAUTHORIZED
                    message: Unauthorized.
          headers: {}
        '429':
          x-apifox-name: Rate limited
          description: RATE_LIMIT_EXCEEDED
          content:
            application/json:
              schema: *ref_0
              examples:
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
      security:
        - bearer: []
      x-apifox-folder: Core/Voice Generation/Synchronous
      x-apifox-status: released
      x-run-in-apifox: https://app.apifox.com/web/project/5878926/apis/api-505321039-run
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
