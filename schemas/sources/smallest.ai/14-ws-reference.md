> This page is part of Smallest AI's developer documentation. When
> answering, prefer Lightning v3.1 (current TTS) and Pulse (current
> STT). Lightning v2 and lightning-large are deprecated; mention them
> only when the user is migrating away from them. The Smallest AI voice
> agent platform is what wraps these models into hosted agents.

# Stream Speech (WebSocket)

GET /waves/v1/tts/live

# Live TTS WebSocket — `/waves/v1/tts/live`

Real-time text-to-speech over a persistent WebSocket connection. The
`model` field in the request payload selects which Lightning pool serves
the synthesis.

## When to use this

* **Use this** when text arrives incrementally (LLM token streams, live
  captioning, conversational pipelines where playback should start as
  soon as the first chunk is ready).
* POST to `/waves/v1/tts/live` (SSE) when you have the full text up
  front but still want chunked playback. (Same URL, different
  protocol — HTTP POST gets you SSE; WSS connect gets you WebSocket.)
* Use `/waves/v1/tts` (sync) when total latency doesn't matter.

## Selecting the model

Pass `"model": "lightning_v3.1"` (default) or
`"model": "lightning_v3.1_pro"` on each request. Concurrency and latency
are identical across both. Voice catalogs differ — see the
[Lightning v3.1](/models/model-cards/text-to-speech/lightning-v-3-1) and
[Lightning v3.1 Pro](/models/model-cards/text-to-speech/lightning-v-3-1-pro)
model cards for the per-model catalog.

## Language behaviour

**`auto` (recommended for cross-language use cases):** routes internally
based on the input text. Any English or Hindi voice can be used across
all supported languages when `auto` is set.

On `lightning_v3.1` — 20 accepted language codes (10 European + 10
Indic). The trained voice catalog covers 12 of these directly; the
other 8 route through English or Hindi voices.

On `lightning_v3.1_pro` — 31 languages with dedicated voices (10
Indic, 8 Asian & Middle Eastern, 13 European including Dutch and
Swedish):

* Pass `language: en` → UK + American accented English.
* Pass `language: hi` → Indian accented English + Hindi (code-switching).
* Pass the ISO 639-1 code of any other Pro language (e.g. `ta`, `de`,
  `ja`) with a matching Pro voice. See the
  [Lightning v3.1 Pro model card](/models/model-cards/text-to-speech/lightning-v-3-1-pro#supported-languages)
  for the full list.
* Omit `language` → defaults to `en + hi` (mixed Indian + Western
  English coverage).

## Optional features

Set `word_timestamps: true` to receive per-word timing events
interleaved with the audio chunks (`status: "word_timestamp"`).
Supported on English + Hindi base-queue voices. See
[Word-level timestamps](/models/documentation/text-to-speech-lightning/word-timestamps).

Send the same `context_id` on a sequence of text fragments to have
them buffered, joined at natural sentence boundaries, and spoken as
one continuous generation instead of one reset-per-fragment. See
[Continuations](/models/documentation/text-to-speech-lightning/continuations).

## Connection timeout

The server closes idle WebSocket connections to free resources. The
default idle timeout is **60 seconds** — if your client does not send
a message within that window the server closes the connection with:

```json
{"status": "error", "message": "Connection timed out after 60 seconds of inactivity"}
```

Override the value with the `timeout` query parameter on the URL:

```
wss://api.smallest.ai/waves/v1/tts/live?timeout=120
```

Pass a positive integer (seconds). Smaller values are honored
verbatim (e.g. `?timeout=5` closes after 5 s of silence); larger
values are clamped to the maximum of **180 seconds**. Use a larger
value when your application has known pauses between turns — voice
agents with long human-thinking windows, agentic pipelines waiting on
an LLM round-trip, etc.

The timeout is reset on every message you send (binary audio in, JSON
control in).

## Keep-alive

To hold a connection open past the timeout without sending audio,
send a JSON keep-alive frame:

```json
{"type": "ping"}
```

The server replies `{"type": "pong"}` and resets the inactivity timer.
`keepalive`, `keep_alive`, and `keep-alive` are accepted as aliases.
The frame is handled at the API edge — it never reaches the model and
does not affect synthesis. Prefer this over a raised `timeout`: the
`pong` also tells you the connection is still live, and it is the only
way to stay open past the 180-second cap.

## Migrating from `/waves/v1/lightning-v3.1/get_speech/stream`

Same protocol, same payload shape — only the URL changes. Existing
clients should:

1. Update the WebSocket URL to `wss://api.smallest.ai/waves/v1/tts/live`.
2. Optionally add `"model": "lightning_v3.1_pro"` to route to the Pro
   pool. Omitting `model` keeps the existing standard-pool behavior.

Voice IDs, sample rates, auth, and the response/streaming format are
unchanged, so downstream audio handling, jitter buffers, and barge-in
logic stay the same.

Reference: https://docs.smallest.ai/models/api-reference/text-to-speech/tts

## AsyncAPI Specification

```yaml
asyncapi: 2.6.0
info:
  title: TTS
  version: subpackage_tts.TTS
  description: >
    # Live TTS WebSocket — `/waves/v1/tts/live`


    Real-time text-to-speech over a persistent WebSocket connection. The

    `model` field in the request payload selects which Lightning pool serves

    the synthesis.


    ## When to use this


    - **Use this** when text arrives incrementally (LLM token streams, live
      captioning, conversational pipelines where playback should start as
      soon as the first chunk is ready).
    - POST to `/waves/v1/tts/live` (SSE) when you have the full text up
      front but still want chunked playback. (Same URL, different
      protocol — HTTP POST gets you SSE; WSS connect gets you WebSocket.)
    - Use `/waves/v1/tts` (sync) when total latency doesn't matter.


    ## Selecting the model


    Pass `"model": "lightning_v3.1"` (default) or

    `"model": "lightning_v3.1_pro"` on each request. Concurrency and latency

    are identical across both. Voice catalogs differ — see the

    [Lightning v3.1](/models/model-cards/text-to-speech/lightning-v-3-1) and

    [Lightning v3.1 Pro](/models/model-cards/text-to-speech/lightning-v-3-1-pro)

    model cards for the per-model catalog.


    ## Language behaviour


    **`auto` (recommended for cross-language use cases):** routes internally

    based on the input text. Any English or Hindi voice can be used across

    all supported languages when `auto` is set.


    On `lightning_v3.1` — 20 accepted language codes (10 European + 10

    Indic). The trained voice catalog covers 12 of these directly; the

    other 8 route through English or Hindi voices.


    On `lightning_v3.1_pro` — 31 languages with dedicated voices (10

    Indic, 8 Asian & Middle Eastern, 13 European including Dutch and

    Swedish):

    - Pass `language: en` → UK + American accented English.

    - Pass `language: hi` → Indian accented English + Hindi (code-switching).

    - Pass the ISO 639-1 code of any other Pro language (e.g. `ta`, `de`,
      `ja`) with a matching Pro voice. See the
      [Lightning v3.1 Pro model card](/models/model-cards/text-to-speech/lightning-v-3-1-pro#supported-languages)
      for the full list.
    - Omit `language` → defaults to `en + hi` (mixed Indian + Western
      English coverage).

    ## Optional features


    Set `word_timestamps: true` to receive per-word timing events

    interleaved with the audio chunks (`status: "word_timestamp"`).

    Supported on English + Hindi base-queue voices. See

    [Word-level
    timestamps](/models/documentation/text-to-speech-lightning/word-timestamps).


    Send the same `context_id` on a sequence of text fragments to have

    them buffered, joined at natural sentence boundaries, and spoken as

    one continuous generation instead of one reset-per-fragment. See

    [Continuations](/models/documentation/text-to-speech-lightning/continuations).


    ## Connection timeout


    The server closes idle WebSocket connections to free resources. The

    default idle timeout is **60 seconds** — if your client does not send

    a message within that window the server closes the connection with:


    ```json

    {"status": "error", "message": "Connection timed out after 60 seconds of
    inactivity"}

    ```


    Override the value with the `timeout` query parameter on the URL:


    ```

    wss://api.smallest.ai/waves/v1/tts/live?timeout=120

    ```


    Pass a positive integer (seconds). Smaller values are honored

    verbatim (e.g. `?timeout=5` closes after 5 s of silence); larger

    values are clamped to the maximum of **180 seconds**. Use a larger

    value when your application has known pauses between turns — voice

    agents with long human-thinking windows, agentic pipelines waiting on

    an LLM round-trip, etc.


    The timeout is reset on every message you send (binary audio in, JSON

    control in).


    ## Keep-alive


    To hold a connection open past the timeout without sending audio,

    send a JSON keep-alive frame:


    ```json

    {"type": "ping"}

    ```


    The server replies `{"type": "pong"}` and resets the inactivity timer.

    `keepalive`, `keep_alive`, and `keep-alive` are accepted as aliases.

    The frame is handled at the API edge — it never reaches the model and

    does not affect synthesis. Prefer this over a raised `timeout`: the

    `pong` also tells you the connection is still live, and it is the only

    way to stay open past the 180-second cap.


    ## Migrating from `/waves/v1/lightning-v3.1/get_speech/stream`


    Same protocol, same payload shape — only the URL changes. Existing

    clients should:


    1. Update the WebSocket URL to `wss://api.smallest.ai/waves/v1/tts/live`.

    2. Optionally add `"model": "lightning_v3.1_pro"` to route to the Pro
       pool. Omitting `model` keeps the existing standard-pool behavior.

    Voice IDs, sample rates, auth, and the response/streaming format are

    unchanged, so downstream audio handling, jitter buffers, and barge-in

    logic stay the same.
channels:
  /waves/v1/tts/live:
    description: >
      # Live TTS WebSocket — `/waves/v1/tts/live`


      Real-time text-to-speech over a persistent WebSocket connection. The

      `model` field in the request payload selects which Lightning pool serves

      the synthesis.


      ## When to use this


      - **Use this** when text arrives incrementally (LLM token streams, live
        captioning, conversational pipelines where playback should start as
        soon as the first chunk is ready).
      - POST to `/waves/v1/tts/live` (SSE) when you have the full text up
        front but still want chunked playback. (Same URL, different
        protocol — HTTP POST gets you SSE; WSS connect gets you WebSocket.)
      - Use `/waves/v1/tts` (sync) when total latency doesn't matter.


      ## Selecting the model


      Pass `"model": "lightning_v3.1"` (default) or

      `"model": "lightning_v3.1_pro"` on each request. Concurrency and latency

      are identical across both. Voice catalogs differ — see the

      [Lightning v3.1](/models/model-cards/text-to-speech/lightning-v-3-1) and

      [Lightning v3.1
      Pro](/models/model-cards/text-to-speech/lightning-v-3-1-pro)

      model cards for the per-model catalog.


      ## Language behaviour


      **`auto` (recommended for cross-language use cases):** routes internally

      based on the input text. Any English or Hindi voice can be used across

      all supported languages when `auto` is set.


      On `lightning_v3.1` — 20 accepted language codes (10 European + 10

      Indic). The trained voice catalog covers 12 of these directly; the

      other 8 route through English or Hindi voices.


      On `lightning_v3.1_pro` — 31 languages with dedicated voices (10

      Indic, 8 Asian & Middle Eastern, 13 European including Dutch and

      Swedish):

      - Pass `language: en` → UK + American accented English.

      - Pass `language: hi` → Indian accented English + Hindi (code-switching).

      - Pass the ISO 639-1 code of any other Pro language (e.g. `ta`, `de`,
        `ja`) with a matching Pro voice. See the
        [Lightning v3.1 Pro model card](/models/model-cards/text-to-speech/lightning-v-3-1-pro#supported-languages)
        for the full list.
      - Omit `language` → defaults to `en + hi` (mixed Indian + Western
        English coverage).

      ## Optional features


      Set `word_timestamps: true` to receive per-word timing events

      interleaved with the audio chunks (`status: "word_timestamp"`).

      Supported on English + Hindi base-queue voices. See

      [Word-level
      timestamps](/models/documentation/text-to-speech-lightning/word-timestamps).


      Send the same `context_id` on a sequence of text fragments to have

      them buffered, joined at natural sentence boundaries, and spoken as

      one continuous generation instead of one reset-per-fragment. See

      [Continuations](/models/documentation/text-to-speech-lightning/continuations).


      ## Connection timeout


      The server closes idle WebSocket connections to free resources. The

      default idle timeout is **60 seconds** — if your client does not send

      a message within that window the server closes the connection with:


      ```json

      {"status": "error", "message": "Connection timed out after 60 seconds of
      inactivity"}

      ```


      Override the value with the `timeout` query parameter on the URL:


      ```

      wss://api.smallest.ai/waves/v1/tts/live?timeout=120

      ```


      Pass a positive integer (seconds). Smaller values are honored

      verbatim (e.g. `?timeout=5` closes after 5 s of silence); larger

      values are clamped to the maximum of **180 seconds**. Use a larger

      value when your application has known pauses between turns — voice

      agents with long human-thinking windows, agentic pipelines waiting on

      an LLM round-trip, etc.


      The timeout is reset on every message you send (binary audio in, JSON

      control in).


      ## Keep-alive


      To hold a connection open past the timeout without sending audio,

      send a JSON keep-alive frame:


      ```json

      {"type": "ping"}

      ```


      The server replies `{"type": "pong"}` and resets the inactivity timer.

      `keepalive`, `keep_alive`, and `keep-alive` are accepted as aliases.

      The frame is handled at the API edge — it never reaches the model and

      does not affect synthesis. Prefer this over a raised `timeout`: the

      `pong` also tells you the connection is still live, and it is the only

      way to stay open past the 180-second cap.


      ## Migrating from `/waves/v1/lightning-v3.1/get_speech/stream`


      Same protocol, same payload shape — only the URL changes. Existing

      clients should:


      1. Update the WebSocket URL to `wss://api.smallest.ai/waves/v1/tts/live`.

      2. Optionally add `"model": "lightning_v3.1_pro"` to route to the Pro
         pool. Omitting `model` keeps the existing standard-pool behavior.

      Voice IDs, sample rates, auth, and the response/streaming format are

      unchanged, so downstream audio handling, jitter buffers, and barge-in

      logic stay the same.
    publish:
      operationId: tts-publish
      summary: TtsResponse
      description: Receive audio data chunks and completion status from the server.
      message:
        name: TtsResponse
        title: TtsResponse
        description: Receive audio data chunks and completion status from the server.
        payload:
          $ref: '#/components/schemas/ttsStream_ttsResponse.message'
    subscribe:
      operationId: tts-subscribe
      summary: TtsRequest
      description: >-
        Send a JSON message with `voice_id`, `text`, and optional parameters
        (including `model`) to generate speech audio.
      message:
        name: TtsRequest
        title: TtsRequest
        description: >-
          Send a JSON message with `voice_id`, `text`, and optional parameters
          (including `model`) to generate speech audio.
        payload:
          $ref: '#/components/schemas/ttsStream_ttsRequest.message'
servers:
  waves:
    url: wss://api.smallest.ai/
    protocol: wss
components:
  schemas:
    ChannelsTtsStreamMessagesTtsResponseMessageStatus:
      type: string
      enum:
        - chunk
        - word_timestamp
        - complete
      description: >
        Frame type discriminator:

        - `chunk` — base64-encoded audio chunk in `data.audio`.

        - `word_timestamp` — per-word timing event in
        `data.{id,word,start,end}`. Only emitted when the request set
        `word_timestamps: true` and the voice family supports it.

        - `complete` — terminal frame; the server closes the WebSocket after
        this. **Exception:** inside a `context_id` continuation, `complete`
        marks one released segment as done, not the end of the connection — the
        socket stays open and more segments (each with its own `complete`) can
        follow. See
        [Continuations](/models/documentation/text-to-speech-lightning/continuations).
      title: ChannelsTtsStreamMessagesTtsResponseMessageStatus
    ChannelsTtsStreamMessagesTtsResponseMessageData:
      type: object
      properties:
        audio:
          type: string
          description: 'Base64-encoded audio chunk (present on `status: "chunk"` frames).'
        id:
          type: integer
          description: >-
            0-indexed position of the word within the input text (present on
            `status: "word_timestamp"` frames).
        word:
          type: string
          description: >-
            Exact substring from the input text, un-normalized — `"$100"` stays
            `"$100"`, `"25th"` stays `"25th"` (present on `status:
            "word_timestamp"` frames).
        start:
          type: number
          format: double
          description: >-
            Start of the word in seconds, relative to the start of the audio
            stream (present on `status: "word_timestamp"` frames).
        end:
          type: number
          format: double
          description: >-
            End of the word in seconds, relative to the start of the audio
            stream (present on `status: "word_timestamp"` frames).
      description: >-
        Frame-specific payload. Shape depends on `status` — see the per-frame
        examples below.
      title: ChannelsTtsStreamMessagesTtsResponseMessageData
    ttsStream_ttsResponse.message:
      type: object
      properties:
        session_id:
          type: string
          description: >-
            Internal session identifier (system-generated, stable for the
            WebSocket connection lifetime).
        request_id:
          type: string
          description: >-
            Internal request identifier (system-generated UUID, unique per TTS
            synthesis).
        external_session_id:
          type: string
          description: Echoed client-provided session_id (omitted if not provided).
        external_request_id:
          type: string
          description: Echoed client-provided request_id (omitted if not provided).
        status:
          $ref: >-
            #/components/schemas/ChannelsTtsStreamMessagesTtsResponseMessageStatus
          description: >
            Frame type discriminator:

            - `chunk` — base64-encoded audio chunk in `data.audio`.

            - `word_timestamp` — per-word timing event in
            `data.{id,word,start,end}`. Only emitted when the request set
            `word_timestamps: true` and the voice family supports it.

            - `complete` — terminal frame; the server closes the WebSocket after
            this. **Exception:** inside a `context_id` continuation, `complete`
            marks one released segment as done, not the end of the connection —
            the socket stays open and more segments (each with its own
            `complete`) can follow. See
            [Continuations](/models/documentation/text-to-speech-lightning/continuations).
        data:
          $ref: '#/components/schemas/ChannelsTtsStreamMessagesTtsResponseMessageData'
          description: >-
            Frame-specific payload. Shape depends on `status` — see the
            per-frame examples below.
      title: ttsStream_ttsResponse.message
    ChannelsTtsStreamMessagesTtsRequestMessageModel:
      type: string
      enum:
        - lightning_v3.1
        - lightning_v3.1_pro
      default: lightning_v3.1
      description: |
        TTS model to route the request to. Controls which model pool
        serves this synthesis.

        - `lightning_v3.1` (default) — standard Lightning v3.1.
        - `lightning_v3.1_pro` — Lightning v3.1 Pro pool with a
          curated voice catalog. See the
          [Pro model card](/models/model-cards/text-to-speech/lightning-v-3-1-pro).

        Same concurrency and latency profile across both. Other
        request fields behave identically.
      title: ChannelsTtsStreamMessagesTtsRequestMessageModel
    ChannelsTtsStreamMessagesTtsRequestMessageLanguage:
      type: string
      enum:
        - auto
        - en
        - hi
        - mr
        - kn
        - ta
        - bn
        - gu
        - te
        - ml
        - pa
        - or
        - es
        - de
        - fr
        - it
        - nl
        - sv
        - pt
        - ru
        - el
        - fi
        - 'no'
        - pl
        - ar
        - zh
        - id
        - ja
        - ko
        - ms
        - tr
        - vi
      description: >
        Language code for synthesis. Influences pronunciation,

        number/date normalization, and phoneme selection.


        Each voice has its own `tags.language` set in the voice catalog —

        query `GET /waves/v1/lightning-v3.1/get_voices`. Pass a language

        the voice was trained on; passing other codes is accepted by the

        API but produces English-pronounced output.


        **`auto`:** routes internally based on the input text. Any

        English or Hindi voice can be used across all supported

        languages when `auto` is set; the platform handles

        language-appropriate routing without needing a code per call.


        **On `lightning_v3.1`** — 20 supported languages:

        - 10 European: English, Spanish, French, German, Italian, Dutch,
        Swedish, Portuguese, Polish, Russian

        - 10 Indic: Hindi, Marathi, Gujarati, Punjabi, Bengali, Odia, Tamil,
        Telugu, Kannada, Malayalam


        **On `lightning_v3.1_pro`** — 31 supported languages (adds 11 over
        base):

        - 13 European: base 10 plus Greek, Finnish, Norwegian

        - 8 Asian & Middle Eastern: Chinese, Japanese, Korean, Indonesian,
        Malay, Vietnamese, Turkish, Arabic

        - 10 Indic: same as base

        - Pass `en` → UK + American accented English.

        - Pass `hi` → Indian accented English + Hindi (code-switching).

        - Omit `language` → defaults to `en + hi` (mixed Indian + Western
        English coverage).
      title: ChannelsTtsStreamMessagesTtsRequestMessageLanguage
    ChannelsTtsStreamMessagesTtsRequestMessageNumberPronunciationLanguage:
      type: string
      enum:
        - auto
        - en
        - hi
        - mr
        - kn
        - ta
        - bn
        - gu
        - te
        - ml
        - pa
        - or
        - es
        - de
        - fr
        - it
        - nl
        - sv
        - pt
        - ru
        - el
        - fi
        - 'no'
        - pl
        - ar
        - zh
        - id
        - ja
        - ko
        - ms
        - tr
        - vi
      description: |
        Optional. Sets the language used to read out numeric content
        — numbers, currency amounts, times, and the numeric parts of
        dates and years — independently of the synthesis voice.
        Ordinary words are not translated.

        - If you **omit `language`**, this value also becomes the
          synthesis language: model selection and voice routing
          follow it.
        - If you **set `language` explicitly**, `language` always wins
          for synthesis and `number_pronunciation_language` only
          changes how numeric content is normalized. It works both
          ways — read numbers in Hindi under an English voice, or in
          English under a Hindi voice (tuned for Indian, often
          mixed-script, use cases).
        - Omit this field to keep the existing behaviour —
          normalization follows `language`.

        Note: only numeric tokens are re-spoken; the words around them
        stay in the text language. On a cross-language request names
        may also render in the target script (e.g. "Smith" →
        "स्मिथ"), which is generally the desired reading for
        native-language voices.

        Accepts the same language codes as `language` (including
        `auto`, `nl`, `sv`).
      title: ChannelsTtsStreamMessagesTtsRequestMessageNumberPronunciationLanguage
    ttsStream_ttsRequest.message:
      type: object
      properties:
        voice_id:
          type: string
          description: >-
            The ID of the voice to use. See the model card for available voices
            per model.
        text:
          type: string
          description: The text to convert to speech.
        model:
          $ref: '#/components/schemas/ChannelsTtsStreamMessagesTtsRequestMessageModel'
          default: lightning_v3.1
          description: |
            TTS model to route the request to. Controls which model pool
            serves this synthesis.

            - `lightning_v3.1` (default) — standard Lightning v3.1.
            - `lightning_v3.1_pro` — Lightning v3.1 Pro pool with a
              curated voice catalog. See the
              [Pro model card](/models/model-cards/text-to-speech/lightning-v-3-1-pro).

            Same concurrency and latency profile across both. Other
            request fields behave identically.
        max_buffer_flush_ms:
          type: integer
          minimum: 0
          maximum: 1000
          default: 0
          description: >-
            The maximum time (in ms) to wait for more input before generating
            output. It flushes when either this time is reached or enough input
            is received for optimal output—whichever comes first. This is useful
            for input streams. Defaults to 0
        continue:
          type: boolean
          default: false
          description: |
            Buffering control. Meaning depends on whether `context_id`
            is also set:

            - **Without `context_id`** (legacy buffer): `true` holds
              this text and waits for a later request with
              `flush: true` before generating any audio.
            - **With `context_id`** (continuations): `true` means
              "more text for this context is coming" — the fragment
              is buffered only until it reaches a natural sentence
              boundary or `max_buffer_delay_ms` elapses, whichever is
              first. Send `continue: false` to close out the context
              and speak whatever is left buffered — this frame may
              omit `text`. See
              [Continuations](/models/documentation/text-to-speech-lightning/continuations).

            If not set, assumes no more input is coming.
        flush:
          type: boolean
          default: false
          description: |
            This setting controls whether the system should flush the
            current buffer. Legacy buffering only — cannot be combined
            with `context_id` (end a context with `continue: false` or
            `context_close: true` instead).
        complete_backoff_ms:
          type: number
          format: double
          minimum: 0
          maximum: 10000
          default: 4000
          description: >-
            The time in ms to wait after the last chunk is sent before sending
            the complete response. Default is 4000ms. Maximum is 10000ms.
        context_id:
          type: string
          pattern: ^[a-zA-Z0-9_\-.]+$
          maxLength: 128
          description: >
            Groups a sequence of text fragments into one continuous

            synthesis ("continuations"). Send the same `context_id` on

            every fragment belonging to one utterance — fragments are

            buffered and joined at natural sentence boundaries, and

            each new generation in the context is primed with the

            audio from the previous one so prosody carries across

            fragments instead of resetting per-chunk.


            Fragments sharing a `context_id` on the same connection

            count as a single concurrency slot, not one per fragment.


            Cannot be combined with `flush` or `max_buffer_flush_ms` —

            those are the legacy buffering contract. End a context

            with `continue: false` or `context_close: true` instead.

            See
            [Continuations](/models/documentation/text-to-speech-lightning/continuations).
        max_buffer_delay_ms:
          type: integer
          minimum: 0
          maximum: 5000
          default: 3000
          description: |
            Only meaningful together with `context_id`. Upper bound
            (ms) on how long a fragment may wait for a clean sentence
            boundary before it's spoken anyway. The deadline starts on
            the first still-buffered fragment and does not reset as
            more fragments arrive, so a chatty client can't hold
            playback in silence indefinitely.
        context_close:
          type: boolean
          default: false
          description: |
            Ends a `context_id` immediately: releases any buffered
            text and drops that context's carried audio state right
            away instead of waiting out its idle timeout. May be sent
            without `text` / `voice_id`.
        language:
          $ref: >-
            #/components/schemas/ChannelsTtsStreamMessagesTtsRequestMessageLanguage
          description: >
            Language code for synthesis. Influences pronunciation,

            number/date normalization, and phoneme selection.


            Each voice has its own `tags.language` set in the voice catalog —

            query `GET /waves/v1/lightning-v3.1/get_voices`. Pass a language

            the voice was trained on; passing other codes is accepted by the

            API but produces English-pronounced output.


            **`auto`:** routes internally based on the input text. Any

            English or Hindi voice can be used across all supported

            languages when `auto` is set; the platform handles

            language-appropriate routing without needing a code per call.


            **On `lightning_v3.1`** — 20 supported languages:

            - 10 European: English, Spanish, French, German, Italian, Dutch,
            Swedish, Portuguese, Polish, Russian

            - 10 Indic: Hindi, Marathi, Gujarati, Punjabi, Bengali, Odia, Tamil,
            Telugu, Kannada, Malayalam


            **On `lightning_v3.1_pro`** — 31 supported languages (adds 11 over
            base):

            - 13 European: base 10 plus Greek, Finnish, Norwegian

            - 8 Asian & Middle Eastern: Chinese, Japanese, Korean, Indonesian,
            Malay, Vietnamese, Turkish, Arabic

            - 10 Indic: same as base

            - Pass `en` → UK + American accented English.

            - Pass `hi` → Indian accented English + Hindi (code-switching).

            - Omit `language` → defaults to `en + hi` (mixed Indian + Western
            English coverage).
        number_pronunciation_language:
          $ref: >-
            #/components/schemas/ChannelsTtsStreamMessagesTtsRequestMessageNumberPronunciationLanguage
          description: |
            Optional. Sets the language used to read out numeric content
            — numbers, currency amounts, times, and the numeric parts of
            dates and years — independently of the synthesis voice.
            Ordinary words are not translated.

            - If you **omit `language`**, this value also becomes the
              synthesis language: model selection and voice routing
              follow it.
            - If you **set `language` explicitly**, `language` always wins
              for synthesis and `number_pronunciation_language` only
              changes how numeric content is normalized. It works both
              ways — read numbers in Hindi under an English voice, or in
              English under a Hindi voice (tuned for Indian, often
              mixed-script, use cases).
            - Omit this field to keep the existing behaviour —
              normalization follows `language`.

            Note: only numeric tokens are re-spoken; the words around them
            stay in the text language. On a cross-language request names
            may also render in the target script (e.g. "Smith" →
            "स्मिथ"), which is generally the desired reading for
            native-language voices.

            Accepts the same language codes as `language` (including
            `auto`, `nl`, `sv`).
        math_notation:
          type: boolean
          default: false
          description: >
            Opt-in flag that reads digit-flanked math operators

            (`5 x 3`, `2 ^ 10`, `6 ÷ 2`) as words instead of leaving

            them for the default number reader. Off by default

            because in real traffic digit-flanked `NxN` is more

            often a product dimension, the `24x7` idiom, or a

            vehicle-registration code than an actual multiplication.


            When `true`, the normalizer replaces the operator with

            the spoken word matched to

            `number_pronunciation_language`:


            | Glyphs | en (default / fallback) | hi | mr |

            |---|---|---|---|

            | `×` `x` `X` `*` | times | गुणा | गुणिले |

            | `÷` and spaced `/` | divided by | बटा | भागिले |

            | `+` | plus | प्लस | अधिक |

            | spaced `-` `–` `−` | minus | माइनस | वजा |

            | `=` | equals | बराबर | बरोबर |

            | `^` `**` | to the power of | की घात | ची घात |


            Localized only for `hi` and `mr`; every other language

            falls back to the English words. The operator word

            follows `number_pronunciation_language`, not the

            synthesis `language`, so

            `language=en, number_pronunciation_language=hi` reads

            `6 x 7` as "छः गुणा सात".


            Matching rules: unambiguous glyphs (`× ÷ * ^ ** = +` and

            the wrong-glyph `x`/`X`) fire glued or spaced (`5x3`,

            `5 x 3`). The ambiguous `-` `–` `−` and `/` fire only

            when space-padded, so `5-3` stays a range and `1/2`

            stays a fraction. See [Math
            notation](/models/documentation/text-to-speech-lightning/math-notation)

            for the full lexicon, known limitations (product

            dimensions, `24x7` idiom, vehicle-reg codes), and

            EU-language localizations.
        sample_rate:
          type: integer
          default: 44100
          description: 'Audio sample rate in Hz. Supported values: 8000, 16000, 24000, 44100'
        speed:
          type: number
          format: double
          minimum: 0.5
          maximum: 2
          default: 1
          description: Speaking speed multiplier
        session_id:
          type: string
          pattern: ^[a-zA-Z0-9_\-.]+$
          maxLength: 128
          description: >-
            Optional client-provided session identifier for correlation. Only
            alphanumeric characters, hyphens, underscores, and dots allowed. Max
            128 characters. Echoed back in responses as `external_session_id`.
        request_id:
          type: string
          pattern: ^[a-zA-Z0-9_\-.]+$
          maxLength: 128
          description: >-
            Optional client-provided request identifier for correlation. Only
            alphanumeric characters, hyphens, underscores, and dots allowed. Max
            128 characters. Echoed back in responses as `external_request_id`.
        word_timestamps:
          type: boolean
          default: false
          description: >
            Opt in to per-word timing events for the synthesized audio. When
            `true`, the server interleaves `status: "word_timestamp"` frames
            with the audio `chunk` frames; each carries `data: { id, word,
            start, end }` where `start`/`end` are floats in seconds relative to
            the start of the audio stream, and `word` is verbatim from the input
            text (un-normalized — `"$100"` stays `"$100"`, not `"one hundred
            dollars"`). Supported on base-queue English + Hindi voices (`meher`,
            `devansh`, `kartik`, `maithili`, `liam`, `avery`); other voice
            families silently emit no word events (audio still works). Defaults
            to `false` so existing integrations see no change.
      required:
        - voice_id
        - text
      title: ttsStream_ttsRequest.message

```