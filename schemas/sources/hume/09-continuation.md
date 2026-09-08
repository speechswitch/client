> For clean Markdown of any page, append .md to the page URL.
> For a complete documentation index, see https://dev.hume.ai/llms.txt.
> For AI client integration (Claude Code, Cursor, etc.), connect to the MCP server at https://dev.hume.ai/_mcp/server.

# Continuation Guide

**Octave supports continuation across generations.** It carries context from earlier output into the next generation,
keeping long-form speech coherent across multiple utterances so delivery stays natural, consistent, and emotionally
continuous.

## Ways to continue

### 1. **Chain utterances in one request**

* Put multiple items in the [`utterances`](/reference/text-to-speech-tts/synthesize-json-streaming#request.body.utterances) array.
* Each utterance continues only from the immediate previous utterance in the same request.

### 2. **Continue from a previous call**

Pass context in the [`context`](/reference/text-to-speech-tts/synthesize-json-streaming#request.body.context) field using one of:

* `generation_id`: continue from the most recent generation you specify.
* **Context utterances**: supply reference utterances that guide delivery.

## Aspects of continuation

### Narrative coherence

For long-form audio such as audiobooks, continuation keeps the narrative cohesive across utterances. It prevents abrupt
shifts in delivery, pacing, and emotion, carries energy and emotional progression forward, and lets each segment build
naturally on the last for a more authentic listen.

In the examples below, the same line is delivered with different emotions based on the context set by the preceding
utterance.

**With positive context** (*excited interpretation*)

#### cURL

```cURL
curl "https://api.hume.ai/v0/tts/stream/json" \
  -H "X-Hume-Api-Key: $HUME_API_KEY" \
  --json '{
    "version": "1",
    "utterances": [
      {
        "text": "Our proposal has been accepted with full funding for the next three years!",
        "voice": {
          "name": "Ava Song",
          "provider": "HUME_AI"
        }
      },
      {
        "text": "I can'\''t believe it!",
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
            text="Our proposal has been accepted with full funding for the next three years!",
            voice=voice
        ),
        PostedUtterance(
            text="I can't believe it!",
            voice=voice
        )
    ],
    version="1"
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
    { text: "Our proposal has been accepted with full funding for the next three years!", voice },
    { text: "I can't believe it!", voice }
  ],
  version: "2"
});
for await (const chunk of stream) {
  // send audio to speaker or write to file
}
```

**With negative context** (*disappointed interpretation*)

#### cURL

```cURL
curl "https://api.hume.ai/v0/tts/stream/json" \
  -H "X-Hume-Api-Key: $HUME_API_KEY" \
  --json '{
    "version": "1",
    "utterances": [
      {
        "text": "After all our preparation... They'\''ve decided to cancel the entire project...",
        "voice": {
          "name": "Ava Song",
          "provider": "HUME_AI"
        }
      },
      {
        "text": "I can'\''t believe it!",
        "voice": {
          "name": "Ava Song",
          "provider": "HUME_AI"
        }
      }
    ]
  }'
```

#### Python

```Python maxLines=0
hume = AsyncHumeClient(apiKey=os.getenv("HUME_API_KEY"))
voice = PostedUtteranceVoiceWithName(
    name="Ava Song",
    provider="HUME_AI",
)
stream = hume.tts.synthesize_json_streaming(
    utterances=[
        PostedUtterance(text="After all our preparation... They've decided to cancel the entire project...", voice=voice),
        PostedUtterance(text="I can't believe it!", voice=voice)
    ],
    version="1"
)
async for chunk in stream:
    # send audio to speaker or write to file
```

#### TypeScript

```TypeScript maxLines=0
const hume = new HumeClient({ apiKey: process.env.HUME_API_KEY });
const voice = {
  name: "Ava Song",
  provider: "HUME_AI",
} as const;
const stream = await hume.tts.synthesizeJsonStreaming({
  utterances: [
    { text: "After all our preparation... They've decided to cancel the entire project...", voice },
    { text: "I can't believe it!", voice }
  ]
});
for await (const chunk of stream) {
  // send audio to speaker or write to file
}
```

### Linguistic context

Continuation also provides linguistic context for proper pronunciation, particularly with homographs—words that are
spelled the same but pronounced differently based on meaning. For example, Octave can correctly differentiate between:

* "Take a **bow**." (`/bau/`) vs. "Take a **bow** and arrow." (`/bō/`)
* "Play the **bass** guitar." (`/bās/`) vs. "Go **bass** fishing." (`/bas/`)
* "I **read** the book yesterday." (`/red/`) vs. "I will **read** the book tomorrow." (`/rēd/`)

Try these examples to see how Octave intelligently distinguishes between different pronunciations of the word "bow"
based on contextual understanding:

**With `/bau/` pronunciation**

#### cURL

```cURL
curl https://api.hume.ai/v0/tts/stream/json \
  -H "X-Hume-Api-Key: $HUME_API_KEY" \
  --json '{
    "utterances": [
      {
        "text": "What a fantastic performance!",
        "voice": {
          "name": "Ava Song",
          "provider": "HUME_AI"
        }
      },
      {
        "text": "Now take a bow.",
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
        PostedUtterance(text="What a fantastic performance!", voice=voice),
        PostedUtterance(text='Now take a bow.', voice=voice)
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
    { text: 'What a fantastic performance!', voice },
    { text: 'Now take a bow.', voice }
  ]
});
for await (const chunk of stream) {
  // send audio to speaker or write to file
}
```

**With `/bō/` pronunciation**

#### cURL

```cURL
curl https://api.hume.ai/v0/tts/stream/json \
  -H "X-Hume-Api-Key: $HUME_API_KEY" \
  --json '{
    "utterances": [
      {
        "text": "First take a quiver of arrows.",
        "voice": {
          "name": "Ava Song",
          "provider": "HUME_AI"
        }
      },
      {
        "text": "Now take a bow.",
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
        PostedUtterance(text="First take a quiver of arrows.", voice=voice),
        PostedUtterance(text="Now take a bow.", voice=voice)
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
    { text: 'First take a quiver of arrows.', voice },
    { text: 'Now take a bow.', voice }
  ],
  version: "2"
});
for await (const chunk of stream) {
  // send audio to speaker or write to file
}
```

### Consistent voice

When continuing from an **utterance**, Octave intelligently handles voice consistency:

* Octave automatically continues using the same voice from the previous utterance.
* You only need to specify a voice when you want to change from the currently established one.

Below are sample requests which show how you can continue with the same voice:

For more information on specifying a voice in your request, see our [voices guide](/docs/text-to-speech-tts/voices).

**Multiple utterances in a single request**

#### cURL

```cURL maxLines=0
curl "https://api.hume.ai/v0/tts/stream/json" \
  -H "X-Hume-Api-Key: $HUME_API_KEY" \
  --json '{
    "utterances": [
      {
        "text": "Gather around everyone! May I have your attention? Today we'\''ll be learning about supermassive black holes at the center of galaxies.",
        "description": "projecting in a large museum auditorium, enthusiastic, joyful, ostentatious",
        "voice": {
          "name": "Donovan Sinclair",
          "provider": "HUME_AI"
        },
        "speed": 1.3
      },
      {
        "text": "I'\''ve arranged for the museum guide to explain their special exhibit on black holes! I think you'\''ll find it really helpful for the concepts we'\''ve been covering in class!",
        "description": "pedagogical, enthusiastic, hinting",
        "speed": 1.3
      }
    ]
  }'
```

#### Python

```Python maxLines=0
hume = AsyncHumeClient(apiKey=os.getenv("HUME_API_KEY"))
voice = PostedUtteranceVoiceWithName(
    name="Donovan Sinclair",
    provider="HUME_AI",
)
stream = hume.tts.synthesize_json_streaming(
    utterances=[
        PostedUtterance(
            text="Gather around everyone! May I have your attention? Today we'll be learning about supermassive black holes at the center of galaxies.",
            description="projecting in a large museum auditorium, enthusiastic, joyful, ostentatious",
            voice=voice,
            speed=1.3
        ),
        PostedUtterance(
            text="I've arranged for the museum guide to explain their special exhibit on black holes. I think you'll find it really helpful for the concepts we've been covering in class.",
            description="pedagogical, enthusiastic, hinting",
            speed=1.3
        ),
    ]
)
async for chunk in stream:
    # send audio to speaker or write to file
```

#### TypeScript

```TypeScript maxLines=0
const hume = new HumeClient({ apiKey: process.env.HUME_API_KEY });
const stream = await hume.tts.synthesizeJsonStreaming({
  utterances: [
    {
      text: "Gather around everyone! May I have your attention? Today we'll be learning about supermassive black holes at the center of galaxies.",
      description: "projecting in a large museum auditorium, enthusiastic, joyful, ostentatious",
      voice: {
        name: "Donovan Sinclair",
        provider: "HUME_AI"
      },
      speed: 1.3
    },
    {
      text: "I've arranged for the museum guide to explain their special exhibit on black holes. I think you'll find it really helpful for the concepts we've been covering in class.",
      description: "pedagogical, enthusiastic, hinting",
      speed: 1.3
    },
  ]
});
for await (const chunk of stream) {
  // send audio to speaker or write to file
}
```

**Continuing from previous generation using context**

#### cURL

```cURL maxLines=0
# First request - capture the generation_id
GENERATION_ID=$(curl "https://api.hume.ai/v0/tts/stream/json" \
  -H "X-Hume-Api-Key: $HUME_API_KEY" \
  --json '{
    "utterances": [
      {
        "text": "Gather around everyone! May I have your attention? Today we'\''ll be learning about supermassive black holes at the center of galaxies.",
        "description": "projecting in a large museum auditorium, enthusiastic, joyful, ostentatious",
        "voice": {
          "name": "Donovan Sinclair",
          "provider": "HUME_AI"
        }
        "speed": 1.3
      }
    ]
  }' | jq -r '.generations[0].generation_id')

# Second request using the generation_id from the first request
curl "https://api.hume.ai/v0/tts/stream/json" \
  -H "X-Hume-Api-Key: $HUME_API_KEY" \
  --json '{
    "utterances": [
      {
        "text": "I'\''ve arranged for the museum guide to explain their special exhibit on black holes. I think you'\''ll find it really helpful for the concepts we'\''ve been covering in class.",
        "description": "pedagogical, enthusiastic, hinting",
        "voice": {
          "name": "Donovan Sinclair",
          "provider": "HUME_AI"
        },
        "speed": 1.3
      },
    ],
    "context": {
      "generation_id": "'$GENERATION_ID'"
    }
  }'
```

#### Python

```Python maxLines=0
hume = AsyncHumeClient(apiKey=os.getenv("HUME_API_KEY"))
voice = PostedUtteranceVoiceWithName(
    name="Donovan Sinclair",
    provider="HUME_AI",
)
stream_a = hume.tts.synthesize_json_streaming(
    utterances=[
        PostedUtterance(
            text="Gather around everyone! May I have your attention? Today we'll be learning about supermassive black holes at the center of galaxies.",
            description="projecting in a large museum auditorium, enthusiastic, joyful, ostentatious",
            voice=voice,
            speed=1.3
        ),
    ]
)
async for chunk in stream_a:
    # send audio to speaker or write to file
    # capture generation_id from the first chunk that contains it
    if hasattr(chunk, 'generation_id'):
        generation_id = chunk.generation_id
stream_b = hume.tts.synthesize_json_streaming(
    utterances=[
        PostedUtterance(
            text="I've arranged for the museum guide to explain their special exhibit on black holes. I think you'll find it really helpful for the concepts we've been covering in class.",
            description="pedagogical, enthusiastic, hinting",
            voice=voice,
            speed=1.3
        ),
    ],
    context=PostedContextWithGenerationId(generation_id=generation_id)
)
async for chunk in stream_b:
    # send audio to speaker or write to file
```

#### TypeScript

```TypeScript maxLines=0
const hume = new HumeClient({ apiKey: process.env.HUME_API_KEY });
const voice = {
  name: "Donovan Sinclair",
  provider: "HUME_AI"
} as const;
const streamA = await hume.tts.synthesizeJsonStreaming({
  utterances: [
    {
      text: "Gather around everyone! May I have your attention? Today we'll be learning about supermassive black holes at the center of galaxies.",
      description: "projecting in a large museum auditorium, enthusiastic, joyful, ostentatious",
      voice,
      speed: 1.3
    }
  ]
});
let generationId: string;
for await (const chunk of streamA) {
  // send audio to speaker or write to file
  // capture generation_id from the first chunk that contains it
  if (chunk.generation_id) {
    generationId = chunk.generation_id;
  }
}
const streamB = await hume.tts.synthesizeJsonStreaming({
  utterances: [
    {
      text: "I've arranged for the museum guide to explain their special exhibit on black holes. I think you'll find it really helpful for the concepts we've been covering in class.",
      description: "pedagogical, enthusiastic, hinting",
      voice,
      speed: 1.3
    },
  ]
});
for await (const chunk of streamB) {
  // send audio to speaker or write to file
}
```

**Changing voices mid-conversation**

#### cURL

```cURL maxLines=0
curl "https://api.hume.ai/v0/tts/stream/json" \
  -H "X-Hume-Api-Key: $HUME_API_KEY" \
  --json '{
    "utterances": [
      {
        "text": "Gather around everyone! May I have your attention? Today we'\''ll be learning about supermassive black holes at the center of galaxies.",
        "description": "projecting in a large museum auditorium, enthusiastic, joyful, ostentatious",
        "voice": {
          "name": "Donovan Sinclair",
          "provider": "HUME_AI"
        },
        "speed": 1.3
      },
      {
        "text": "I'\''ve arranged for the museum guide to explain their special exhibit on black holes. I think you'\''ll find it really helpful for the concepts we'\''ve been covering in class.",
        "description": "pedagogical, enthusiastic, hinting",
        "speed": 1.3
      },
      {
        "text": "Thank you, Professor! Hello, everyone! I'\''m Vince from the astronomy department here at the museum. Welcome to our black hole visualization exhibit!",
        "description": "projecting in a large museum auditorium, professional, academic, welcoming, enthusiastic",
        "voice": {
          "name": "Vince Douglas",
          "provider": "HUME_AI"
        }
      },
      {
        "text": "It'\''s quite fascinating how we can detect something we can'\''t directly observe. Black holes don'\''t emit light, but we can study their effects on nearby stars and gas.",
        "description": "expressing awe, enthusiastic, emphatic, passionate"
      }
    ]
  }'
```

#### Python

```Python maxLines=0
hume = AsyncHumeClient(apiKey=os.getenv("HUME_API_KEY"))
voice = PostedUtteranceVoiceWithName(
    name="Donovan Sinclair",
    provider="HUME_AI",
)
vince_voice = PostedUtteranceVoiceWithName(
    name="Vince Douglas",
    provider="HUME_AI",
)
stream = hume.tts.synthesize_json_streaming(
    utterances=[
        PostedUtterance(
            text="Gather around everyone! May I have your attention? Today we'll be learning about supermassive black holes at the center of galaxies.",
            description="projecting in a large museum auditorium, enthusiastic, joyful, ostentatious",
            voice=voice,
            speed=1.3
        ),
        PostedUtterance(
            text="I've arranged for the museum guide to explain their special exhibit on black holes. I think you'll find it really helpful for the concepts we've been covering in class.",
            description="pedagogical, enthusiastic, hinting",
            speed=1.3
        ),
        PostedUtterance(
            text="Thank you, Professor! Hello, everyone! I'\''m Vince from the astronomy department here at the museum. Welcome to our black hole visualization exhibit!",
            description="projecting in a large museum auditorium, professional, academic, welcoming, enthusiastic",
            voice=vince_voice
        ),
        PostedUtterance(
            text="It's quite fascinating how we can detect something we can't directly observe. Black holes don't emit light, but we can study their effects on nearby stars and gas.",
            description="expressing awe, enthusiastic, emphatic, passionate"
        )
    ]
)
async for chunk in stream:
    # send audio to speaker or write to file
```

#### TypeScript

```TypeScript maxLines=0
const hume = new HumeClient({ apiKey: process.env.HUME_API_KEY });
const voice = {
  name: "Donovan Sinclair",
  provider: "HUME_AI"
} as const;
const vinceVoice = {
  name: "Vince Douglas",
  provider: "HUME_AI"
} as const;
const stream = await hume.tts.synthesizeJsonStreaming({
  utterances: [
    {
      text: "Gather around everyone! May I have your attention? Today we'll be learning about supermassive black holes at the center of galaxies.",
      description: "projecting in a large museum auditorium, enthusiastic, joyful, ostentatious",
      voice,
      speed: 1.3
    },
    {
      text: "I've arranged for the museum guide to explain their special exhibit on black holes. I think you'll find it really helpful for the concepts we've been covering in class.",
      description: "pedagogical, enthusiastic, hinting",
      speed: 1.3
    },
    {
      text: "Thank you, Professor! Hello, everyone! I'\''m Vince from the astronomy department here at the museum. Welcome to our black hole visualization exhibit!",
      description: "projecting in a large museum auditorium, professional, academic, welcoming, enthusiastic",
      voice: vinceVoice
    },
    {
      text: "It's quite fascinating how we can detect something we can't directly observe. Black holes don't emit light, but we can study their effects on nearby stars and gas.",
      description: "expressing awe, enthusiastic, emphatic, passionate",
    }
  ]
});
for await (const chunk of stream) {
  // send audio to speaker or write to file
}
```

This intelligent handling of voice consistency saves development effort and ensures a seamless listening experience,
making it easier to create dynamic, multi-character narratives without redundant voice specifications.

## Notes and constraints

* Continuation is scoped to the **immediate preceding utterance** only. It does not skip back to earlier utterances or generations.
* Only items in utterances are synthesized. Items in context are reference-only.
* Context utterances add latency because Octave must first generate the speech tokens it will continue from.
* Octave supports **multi-speaker continuation**. You can keep the current voice or continue from speech generated with a different voice.
* Speech generated from Octave 1 **cannot** be continued from speech generated from Octave 2 (preview).

---