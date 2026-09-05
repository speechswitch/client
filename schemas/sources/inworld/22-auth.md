> ## Documentation Index
> Fetch the complete documentation index at: https://docs.inworld.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Introduction

## Authentication

All requests to Inworld's APIs carry a credential in the `Authorization` header — your [API key](/portal/api-key-auth) directly on servers, or a token minted from it (a [one-time token](/portal/ephemeral-tokens); [session tokens](/portal/session-tokens) are deprecated) on clients:

```
Authorization: Basic $INWORLD_API_KEY
```

The [authentication guide](/portal/authentication) covers how to choose a credential, and [Security best practices](/portal/auth-security) covers keeping it safe.
