> For clean Markdown of any page, append .md to the page URL.
> For a complete documentation index, see https://murf.ai/api/docs/llms.txt.
> For AI client integration (Claude Code, Cursor, etc.), connect to the MCP server at https://murf.ai/_mcp/server.

# Speech Customization

Murf's AI models not only generate natural-sounding speech quickly but also give you powerful customization controls to shape the output with precision and personality. Through intuitive controls, you can fine-tune every detail to bring your creative vision to life.

All the speech customization features will only be available on the Gen2 non-streaming [Synthesize Speech](/api/docs/api-reference/text-to-speech/generate) endpoint. Gen2 streaming endpoint is deprecated. We recommend using our latest [Falcon 2](/api/docs/text-to-speech-models/falcon-2) model instead.

## Voices

Murf offers a diverse collection of **150+ AI voices** across different accents, genders, and speaking styles—designed to suit a wide range of use cases from narration and marketing to training and conversation. The `voiceId` key is a **required parameter** in the [Synthesis Speech](/api/docs/api-reference/text-to-speech/generate) operation’s request body and must be provided to specify which voice should be used to generate the audio output. Each voice comes with its own unique tonal profile and supports different features such as [styles](#styles) and [locales](#multilingual).

```python title="Python SDK"

from murf import Murf
client = Murf()
res = client.text_to_speech.generate(
    text="What color is the sky?",
    voice_id="Ariana",
)

```

```javascript title="Javascript"
import axios from "axios";

const data = {
  text: "¡Ay, mi amor! ¡Ay, mi amor!",
  voiceId: "Valeria",
};
axios
  .post("https://api.murf.ai/v1/speech/generate", data, {
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "api-key": process.env.MURF_API_KEY,
    },
  })
  .then((response) => {
    console.log(response.data.audioFile);
  });
```

```curl title="curl"
curl -X POST https://api.murf.ai/v1/speech/generate \
     -H "api-key: $MURF_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{
  "text": "du sagst mir, dass es rot ist",
  "voiceId": "Matthias"
}'
```

#### [Find your Perfect Voice](https://murf.ai/api/products/text-to-speech/Falcon?utm_source=murf_api_docs)

Explore, preview, and select from 150+ voices in 20+ expressive styles

## Multilingual

Multilingual voices enable text-to-speech synthesis that sounds authentically native across multiple languages. This allows you to use the same voice which can speak multiple languages while preserving natural pronunciation patterns specific to each language, effectively eliminating the "foreign accent" effect common in conventional Multilingual TTS systems.

**For example - "Croissant" in English & French**

#### With en-US Locale

#### With fr-FR Locale

Use the `locale` key to select which locale to use for your audio generation.

```python title="Python SDK"

from murf import Murf
client = Murf()
res = client.text_to_speech.generate(
    text="Croissant",
    voice_id="Natalie",
    locale="fr-FR"
)

```

```javascript title="Javascript"
import axios from "axios";

const data = {
  text: "Croissant",
  voiceId: "Natalie",
  locale: "fr-FR",
};
axios
  .post("https://api.murf.ai/v1/speech/generate", data, {
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "api-key": process.env.MURF_API_KEY,
    },
  })
  .then((response) => {
    console.log(response.data.audioFile);
  });
```

```curl title="curl"
curl -X POST https://api.murf.ai/v1/speech/generate \
     -H "api-key: $MURF_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{
  "text": "Croissant",
  "voiceId": "Natalie",
  "locale": "fr-FR"
}'
```

Make sure the locale that you send in `locale` is supported by your
chosen voice. You can see the list of supported locales for each voice in the
[Voice Library](/api/docs/voices-styles/voice-library).

## Styles

Murf Styles enable developers to fine-tune voice output for different contexts. Each voice supports multiple predefined styles that modify tone, emotional inflection, and delivery patterns. By passing the style parameter, you can programmatically transform a neutral voice to match specific contexts such as promotional, newscast, conversational, or inspirational to meet your application's delivery requirements.

Here are some examples of different styles available in the Murf API:

#### Sad

#### Angry

Use the `style` key to select which style to use for your audio generation.

```python title="Python SDK"

from murf import Murf
client = Murf()
res = client.text_to_speech.generate(
    text="Oh! I'll have to do this all over again.",
    voice_id="Ken",
    style="Angry"
)

```

```javascript title="Javascript"
import axios from "axios";

const data = {
  text: "Oh! I'll have to do this all over again.",
  voiceId: "Ken",
  style: "Angry",
};
axios
  .post("https://api.murf.ai/v1/speech/generate", data, {
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "api-key": process.env.MURF_API_KEY,
    },
  })
  .then((response) => {
    console.log(response.data.audioFile);
  });
```

```curl title="curl"
curl -X POST https://api.murf.ai/v1/speech/generate \
     -H "api-key: $MURF_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{
  "text": "Oh! I'll have to do this all over again.",
  "voiceId": "Ken",
  "style": "Angry"
}'
```

You can explore all supported styles and hear audio samples in our [Voice Library](/api/docs/voices-styles/voice-library).

## Pauses

Our models are capable of adding natural pauses based on the text and context. In some cases, you may want to adjust the pause duration between two words to achieve the desired effect in your speech.

Custom pause tags are only available for the **Gen2** model.

In the [Synthesize Speech](/api/docs/api-reference/text-to-speech/generate) operation, the text key of the request body holds the text to be synthesized. This text key can be tweaked to add a pause between words in your script. This is done using Murf's pause syntax: `[pause <duration>]`.

Specify how long you want the pause to be in seconds by replacing the `<duration>` part of the syntax, and you'll get silence for that duration in the generated voiceover. The pause duration can be between 0.1s to 5s.

```python title="Python SDK"

from murf import Murf
client = Murf()
res = client.text_to_speech.generate(
    text="The answer to the problem was [pause 1s] patience.",
    voice_id="Terrell"
)

```

```javascript title="Javascript"
import axios from "axios";

const data = {
  text: "The answer to the problem was [pause 1s] patience.",
  voiceId: "terrell",
};
axios
  .post("https://api.murf.ai/v1/speech/generate", data, {
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "api-key": process.env.MURF_API_KEY,
    },
  })
  .then((response) => {
    console.log(response.data.audioFile);
  });
```

```curl title="curl"
curl -X POST https://api.murf.ai/v1/speech/generate \
     -H "api-key: $MURF_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{
  "text": "The answer to the problem was [pause 1s] patience.",
  "voiceId": "Terrell"
}'
```

The `[pause <duration>]` tag is currently supported only in the **Synthesize Speech** operation for the **Gen2** model. The **Stream Speech** operation does not support custom pause tags, it automatically adds natural pauses based on the text and context.

## Audio Duration

The `audioDuration` key in [Synthesize Speech](/api/docs/api-reference/text-to-speech/generate) operation’s request body lets you specify the desired length of the generated audio (in seconds), and the system adjusts the speech to fit this duration.

Here is an example of how audio duration helps in generating voiceovers of specific lengths:

#### Default (7s)

#### Faster (6s)

#### Slower (8s)

This can be useful for matching voiceovers with specific audio lengths or other time constraints. The system will try to match the duration of the generated audio to `audioDuration` as closely as possible.

If there’s a significant difference between the requested and actual duration, consider changing the text length or `audioDuration` value for better alignment.

* **Valid values**: A double value representing the time in seconds.
* **Guideline**: As a rule of thumb. \~150 words/1000 characters of text generates around 60 seconds of audio.
* **Availability**: Supported only in the Synthesize Speech operation for the Gen2 model.

```python title="Python SDK"

from murf import Murf
client = Murf()
res = client.text_to_speech.generate(
    text="The team is down by three points. Ten seconds left on the clock! The next play could decide the game",
    voice_id="Miles",
    audio_duration=8.0
)

```

```javascript title="Javascript"
import axios from "axios";

const data = {
  text: "The team is down by three points. Ten seconds left on the clock! The next play could decide the game",
  voiceId: "Miles",
  audioDuration: 8.0,
};
axios
  .post("https://api.murf.ai/v1/speech/generate", data, {
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "api-key": process.env.MURF_API_KEY,
    },
  })
  .then((response) => {
    console.log(response.data.audioFile);
  });
```

```curl title="curl"
curl -X POST https://api.murf.ai/v1/speech/generate \
     -H "api-key: $MURF_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{
  "text": "The team is down by three points. Ten seconds left on the clock! The next play could decide the game",
  "voiceId": "Miles",
  "audioDuration": 8.0
}'
```

## Speed

The `rate` key in the [Synthesize Speech](/api/docs/api-reference/text-to-speech/generate) operation’s request body controls the speed at which the voice speaks. Adjusting this parameter lets you make the voice output faster or slower.

**Higher values mean higher speed**, and lower values slow down the speech.

* **Valid values**: Any integer between -50 and 50
* **Default value**: 0

#### Default

#### High Speed

```python title="Python SDK"

from murf import Murf
client = Murf()
res = client.text_to_speech.generate(
    text="I can't believe it! Is that really you captain?",
    voice_id="Ken",
    rate=10
)

```

```javascript title="Javascript"
import axios from "axios";

const data = {
  text: "I can't believe it! Is that really you captain?",
  voiceId: "Ken",
  rate: 10,
};
axios
  .post("https://api.murf.ai/v1/speech/generate", data, {
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "api-key": process.env.MURF_API_KEY,
    },
  })
  .then((response) => {
    console.log(response.data.audioFile);
  });
```

```curl title="curl"
curl -X POST https://api.murf.ai/v1/speech/generate \
     -H "api-key: $MURF_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{
  "text": "I can't believe it! Is that really you captain?",
  "voiceId": "Ken",
  "rate": 10
}'
```

## Pitch

The `pitch` key controls the tone or frequency of the generated voice. Increasing the pitch makes the voice sound higher (more treble), while decreasing it results in a deeper (more bass) voice.

* **Valid values**: Any integer between -50 and 50
* **Default value**: 0

#### Default

#### Low Pitch

```python title="Python SDK"

from murf import Murf
client = Murf()
res = client.text_to_speech.generate(
    text="I can't believe it! Is that really you captain?",
    voice_id="Ken",
    pitch=-10
)

```

```javascript title="Javascript"
import axios from "axios";

const data = {
  text: "I can't believe it! Is that really you captain?",
  voiceId: "Ken",
  pitch: -10,
};
axios
  .post("https://api.murf.ai/v1/speech/generate", data, {
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "api-key": process.env.MURF_API_KEY,
    },
  })
  .then((response) => {
    console.log(response.data.audioFile);
  });
```

```curl title="curl"
curl -X POST https://api.murf.ai/v1/speech/generate \
     -H "api-key: $MURF_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{
  "text": "I can't believe it! Is that really you captain?",
  "voiceId": "Ken",
  "pitch": -10
}'
```

## Variations

Variations allows you to generate voiceover using three primary parameters: pause, pitch, and speed. A higher variation value results in a more dynamic voice output, incorporating changes in speech delivery, pitch shifts, and pauses to make the audio sound more natural and less robotic.

**Variation 1**

**Variation 5**

Increasing the value will add more variation in voice style, with noticeable shifts in pause, pitch, and speed

* **Valid values**: An integer between 0 and 5
* **Default value**: 1
* **Availability**: Only available for the Gen2 model

```python title="Python SDK"

from murf import Murf
client = Murf()
res = client.text_to_speech.generate(
    text="And off they went. Gently walking into the sunset, with not a single care in the world",
    voice_id="Julia",
    variation=5
)

```

```javascript title="Javascript"
import axios from "axios";

const data = {
  text: "And off they went. Gently walking into the sunset, with not a single care in the world",
  voiceId: "Julia",
  variation: 5,
};
axios
  .post("https://api.murf.ai/v1/speech/generate", data, {
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "api-key": process.env.MURF_API_KEY,
    },
  })
  .then((response) => {
    console.log(response.data.audioFile);
  });
```

```curl title="curl"
curl -X POST https://api.murf.ai/v1/speech/generate \
     -H "api-key: $MURF_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{
  "text": "And off they went. Gently walking into the sunset, with not a single care in the world",
  "voiceId": "Julia",
  "variation": 5
}'
```