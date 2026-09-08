> ## Documentation Index
> Fetch the complete documentation index at: https://docs.rime.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Changelog

> Release notes for Rime's TTS API and on-prem images.

## Rime API changelog

<Tip>Subscribe to the [RSS feed](https://docs.rime.ai/docs/changelog/rss.xml) to get notified of new releases.</Tip>

<Update label="2026-08-25">
  * The [Data and privacy](https://app.rime.ai/data-and-privacy) page in the Rime dashboard now lets you control optional request-data retention for your personal account or team.
    * Optional retention is disabled by default. Team members can view the setting, and team owners can change it.
    * If you enable retention, Rime can keep customer content and technical request details to investigate support issues and improve speech quality. This setting does not permit model training.
</Update>

<Update label="2026-08-15">
  * Arcana retired from the Rime cloud API. Requests using `arcana`, `arcanav2`, or `arcanav3` are now served by Coda. Replace the retired identifier and verify the voice and language pairing with [Remove Arcana model IDs](/docs/migrate-arcana-to-coda).
  * Release `20260815`:
    * Improved text normalization, including more consistent tokenization and handling of symbols, fractions, and common numeric expressions.
</Update>

<Update label="2026-08-04">
  * The [language matrix](/docs/voices#languages) now lists support per model.
    * Coda serves English, Arabic, French, German, Hindi, Japanese, Portuguese, and Spanish.
    * Mist v3 serves English, French, German, and Spanish.
    * The `lang` parameter tables in the [Coda API reference](/api-reference/coda/http) now include Arabic and Hindi.
</Update>

<Update label="2026-07-29">
  * **Cloud Arcana requests will switch to Coda on August 15, 2026.**
    * On August 15, cloud Arcana traffic will route to [Coda](/docs/models#coda). Migrate by changing `modelId: arcana` to `modelId: coda`; the API contract is unchanged. Sinhala remains available on Arcana.
    * **On-prem:** existing Arcana images remain available to pull and run, but will not receive updates or support (including vulnerability patches and text-normalization fixes) after August 15, 2026.
    * We recommend migrating before August 15 so you can test voices and validate output on your own timeline. Questions? Contact [support@rime.ai](mailto:support@rime.ai).
</Update>

<Update label="2026-07-10">
  * Rime now hosts a first-party MCP (Model Context Protocol) server at [mcp.rime.ai](https://mcp.rime.ai):
    * Connect Claude, OpenAI Codex, your IDE, or any MCP-compatible client to browse the voice catalog, check dictionary coverage, preview text normalization, generate speech samples, and scaffold Pipecat or LiveKit integration code.
    * Catalog and integration tools work without an API key; synthesis and linguistics tools authenticate with your existing Rime API key, sent per request.
    * See the [MCP quickstart](/docs/mcp) to get connected, and the [MCP server reference](/mcp-reference/overview) for tool-by-tool documentation.
</Update>

<Update label="2026-06-11">
  * The Speech QA dashboard has been retired from the Rime web app.
    * Pronunciation features remain fully supported via the API: check dictionary coverage with the [Coverage API](/api-reference/other/oov) and specify custom pronunciations inline with the [Rime phonetic alphabet](/platform/rime-phonetic-alphabet) and `phonemizeBetweenBrackets` (Mist v1/v2).
    * To request a pronunciation fix or dictionary addition, reach out to your account manager via Slack or email, or contact [sales@rime.ai](mailto:sales@rime.ai).
    * The `saveOovs` parameter on Mist v1/v2 endpoints remains supported for backward compatibility, but has been removed from the API reference along with the dashboard it reported to.
    * Newly documented: the [Phonemize API](/api-reference/other/phonemize); post a recording of a word and get back a phonetic string in the Rime phonetic alphabet.
    * See [Pronunciation control](/platform/pronunciation-control) for an overview of all the ways to control pronunciation.
</Update>

<Update label="2026-05-19">
  * **Coda** is now available via `modelId: coda`:
    * New flagship TTS model; sophisticated LLM backbone paired with a dedicated speech inference engine, trained on conversational full-duplex data.
    * Surpasses prior Rime models and competitor offerings in human-led voice-quality evaluations across naturalness, prosody, and artifact-free output.
    * Sub-100ms model latency on the GPU engine (self-hosted or on-prem); cloud API users add roughly 25–50ms network round-trip from most of the continental US. See [Regional endpoints](/docs/regional-endpoints).
    * Multilingual support across English, French, German, Japanese, Portuguese, and Spanish.
    * Word-level timestamps over the JSON websocket endpoint for text-audio alignment and interruption handling.
    * Available via the cloud API and on-premises at launch.
    * **Recommended successor to Arcana** for all existing Arcana traffic; swap `modelId: arcana` for `modelId: coda`.
    * See the [Coda API reference](/api-reference/coda/http) for details.
</Update>

<Update label="2026-04-24">
  * API on-prem image `20260424`:
    * New environment variables for authentication configuration:
      * `RIME_API_KEY`: pre-configure the API key at the deployment level so callers don't need to include it in each request. Can also be mounted as a secret file at `/secrets/rime_api_key`.
      * `API_KEY_HEADER`: specify an alternate header name for platforms that intercept the `Authorization` header.
      * `PLATFORM_API_KEY`: supply a platform API key for authenticated inter-container requests. Can also be mounted as a secret file at `/secrets/platform_api_key`.
</Update>

<Update label="2026-04-20">
  * Arcana V2, Arcana V3 and Mist V3 release `20260420`.
  * General performance improvements and bug fixes.
</Update>

<Update label="2026-04-09">
  * Arcana release `20260404`:
    * Improved and stabilized text normalization across all supported languages.
    * Upgrade to `20260404` is recommended.
  * Mist v3 release `20260404`:
    * Reached general availability.
  * General performance improvements across the inference stack for all models.
</Update>

<Update label="2026-04-07">
  * API on-prem image `20260407`:
    * Compatible with Mist v3.
</Update>

<Update label="2026-04-06">
  * Mist v3 is now available via `modelId: mistv3`:
    * TTFB well below 100ms: a major latency improvement over Mist v2 without sacrificing quality
    * Popular Mist v2 speakers available, plus 8 Arcana flagship speakers now available as Mist v3 voices
    * See the [full voice list](/api-reference/data/voices)
</Update>

<Update label="2026-02-23">
  * Arcana release `20260223`:
    * v3 (multilingual)
      * Supported languages: `de`, `en`, `es`, `fr`, `he`, `ja`, `pt`, `si`, `ta`.
    * General performance improvements and bug fixes.
</Update>

<Update label="2026-02-11">
  * API on-prem image `20260212`:
    * Exposes a new json websockets endpoint with WLT (equivalent to the cloud api's `ws3` endpoint) on port 8003
</Update>

<Update label="2026-02-05">
  * Arcana v3 `lang` parameter: 2- and 3-letter ISO 639 codes that map to the same language are accepted and normalized (e.g. <code>de</code>, <code>deu</code>, or <code>ger</code> for German; <code>fr</code>, <code>fra</code>, or <code>fre</code> for French). Supported languages:

    | 639-1 | 639-2/639-3 | Language   |
    | ----- | ----------- | ---------- |
    | de    | deu, ger    | German     |
    | en    | eng         | English    |
    | es    | spa         | Spanish    |
    | fr    | fra, fre    | French     |
    | he    | heb         | Hebrew     |
    | ja    | jpn         | Japanese   |
    | pt    | por         | Portuguese |

    Any valid ISO 639-1, 639-2, or 639-3 code that maps to one of these languages is accepted.
</Update>

<Update label="2026-02-04">
  * Regional endpoints available:
    * `wss://users-east-ws.rime.ai/ws*` offers all the websockets apis currently served served via `wss://users-ws.rime.ai/ws*` and may provide better latency
      for clients closer to `us-east-1`.
    * `https://users-east.rime.ai/v1/rime-tts` offers all the same API currently served via `https://users.rime.ai/v1/rime-tts`, and may provide better latency
      for clients closer to `us-east-1`.
    * Additionally `https://users-west.rime.ai/v1/rime-tts` offers all the apis currently served via `https://users.rime.ai/v1/rime-tts`, and may provide better latency
      for clients closer to `us-west-1`.
  * Arcana now supports JSON websockets with Word-Level-Timestamps:
    * `wss://users-ws.rime.ai/ws3` and `wss://users-east-ws.rime.ai/ws3` serve the JSON websockets api that now supports both `mist` and `arcana` model classes.
  * Arcana release `20260204` (Arcana v3):
    * Added support for languages: English (`lang=eng`), French (`lang=fra`), German (`lang=ger`), Hebrew (`lang=heb`), Japanese (`lang=jpn`), Portuguese (`lang=por`), Spanish (`lang=spa`).
    * Languages can be specified using either 2-character codes (`en`, `fr`, `de`, `he`, `ja`, `pt`, `es`) or 3-character codes (`eng`, `fra`, `ger`, `heb`, `jpn`, `por`, `spa`).
</Update>

<Update label="2026-02-03">
  * Arcana now supports the `spell()` function. You can use `spell()` to spell out sequences letter by letter or number by number with Arcana voices. See the [spell function documentation](/docs/spell) for examples.
</Update>

<Update label="2026-01-31">
  * Arcana release `20260131`:
    * General performance improvements and bug fixes.
</Update>

<Update label="2026-01-24">
  * Arcana release `20260124`:
    * Fixed speaker mapping for English Arcana.
    * General performance improvements and bug fixes.
</Update>

<Update label="2026-01-23">
  * API on-prem image `20260123`:
    * Exposes the binary websockets API on port 8002. This API is equivalent to the [cloud websockets API](/api-reference/endpoint/websockets).
</Update>

<Update label="2026-01-22">
  * Arcana release `20260122`:
    * `rime.engine.initial_latency` and `rime.engine.generated_audio_duration` have saner defaults and [can be tuned](/docs/on-prem/metrics).
    * Added `spell()` support.
    * General performance improvements and bug fixes.
</Update>

<Update label="2026-01-15">
  * Arcana release `20260115`:
    * Fixed an issue where there is static noise for some speakers at the end or in the middle of utterances.
    * A full set of ORCA headers are now returned for load balancing.
    * A `/statusz` endpoint is introduced for the model container that contains diagnostics information.
    * `/livez` now responds with `OK` as soon as the server starts up.
    * General performance improvements.
</Update>

<Update label="2026-01-14">
  * Added [Lovable integration guide](/docs/lovable) with template for building voice-enabled apps.
  * Added [Replit integration guide](/docs/replit) with template for building voice-enabled apps.
</Update>

<Update label="2025-12-20">
  * Arcana release `20251220`:
    * An ORCA header, `named_metrics.inference_concurrency_utilization`, is now returned in all HTTP responses.
    * Emojis are no longer read out.
    * General reliability updates.
</Update>

<Update label="2025-12-13">
  * Arcana release `20251213`:
    * Performance improvements for the English model.
    * Minimum requirements for NVIDIA drivers reduced to `525.60.13`.
    * General reliability updates.

  * API release `20251209`:
    * Exposes non-JSON WebSockets over port `8002`, allowing for Arcana over
      WebSockets.
    * Fixes an issue where `null` values were sent to the model for parameter
      keys not set by the user.
</Update>

<Update label="2025-12-06">
  * Arcana release `20251206`:
    * [OpenTelemetry metrics](/docs/on-prem/metrics#opentelemetry-metrics) are now available in the model images.
    * Quality and performance improvements.
</Update>

<Update label="2025-11-21">
  * Arcana release `20251121`:
    * Fixed an issue with μ-law encoding.
</Update>

<Update label="2025-11-20">
  * Arcana release `20251120`:
    * Fixed an issue with audio buffer underrun.
</Update>

<Update label="2025-11-19">
  * Arcana release `20251119`:
    * Fixed a startup issue in the `20251118` release.
</Update>

<Update label="2025-11-18">
  * Arcana release `20251118`:
    * General improvements.
</Update>

<Update label="2025-11-10">
  * Arcana release `20251110`:
    * Separate engine and data package containers for easier deployment.
    * General reliability improvements.
</Update>

<Update label="2025-11-06">
  * Mist on-prem model image `us-docker.pkg.dev/rime-labs/mist/v2/en:20251106` released.
  * Includes performance enhancements and minor fixes.
</Update>

<Update label="2025-11-05">
  * Mist on-prem model image `us-docker.pkg.dev/rime-labs/mist/v2/en:20251105` released.
</Update>

<Update label="2025-11-03">
  * Arcana on-prem model images tagged `20251101` release with language updates.
</Update>

<Update label="2025-10-29">
  * Arcana language update: additional language support and new voices.
</Update>

<Update label="2025-10-27">
  * Arcana on-prem model images tagged `20251027`: performance improvements.
  * Documentation on [performance tuning](/docs/on-prem/performance).
</Update>

<Update label="2025-10-15">
  * Arcana is now available via (non-json) websockets users.rime.ai/ws.
</Update>

<Update label="2025-10-14">
  * Arcana on-prem images with tag `20251014`: Fixed a bug related to sample rate.
</Update>

<Update label="2025-10-13">
  * Arcana on-prem images with tag `20251013`: General performance improvements.
</Update>

<Update label="2025-10-10">
  * Api on-prem image with tag `20251010`: Uses https instead of http in the external calls to rime.optimize.ai to acquire licenses and track usage.
  * ⚠️ When upgrading to this image you may have to update your firewall settings to account for the new URLs ([see docs](/docs/on-prem/quickstart#firewall-requirements)).
</Update>

<Update label="⚠️ 2025-09-30">
  * We have made breaking changes in voice details api ([https://users.rime.ai/data/voices/voice\_details.json](https://users.rime.ai/data/voices/voice_details.json))
  * In the voice details API, the field `model_id` has been renamed to `modelId` and `name` have been renamed to `speaker` for better clarity.
  * In the voice details API, the field `region` has been renamed to `dialect` for better clarity.
  * The `language` field value has been changed from short codes (e.g., `eng`) to human-readable names (e.g., `english`).
  * A new field `lang` has been added to retain the short language code (e.g., `eng`).
</Update>

<Update label="2025-09-29">
  * Arcana on-prem images with tag `20250929`: quality improvements.
</Update>

<Update label="2025-09-27">
  * Arcana on-prem images with tag `20250927`: quality improvements.
</Update>

<Update label="2025-09-25">
  * Arcana on-prem English image with tag `20250925`: performance improvements and general model stability enhancements.
  * Added two new Australian flagship voices:
    * `eucalyptus`
    * `marlu`
</Update>

<Update label="2025-09-24">
  * Arcana on-prem images with tag `20250924`: performance improvements.
</Update>

<Update label="2025-09-17">
  New api onprem image `us-docker.pkg.dev/rime-labs/api/service:20250917` released.

  * api image now supports multiple model backends.
  * /health endpoint on the api image now reports model status.
</Update>

<Update label="2025-09-13">
  * Both `/ws` and `/ws2` support the query param `saveOovs`, allowing tts users to track which words in their text are out-of-vocabulary on
    the Speech QA dashboard.
</Update>

<Update label="2025-09-13">
  * Arcana on-prem images from `20250913` now provide better latency and can run on H100 MIG (`3g.40gb`).
</Update>

<Update label="2025-09-09">
  * Arcana on-prem images from `20250909` now provide `/livez` and `/readyz` endpoints for liveness and readiness checks.
</Update>

<Update label="2025-09-08">
  * Arcana on-prem images from `20250908` now use 16-bit little endian for PCM and WAV.
  * Arcana on-prem images from `20250908` now support G-711 μ-law as an audio codec.
  * Arcana on-prem images from `20250908` now support the `speedAlpha` option for time scaling.
</Update>

<Update label="2025-09-02">
  * `saveOovs` parameter added to all mistv2 tts endpoints, enabling users to have out-of-vocabulary words logged to their Speech QA dashboard for review and addition to the mist lexicon.
</Update>

<Update label="2025-08-01">
  * Added French and German language support via the `lang` parameter in WebSocket JSON APIs. The `/ws2` api now has full language parity with the `/ws` and http tts endpoints.
</Update>

<Update label="2025-07-31">
  * Added Spanish language support via the `lang: spa` parameter in WebSocket JSON APIs.
  * Enhanced text segmentation with new `segment` parameter:
    * Added `segment` query parameter with three modes: "immediate", "never", and "bySentence" (default)
    * Deprecated `immediate` boolean parameter (still supported for backward compatibility)
    * Improved control over text processing and synthesis timing
</Update>

<Update label="2025-05-27">
  * The `<FLUSH>` command is now available on both the the websockets and websockets-json apis, allowing for immediate audio synthesis of all tokens in the buffer.
</Update>

<Update label="2025-04-24">
  * We've launched **Arcana**: a new model for expressive, natural voice synthesis. Available now with `modelId: arcana`.
</Update>

<Update label="2025-03-28">
  * The `lang` ID `spa-mx` has been added. Using this accesses the same spanish languages but uses `pesos` instead of `dolares` for currency.
  * New `lang: fra` has been added. We now have French voices available on the dashboard and via API.
</Update>

<Update label="2025-03-26">
  * The `spell()` function now works for Spanish. Try it out! "El nombre se escribe spell(Isabella)."
  * Fixed a bug where silence information is not processed properly when `pauseBetweenBrackets` is True
  * The url `demo-api.rime.ai` has been **deprecated**. Please use `demo.rime.ai` instead if you are using the demo API.
</Update>
