> ## Documentation Index
> Fetch the complete documentation index at: https://docs.gradium.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Voice Settings

> Fine-tune TTS output: speed, temperature, voice similarity, rewrite rules

TTS models accept advanced options via the `json_config` parameter. In
the Python SDK, this is a dict mapping option name to value (float or
string). When using the REST endpoints, pass it as a URL-encoded JSON
string in the query parameters.

These options apply to both the [WebSocket](/guides/text-to-speech) and
[REST](/guides/text-to-speech-rest) transports. For STT, see
[Transcription Settings](/guides/transcription-settings).

## Quick reference

**Range** is the span each option is tuned and tested across.

| Parameter       | Range        | Default        | Effect                                                                                                                                                               |
| --------------- | ------------ | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `temp`          | `0.0`–`1.4`  | `0.7`          | Sampling temperature. `0.0` is deterministic; higher values produce more diverse output.                                                                             |
| `cfg_coef`      | `1.0`–`4.0`  | `2.0`          | Voice similarity. Higher values stay closer to the target voice; very high values can introduce artifacts.                                                           |
| `padding_bonus` | `-4.0`–`4.0` | `0.0`          | Speech speed. Negative values are faster, positive values are slower.                                                                                                |
| `rewrite_rules` | string       | voice language | Text-rewriting rules applied before synthesis. Defaults to the voice's language alias; pass `"none"` to disable. See [Text Rewriting Rules](/guides/text-rewriting). |

<Note>
  Validation accepts a wider span than the table: `temp` to `1.5`,
  `padding_bonus` from `-5.0` to `5.0`, and `cfg_coef` to `10.0`. Error
  messages quote the validation limit, so a rejected `cfg_coef` reports
  `cfg_coef should be between 1.0 and 10.0`. Use the table's ranges when
  tuning.
</Note>

For deterministic output, set `temp` to `0.0`. For multi-utterance
flows on a single session, see [Multiplexing](/guides/multiplexing).
The TTS engine recognises the `<flush>` and `<break time="..." />`
tags described in [Text-to-Speech](/guides/text-to-speech).

## Setup fields, not `json_config`

Two per-request options are set at the top level of the setup message,
alongside `voice_id`, rather than inside `json_config`:

| Field              | Type   | Effect                                                                                                                           |
| ------------------ | ------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `pronunciation_id` | string | A pronunciation dictionary ID, applied for the whole session. See [Pronunciations](/api-reference/endpoint/list-pronunciations). |
| `model_name`       | string | Model alias to synthesise with. Defaults to `default`.                                                                           |

`pronunciation_id` goes next to `voice_id`, at the top level of the
setup. An ID that doesn't exist is reported as `Pronunciation dictionary <id> not found.`

<Note>
  Pronunciation dictionaries apply to WebSocket sessions only. REST
  requests cannot use them; the pattern-based `rewrite_rules` in
  `json_config` are the only rewriting control there. See [Text
  Rewriting Rules](/guides/text-rewriting).
</Note>

```python theme={null}
# pronunciation_id sits beside voice_id; tuning options go in json_config.
audio = await client.tts(
    setup={
        "voice_id": "YTpq7expH9539ERJ",
        "output_format": "wav",
        "pronunciation_id": "bb1ckYhNHCcIJjdK",
        "json_config": {"temp": 0.3},
    },
    text="Our SDK ships today.",
)
```

## Speed control

You can guide the speed of the model using the padding bonus
parameter. Default value is 0.0. Negative values mean that the speaker
will speak faster (values between -4.0 and -0.1). Positive values mean
that the speaker will speak slower (values between 0.1 and 4.0).

```python theme={null}
sample_text = "Hello, this is a test from the Gradium Text to Speech system. We are testing the speed."

slower_audio = await client.tts(
    setup={'voice_id': 'YTpq7expH9539ERJ', 'output_format': 'wav', 'json_config':{'padding_bonus':2.0}},
    text=sample_text,
)

faster_audio = await client.tts(
    setup={'voice_id': 'YTpq7expH9539ERJ', 'output_format': 'wav', 'json_config':{'padding_bonus':-2.0}},
    text=sample_text,
)
```

## Temperature control

The temperature for the generation can be set with values ranging from
0 to 1.4. A value of 0 corresponds to a deterministic generation, while
higher values lead to more diverse outputs. Default value is 0.7.

```python theme={null}
setup = {'voice_id': 'YTpq7expH9539ERJ', 'output_format': 'wav', 'json_config':{'temp':0.3}}

audio = await client.tts(text=sample_text, setup=setup)
```

## Voice similarity control

The `cfg_coef` parameter can be used to control the similarity of the
generated speech to the target voice. Values range from 1.0 to 4.0.
The default value is 2.0. The higher the value, the more the model
replicates the cloned voice but larger values can lead to audio
artifacts. In practice 2.0 to 3.0 covers most voice cloning work, and
4.0 is as high as you need to go.

## Rewrite rules

The `rewrite_rules` parameter can be used to pass text rewriting rules
that are applied before the text is synthesized. The rules should be
passed as a string. More details on the rules themselves can be found
in the [Text Rewriting Rules](/guides/text-rewriting) guide. Values
such as `"en"`, `"fr"`, `"fr-be"`, `"fr-ch"`, `"de"`, `"es"`, `"pt"`
enable all the rewriting rules for a given language. When the voice has a language, its alias is
enabled by default; pass `"none"` to disable rewriting entirely.

## Passing `json_config`

```python theme={null}
config = {"temp": 0.3, "cfg_coef": 2.5, "padding_bonus": -1.0}

# Streaming over WebSocket: setup is keyword args; json_config stays nested.
async with client.tts_realtime(
    voice_id="YTpq7expH9539ERJ",
    output_format="pcm",
    json_config=config,
) as stream:
    ...

# One-shot via SDK: setup is a dict containing json_config.
audio = await client.tts(
    setup={"voice_id": "YTpq7expH9539ERJ", "output_format": "wav", "json_config": config},
    text="Hello",
)
```

For REST, see the [TTS POST reference](/api-reference/endpoint/tts-post).
