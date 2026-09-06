> ## Documentation Index
> Fetch the complete documentation index at: https://docs.rime.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Custom pauses

> Insert pauses of specific durations into Mist family synthesis using angle-bracket markers.

<Note>Custom pauses are supported by **Mist**, **Mist v2**, and **Mist v3**.</Note>

By default, Rime adds pauses based on sentence punctuation. To set a specific pause, insert its duration in milliseconds inside angle brackets.

For example, `<750>` inserts a pause of 750 milliseconds (or .75 seconds). To hear the difference, compare the following:

| Audio clip                                              | Sentence                                |
| ------------------------------------------------------- | --------------------------------------- |
| <audio controls src="/sounds/docs/wait_no_pause.wav" /> | wait, are you actually serious.         |
| <audio controls src="/sounds/docs/wait_750.wav" />      | wait. `<750>` are you actually serious. |

<Note>When making an API request, you must set `pauseBetweenBrackets` to `true`. The request would look like this:</Note>

```python Custom Pause Example theme={null}
{
	"text": "wait. <750> are you actually serious.",
    "speaker": "cove",
    "modelId": "mistv3",
    "pauseBetweenBrackets": true
}
```
