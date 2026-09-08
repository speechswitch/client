> For clean Markdown of any page, append .md to the page URL.
> For a complete documentation index, see https://space.respeecher.com/docs/llms.txt.
> For AI client integration (Claude Code, Cursor, etc.), connect to the MCP server at https://space.respeecher.com/_mcp/server.

# Sampling Parameters Guide

Sampling Parameters allow you to control the behavior and creativity of the generated audio
and influence how the model selects and structures its output.
Default Sampling Parameters for each voice can be obtained through the
[Voices](../voices/list#response.body.sampling_params) endpoint.
When specifying voice for TTS endpoints, you can optionally override these default values.
For example, if you pass `voice: {"id": "samantha", "sampling_params": {"temperature": 0.22}}`,
the default `temperature` will be overridden with `0.22`, and the other parameters will
keep their default values for `samantha`.

Finding the right set of Sampling Parameters is largely a matter of trial and error.

* `temperature`:
  Controls the randomness of the model's output.
  Low values make the model more deterministic and focused.
  High values introduce more creativity and variability.
* `top_p`:
  Limits the next audio token selection to the smallest set whose cumulative probability is
  above the set threshold.
  Low values make the model more focused.
  High values increase diversity.
* `frequency_penalty`:
  Reduces the likelihood of repeating audio tokens based on their frequency
  in the generated audio.
  Specifically targets overuse of audio tokens, or "phonemes",
  making sure no token is overly repeated in the audio.
* `repetition_penalty`:
  Penalizes new audio tokens based on whether they appear in the generated audio so far.
  Very likely tokens are penalized more than less likely tokens.
* `presence_penalty`:
  Penalizes new audio tokens based on whether they appear in the generated audio so far.
  The applied penalty does not depend on likeliness of the token.
* `seed`:
  Sets a random seed for generation.
  Using the same seed allows for reproducible outputs.
* `top_k`:
  Considers the top-k most likely next audio tokens.
  Low values generate more focused outputs.
  High values generate more diverse outputs.
  The special value of `-1` considers all tokens.
* `min_p`:
  Sets a minimum probability threshold for audio token selection.
  Low values allow more tokens to be considered.
  High values restrict the number of tokens considered.

See the [Voices](../voices/list#response.body.sampling_params) endpoint reference
for allowed values for each of the Sampling Parameters.