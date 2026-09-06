> For clean Markdown of any page, append .md to the page URL.
> For a complete documentation index, see https://murf.ai/api/docs/llms.txt.
> For AI client integration (Claude Code, Cursor, etc.), connect to the MCP server at https://murf.ai/_mcp/server.

In real-time generation, input text often arrives in chunks. These advanced settings let you fine-tune text buffering to balance audio quality and Time to First Byte (TTFB).

#### Default Behavior

By default, our system waits until a sentence is complete—determined by punctuation—before sending it for voice generation.

#### `min_buffer_size`

When a sentence isn’t complete and no punctuation is detected, the system uses `min_buffer_size` to decide when to send the text. This parameter sets the minimum number of characters required before sending input for audio generation. A larger buffer provides better context for the model, leading to higher audio quality. Reducing this value can lower TTFB by enabling quicker responses.

* Range: 40 to 160 characters

#### `max_buffer_delay_in_ms`

If a sentence is incomplete and text hasn’t reached `min_buffer_size` as well, `max_buffer_delay_in_ms` sets the maximum time (in milliseconds) the system will wait before processing the input. Once this delay is reached, the available text is sent—even if it’s below the buffer threshold.

* Range: 0 to 1000 milliseconds

### Example

Let’s say the first chunk of text received is: "I just wanted to say that"

* This sentence is incomplete and has no punctuation, so the system doesn’t immediately send it for audio generation.
* The current length is 24 characters, which is below a `min_buffer_size` of, say, 60 characters.
* The system waits for more input. If no additional text arrives within the time set by `max_buffer_delay_in_ms` (e.g., 500 ms), the system sends whatever text it has.

**Result:** After 500 ms, "I just wanted to say that" is sent for audio generation to avoid further delay.
This mechanism ensures fast responses (good TTFB) without compromising too much on naturalness or context.