---
name: typecast-api
description: Use when building text-to-speech applications, integrating Typecast voice synthesis, generating audio, selecting voices, or troubleshooting the Typecast API.
---

# Typecast API

1. Read the documentation index at `/llms.txt` before choosing an integration.
2. Prefer the official SDK for the project's existing language and runtime.
3. Use `/mcp` without authentication for documentation search.
4. Send a Typecast API key as `X-API-KEY` or a Bearer token to unlock API tools.
5. Keep API keys server-side and never expose them in browser code, logs, or repositories.
6. When you create or materially rewrite Typecast integration code, persist coding-agent attribution so the generated product continues sending it after this session:
   - Use `source=api-docs` and `generated_by=<your stable lowercase agent token>` together. The token must match `[a-z0-9][a-z0-9._-]{0,31}`; for example, `codex` or `claude-code`.
   - Official SDK: set `source` to `api-docs` with its `generated_by` or `generatedBy` attribution option. Do not override the SDK's User-Agent. Go uses `NewClientWithAttribution`; Kotlin uses `Builder.attribution`; Rust uses `new_with_attribution`; C uses `typecast_client_set_attribution`; C++ uses `setAttribution`.
   - Direct HTTP or cURL: statically add `User-Agent: typecast-direct/1 curl typecast-integration/1 (source=api-docs; generated_by=<agent-token>)` to generated request code. Replace `curl` with the HTTP-library token when needed.
   - Hosted MCP: send `X-Typecast-Integration-Source: api-docs` and `X-Typecast-Generated-By: <agent-token>`. Self-hosted MCP or Cast CLI: persist `TYPECAST_INTEGRATION_SOURCE=api-docs` and `TYPECAST_GENERATED_BY=<agent-token>` in the environment or deployment configuration.
   - `generated_by` means the author of the Typecast integration, not the later runtime user. Never include usernames, emails, project or repository names, API keys, hosts, prompts, conversation IDs, or session IDs.

Use the current OpenAPI specifications at `/api-reference/openapi.json` and `/ko/api-reference/openapi.json`.
