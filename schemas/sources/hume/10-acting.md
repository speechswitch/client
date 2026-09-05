> For clean Markdown of any page, append .md to the page URL.
> For a complete documentation index, see https://dev.hume.ai/llms.txt.
> For AI client integration (Claude Code, Cursor, etc.), connect to the MCP server at https://dev.hume.ai/_mcp/server.

# Acting Instructions Guide

The `description` field for acting instructions is available for Octave 1 only. Support for `description` with Octave 2 is coming soon. The `speed` and `trailing_silence` fields are supported in all models.

Octave supports supplying **acting instructions** to guide aspects of speech delivery:

* **Emotional tone**: happiness, sadness, excitement, nervousness, etc.
* **Delivery style**: whispering, shouting, rushed speaking, measured pace, etc.
* **Performance context**: speaking to a crowd, intimate conversation, etc.
* **Speaking rate**: the rate at which the speech is delivered, faster or slower.
* **Trailing silence**: injecting pauses in the speech for a specified duration in seconds.

In the following section, we'll explore the ways in which you can provide acting instructions to Octave through the
API.

## Providing acting instructions

The TTS API offers parameters which allow you to control how an individual **utterance** is performed. These
parameters can be used individually or combined for precise control over speech output:

* [description](https://dev.hume.ai/reference/text-to-speech-tts/synthesize-json-streaming#request.body.utterances.description):
  provide acting instructions in natural language.
* [speed](https://dev.hume.ai/reference/text-to-speech-tts/synthesize-json-streaming#request.body.utterances.speed): adjust the
  relative speaking rate on a non-linear scale from `0.5` (much slower) to `2.0` (much faster), where `1.0` represents
  normal speaking pace. Note that changes are not proportional to the value provided - for example, setting speed to
  `2.0` will make speech faster but not exactly twice as fast as the default.
* [trailing\_silence](https://dev.hume.ai/reference/text-to-speech-tts/synthesize-json-streaming#request.body.utterances.trailing_silence):
  specify a duration of trailing silence (in seconds) to add to an **utterance**.

In this section we'll leverage acting instructions to guide Octave's speech output for guided meditation.

Before we apply acting instructions, let's first take a look at a request that does not contain any acting instructions:

#### cURL

```cURL
curl "https://api.hume.ai/v0/tts/stream/json" \
  -H "X-Hume-Api-Key: $HUME_API_KEY" \
  --json '{
    "utterances": [
      {
        "text": "Let us begin by taking a deep breath in.",
        "voice": {
          "name": "Ava Song",
          "provider": "HUME_AI"
        }
      },
      { 
        "text": "Now, slowly exhale.",
        "voice": {
          "name": "Ava Song",
          "provider": "HUME_AI"
        }
      }
    ]
  }'
```

#### Python

```Python
hume = AsyncHumeClient(apiKey=os.getenv("HUME_API_KEY"))

voice = PostedUtteranceVoiceWithName(
    name="Ava Song", 
    provider="HUME_AI",
)
stream = hume.tts.synthesize_json_streaming(
    utterances=[
        PostedUtterance(
            text="Let us begin by taking a deep breath in.",
            voice=voice
        ),
        PostedUtterance(
            text="Now, slowly exhale.",
            voice=voice
        ),
    ]
)         
async for chunk in stream:
    # send audio to speaker or write to file
```

#### TypeScript

```TypeScript
const hume = new HumeClient({ apiKey: process.env.HUME_API_KEY });
const voice = {
  name: "Ava Song",
  provider: "HUME_AI",
} as const;
const stream = await hume.tts.synthesizeJsonStreaming({
  utterances: [
    {
      text: "Let us begin by taking a deep breath in.", voice
    },
    {text: "Now, slowly exhale.", voice}
  ]
});
for await (const chunk of stream) {
  // send audio to speaker or write to file
}
```

Without acting instructions, Octave will infer how to deliver the speech from the base voice's description and the
provided text input.

In the following steps, we'll iteratively improve Octave's delivery by specifying different types of acting
instructions to better simulate guided meditation.

### Guide delivery with natural language

Let's begin by providing a `description` to guide the delivery of these **utterances** to be calmer and more
instructive:

#### cURL

```cURL {7, 15} maxLines=0
curl "https://api.hume.ai/v0/tts/stream/json" \
  -H "X-Hume-Api-Key: $HUME_API_KEY" \
  --json '{
    "utterances": [
      {
        "text": "Let us begin by taking a deep breath in.",
        "description": "calm, pedagogical",
        "voice": {
          "name": "Ava Song",
          "provider": "HUME_AI"
        }
      },
      { 
        "text": "Now, slowly exhale.",
        "description": "calm, serene",
        "voice": {
          "name": "Ava Song",
          "provider": "HUME_AI"
        }
      }
    ]
  }'
```

#### Python

```Python {10,15} maxLines=0
hume = AsyncHumeClient(apiKey=os.getenv("HUME_API_KEY"))
voice = PostedUtteranceVoiceWithName(
    name="Ava Song", 
    provider="HUME_AI",
)
stream = await hume.tts.synthesize_json_streaming(
    utterances=[
        PostedUtterance(
            text="Let us begin by taking a deep breath in.",
            description="calm, pedagogical",
            voice=voice,
        ),
        PostedUtterance(
            text="Now, slowly exhale.",
            description="calm, serene",
            voice=voice,
        ),
    ]
)         
async for chunk in stream:
  # send audio to speaker or write to file
```

#### TypeScript

```TypeScript {10, 15} maxLines=0
const hume = new HumeClient({ apiKey: process.env.HUME_API_KEY });
const voice = {
  name: "Ava Song",
  provider: "HUME_AI"
} as const;
const stream = await hume.tts.synthesizeJsonStreaming({
  utterances: [
    {
      text: "Let us begin by taking a deep breath in.",
      description: "calm, pedagogical",
      voice
    },
    { 
      text: "Now, slowly exhale.",
      description: "calm, serene",
      voice
    }
  ]
});
for await (const chunk of stream) {
  // send audio to speaker or write to file
}
```

When you don’t specify a voice, the description field serves as a voice prompt for creating a new voice. See our [Voice Design guide](https://github.com/docs/voice/voice-design) for details.

### Control speed of delivery

While the descriptions help to make the voice sound more appropriate for our use case, we now want to adjust
the speed of delivery to be slower to create an atmosphere better suited for meditation:

#### cURL

```cURL {12, 21} maxLines=0
curl "https://api.hume.ai/v0/tts/stream/json" \
  -H "X-Hume-Api-Key: $HUME_API_KEY" \
  --json '{
    "utterances": [
      {
        "text": "Let us begin by taking a deep breath in.",
        "description": "calm, pedagogical",
        "voice": {
          "name": "Ava Song",
          "provider": "HUME_AI"
        },
        "speed": 0.65
      },
      { 
        "text": "Now, slowly exhale.",
        "description": "calm, serene",
        "voice": {
          "name": "Ava Song",
          "provider": "HUME_AI"
        },
        "speed": 0.65
      }
    ]
  }'
```

#### Python

```Python {12, 18} maxLines=0
hume = AsyncHumeClient(apiKey=os.getenv("HUME_API_KEY"))
voice = PostedUtteranceVoiceWithName(
    name="Ava Song", 
    provider="HUME_AI",
)
stream = await hume.tts.synthesize_json_streaming(
    utterances=[
        PostedUtterance(
            text="Let us begin by taking a deep breath in.",
            description="calm, pedagogical",
            voice=voice,
            speed=0.65
        ),
        PostedUtterance(
            text="Now, slowly exhale.",
            description="calm, serene",
            voice=voice,
            speed=0.65
        ),
    ]
)         
async for chunk in stream:
  # send audio to speaker or write to file
```

#### TypeScript

```TypeScript {12, 18} maxLines=0
const hume = new HumeClient({ apiKey: process.env.HUME_API_KEY });
const voice = {
  name: "Ava Song",
  provider: "HUME_AI"
} as const;
const stream = await hume.tts.synthesizeJsonStreaming({
  utterances: [
    {
      text: "Let us begin by taking a deep breath in.",
      description: "calm, pedagogical",
      voice,
      speed: 0.65
    },
    { 
      text: "Now, slowly exhale.",
      description: "calm, serene",
      voice,
      speed: 0.65,
    }
  ]
});
for await (const chunk of stream) {
  // send audio to speaker or write to file
}
```

### Injecting pauses

Finally, in this guided meditation, it would be helpful to give the participants some time to actually take a breath!
To achieve this we can introduce a pause between **utterances** by specifying a trailing silence duration for the
first **utterance**.

To inject natural breaks *within* an utterance, try using **\[pause]** or **\[long pause]** in your `text`. Example:
*"Haha \[pause] I didn't realize this was going to be a formal event."*

#### cURL

```cURL {13} maxLines=0
curl "https://api.hume.ai/v0/tts" \
  -H "X-Hume-Api-Key: $HUME_API_KEY" \
  --json '{
    "utterances": [
      {
        "text": "Let us begin by taking a deep breath in.",
        "description": "calm, pedagogical",
        "voice": {
          "name": "Ava Song",
          "provider": "HUME_AI"
        },
        "speed": 0.65,
        "trailing_silence": 4
      },
      { 
        "text": "Now, slowly exhale.",
        "description": "calm, serene",
        "speed": 0.65
      }
    ]
  }'
```

#### Python

```Python {13} maxLines=0
hume = AsyncHumeClient(apiKey=os.getenv("HUME_API_KEY"))
voice = PostedUtteranceVoiceWithName(
    name="Ava Song", 
    provider="HUME_AI",
)
response = await hume.tts.synthesize_json_streaming(
    utterances=[
        PostedUtterance(
            text="Let us begin by taking a deep breath in.",
            description="calm, pedagogical",
            voice=voice,
            speed=0.65,
            trailing_silence=4,
        ),
        PostedUtterance(
            text="Now, slowly exhale.",
            description="calm, serene",
            voice=voice,
            speed=0.65,
        ),
    ]
)         
```

#### TypeScript

```TypeScript {13} maxLines=0
const hume = new HumeClient({ apiKey: process.env.HUME_API_KEY });
const voice = {
  name: "Ava Song",
  provider: "HUME_AI"
} as const;
const stream = await hume.tts.synthesizeJsonStreaming({
  utterances: [
    {
      text: "Let us begin by taking a deep breath in.",
      description: "calm, pedagogical",
      voice,
      speed: 0.65,
      trailingSilence: 4,
    },
    { 
      text: "Now, slowly exhale.",
      description: "calm, serene",
      voice,
      speed: 0.65,
    }
  ]
});
for await (const chunk of stream) {
  // send audio to speaker or write to file
}
```

Combine natural language descriptions, speed adjustments, and pauses to control Octave's delivery. In the meditation example, these settings turn a simple line into naturally paced speech. Tune these controls together to match your intended delivery.

## Best practices

* **Keep it concise**: Short instructions work best—aim for no more than 100 characters. Instead of long phrases like “The speaker is scared and in a hurry to leave”, write “frightened, rushed”.
* **Use precise emotions**: Instead of broad terms like "sad", use specific emotions like "melancholy" or "frustrated".
* **Combine for nuance**: Pair emotions with delivery styles, e.g., "excited but whispering" or "confident, professional tone".
* **Indicate pacing**: Use terms like "rushed", "measured", "deliberate pause" to adjust speech rhythm.
* **Specify the audience**: Instructions like "speaking to a child" or "addressing a large crowd" help shape delivery.
* **Use `speed` for adjusting speech rate**: Rather than using the `description` field to instruct slower or faster speech, leverage the `speed` parameter.

### Examples

The table below demonstrates how acting instructions can transform the same text into different delivery styles:

| Text Input              | Acting Instruction | Output Style                |
| ----------------------- | ------------------ | --------------------------- |
| "Are you serious?"      | whispering, hushed | Soft, secretive tone        |
| "We need to move, now!" | urgent, panicked   | Fast, tense delivery        |
| "Welcome, everyone."    | warm, inviting     | Friendly, engaging tone     |
| "I can't believe this…" | sarcastic          | Dry, exaggerated inflection |

---