> ## Documentation Index
> Fetch the complete documentation index at: https://docs.inworld.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Steering

> Direct the performance of any voice using natural language instructions.

Steering is a powerful capability that brings realistic speech to life. Truly convincing audio depends not just on the words spoken, but on how they are delivered. Flat, mechanical voices break immersion and signal to listeners that they are interacting with a machine. Steering addresses this by letting you provide natural-language instructions that control how a voice performs, covering articulation, pitch, speed, volume, and more.

Think of it as giving direction to a voice actor. Wrap your instructions in square brackets and place them before the text they apply to. No markup languages or numeric parameters required.

<Note>
- Steering is supported only on `inworld-tts-2`. On `inworld-tts-2-flash`, steering is not supported — instruction tags and the request-level `instruction` field are ignored, though [non-verbal](#non-verbals) tags like `[laugh]` work as usual. For steering, use `inworld-tts-2`.
- Steering instructions must be written in English, even when the input text is in another language.
</Note>

## How instructions work

<Note>
**A `[tag]` applies from where you write it until you change it.**
</Note>

This is the same convention as a stage direction in a screenplay. Once *(shouting)* appears, every line after it is shouted until a new direction says otherwise. A `[tag]` behaves the same way: it takes effect at the point you write it and stays in force for the rest of the text.

To end a styled passage, write `[reset]`. To switch to a different style, just write the new tag.

| You write | How it sounds |
| :---- | :---- |
| `[shouting] We need to leave now! Do you understand me?` | Both sentences shouted. |
| `[shouting] We need to leave now! [reset] Do you understand me?` | First sentence shouted, second delivered normally. |
| `[shouting] Go! [whisper] Quietly now.` | First shouted, then a whisper. |
| `We need to leave now! [shouting] Do you understand me?` | First sentence normal, second shouted. |
| `[reset] Do you understand me?` | Normal — clears an instruction set by the [`instruction`](#setting-the-instruction-for-the-whole-request) request field. |

### What does not change the instruction

An instruction stays in force until you change it. None of the following ends it:

- **The end of a sentence or a paragraph break.** Instructions are not scoped to a sentence.
- **Very long input text.** Long input is internally split for synthesis, and every part inherits the instruction in force.
- **A `<break/>` pause.** See [Pause Controls](/tts/capabilities/pause-controls) — a pause is a pause, and never alters delivery.
- **A non-verbal tag.** `[laugh]` inserts a sound; it does not clear a style.

Only another `[tag]` or `[reset]` changes the instruction.

### Ending an instruction with `[reset]`

`[reset]` removes the active instruction for the rest of the text.

> [say slowly with a trembling voice] I don't think we're alone in here. [reset] Anyway, the report is on your desk.

A few details worth knowing:

- **`[reset]` is never spoken.** Like every instruction tag, it is removed from the text before synthesis.
- **It is case-insensitive.** `[Reset]` and `[RESET]` work the same as `[reset]`.
- **It removes the instruction, not the voice.** A voice whose own character is angry or breathy stays that way after a reset. `[reset]` returns the voice to itself, not to a flat, emotionless read — which is exactly why it is not called `[neutral]`.
- **It is not final.** A later tag takes over and persists in turn: `[reset] One. [whisper] Two. Three.` speaks the first sentence normally and whispers the other two.
- **In a run of adjacent tags, the last instruction wins.** `[whisper] [reset] Hi.` clears the instruction; `[reset] [whisper] Hi.` whispers. Non-verbal tags in the run are unaffected: `[reset] [laugh] Hi.` clears the instruction and keeps the laugh.

## Setting the instruction for the whole request

The [`instruction`](/api-reference/ttsAPI/texttospeech/synthesize-speech#body-instruction) request field sets one instruction for the whole request, without putting tags in your text. It is the starting instruction; an inline tag replaces it from the point where the tag appears, and the field does not come back afterwards.

```json
{
  "text": "We need to leave now! Do you understand me?",
  "voiceId": "Dennis",
  "modelId": "inworld-tts-2",
  "instruction": "speak loudly and urgently"
}
```

<Tip>
**Pick one approach.** Use either the `instruction` field or inline `[tag]`s — not both. Mixing them is well defined (the instruction is whatever was set last, reading left to right), but it is harder to reason about. Use the field when the whole request has one delivery, and inline tags when the delivery changes partway through.
</Tip>

The `instruction` field is available on the [synthesize](/api-reference/ttsAPI/texttospeech/synthesize-speech) and [streaming](/api-reference/ttsAPI/texttospeech/synthesize-speech-stream) endpoints. The [WebSocket API](/tts/synthesize-speech-websocket) has no equivalent field — use inline tags there. Tags you send in one WebSocket message stay in force for the text you send afterwards on the same context, until you change them.

## Free-form turn instructions

Describe the full character of a delivery in natural language, like a director coaching an actor before a take. A single instruction can capture emotion, energy, pacing, and intent all at once. The more fully you describe the delivery — layering mood, physical manner, and intent — the more precisely the voice will perform.

> [speak as if barely holding back rage forcing every word through gritted teeth] I have told you. Repeatedly. And you STILL didn't listen.

> [overwhelmed with excitement and barely able to contain yourself] We just hit a million users. I still can't believe it — we actually did it!

> [slow and hushed with every word weighted by grief] I got the call this morning. He's gone.

## Metadata-based instructions

Single-property instructions that target one aspect of delivery at a time. The examples below are starting points — feel free to experiment with your own natural language phrasing.

- **Articulation:** How words are shaped and delivered — add force, crispness, or deliberate rhythm.

  *Examples:* `[say with force]` `[articulate clearly]` `[say with deliberate pauses]`

  > [articulate clearly] Each step must be followed in order. Do not skip ahead.

- **Intonation:** Controls how pitch moves through a phrase — whether it lands decisively or stays open-ended.

  *Examples:* `[say with a falling pitch]` `[say with a rising pitch]`

  > [say with a falling pitch] That's my final answer. I'm not changing my mind.

- **Volume:** The overall amplitude of the voice, from barely audible to a full, room-filling projection.

  *Examples:* `[very loud]` `[very quiet]`

  > [very quiet] Don't make a sound. There's someone right outside the door.

- **Pitch:** The baseline register of the voice — lower for gravity and weight, higher for energy and presence.

  *Examples:* `[say in a low tone]` `[say in a high pitch]`

  > [say in a high pitch] We just got the green light, the product launches tomorrow!

- **Range:** How much pitch varies across the utterance — flat for monotony, expressive for warmth or playfulness.

  *Examples:* `[say playfully]` `[say with no pitch variation]`

  > [say playfully] So anyway, I was telling her about the trip, and she just laughed the whole time.

- **Speed:** The speed of delivery — faster for urgency and tension, slower for weight and clarity.

  *Examples:* `[very fast]` `[very slow]`

  > [very fast] Run, they're right behind us, don't stop, keep moving!

- **Vocal style:** Changes how the voice itself sounds — shifting from normal speech into a different mode like whispering or singing.

  *Examples:* `[sing joyfully]` `[whisper in a hushed style]` `[give a nasal quality]`

  > [sing joyfully] The sun is rising and the world feels new, everything I dreamed is finally coming true.

## Non-verbals

Insert organic, human sounds at any point in the text to add realism.

> [clear throat] If I could have everyone's attention, please.

> I told him what happened, and he just [laugh] couldn't believe it!

Non-verbal tags and instruction tags share the same `[bracket]` syntax but behave in opposite ways:

| | Non-verbal tag | Instruction tag |
| :---- | :---- | :---- |
| **Example** | `[laugh]` | `[shouting]` |
| **What it does** | Produces a sound at that point | Changes how the surrounding words are spoken |
| **How long it lasts** | One occurrence | Until you change it or `[reset]` |
| **Where to put it** | Exactly where the sound belongs | Before the text it applies to |

Which one a bracket becomes is decided entirely by the list below: if the tag names a recognized sound, it is a non-verbal; **anything else in brackets is treated as an instruction.**

### Recognized sounds

The most reliable non-verbals — and the ones to reach for first — are `[laugh]` `[breathe]` `[clear throat]` `[sigh]` `[cough]` `[yawn]`.

The full set of recognized sounds is below. Matching ignores case, spacing, and punctuation, and accepts common inflections, so `[Clear Throat]`, `[clear_throat]`, `[clears throat]`, and `[throat clearing]` all resolve to the same sound.

<Accordion title="Full list of recognized sounds">

| Category | Tags |
| :---- | :---- |
| **Breath and effort** | `[breathe]` `[sigh]` `[gasp]` `[pant]` `[huff]` `[grunt]` `[groan]` `[moan]` |
| **Laughter** | `[laugh]` `[chuckle]` `[giggle]` `[cackle]` `[snort]` `[scoff]` |
| **Distress** | `[cry]` `[sob]` `[wail]` `[whimper]` `[whine]` `[sniffle]` `[sniff]` `[shriek]` `[squeal]` `[howl]` |
| **Throat and chest** | `[clear throat]` `[cough]` `[sneeze]` `[hiccup]` `[yawn]` `[burp]` `[snore]` `[choke]` `[gag]` `[swallow]` `[gulp]` `[spit]` |
| **Mouth** | `[tongue click]` `[mouth click]` `[mouth sound]` `[lip smack]` `[kiss]` `[shush]` `[raspberry]` `[whistle]` `[bleh]` |
| **Eating and drinking** | `[chew]` `[slurp]` |
| **Other** | `[babble]` `[beatbox]` `[growl]` |

</Accordion>

<Warning>
`[shout]`, `[scream]`, `[sing]`, `[hum]`, and `[mumble]` describe *how words are spoken*, so they are instructions, not sounds. Like any instruction, they persist until you change them — `[shout] Get down! Everyone stay calm.` shouts both sentences. Use `[reset]` if you only want the first one shouted.
</Warning>

## Emphasis

Capitalize letters within your input text to draw attention to specific words or syllables. Fully capitalizing a word stresses the entire word, while capitalizing individual letters within a word emphasizes a specific syllable.

> I told you NOT to open that door.

> Are you seriously asking if I want pizza? AbsoLUTEly I do.

## Common gotchas

<AccordionGroup>
  <Accordion title="I expected the tag to affect only one sentence">
    An instruction is not scoped to a sentence — it applies from where you write it until you change it. Write `[reset]` at the point where normal delivery should resume, or write a new tag there.

    *Instead of:* `[whisper] Don't move. They're still out there. It's clear now, we can go.`

    *Write:* `[whisper] Don't move. They're still out there. [reset] It's clear now, we can go.`
  </Accordion>
  <Accordion title="I set the instruction field and it stopped applying partway through">
    An inline tag replaces the `instruction` field from the point where the tag appears, and the field does not come back after it. This is the reason to [pick one approach](#setting-the-instruction-for-the-whole-request) rather than combining them.
  </Accordion>
  <Accordion title="[reset] made my expressive voice sound flat">
    It should not. `[reset]` removes the *instruction* you gave, not the character of the voice itself — a voice that is inherently warm, gruff, or excitable keeps that character. If a voice sounds flat after a reset, the expressiveness you were hearing came from the instruction, so use a lighter instruction rather than clearing it entirely.
  </Accordion>
  <Accordion title="My [tag] was read aloud instead of interpreted">
    Check the model. Steering is supported only on `inworld-tts-2` — `inworld-tts-2-flash` ignores instruction tags entirely (non-verbals like `[laugh]` still work), and older models may read them aloud. Also check the spelling of non-verbals — an unrecognized sound name is treated as an instruction instead of producing a sound.
  </Accordion>
  <Accordion title="I added a pause and the delivery changed">
    It should not, and a `<break/>` never clears an instruction. If the delivery changed across a pause, the cause is elsewhere in the text — most often a second `[tag]` after the break.
  </Accordion>
</AccordionGroup>

## Best practices

**Write instructions in English.** Steering instructions must be in English regardless of the language of the input text. For best results, avoid capital letters and punctuation in your instructions. For example, `[say quietly in a low tone with deliberate pauses] Bonjour, je suis ravi de vous rencontrer.`

**Use free-form descriptive instructions for maximum control.** The more you describe how you want the voice to perform, the better the output. A bare tag like `[sad]` gives the model one dimension to work with. A fuller instruction like `[say sadly with deliberate pauses in a low voice and hushed style]` combines mood, rhythm, pitch, and mode — producing a more nuanced and convincing performance.

**Avoid conflicting instructions.** Combining opposing directions, for example `[whisper in a hushed style]` and `[very loud]` in the same tag, produces unpredictable results. Use one clear instruction per tag.

**Match the instruction to the text.** The content being spoken should be consistent with the delivery style. A mismatch like `[say sadly]` applied to `This is the happiest day of my life, I just landed my dream job and fell in love!` sends contradictory signals and may degrade output quality.

**Change the instruction only where the delivery should change.** Because a tag persists, one tag at the start is enough for a passage that keeps a single delivery. Add a tag mid-text when the performance genuinely shifts, and `[reset]` when it should return to normal — but re-tagging every sentence gives the model less continuity to work with and can make delivery uneven.

**Use pause controls for longer pauses.** Use [pause controls](/tts/capabilities/pause-controls) if you want to add longer pauses for added emphasis.
