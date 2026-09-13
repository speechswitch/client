> For clean Markdown of any page, append .md to the page URL.
> For a complete documentation index, see https://developers.deepgram.com/llms.txt.
> For AI client integration (Claude Code, Cursor, etc.), connect to the MCP server at https://developers.deepgram.com/_mcp/server.

# Flux TTS Voices & Languages

Flux TTS voices use the model string format `flux-{voice}-{language}` (e.g. `flux-haley-en`). The same voice catalog is served on both `/v2/speak` transports — the [streaming WebSocket](/docs/flux-tts/quickstart) and [batch REST](/docs/flux-tts/batch).

## Selecting a voice

Pass the model string on connection:

```
wss://api.deepgram.com/v2/speak?model=flux-haley-en
```

Every voice handles general conversational synthesis. Use the tables below to shortlist, then hear the voices live at [talk.deepgram.com](https://talk.deepgram.com) before you build.

## Featured voices

Start here. The featured voices are the strongest all-rounders in the catalog — the most versatile across customer service, IVR, narration, and casual chat. Browse [More voices](#more-voices) below for additional accents, ages, and characters when you're matching a specific brand or audience.

| Voice   | Model             | Accent   | Gender | Age         | Character                                             | Use cases                                         |
| ------- | ----------------- | -------- | ------ | ----------- | ----------------------------------------------------- | ------------------------------------------------- |
| Hannah  | `flux-hannah-en`  | American | Female | Young       | Clear, confident, thoughtful, pleasant, nice          | Casual chat, storytelling                         |
| Kit     | `flux-kit-en`     | British  | Male   | Young Adult | Friendly, energetic, thoughtful, calm, helpful        | Customer service, narration, financial services   |
| Alexis  | `flux-alexis-en`  | American | Female | Adult       | Clear, professional, calm, caring, empathetic         | Customer service, IVR, financial services         |
| Cliff   | `flux-cliff-en`   | American | Male   | Mature      | Deep, confident, calm, raspy, clear                   | Financial services, narration, customer service   |
| Sienna  | `flux-sienna-en`  | American | Female | Young Adult | Clear, professional, calm, warm, caring               | Customer service, financial services, narration   |
| Cole    | `flux-cole-en`    | American | Male   | Young       | Friendly, clear, interesting, energetic, engaging     | Customer service, IVR                             |
| Brooke  | `flux-brooke-en`  | American | Female | Young       | Friendly, intelligent, fast, confident, energetic     | Healthcare, financial services, casual chat       |
| Colin   | `flux-colin-en`   | British  | Male   | Adult       | Warm, friendly, trustworthy, confident, authoritative | Customer service, financial services, narration   |
| Gemma   | `flux-gemma-en`   | British  | Female | Young       | Friendly, kind, approachable, caring, happy           | Customer service, IVR                             |
| Haley   | `flux-haley-en`   | American | Female | Young Adult | Clear, professional, caring, calm, empathetic         | Customer service, financial services, IVR         |
| Heather | `flux-heather-en` | American | Female | Young       | Clear, engaging, energetic, friendly, thoughtful      | Customer service, IVR                             |
| Miles   | `flux-miles-en`   | American | Male   | Adult       | Clear, calm, professional, confident, sincere         | Customer service, financial services, informative |
| Sean    | `flux-sean-en`    | British  | Male   | Mature      | Friendly, kind, caring, calming                       | IVR                                               |

## More voices

The rest of the catalog. Every voice here handles general conversational synthesis; the [featured voices](#featured-voices) above are the strongest all-rounders.

| Voice    | Model              | Accent      | Gender | Age         | Character                                              | Use cases                                             |
| -------- | ------------------ | ----------- | ------ | ----------- | ------------------------------------------------------ | ----------------------------------------------------- |
| Bree     | `flux-bree-en`     | American    | Female | Mature      | Friendly, sweet, kind                                  | Customer service, casual chat                         |
| Brittany | `flux-brittany-en` | American    | Female | Mature      | Confident, kind, soft                                  | Casual chat                                           |
| Bruce    | `flux-bruce-en`    | American    | Male   | Adult       | Friendly, kind, natural, believable, engaged           | Customer service, IVR                                 |
| Conor    | `flux-conor-en`    | British     | Male   | Mature      | Confident, deep, friendly, relaxed                     | Customer service, IVR                                 |
| Donovan  | `flux-donovan-en`  | American    | Male   | Adult       | Professional, calm, thoughtful                         | IVR                                                   |
| Drew     | `flux-drew-en`     | American    | Male   | Adult       | Confident, relaxed, soft, young, calm                  | Healthcare, financial services, customer service, IVR |
| Elise    | `flux-elise-en`    | American    | Female | Adult       | Clear, professional, calm, caring, empathetic          | Customer service, financial services, IVR             |
| Jack     | `flux-jack-en`     | British     | Male   | Adult       | Confident, thoughtful, friendly, professional, clear   | Customer service, storytelling                        |
| Kai      | `flux-kai-en`      | Singaporean | Male   | Young Adult | Clear, calm, professional, knowledgeable, caring       | Customer service, informative, IVR                    |
| Kelsey   | `flux-kelsey-en`   | American    | Female | Young Adult | Clear, professional, caring, calm, empathetic          | Customer service, IVR, financial services             |
| Maeve    | `flux-maeve-en`    | Irish       | Female | Adult       | Friendly, energetic, confident, gentle, calm           | Customer service, IVR, narration                      |
| Marcelo  | `flux-marcelo-en`  | Filipino    | Male   | Young Adult | Clear, calm, professional, knowledgeable, caring       | Customer service, informative, IVR                    |
| Marcus   | `flux-marcus-en`   | American    | Male   | Adult       | Friendly, helpful, smooth, professional, kind          | Customer service, casual chat                         |
| Meena    | `flux-meena-en`    | Indian      | Female | Adult       | Empathetic, professional, calm, reassuring, satisfying | Customer service, casual chat                         |
| Meghan   | `flux-meghan-en`   | American    | Female | Adult       | Friendly, nice, energetic, kind, confident             | Healthcare, financial services                        |
| Naveen   | `flux-naveen-en`   | Indian      | Male   | Adult       | Clear, professional, knowledgeable, calm, caring       | Customer service, IVR, informative                    |
| Paige    | `flux-paige-en`    | American    | Female | Young Adult | Clear, professional, calm, comfortable, caring         | Customer service, financial services, IVR             |
| Priya    | `flux-priya-en`    | Indian      | Female | Adult       | Confident, empathetic, professional, calm, reassuring  | IVR                                                   |
| Rufus    | `flux-rufus-en`    | British     | Male   | Adult       | Friendly, confident, intelligent, gentle, enthusiastic | Healthcare, financial services, storytelling          |
| Sharon   | `flux-sharon-en`   | Australian  | Female | Young       | Formal, calm, relaxed, confident                       | Healthcare, financial services                        |
| Tanner   | `flux-tanner-en`   | British     | Male   | Adult       | Professional, calm, confident                          | Customer service                                      |
| Wade     | `flux-wade-en`     | American    | Male   | Adult       | Warm, confident, clear, enthusiastic, friendly         | Customer service, casual chat                         |
| Wes      | `flux-wes-en`      | American    | Male   | Adult       | Thoughtful, friendly, warm, interesting                | Customer service, casual chat                         |

## Languages

Flux TTS voices speak English, with accents spanning American, British, Irish, Australian, Indian, Singaporean, and Filipino English. For synthesis in other languages, see [Aura-2](/docs/tts-models).

## Related resources

* [Getting Started (Streaming)](/docs/flux-tts/quickstart) — connect and synthesize with a voice
* [Getting Started (Batch)](/docs/flux-tts/batch) — one-shot synthesis
* [Feature Overview](/docs/flux-tts/feature-overview)
* [Migrating from Aura to Flux TTS](/docs/flux-tts/migrating)