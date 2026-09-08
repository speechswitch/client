> For clean Markdown of any page, append .md to the page URL.
> For a complete documentation index, see https://space.respeecher.com/docs/llms.txt.
> For AI client integration (Claude Code, Cursor, etc.), connect to the MCP server at https://space.respeecher.com/_mcp/server.

# Models & Languages

Text-to-speech language support depends on the model (base URL) used:

* `api.respeecher.com/v1/public/tts/en-rt`: English primarily,
  with some support for other languages for voices highlighted with ✨ in the playground,
  which is useful for short passages in other languages within
  text that is otherwise in English. The default model in the
  [Python](./sdks/python) and [TypeScript](./sdks/type-script) SDKs;
* `api.respeecher.com/v1/public/tts/ua-rt`: Ukrainian primarily,
  with some support for other languages for all voices, which is useful for short
  passages in other languages within text that is otherwise in Ukrainian.

There are predefined constants for public models in the SDKs, for example in Python:

```python
from respeecher import Respeecher, RespeecherEnvironment
client = Respeecher(environment=RespeecherEnvironment.PUBLIC_UA_RT)
```

## Stress marking (Ukrainian model only)

The Ukrainian model (`api.respeecher.com/v1/public/tts/ua-rt`) supports explicit stress marks, which let you control
where the stress falls in a word. This is useful for homographs or names where the
model might otherwise guess wrong.

A stress mark is placed **immediately before the vowel** that should be stressed. You
can mark stress in any of three equivalent ways:

* **Stress token** — insert a `<stress>` token before the vowel, e.g. `йог<stress>урт`.
* **Plus sign** — insert a `+` before the vowel, inside the word, e.g. `йог+урт`.
* **Unicode combining accent** — place a combining acute accent (U+0301) after the
  vowel, e.g. `йогу́рт`.

### Forcing a stress

If a single mark doesn't take effect, you can repeat it to push the model harder
toward placing the stress, e.g. `йог<stress><stress>урт` or `йог++урт`.

Repeated marks only increase how strongly the stress is enforced — they do **not**
add a second or secondary stress. Start with a single mark and only add more if it
isn't honored. More than three repeats is not recommended.