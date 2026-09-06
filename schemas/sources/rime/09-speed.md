> ## Documentation Index
> Fetch the complete documentation index at: https://docs.rime.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Playback speed

> Control speaking speed in Rime synthesis using speedAlpha and inlineSpeedAlpha.

Speed controls use different parameters and value directions by model. Use this table before changing a request:

| Scope                          | Models           | Parameter          | Faster speech | Slower speech |
| :----------------------------- | :--------------- | :----------------- | :------------ | :------------ |
| Entire response                | Coda, Mist v3    | `timeScaleFactor`  | Below 1.0     | Above 1.0     |
| Entire response, compatibility | Coda, Mist v3    | `speedAlpha`       | Above 1.0     | Below 1.0     |
| Entire response                | Mist v2          | `speedAlpha`       | Below 1.0     | Above 1.0     |
| Selected words                 | Mist v2, Mist v3 | `inlineSpeedAlpha` | Below 1.0     | Above 1.0     |

## Adjusting the overall speed

### Coda and Mist v3

Use the `timeScaleFactor` parameter. A value **above 1.0 slows the audio**; a value **below 1.0 speeds it up**.

```js theme={null}
{
    ...otherParams,
    "text": "Hello, world!",
    "modelId": "coda",
    "timeScaleFactor": 0.85
}
```

<Note>
  Coda and Mist v3 also accept `speedAlpha`, but it works in the **opposite direction** from `timeScaleFactor` (higher than 1.0 is faster, lower is slower). Use `timeScaleFactor` for these models.
</Note>

<Note>
  `timeScaleFactor` works over both HTTP and WebSocket endpoints. For `/ws`, `/ws2`, and `/ws3`, pass it as a query parameter when opening the connection.
</Note>

### Mist v2

Use the `speedAlpha` parameter. **Lower** than 1.0 is faster; **higher** than 1.0 is slower.

```js theme={null}
{
    ...otherParams,
    "text": "Hello, world!",
    "modelId": "mistv2",
    "speedAlpha": 0.85
}
```

## Adjusting the speed of individual words

<Note>Per-word speed adjustment via `inlineSpeedAlpha` is a Mist-family feature. Coda does not support it.</Note>

To adjust the speed of individual words or phrases on the Mist family, use the `inlineSpeedAlpha` parameter. It takes a comma-separated list of speed values applied to words in square brackets.

On `mistv2` and `mistv3`, values **\< 1.0 speed up** speech and values **> 1.0 slow it down**.

<Note>On Mist v3, `inlineSpeedAlpha` and `speedAlpha` go in opposite directions; `speedAlpha` follows the direction used by Coda and Mist v3 (higher = faster), but `inlineSpeedAlpha` follows the legacy Mist direction (lower = faster). Don't infer one from the other.</Note>

For example: "This sentence is \[really] \[fast]" with `inlineSpeedAlpha` "0.5, 3" will make "really" fast and "fast" slow on the Mist family.

```js theme={null}
{
    ...otherParams,
    "modelId": "mistv2",
    "text": "This sentence is [really] [fast]",
    "inlineSpeedAlpha": "0.5, 3"
}
```

## Evaluate the result

Start near `1.0` and evaluate representative audio before increasing the adjustment. Large changes can reduce naturalness and clarity.
