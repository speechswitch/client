> For clean Markdown of any page, append .md to the page URL.
> For a complete documentation index, see https://murf.ai/api/docs/llms.txt.
> For AI client integration (Claude Code, Cursor, etc.), connect to the MCP server at https://murf.ai/_mcp/server.

Here are answers to some common questions about the Murf API:

#### How does Murf ensure data security?

Murf prioritizes data security by using encryption for all API
communications, both during transit and at rest, through industry-standard
mechanisms. Data is retained only for the duration necessary, based on its
classification and intended purpose. Additionally, Murf complies with major
data regulations, including GDPR and CCPA, to ensure comprehensive
protection of user data.

#### How long can I use the free plan for?

The free plan remains valid until you exhaust the 100,000 character credits.
After this, you’ll need to upgrade to a paid plan to continue using the API.
There’s no time limit associated with the free plan, so you can use the
credits at your convenience.

#### Does the API support multiple languages?

Yes, the Murf API supports 35 languages with 150+ voices and 20+ expressive
styles to suit different use cases.

#### Can I track my usage of the API?

Yes, you can track your API usage directly from the
[dashboard](https://murf.ai/api/dashboard?utm_source=murf_api_docs). The
dashboard provides daily and monthly metrics to help you monitor your
consumption. Additionally, you’ll receive email alerts when your usage
approaches the limits of your current plan, ensuring you can manage your
quota effectively.

#### Are there character limits for TTS API requests?

The API supports up to 3,000 characters per request. For longer text, split
it into multiple requests.

#### What is the startup incubator program, and how does it work?

Startups with fewer than 100 employees can get 50 million free characters
for three months. [Apply on our website](https://murf.ai/startup-program) to
join the program.

#### What is the concurrency limit for API requests?

You can find the latest information on concurrency limits and rate limits
[here](/api/docs/resources/rate-limits).

#### Does Murf API provide timestamps for words in synthesized audio?

Yes, Murf API returns timestamps for each word in the response. This allows
accurate synchronization of audio with text, enabling features like
karaoke-style highlighting, captions, or precise playback control.

#### What do file format and audio channels mean?

* File Format: Generate audio files in MP3, WAV, FLAC, ALAW, ULAW, or encode as Base64. Sampling rates include 8Khz, 24Khz, 44.1Khz, and 48Khz.
* Audio Channels: Determine how sound is distributed. Mono channels output the same audio through all speakers, while stereo channels provide a more dynamic sound experience with distinct left and right audio tracks.

#### How does Murf protect against unethical sourcing of data?

Murf adheres to strict data sourcing guidelines to ensure ethical practices.
The company ensures that all voice data used for training and synthesis is
sourced with proper consent, respecting privacy and intellectual property
laws. Regular audits and compliance with global data regulations help
maintain ethical standards.