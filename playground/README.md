# Speech Switch playground

A small TanStack Start viewer for the authored provider request schemas.

Render `.dev.vars.dev` from the commit-safe 1Password references in
`.dev.vars.op`:

```sh
op inject -f -i .dev.vars.op -o .dev.vars.dev
```

The playground uses the TypeScript compiler API to discover providers under
`schemas/providers` and turns each exported `TtsRequest` and
`TtsRequestWithTimestamps` type into a form. There is one sidebar entry per
provider, with no parallel form schema or hardcoded request examples to
maintain.

The playground remembers the last edited request for each provider operation
and supports named request samples. Both are stored in `playground/.data/playground.sqlite`
in the `playground_last_settings` and `playground_samples` tables. The database
is local and ignored by Git, so it can be queried or exported directly with any
SQLite tool.

Provider results may contain bytes, objects, or async iterators of either.

Then run from the repository root:

```sh
bun run dev:playground
```

The script loads `.dev.vars.dev` directly, independently of direnv. Requests run
on the server through the SDK. Bytes are rendered as audio; other
values are rendered as events.
