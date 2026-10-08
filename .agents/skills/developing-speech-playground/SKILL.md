---
name: developing-speech-playground
description: Changes Speech Switch schema-derived playground forms, model selection, saved requests, and error presentation. Use for playground UI or request-materialization work.
---

# Developing the speech playground

Keep the playground a consumer of authored provider schemas, not a second capability
catalog. Read the root `AGENTS.md` and `playground/README.md`. Paths and commands below
are relative to the repository root.

## Trace the schema to the form

1. `playground/vite.config.ts` supplies `virtual:speech-spec` by calling
   `codegen/repository-spec.ts` in memory. Do not add a generated JSON file,
   subprocess, or independent TypeScript parser for the playground.
2. `playground/src/lib/provider-schemas.ts` turns the complete extracted request
   union into UI schemas. Prefer `model` as the first selector, then refine with
   other literals or field presence. Keep all same-model alternatives and both
   string and streaming input variants; never select only the first union branch.
3. `playground/src/lib/provider-request.ts` owns initialization, materialization,
   and reconciliation. Reuse schema defaults and requiredness, not provider-name
   switches or hardcoded example requests.
4. `playground/src/routes/index.tsx` renders the controls. Keep the compact provider
   sidebar/form layout, authored descriptions, visible required/optional states,
   and streaming chunk/delay controls unless the requested design changes them.

## Preserve user intent

- Reconcile dependent fields only on explicit selector or transport changes. Preserve
  compatible nested values and drop only those made unsupported by that change.
- Validate saved requests as submitted. Reject incompatible fields with actionable
  errors rather than silently pruning them during load or synthesis.
- Preserve omission as a real choice for optional selectors (provider defaults).
  Do not turn every optional field into a required field just to simplify the UI.
- Keep the selected provider in the URL. Preserve per-provider/operation last
  settings and named samples in the existing local SQLite store; do not commit
  databases or clear saved data to fix form behavior.
- Preserve error messages as well as stacks, including browsers whose stack omits
  the message. Nested input errors should identify the field and collection item.
  Show structured input examples when plain comma-separated text is insufficient.
- Run synthesis on the server through the SDK; keep credentials out of client code
  and screenshots. Use the ignored environment file documented in the playground
  README rather than committing secrets.

## Verify the affected states

Use `playground/src/lib/fixtures/model-requests/` and
`playground/src/lib/model-requests.node-test.ts` for independent authored fixtures
covering model changes, same-model alternatives, optional selector omission, and
incompatible saved requests. Use `testing-speech-behavior` for assertion conventions.

Run `node --test "playground/src/lib/*.node-test.ts"` and `bun run check`; for build
or pipeline changes also run `bun run --cwd playground build`. Install playground
dependencies separately with `bun install --frozen-lockfile --cwd playground`.

For visual changes, run `bun run dev:playground` after preparing the ignored
`.dev.vars.dev` as described in `playground/README.md`. Inspect rendered captures of
the affected default, selector/streaming, and error states; do not claim visual
verification from typechecks alone. For interaction-only changes, exercise the DOM
or accessibility behavior. Report any unavailable runtime or credential-dependent
checks without treating them as passed.

## History behind this workflow

- [Generate the playground spec in memory](https://github.com/speechswitch/client/commit/26e1c3d5d5d67a8906b8ebd7bb296aa7cedb01d6)
  and [simplify the pipeline](https://github.com/speechswitch/client/commit/1b61b4bb19b80e738afefc70d953a249230724b4)
  remove parallel artifacts and analysis wrappers.
- [Carry schema defaults and actionable errors](https://github.com/speechswitch/client/commit/13ce498ba38cd8a75f80d4c001afd4403009a334)
  makes defaults provider-neutral and preserves error context.
- [Derive forms from complete request unions](https://github.com/speechswitch/client/commit/fe6df5abfd0e2c03efc0f53eb650c82cbd25b60f)
  preserves same-model alternatives and separates reconciliation from validation.
- [Compact the synthesis form](https://github.com/speechswitch/client/commit/b3791807bc8545b7325997e3651b113538df1ff9)
  favors a focused form over explanatory chrome.
