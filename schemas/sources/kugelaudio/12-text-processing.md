> ## Documentation Index
> Fetch the complete documentation index at: https://docs.kugelaudio.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Text Normalization & Spelling

> Control how text is processed before speech synthesis

KugelAudio provides text processing features to ensure your text is spoken naturally. This includes automatic normalization of numbers, dates, and currencies, as well as the ability to spell out text letter by letter.

## Text Normalization

Text normalization converts numbers, dates, times, and other non-verbal text into spoken words:

* "I have 3 apples" → "I have three apples"
* "The meeting is at 2:30 PM" → "The meeting is at two thirty PM"
* "€50.99" → "fifty euros and ninety-nine cents"

Enable normalization by setting `normalize=True` (Python), `normalize: true` (JavaScript), or `"normalize": true` (JSON):

<Tabs>
  <Tab title="Python">
    ```python theme={null}
    # With explicit language (recommended - fastest)
    audio = client.tts.generate(
        text="I bought 3 items for €50.99 on 01/15/2024.",
        voice_id=1071,
        normalize=True,
        language="en",
    )

    # With auto-detection (may cause incorrect normalizations)
    audio = client.tts.generate(
        text="Ich habe 3 Artikel für 50,99€ gekauft.",
        voice_id=1071,
        normalize=True,
        # language not specified - will auto-detect
    )
    ```
  </Tab>

  <Tab title="JavaScript">
    ```typescript theme={null}
    // With explicit language (recommended - fastest)
    const audio = await client.tts.generate({
      text: 'I bought 3 items for €50.99 on 01/15/2024.',
      voiceId: 1071,
      normalize: true,
      language: 'en',
    });

    // With auto-detection (may cause incorrect normalizations)
    const audio = await client.tts.generate({
      text: 'Ich habe 3 Artikel für 50,99€ gekauft.',
      voiceId: 1071,
      normalize: true,
      // language not specified - will auto-detect
    });
    ```
  </Tab>

  <Tab title="Java">
    ```java theme={null}
    // With explicit language (recommended - fastest)
    AudioResponse audio = client.tts().generate(
        GenerateRequest.builder("I bought 3 items for €50.99 on 01/15/2024.")
            .voiceId(1071)
            .normalize(true)
            .language("en")
            .build()
    );

    // With auto-detection (may cause incorrect normalizations)
    AudioResponse audio2 = client.tts().generate(
        GenerateRequest.builder("Ich habe 3 Artikel für 50,99€ gekauft.")
            .voiceId(1071)
            .normalize(true)
            // language not specified - will auto-detect
            .build()
    );
    ```
  </Tab>

  <Tab title="cURL">
    ```bash theme={null}
    # With explicit language (recommended - fastest)
    curl -X POST https://api.kugelaudio.com/v1/tts/generate \
      -H "Authorization: Bearer $KUGELAUDIO_API_KEY" \
      -H "Content-Type: application/json" \
      -d '{
        "text": "I bought 3 items for €50.99 on 01/15/2024.",
        "voice_id": 1071,
        "normalize": true,
        "language": "en"
      }' \
      --output output.pcm

    # With auto-detection (may cause incorrect normalizations)
    curl -X POST https://api.kugelaudio.com/v1/tts/generate \
      -H "Authorization: Bearer $KUGELAUDIO_API_KEY" \
      -H "Content-Type: application/json" \
      -d '{
        "text": "Ich habe 3 Artikel für 50,99€ gekauft.",
        "voice_id": 1071,
        "normalize": true
      }' \
      --output output.pcm
    ```
  </Tab>
</Tabs>

<Warning>
  Using `normalize` without specifying `language` may cause incorrect normalizations, especially for short texts or languages that share similar vocabulary. Always specify `language` when you know it.
</Warning>

### Supported Languages

| Code | Language   | Code  | Language   |
| ---- | ---------- | ----- | ---------- |
| `de` | German     | `nl`  | Dutch      |
| `en` | English    | `pl`  | Polish     |
| `fr` | French     | `sv`  | Swedish    |
| `es` | Spanish    | `da`  | Danish     |
| `it` | Italian    | `no`  | Norwegian  |
| `pt` | Portuguese | `fi`  | Finnish    |
| `cs` | Czech      | `hu`  | Hungarian  |
| `ro` | Romanian   | `el`  | Greek      |
| `uk` | Ukrainian  | `bg`  | Bulgarian  |
| `tr` | Turkish    | `vi`  | Vietnamese |
| `ar` | Arabic     | `hi`  | Hindi      |
| `zh` | Chinese    | `ja`  | Japanese   |
| `ko` | Korean     | `sk`  | Slovak     |
| `sl` | Slovenian  | `hr`  | Croatian   |
| `sr` | Serbian    | `ru`  | Russian    |
| `he` | Hebrew     | `fa`  | Persian    |
| `ur` | Urdu       | `bn`  | Bengali    |
| `ta` | Tamil      | `yue` | Cantonese  |
| `th` | Thai       | `id`  | Indonesian |
| `ms` | Malay      |       |            |

## Spell Tags

Use `<spell>` tags to spell out text letter by letter. This is useful for email addresses, codes, acronyms, or any text that should be pronounced character by character.

<Note>
  Content inside `<spell>` automatically bypasses text normalization.
  The `normalize` setting continues to apply to surrounding prose.
</Note>

<Tabs>
  <Tab title="Python">
    ```python theme={null}
    # Spell out an email address
    audio = client.tts.generate(
        text="Contact me at <spell>kajo@kugelaudio.com</spell>",
        voice_id=1071,
        normalize=True,
        language="en",
    )
    # Output: "Contact me at K, A, J, O, at, K, U, G, E, L, A, U, D, I, O, dot, C, O, M"

    # Spell out an acronym
    audio = client.tts.generate(
        text="The <spell>API</spell> is easy to use.",
        voice_id=1071,
        normalize=True,
        language="en",
    )
    # Output: "The A, P, I is easy to use."

    # German example with language-specific translations
    audio = client.tts.generate(
        text="Meine E-Mail ist <spell>test@beispiel.de</spell>",
        voice_id=1071,
        normalize=True,
        language="de",
    )
    # Output: "Meine E-Mail ist T, E, S, T, ät, B, E, I, S, P, I, E, L, Punkt, D, E"
    ```
  </Tab>

  <Tab title="JavaScript">
    ```typescript theme={null}
    // Spell out an email address
    const audio = await client.tts.generate({
      text: 'Contact me at <spell>kajo@kugelaudio.com</spell>',
      voiceId: 1071,
      normalize: true,
      language: 'en',
    });
    // Output: "Contact me at K, A, J, O, at, K, U, G, E, L, A, U, D, I, O, dot, C, O, M"

    // Spell out an acronym
    const audio2 = await client.tts.generate({
      text: 'The <spell>API</spell> is easy to use.',
      voiceId: 1071,
      normalize: true,
      language: 'en',
    });
    // Output: "The A, P, I is easy to use."

    // German example with language-specific translations
    const audio3 = await client.tts.generate({
      text: 'Meine E-Mail ist <spell>test@beispiel.de</spell>',
      voiceId: 1071,
      normalize: true,
      language: 'de',
    });
    // Output: "Meine E-Mail ist T, E, S, T, ät, B, E, I, S, P, I, E, L, Punkt, D, E"
    ```
  </Tab>

  <Tab title="Java">
    ```java theme={null}
    // Spell out an email address
    AudioResponse audio = client.tts().generate(
        GenerateRequest.builder("Contact me at <spell>kajo@kugelaudio.com</spell>")
            .voiceId(1071)
            .normalize(true)
            .language("en")
            .build()
    );
    // Output: "Contact me at K, A, J, O, at, K, U, G, E, L, A, U, D, I, O, dot, C, O, M"

    // Spell out an acronym
    AudioResponse audio2 = client.tts().generate(
        GenerateRequest.builder("The <spell>API</spell> is easy to use.")
            .voiceId(1071)
            .normalize(true)
            .language("en")
            .build()
    );
    // Output: "The A, P, I is easy to use."

    // German example with language-specific translations
    AudioResponse audio3 = client.tts().generate(
        GenerateRequest.builder("Meine E-Mail ist <spell>test@beispiel.de</spell>")
            .voiceId(1071)
            .normalize(true)
            .language("de")
            .build()
    );
    // Output: "Meine E-Mail ist T, E, S, T, ät, B, E, I, S, P, I, E, L, Punkt, D, E"
    ```
  </Tab>

  <Tab title="cURL">
    ```bash theme={null}
    # Spell out an email address
    curl -X POST https://api.kugelaudio.com/v1/tts/generate \
      -H "Authorization: Bearer $KUGELAUDIO_API_KEY" \
      -H "Content-Type: application/json" \
      -d '{
        "text": "Contact me at <spell>kajo@kugelaudio.com</spell>",
        "voice_id": 1071,
        "normalize": true,
        "language": "en"
      }' \
      --output output.pcm
    # Output: "Contact me at K, A, J, O, at, K, U, G, E, L, A, U, D, I, O, dot, C, O, M"

    # Spell out an acronym
    curl -X POST https://api.kugelaudio.com/v1/tts/generate \
      -H "Authorization: Bearer $KUGELAUDIO_API_KEY" \
      -H "Content-Type: application/json" \
      -d '{
        "text": "The <spell>API</spell> is easy to use.",
        "voice_id": 1071,
        "normalize": true,
        "language": "en"
      }' \
      --output output.pcm
    # Output: "The A, P, I is easy to use."
    ```
  </Tab>
</Tabs>

### Language-Specific Character Translations

Special characters within `<spell>` tags are translated based on the language:

| Character | English    | German      | French     | Spanish    |
| --------- | ---------- | ----------- | ---------- | ---------- |
| `@`       | at         | ät          | arobase    | arroba     |
| `.`       | dot        | Punkt       | point      | punto      |
| `-`       | dash       | Strich      | tiret      | guión      |
| `_`       | underscore | Unterstrich | underscore | guión bajo |

### Spell Tags with Streaming

Spell tags work seamlessly with streaming. When streaming text token-by-token (e.g., from an LLM), tags that span multiple chunks are automatically handled:

<Tabs>
  <Tab title="Python">
    ```python theme={null}
    async with client.tts.streaming_session(
        voice_id=1071,
        normalize=True,
        language="en",
    ) as session:
        # Even if the tag is split across tokens, it works correctly
        async for chunk in session.send("My code is <spell>"):
            play_audio(chunk.audio)
        async for chunk in session.send("ABC123</spell>"):
            play_audio(chunk.audio)
        async for chunk in session.flush():
            play_audio(chunk.audio)
    ```
  </Tab>

  <Tab title="JavaScript">
    ```typescript theme={null}
    await client.tts.stream(
      {
        text: 'My verification code is <spell>ABC-123-XYZ</spell>.',
        voiceId: 1071,
        normalize: true,
        language: 'en',
      },
      {
        onChunk: (chunk) => playAudio(chunk.audio),
      }
    );
    ```
  </Tab>

  <Tab title="cURL">
    ```bash theme={null}
    curl -X POST https://api.kugelaudio.com/v1/tts/generate \
      -H "Authorization: Bearer $KUGELAUDIO_API_KEY" \
      -H "Content-Type: application/json" \
      -d '{
        "text": "My verification code is <spell>ABC-123-XYZ</spell>.",
        "voice_id": 1071,
        "normalize": true,
        "language": "en"
      }' \
      --no-buffer | ffplay -f s16le -ar 24000 -ac 1 -nodisp -
    ```
  </Tab>
</Tabs>

<Note>
  **Streaming Safety**: The system buffers text until the closing `</spell>` tag arrives before generating audio. If the stream ends unexpectedly, incomplete tags are auto-closed so the content still gets spelled out.
</Note>

### Using Spell Tags with LLMs

When integrating with language models, add instructions to your system prompt so the LLM wraps appropriate text in spell tags:

```python theme={null}
SYSTEM_PROMPT = """You are a helpful assistant. When you need to spell out text 
(like email addresses, codes, or acronyms), wrap it in <spell> tags.

Examples:
- "My email is <spell>kajo@kugelaudio.com</spell>"
- "The code is <spell>ABC123</spell>"
- "That stands for <spell>API</spell>, Application Programming Interface"
"""
```

For more details, see [Voice Agent Prompting](/guides/voice-prompting) and [Streaming overview](/streaming/overview).

## Custom Pronunciation Dictionaries

When normalization and `<spell>` tags aren't enough — brand names,
product names, acronyms the model gets wrong — attach a per-project
dictionary. The TTS pipeline substitutes `word → replacement` before
synthesis and invalidates its cache the moment you change the
dictionary, so the next request picks it up.

Manage dictionaries from the dashboard or the API:

* Guide: [Dictionaries](/features/dictionaries) — how pronunciation dictionaries work
* API: [`/v1/dictionaries`](/api-reference/endpoints/dictionaries) — full CRUD plus idempotent bulk replace
* SDKs: `client.dictionaries.*` ([Python](/sdks/python/dictionaries), [JavaScript](/sdks/javascript/dictionaries), [Java](/sdks/java/dictionaries))

## Next Steps

<CardGroup cols={2}>
  <Card title="Generate Speech" icon="play" href="/features/generate">
    Basic speech generation
  </Card>

  <Card title="Streaming" icon="wave-pulse" href="/streaming/overview">
    Real-time audio streaming
  </Card>

  <Card title="Voice Agent Prompting" icon="robot" href="/guides/voice-prompting">
    System prompt patterns for LLM-driven voice agents
  </Card>

  <Card title="Custom Dictionaries" icon="book" href="/features/dictionaries">
    Per-project pronunciation fixes for brand names and acronyms
  </Card>
</CardGroup>
