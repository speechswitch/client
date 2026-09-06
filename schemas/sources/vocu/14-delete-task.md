# Delete an asynchronous generation task by ID

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /api/tts/generate/{id}:
    delete:
      summary: Delete an asynchronous generation task by ID
      deprecated: false
      description: >-
        **A job in flight cannot be deleted:** while `status` is `pending` or
        `processing` the call returns 403 `GENERATE_DELETE_IN_PROGRESS`, so wait
        until the job settles into `generated` / `failed`. There is no "cancel"
        semantics here, and the call will not abort a job that is already
        synthesising.


        After deletion the job disappears from the list and detail endpoints,
        but the produced audio file is **not** removed and credits already
        charged are **not** refunded.


        The response is just `{ status: 200 }` with no `data`.


        :::info

        See the Errors document for the full code reference. Always use the
        `X-Vocu-App-Request-Id` response header when troubleshooting.

        :::
      tags:
        - Core/Voice Generation/Async jobs
        - Core/Voice Generation/Async jobs
      parameters:
        - name: id
          in: path
          description: Generation task ID
          required: true
          example: ''
          schema:
            type: string
      responses:
        '200':
          x-apifox-name: Successfully deleted the generation task
          x-apifox-ordering: 0
          description: Deleted (no `data`)
          content:
            application/json:
              schema:
                type: object
                properties:
                  status:
                    type: integer
                    description: Status code
                    examples:
                      - 200
                    x-apifox-mock: '@pick([''200''])'
                  message:
                    type: string
                    description: Status message
                    examples:
                      - OK
                    x-apifox-mock: OK
                x-apifox-orders:
                  - status
                  - message
                x-apifox-ignore-properties: []
              example:
                status: 200
                message: OK
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
        '403':
          x-apifox-name: Forbidden
          description: GENERATE_DELETE_IN_PROGRESS
          content:
            application/json:
              schema: *ref_0
              examples:
                GENERATE_DELETE_IN_PROGRESS:
                  summary: >-
                    GENERATE_DELETE_IN_PROGRESS — Cannot delete while
                    processing.
                  value:
                    status: 403
                    code: GENERATE_DELETE_IN_PROGRESS
                    message: Cannot delete while processing.
          headers: {}
        '404':
          x-apifox-name: Not found
          description: GENERATE_NOT_FOUND
          content:
            application/json:
              schema: *ref_0
              examples:
                GENERATE_NOT_FOUND:
                  summary: GENERATE_NOT_FOUND — Generation record not found.
                  value:
                    status: 404
                    code: GENERATE_NOT_FOUND
                    message: Generation record not found.
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
      x-apifox-folder: Core/Voice Generation/Async jobs
      x-apifox-status: released
      x-run-in-apifox: https://app.apifox.com/web/project/5878926/apis/api-373800508-run
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
