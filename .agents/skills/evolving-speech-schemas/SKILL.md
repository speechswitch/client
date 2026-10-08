---
name: evolving-speech-schemas
description: Evolves Speech Switch authored types and generated validation, defaults, documentation, and wire mappings. Use for schema, specgen, serializer, or provider-narrowing changes.
---

# Evolving speech schemas

Change the authored contract first, then derive its consumers. Read the root
`AGENTS.md`; all paths and commands below are repository-root relative.

## Follow the existing pipeline

1. Start in `schemas/base.ts` and `schemas/providers/<provider>/index.ts`. Keep this
   TypeScript project runtime-free and its exported request types plain. Model
   cohesive values with nesting and independent concepts separately: `container`,
   `codec`, `sampleFormat`, and `sampleRateHz` are not one vendor format string.
2. Read `codegen/specgen.ts` and `codegen/spec-model.ts` before extending extraction.
   Normalize base and provider types independently using checker identity/typed AST,
   compare subsets, then inherit base metadata. Preserve forbidden fields and full
   union alternatives. Do not replace this with a parallel schema language or
   rendered-type-string parsing.
3. Follow the change through `codegen/request-validator.ts`,
   `codegen/request-serializer.ts`, and `codegen/spec-render.ts` as applicable.
   Emit specialized code, not runtime schema descriptors. The playground consumes
   the same extracted spec through `codegen/repository-spec.ts`.

## Preserve the validation contracts

- Normalize `undefined` only at optional property boundaries, not inside required
  values, arrays, or records. Each provider union branch must fit a base alternative,
  including its required discriminators; do not compare only the first alternatives.
- Use JSDoc for documentation and supported annotations for constraints/defaults.
  Provider bounds can narrow, not widen, the base. Validate `@default` against the
  type and inherited constraints; a default requires an optional field.
- Export shared top-level defaults as metadata; do not mutate requests to fill them.
  Provider boundaries and playground initialization consume that metadata.
- `validateRequest(value)` returns void and never acquires/advances async input.
  `validateInputItem(request, item)` assumes a validated request and checks the
  compatible streaming variants. Do not revalidate common request fields per item.
- Accumulate sibling errors with useful paths. Stop descending into an invalid
  container. A successful union branch discards only that union's failed alternatives,
  not earlier sibling failures. Use discriminators when available.

## Keep serialization partial

Use `@serializeAs <contract> <field>` for mechanical wire names, including unchanged
names. Emit only fields annotated for that contract, recursively map nested values,
omit optional `undefined`, and preserve record keys. Reject duplicate destinations
and conflicting union mappings. Serializers neither validate requests nor consume
iterators. Defaults, flattening, value conversion, and streaming input stay explicit
in adapters, which check the completed object against its wire type.

## Exercise generated behavior

Use small authored TypeScript fixtures, extract in-process, generate into a temporary
module, import it, and assert behavior; see `codegen/specgen.node-test.ts` and
`codegen/request-validator.node-test.ts`. Cover both sides of the changed constraint
and exact diagnostics where relevant. Add type-level rejection checks for API
combinations that must fail at compile time.

Run `bun run generate:spec` and inspect the generated diff, then `bun run check`.
Run `generate:clients` only for wire-client changes and `generate:registry` for
provider discovery changes. Never hand-edit generated outputs to make checks pass.

## History behind this workflow

- [Use plain provider request schemas](https://github.com/speechswitch/client/commit/e228d958f509b6a5439b897f825d4354026fd7d3)
  replaces type-level capability machinery with independently authored requests.
- [Separate request and streaming-item validation](https://github.com/speechswitch/client/commit/2c22d7a)
  replaces returned validation closures with two explicit operations.
- [Generate partial wire mappings](https://github.com/speechswitch/client/commit/ddcfd9d434c8a319c6704a382e1cf219d693ac6a)
  keeps mechanical mapping separate from protocol semantics.
- [Separate containers, codecs, and PCM sample formats](https://github.com/speechswitch/client/commit/3dbb90d77471010604df6a0d39743cd5abf5e4eb)
  supersedes the older prohibition on base output unions.
