# Get the list of voice characters for the current user

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /api/voice:
    get:
      summary: Get the list of voice characters for the current user
      deprecated: false
      description: >-
        **This endpoint is not paginated** — it returns every voice the user
        owns in one response, with no `limit` / `offset` / `cursor`. Purchased
        market voices are prepended to the **front** of the array and carry ids
        of the form `market:<uuid>`; pass them through verbatim when generating.


        The statuses `lora-pending`, `lora-failed` and `lora-awaiting` are
        hidden by default. Pass `show=full` to see professional clones that are
        still training or that failed.


        An unrecognised `version` value **drops the filter** (all versions are
        returned) rather than raising an error or falling back to some default.
        `from` only accepts `library` / `upload`; other values are dropped the
        same way.


        :::info

        Deprecated alias: `/api/tts/voice`. See the site document "Versions and
        migration".

        :::


        :::info

        See the Errors document for the full code reference. Always use the
        `X-Vocu-App-Request-Id` response header when troubleshooting.

        :::
      tags:
        - Core/Voice Character/Manage
        - Core/Voice Character/Manage
      parameters:
        - name: from
          in: query
          description: >-
            [Optional] Voice character source, optional values are 'market'
            (from Voice Market) or 'upload' (uploaded by the user)
          required: false
          schema:
            type: string
            enum:
              - market
              - upload
            x-apifox-enum:
              - name: ''
                value: market
                description: From Voice Market
              - name: ''
                value: upload
                description: From User Upload
        - name: showMarket
          in: query
          description: >-
            [Optional] If true, characters from the Voice Market will be
            returned; otherwise, they will be hidden
          required: false
          schema:
            type: boolean
            default: false
      responses:
        '200':
          x-apifox-name: Successfully retrieved voice character list
          x-apifox-ordering: 0
          description: Voice list (unpaginated, market voices first)
          content:
            application/json:
              schema:
                type: object
                properties:
                  status:
                    type: integer
                    description: Status Code
                    examples:
                      - 200
                    x-apifox-mock: '@pick([''200''])'
                  message:
                    type: string
                    description: Status Message
                    examples:
                      - OK
                    x-apifox-mock: OK
                  data:
                    type: array
                    description: Voice Character List
                    items:
                      $ref: '#/components/schemas/Voice'
                x-apifox-orders:
                  - status
                  - message
                  - data
                required:
                  - status
                  - message
                  - data
                x-apifox-ignore-properties: []
              example:
                status: 200
                message: OK
                data:
                  - id: ac68e5c9-25d6-4024-b42e-9777c6277b14
                    idForGenerate: bf20083c-b161-46eb-8a7e-d9bc62ea7aaf
                    name: Sai Guolan
                    status: pending
                    metadata:
                      avatar: https://loremflickr.com/3851/3726?lock=5020255648078239
                      description: Armchair enthusiast, graduate
                      prompts:
                        - id: 4dd2f015-1c9d-403e-8ef0-23ca76b8ebad
                          name: Brave
                          promptOriginAudioStorageUrl: >-
                            https://storage.vocu.ai/prompt/744386/002747-playback-lijo9z.mp3
                  - id: ea6c112a-6c78-4d7d-beda-14cecf9fa85b
                    idForGenerate: 7f6d050c-b227-4cd8-8b2e-03cd53f7fd5c
                    name: Che Ziyan
                    status: lora-success
                    metadata:
                      avatar: https://loremflickr.com/1215/2227?lock=5797113421436778
                      description: Dreamer, inventor, gourmet
                      prompts:
                        - id: c6955615-18cb-4189-8207-1e7b06a07c10
                          name: Cold
                          promptOriginAudioStorageUrl: >-
                            https://storage.vocu.ai/prompt/035564/083043-playback-ozp48y.mp3
                        - id: a5c925ad-ea35-4d89-ae06-c4e538c617e3
                          name: Bitter
                          promptOriginAudioStorageUrl: >-
                            https://storage.vocu.ai/prompt/538614/851232-playback-u5biu8.mp3
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
      x-apifox-folder: Core/Voice Character/Manage
      x-apifox-status: released
      x-run-in-apifox: https://app.apifox.com/web/project/5878926/apis/api-373800498-run
components:
  schemas:
    Voice:
      type: object
      description: Voice Character Details
      properties:
        id:
          type: string
          description: Voice Character ID
          x-apifox-mock: '{{$string.uuid}}'
        name:
          type: string
          description: Voice Character Name
          x-apifox-mock: '{{$person.fullName}}'
        status:
          type: string
          description: >-
            Voice Character Status, can be pending (instant clone completed),
            lora-pending (professional clone training in progress), lora-success
            (professional clone completed), lora-failed (professional clone
            failed)


            Only `lora-success`, `pending`, `lora-awaiting-auto-reupload` can be
            used for generation. `creating` returns 409 and `failed` returns
            400. The list endpoint hides `lora-pending` / `lora-failed` /
            `lora-awaiting` unless `show=full` is passed.
          enum:
            - creating
            - failed
            - pending
            - lora-success
            - lora-pending
            - lora-failed
            - lora-awaiting
            - lora-awaiting-auto-reupload
            - lora-need-reupload
          x-apifox-enum:
            - value: creating
              name: creating
              description: >-
                Creating. Generation against this voice returns 409
                VOICE_CREATING
            - value: failed
              name: failed
              description: >-
                Creation failed. Generation against this voice returns 400
                VOICE_CREATE_FAILED
            - value: pending
              name: pending
              description: Instant clone ready; can be used for generation
            - value: lora-success
              name: lora-success
              description: Professional clone ready; can be used for generation
            - value: lora-pending
              name: lora-pending
              description: >-
                Professional clone training. Hidden from the list unless
                show=full
            - value: lora-failed
              name: lora-failed
              description: Professional clone failed. Hidden from the list unless show=full
            - value: lora-awaiting
              name: lora-awaiting
              description: >-
                Queued for professional cloning. Hidden from the list unless
                show=full
            - value: lora-awaiting-auto-reupload
              name: lora-awaiting-auto-reupload
              description: >-
                Waiting for automatic material re-upload; can still be used for
                generation
            - value: lora-need-reupload
              name: lora-need-reupload
              description: Manual re-upload of training material is required
          x-apifox-mock: '@pick([''pending'',''lora-success''])'
        metadata:
          type: object
          description: Voice Character Metadata
          properties:
            avatar:
              type: string
              description: Voice Character Avatar URL
              x-apifox-mock: '{{$image.url}}'
            description:
              type: string
              description: Voice Character Description
              x-apifox-mock: '{{$person.bio}}'
            prompts:
              type: array
              description: Voice Character Style List
              items:
                type: object
                description: Voice Character Style Details
                properties:
                  id:
                    type: string
                    description: Character Style ID
                    x-apifox-mock: '{{$string.uuid}}'
                  name:
                    type: string
                    description: Character Style Name
                    x-apifox-mock: '{{$word.adjective}}'
                  promptOriginAudioStorageUrl:
                    type: string
                    description: Character Style Original Sample Audio URL
                    x-apifox-mock: >-
                      https://storage.vocu.ai/prompt/{{$string.numeric(length=6)}}/{{$string.numeric(length=6)}}-playback-{{$string.alphanumeric(length=6,casing='lower')}}.mp3
                  playBackAudio:
                    type: string
                    description: Character Style Processed Preview Audio URL
                    x-apifox-mock: >-
                      https://storage.vocu.ai/prompt/{{$string.numeric(length=6)}}/{{$string.numeric(length=6)}}-playback-{{$string.alphanumeric(length=6,casing='lower')}}.mp3
                  description:
                    type: string
                    x-apifox-mock: Emotion style of {{$word.adjective(length=2)}}
                    description: Character Style Description
                  language:
                    type: string
                    enum:
                      - auto
                      - zh
                      - en-us
                      - ja
                      - ja-asmr
                      - ko
                      - fr-fr
                      - es
                      - de
                      - yue
                      - pt
                    x-apifox-enum:
                      - value: auto
                        name: Auto-detect (Cantonese is not detected)
                        description: Auto-detect (Cantonese is not detected)
                      - value: zh
                        name: Chinese
                        description: Chinese
                      - value: en-us
                        name: English
                        description: English
                      - value: ja
                        name: Japanese
                        description: Japanese
                      - value: ja-asmr
                        name: >-
                          Japanese ASMR (voice creation only; illegal for
                          synthesis)
                        description: >-
                          Japanese ASMR (voice creation only; illegal for
                          synthesis)
                      - value: ko
                        name: Korean
                        description: Korean
                      - value: fr-fr
                        name: French
                        description: French
                      - value: es
                        name: Spanish
                        description: Spanish
                      - value: de
                        name: German
                        description: German
                      - value: yue
                        name: Cantonese
                        description: Cantonese
                      - value: pt
                        name: Portuguese
                        description: Portuguese
                    default: auto
                    description: >-
                      Language of the character style sample (only supported by
                      V3.0 characters, default is auto, but Cantonese
                      auto-detection is not supported)


                      Note: values must match the list exactly (`en-us`, not
                      `en`; `fr-fr`, not `fr`). **A value outside the list does
                      not raise an error — it is silently downgraded to
                      `auto`**, so do not rely on short codes.
                  vocalFilter:
                    type: boolean
                    default: true
                    description: >-
                      Whether the character style has enabled background sound
                      function other than isolated vocals
                x-apifox-orders:
                  - id
                  - name
                  - promptOriginAudioStorageUrl
                  - playBackAudio
                  - description
                  - language
                  - vocalFilter
                required:
                  - id
                  - name
                  - promptOriginAudioStorageUrl
                  - playBackAudio
                  - language
                x-apifox-ignore-properties: []
          x-apifox-orders:
            - avatar
            - description
            - prompts
          required:
            - prompts
          x-apifox-ignore-properties: []
        version:
          type: string
          enum:
            - v1.0
            - v2.0
            - v3.0
            - v4.0
          x-apifox-enum:
            - value: v1.0
              name: v1.0
              description: Legacy; new voices can no longer be created on this version
            - value: v2.0
              name: v2.0
              description: V2 series (V2.0 – V2.7)
            - value: v3.0
              name: v3.0
              description: V3 series
            - value: v4.0
              name: v4.0
              description: V4 series. Instruct-only generation
          description: Model version of the voice character
        from:
          type: string
          description: Source of the voice character
          enum:
            - upload
            - market
          x-apifox-enum:
            - value: upload
              name: ''
              description: Uploaded by user
            - value: market
              name: ''
              description: From the voice market
      x-apifox-orders:
        - id
        - name
        - status
        - metadata
        - version
        - from
      required:
        - id
        - name
        - status
        - metadata
        - version
        - from
      title: Voice Character
      x-apifox-folder: ''
      x-apifox-ignore-properties: []
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
