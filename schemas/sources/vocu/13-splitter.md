# Create a splitter configuration

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /api/splitter:
    post:
      summary: Create a splitter configuration
      deprecated: false
      description: >-
        Create a reusable splitter configuration. A splitter takes **a stretch
        of text with placeholder markers**, splits it into utterances, and binds
        a voice plus generation parameters to each utterance,

        so a multi-character dialogue can be generated in one request.


        **Working with `POST /api/tts/generate`**


        The generate endpoint has two mutually exclusive inputs: `splitter`
        (inline configuration object) and `splitterId` (reference to a saved
        configuration ID).

        The `data.id` returned here is the value you can pass as `splitterId`.
        In splitter mode you must also pass `text`, and you **must not** also
        pass `contents`.


        **Configuration validation rules** (failure → `TTS_SPLITTER_INVALID`)


        - `config` must be a non-array object.

        - After stripping the three reserved keys, if there is no placeholder,
        no `fallbackConfig`, and no `splitterMarks`, it is invalid.

        - Placeholder keys cannot be empty strings; their values must be
        non-array objects.

        - If `lookupTable` is present: it must be a non-array object; each entry
        must be a non-array object containing a **non-empty** `tags` array;
        `tags` elements may only be strings or arrays of strings.

        - If `fallbackConfig` is present: it must be a non-array object and must
        contain a string `voiceId`.

        - If `splitterMarks` is present: it must be an array, and every element
        must be a string of **exactly 2 characters**.


        **About `TTS_SPLITTER_METADATA_INVALID`**


        This error code is not produced by this CRUD group. It is thrown only
        when `POST /api/tts/generate` references a configuration via
        `splitterId`

        and the stored `metadata` JSON fails to parse; that is server-side data
        corruption (HTTP 500).


        :::info

        See the Errors document for the full code reference. Always use the
        `X-Vocu-App-Request-Id` response header when troubleshooting.

        :::
      tags:
        - Advanced/Splitter
        - Advanced/Splitter
      parameters: []
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                name:
                  type: string
                  maxLength: 100
                  description: >-
                    Configuration name. Required, must not be a blank string, at
                    most 100 characters. Trimmed before it is stored.
                config:
                  type: object
                  additionalProperties: true
                  description: >-
                    Splitter configuration object. Required. See the endpoint
                    description for validation rules.
                  properties:
                    splitterMarks:
                      type: array
                      items:
                        type: string
                        minLength: 2
                        maxLength: 2
                      description: >-
                        Bracket pairs for dynamic markers. Each element must be
                        exactly 2 characters (opening bracket, then closing
                        bracket), for example `["[]", "【】", "<>"]`. Text wrapped
                        in these brackets is extracted as a dynamic marker and
                        matched against `lookupTable`. If you omit this field,
                        only explicitly declared placeholders are recognised.
                    lookupTable:
                      type: object
                      additionalProperties: true
                      description: >-
                        Tag lookup table for dynamic markers. Each key is a
                        custom entry ID; each value must contain a non-empty
                        `tags` array. Tags are combined with OR; if a tag
                        element is itself an array of strings, those strings are
                        combined with AND. The first matching entry in
                        declaration order wins. The value may include `voiceId`
                        and other generation parameters; when `voiceId` is
                        omitted, the current configuration is inherited.
                      x-apifox-orders: []
                      properties: {}
                      x-apifox-ignore-properties: []
                    fallbackConfig:
                      type: object
                      description: >-
                        Fallback configuration, used when neither a placeholder
                        nor `lookupTable` matches. When present, it must include
                        `voiceId`. If you omit `fallbackConfig`, text segments
                        that match no configuration are discarded.
                      properties:
                        voiceId:
                          type: string
                          description: >-
                            Fallback voice ID. Required when you send
                            `fallbackConfig`.
                      required:
                        - voiceId
                      x-apifox-orders:
                        - voiceId
                      x-apifox-ignore-properties: []
                  x-apifox-orders:
                    - splitterMarks
                    - lookupTable
                    - fallbackConfig
                  x-apifox-ignore-properties: []
              required:
                - name
                - config
              x-apifox-orders:
                - name
                - config
              x-apifox-ignore-properties: []
      responses:
        '200':
          x-apifox-name: Success
          description: Created
          content:
            application/json:
              schema:
                type: object
                properties:
                  status:
                    type: integer
                    description: Business status code. Always `200` on success.
                  data:
                    type: object
                    description: Splitter configuration record
                    properties:
                      id:
                        type: string
                        format: uuid
                        description: >-
                          Splitter configuration ID (UUID). Pass it as
                          `splitterId` when generating.
                      name:
                        type: string
                        description: >-
                          Configuration name, up to 100 characters. Trimmed on
                          write.
                      config:
                        type: object
                        additionalProperties: true
                        description: >-
                          Splitter configuration object. Other than the three
                          reserved keys (`splitterMarks` / `lookupTable` /
                          `fallbackConfig`), every key is treated as a
                          placeholder whose value is the generation parameters
                          (`voiceId`, `speechRate`, and so on) that apply while
                          that placeholder is active.
                        properties:
                          splitterMarks:
                            type: array
                            items:
                              type: string
                              minLength: 2
                              maxLength: 2
                            description: >-
                              Bracket pairs for dynamic markers. Each element
                              must be exactly 2 characters (opening bracket,
                              then closing bracket), for example `["[]", "【】",
                              "<>"]`. Text wrapped in these brackets is
                              extracted as a dynamic marker and matched against
                              `lookupTable`. If you omit this field, only
                              explicitly declared placeholders are recognised.
                          lookupTable:
                            type: object
                            additionalProperties: true
                            description: >-
                              Tag lookup table for dynamic markers. Each key is
                              a custom entry ID; each value must contain a
                              non-empty `tags` array. Tags are combined with OR;
                              if a tag element is itself an array of strings,
                              those strings are combined with AND. The first
                              matching entry in declaration order wins. The
                              value may include `voiceId` and other generation
                              parameters; when `voiceId` is omitted, the current
                              configuration is inherited.
                            x-apifox-orders: []
                            properties: {}
                            x-apifox-ignore-properties: []
                          fallbackConfig:
                            type: object
                            description: >-
                              Fallback configuration, used when neither a
                              placeholder nor `lookupTable` matches. When
                              present, it must include `voiceId`. If you omit
                              `fallbackConfig`, text segments that match no
                              configuration are discarded.
                            properties:
                              voiceId:
                                type: string
                                description: >-
                                  Fallback voice ID. Required when you send
                                  `fallbackConfig`.
                            required:
                              - voiceId
                            x-apifox-orders:
                              - voiceId
                            x-apifox-ignore-properties: []
                        x-apifox-orders:
                          - splitterMarks
                          - lookupTable
                          - fallbackConfig
                        x-apifox-ignore-properties: []
                      createdAt:
                        type: string
                        format: date-time
                        description: Created at (ISO 8601)
                      updatedAt:
                        type: string
                        format: date-time
                        description: Last updated at (ISO 8601)
                    x-apifox-orders:
                      - id
                      - name
                      - config
                      - createdAt
                      - updatedAt
                    x-apifox-ignore-properties: []
                x-apifox-orders:
                  - status
                  - data
                x-apifox-ignore-properties: []
              example:
                status: 200
                data:
                  id: 3f2a1b6c-8d4e-4f27-9a10-5c7e2d81b043
                  name: Two-speaker dialogue configuration
                  config:
                    <CharacterA>:
                      voiceId: 9d7f2e14-5b30-4a6c-8e91-c2340af6b7d5
                      speechRate: 1
                    <CharacterB>:
                      voiceId: b81c04a7-6e2f-4d15-93a8-70fe1c6d5382
                      speechRate: 1
                    '[faster_speech:1.2]':
                      speechRate: 1.2
                  createdAt: '2026-08-12T09:31:44.000Z'
                  updatedAt: '2026-08-18T02:07:11.000Z'
          headers: {}
        '400':
          x-apifox-name: Bad request
          description: >-
            VALIDATION_MISSING_FIELD / VALIDATION_TOO_LONG /
            TTS_SPLITTER_INVALID
          content:
            application/json:
              schema: &ref_0
                $ref: '#/components/schemas/ErrorResponse'
              examples:
                VALIDATION_MISSING_FIELD:
                  summary: VALIDATION_MISSING_FIELD — Required field is missing.
                  value:
                    status: 400
                    code: VALIDATION_MISSING_FIELD
                    message: Required field is missing.
                VALIDATION_TOO_LONG:
                  summary: VALIDATION_TOO_LONG — Parameter value exceeds length limit.
                  value:
                    status: 400
                    code: VALIDATION_TOO_LONG
                    message: Parameter value exceeds length limit.
                TTS_SPLITTER_INVALID:
                  summary: TTS_SPLITTER_INVALID — Invalid splitter configuration.
                  value:
                    status: 400
                    code: TTS_SPLITTER_INVALID
                    message: Invalid splitter configuration.
          headers: {}
        '401':
          x-apifox-name: Unauthorized
          description: AUTH_UNAUTHORIZED
          content:
            application/json:
              schema: *ref_0
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
        '500':
          x-apifox-name: Server error
          description: SYSTEM_INTERNAL_ERROR
          content:
            application/json:
              schema: *ref_0
              examples:
                SYSTEM_INTERNAL_ERROR:
                  summary: >-
                    SYSTEM_INTERNAL_ERROR — Internal server error, please try
                    again later.
                  value:
                    status: 500
                    code: SYSTEM_INTERNAL_ERROR
                    message: Internal server error, please try again later.
                    requestId: 3f2504e0-4f89-41d3-9a0c-0305e82c3301
          headers: {}
      security:
        - bearer: []
      x-apifox-folder: Advanced/Splitter
      x-apifox-status: released
      x-run-in-apifox: https://app.apifox.com/web/project/5878926/apis/api-505321034-run
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
