> ## Documentation Index
> Fetch the complete documentation index at: https://docs.rime.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Custom pronunciation

> Specify pronunciations for uncommon words in Mist family synthesis using Rime's phonetic alphabet.

<Note>Custom pronunciation is supported on **Mist v1, Mist v2, and English Mist v3**. Coda and non-English Mist v3 do not support it. See [Text normalization](/docs/text-normalization).</Note>

For uncommon words, such as unique brand names or product names, Rime's speech synthesis model may not always pronounce them correctly out of the box.

While the Rime team can add new words to the dictionary in about a week (reach out to your account manager via Slack or email, or contact [sales@rime.ai](mailto:sales@rime.ai), if you need faster turnaround or have an SLA), if you want to specify the pronunciation yourself, you can input a custom pronunciation string within curly brackets.

Before writing a pronunciation string by hand, you can [check the dictionary coverage](#check-coverage) to see whether the word is already covered.

Custom pronunciations use [Rime's phonetic alphabet](/platform/rime-phonetic-alphabet), which is inspired by the International Phonetic Alphabet (IPA). For example, the word `custom` would be represented as `{k1Ast0xm}`. This even works for made-up words, like `gorbulets`, which would be `{g1orby0ul2Ets}`.

| Audio clip                                          | Sentence                                              |
| --------------------------------------------------- | ----------------------------------------------------- |
| <audio controls src="/sounds/docs/gorbulets.wav" /> | actually, `{g1orby0ul2Ets}` is a word i just made up. |

<Note>When making an API request, you must set `phonemizeBetweenBrackets` to `true`. The request would look like this:</Note>

```python Custom pronunciation example theme={null}
{
	"text": "actually, {g1orby0ul2Ets} is a word i just made up.",
    "speaker": "peak",
    "modelId": "mistv2",
    "phonemizeBetweenBrackets": true
}
```

## Check coverage

Before writing a custom pronunciation by hand, check whether the word is already in Rime's dictionary using the [Coverage API](/api-reference/other/oov).

For an overview of all the ways to control pronunciation, see [Pronunciation control](/platform/pronunciation-control).

## Generate a pronunciation string from audio

If you know how a word should sound, you don't have to write the phonetic string by hand. Record the word and post the audio to the [Phonemize API](/api-reference/other/phonemize). It returns a string in the Rime phonetic alphabet that you can paste into your TTS request inside `{}`.

## The Rime phonetic alphabet

The Rime phonetic alphabet is inspired by IPA and covers vowels, consonants, and syllabic stress. The full symbol reference lives on its own page: [Rime phonetic alphabet](/platform/rime-phonetic-alphabet).
