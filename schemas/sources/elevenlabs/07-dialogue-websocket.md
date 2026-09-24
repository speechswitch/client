> This is a page from the ElevenLabs documentation. For a complete page index, fetch https://elevenlabs.io/docs/llms.txt. For the full documentation in a single file, fetch https://elevenlabs.io/docs/llms-full.txt.

# WebSocket

GET /v1/text-to-dialogue/stream-input

Stream expressive dialogue audio over a WebSocket by sending incremental text segments per registered voice.

The connection uses Eleven v3 dialogue models only (`model_id` must start with `eleven_v3`). The default model is `eleven_v3_conversational`.

## Session setup

* After connecting, the first JSON message **must** include `voices` (voice IDs to register for the session) and credentials if not already sent via headers or query string.
* Optional `voice_settings` and `pronunciation_dictionary_locators` are only accepted on the first message.
* For `eleven_v3_conversational`, only **one** voice ID may be registered. For `eleven_v3`, you may register up to **10** voices.

## Streaming text

* Send `inputs`: an array of `{ "text", "voice_id", "new_turn"? }`. Text for the same turn is buffered until the server has enough context (at least \~40 characters and 8 words), then partial audio chunks are emitted.
* Set `new_turn` to `true` (or switch `voice_id`) to finalize the current prosody segment and start a new speaker turn.

## Control messages

* `flush`: force generation of any buffered text without closing the socket.
* `close_socket`: flush remaining audio, send a final message, and close the connection.
* `keep_alive`: reset the **20 second** receive timeout (no generation).

## Authentication

Use the `xi-api-key` or `Authorization` header, `single_use_token` query parameter, or include `xi_api_key`, `authorization`, or `single_use_token` in the first message body (same pattern as [Text to Speech WebSocket](/docs/api-reference/text-to-speech/v-1-text-to-speech-voice-id-stream-input)). Anonymous sessions are rejected.

For non-streaming dialogue over HTTP, see [Create dialogue](/docs/api-reference/text-to-dialogue/convert) and [Stream dialogue](/docs/api-reference/text-to-dialogue/stream).

Reference: https://elevenlabs.io/docs/api-reference/text-to-dialogue/ttd-websocket

## AsyncAPI Specification

```yaml
asyncapi: 2.6.0
info:
  title: V 1 Text To Dialogue Stream Input
  version: subpackage_v1TextToDialogueStreamInput.v1TextToDialogueStreamInput
  description: >
    Stream expressive dialogue audio over a WebSocket by sending incremental
    text segments per registered voice.


    The connection uses Eleven v3 dialogue models only (`model_id` must start
    with `eleven_v3`). The default model is `eleven_v3_conversational`.


    ## Session setup

    - After connecting, the first JSON message **must** include `voices` (voice
    IDs to register for the session) and credentials if not already sent via
    headers or query string.

    - Optional `voice_settings` and `pronunciation_dictionary_locators` are only
    accepted on the first message.

    - For `eleven_v3_conversational`, only **one** voice ID may be registered.
    For `eleven_v3`, you may register up to **10** voices.


    ## Streaming text

    - Send `inputs`: an array of `{ "text", "voice_id", "new_turn"? }`. Text for
    the same turn is buffered until the server has enough context (at least ~40
    characters and 8 words), then partial audio chunks are emitted.

    - Set `new_turn` to `true` (or switch `voice_id`) to finalize the current
    prosody segment and start a new speaker turn.


    ## Control messages

    - `flush`: force generation of any buffered text without closing the socket.

    - `close_socket`: flush remaining audio, send a final message, and close the
    connection.

    - `keep_alive`: reset the **20 second** receive timeout (no generation).


    ## Authentication

    Use the `xi-api-key` or `Authorization` header, `single_use_token` query
    parameter, or include `xi_api_key`, `authorization`, or `single_use_token`
    in the first message body (same pattern as [Text to Speech
    WebSocket](/docs/api-reference/text-to-speech/v-1-text-to-speech-voice-id-stream-input)).
    Anonymous sessions are rejected.


    For non-streaming dialogue over HTTP, see [Create
    dialogue](/docs/api-reference/text-to-dialogue/convert) and [Stream
    dialogue](/docs/api-reference/text-to-dialogue/stream).
channels:
  /v1/text-to-dialogue/stream-input:
    description: >
      Stream expressive dialogue audio over a WebSocket by sending incremental
      text segments per registered voice.


      The connection uses Eleven v3 dialogue models only (`model_id` must start
      with `eleven_v3`). The default model is `eleven_v3_conversational`.


      ## Session setup

      - After connecting, the first JSON message **must** include `voices`
      (voice IDs to register for the session) and credentials if not already
      sent via headers or query string.

      - Optional `voice_settings` and `pronunciation_dictionary_locators` are
      only accepted on the first message.

      - For `eleven_v3_conversational`, only **one** voice ID may be registered.
      For `eleven_v3`, you may register up to **10** voices.


      ## Streaming text

      - Send `inputs`: an array of `{ "text", "voice_id", "new_turn"? }`. Text
      for the same turn is buffered until the server has enough context (at
      least ~40 characters and 8 words), then partial audio chunks are emitted.

      - Set `new_turn` to `true` (or switch `voice_id`) to finalize the current
      prosody segment and start a new speaker turn.


      ## Control messages

      - `flush`: force generation of any buffered text without closing the
      socket.

      - `close_socket`: flush remaining audio, send a final message, and close
      the connection.

      - `keep_alive`: reset the **20 second** receive timeout (no generation).


      ## Authentication

      Use the `xi-api-key` or `Authorization` header, `single_use_token` query
      parameter, or include `xi_api_key`, `authorization`, or `single_use_token`
      in the first message body (same pattern as [Text to Speech
      WebSocket](/docs/api-reference/text-to-speech/v-1-text-to-speech-voice-id-stream-input)).
      Anonymous sessions are rejected.


      For non-streaming dialogue over HTTP, see [Create
      dialogue](/docs/api-reference/text-to-dialogue/convert) and [Stream
      dialogue](/docs/api-reference/text-to-dialogue/stream).
    bindings:
      ws:
        query:
          type: object
          properties:
            model_id:
              description: Any type
            output_format:
              description: Any type
            language_code:
              description: Any type
            sync_alignment:
              description: Any type
            apply_text_normalization:
              description: Any type
            seed:
              description: Any type
            enable_logging:
              description: Any type
        headers:
          type: object
          properties:
            xi-api-key:
              type: string
    publish:
      operationId: >-
        subpackage_v1TextToDialogueStreamInput.v1TextToDialogueStreamInput-publish
      summary: subscribe
      description: >-
        Defines the message types that can be received by the client from the
        server
      message:
        name: subscribe
        title: subscribe
        description: >-
          Defines the message types that can be received by the client from the
          server
        payload:
          $ref: '#/components/schemas/V1TextToDialogueStreamInputSubscribe'
    subscribe:
      operationId: >-
        subpackage_v1TextToDialogueStreamInput.v1TextToDialogueStreamInput-subscribe
      summary: publish
      description: Defines the message types that can be sent from client to server
      message:
        name: publish
        title: publish
        description: Defines the message types that can be sent from client to server
        payload:
          $ref: '#/components/schemas/V1TextToDialogueStreamInputPublish'
servers:
  Production:
    url: wss://api.elevenlabs.io/
    protocol: wss
    x-default: true
  Production US:
    url: wss://api.us.elevenlabs.io/
    protocol: wss
  Production EU:
    url: wss://api.eu.residency.elevenlabs.io/
    protocol: wss
  Production India:
    url: wss://api.in.residency.elevenlabs.io/
    protocol: wss
  Production Singapore:
    url: wss://api.sg.residency.elevenlabs.io/
    protocol: wss
components:
  schemas:
    DialogueTextAlignment:
      type: object
      properties:
        chars:
          type: array
          items:
            type: string
        char_start_times_ms:
          type: array
          items:
            type: integer
        char_durations_ms:
          type: array
          items:
            type: integer
      description: Character-level alignment data (field names use snake_case in JSON).
      title: DialogueTextAlignment
    TextToDialogueWebsocketAudioChunk:
      type: object
      properties:
        audio:
          type: string
          description: Base64-encoded audio bytes for the selected `output_format`.
        alignment:
          oneOf:
            - $ref: '#/components/schemas/DialogueTextAlignment'
            - type: 'null'
          description: >-
            Present when `sync_alignment` query parameter is `true` and the
            model returned timing data for the chunk.
        normalized_alignment:
          oneOf:
            - $ref: '#/components/schemas/DialogueTextAlignment'
            - type: 'null'
          description: Reserved for future use; currently unused by the server.
      description: Server chunk containing encoded audio and optional alignment metadata.
      title: TextToDialogueWebsocketAudioChunk
    TextToDialogueWebsocketFinalAudioForTurn:
      type: object
      properties:
        is_final_audio_for_turn:
          type: boolean
          description: Indicates that the final audio for a given turn has been sent.
      title: TextToDialogueWebsocketFinalAudioForTurn
    TextToDialogueWebsocketFinal:
      type: object
      properties:
        is_final:
          type: boolean
          description: Marks the end of the closing flush sequence.
      required:
        - is_final
      title: TextToDialogueWebsocketFinal
    TextToDialogueWebsocketError:
      type: object
      properties:
        message:
          type: string
          description: Human-readable error description.
        error:
          type: string
          description: >-
            Machine-readable error identifier (for example
            `authentication_required`).
        code:
          type: integer
          description: WebSocket close code that will follow this payload.
        param:
          type:
            - string
            - 'null'
          description: Field name related to the error, when applicable.
      required:
        - message
        - error
        - code
      title: TextToDialogueWebsocketError
    V1TextToDialogueStreamInputSubscribe:
      oneOf:
        - $ref: '#/components/schemas/TextToDialogueWebsocketAudioChunk'
        - $ref: '#/components/schemas/TextToDialogueWebsocketFinalAudioForTurn'
        - $ref: '#/components/schemas/TextToDialogueWebsocketFinal'
        - $ref: '#/components/schemas/TextToDialogueWebsocketError'
      title: V1TextToDialogueStreamInputSubscribe
    TextToDialogueWebsocketVoiceInput:
      type: object
      properties:
        text:
          type: string
          description: >-
            Text appended for this voice. Buffered with prior text until the
            server triggers generation.
        voice_id:
          type: string
          description: Must be one of the IDs from the initial `voices` array.
        new_turn:
          type: boolean
          default: false
          description: >-
            When `true`, the server finalizes the current pending segment (as if
            the speaker finished their turn) before applying this input.
      required:
        - text
        - voice_id
      title: TextToDialogueWebsocketVoiceInput
    TextToDialogueWebsocketVoiceSettings:
      type: object
      properties:
        stability:
          type: number
          format: double
          minimum: 0
          maximum: 1
          default: 0.5
          description: >-
            Determines how stable the voice is and the randomness between each
            generation. Lower values introduce broader emotional range for the
            voice. Higher values can result in a monotonous voice with limited
            emotion.
      description: >-
        Voice settings for dialogue generation. Only `stability` is supported
        for `eleven_v3` dialogue models.
      title: TextToDialogueWebsocketVoiceSettings
    PronunciationDictionaryLocator:
      type: object
      properties:
        pronunciation_dictionary_id:
          type: string
          description: The unique identifier of the pronunciation dictionary
        version_id:
          type: string
          description: The version identifier of the pronunciation dictionary
      required:
        - pronunciation_dictionary_id
        - version_id
      description: Identifies a specific pronunciation dictionary to use
      title: PronunciationDictionaryLocator
    TextToDialogueWebsocketClientMessage:
      type: object
      properties:
        inputs:
          type: array
          items:
            $ref: '#/components/schemas/TextToDialogueWebsocketVoiceInput'
          description: Dialogue lines to append for synthesis.
        flush:
          type: boolean
          default: false
          description: Force generation of buffered text without closing the connection.
        close_socket:
          type: boolean
          default: false
          description: >-
            Flush buffers, emit remaining audio, send `is_final`, and close the
            WebSocket.
        keep_alive:
          type: boolean
          default: false
          description: Resets the 20s inactivity timer; performs no synthesis.
        xi_api_key:
          type: string
          description: >-
            API key for the first message if not provided via the `xi-api-key`
            header.
        authorization:
          type: string
          description: >-
            Bearer token for the first message if not provided via the
            `Authorization` header.
        single_use_token:
          type: string
          description: >-
            Single-use token for the first message if not provided via the
            `single_use_token` query parameter.
        voices:
          type: array
          items:
            type: string
          description: >-
            Voice IDs to load for the session (first message only, required on
            first message).
        voice_settings:
          $ref: '#/components/schemas/TextToDialogueWebsocketVoiceSettings'
          description: Optional voice settings (first message only).
        pronunciation_dictionary_locators:
          type: array
          items:
            $ref: '#/components/schemas/PronunciationDictionaryLocator'
          description: Optional pronunciation dictionaries (first message only).
      description: >
        All fields are optional unless noted for the **first** message.


        **First message requirements**

        - `voices`: non-empty array of voice IDs (maximum 10 for `eleven_v3`;
        exactly 1 for `eleven_v3_conversational`).

        - Credentials if not supplied via `xi-api-key` / `Authorization` headers
        or `single_use_token` query parameter.


        **Subsequent messages**

        - Do not resend `voices`, `pronunciation_dictionary_locators`, or
        credential fields.
      title: TextToDialogueWebsocketClientMessage
    V1TextToDialogueStreamInputPublish:
      oneOf:
        - $ref: '#/components/schemas/TextToDialogueWebsocketClientMessage'
      title: V1TextToDialogueStreamInputPublish

```