> ## Documentation Index
> Fetch the complete documentation index at: https://docs.kugelaudio.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Dictionaries

> Control pronunciations for brand names, acronyms, and domain vocabulary

Custom dictionaries let you define how specific words should be spoken
before text reaches the TTS model. Each dictionary belongs to a project and
contains entries that map a written word to a replacement pronunciation or
an IPA transcription.

Use dictionaries when a word should always be pronounced the same way:

* Brand, product, and company names
* Acronyms that should be expanded or spoken letter by letter
* Domain terms, customer names, and internal vocabulary
* Words where normal text normalization is not enough

## How Dictionaries Work

The TTS pipeline applies active dictionaries during text processing. When a
request contains a matching `word`, KugelAudio substitutes the configured
`replacement` before synthesis. If an entry has `ipa`, IPA takes precedence
over the replacement text.

Set `project_id` on a generation request to load that project's dictionaries.
When `project_id` is present and `dictionary_ids` is omitted, all *active*
dictionaries of that project apply, filtered by the request language. Without
`project_id`, no project dictionary is loaded. To control which dictionaries
apply for a specific request, use
[per-request selection](#choose-dictionaries-per-request).

<Note>
  Dictionary changes apply to the next synthesis request after the mutation
  finishes.
</Note>

## Choose Dictionaries Per Request

Pass `dictionary_ids` on a TTS request to choose exactly which dictionaries
apply to that request. A non-empty selection also requires `project_id`:

* **Omit the field** — with `project_id`, all active dictionaries apply,
  filtered by language; without `project_id`, none apply.
* **`[]` (empty list)** — no dictionary applies to this request.
* **`[7, 9]` (list of IDs)** — exactly those dictionaries apply. Explicit
  selection overrides the `is_active` flag (an inactive dictionary applies
  when selected) and bypasses the language filter.

This makes `is_active` mean "apply by default": keep a dictionary inactive
and select it per request when you want full control over which vocabulary
applies to each synthesis.

Dictionary IDs are the same `id` values returned by the
[Dictionaries API](/api-reference/endpoints/dictionaries) and shown in the
dashboard. Unknown IDs or IDs from another project are rejected with a
`400` before any audio is generated.

```typescript JavaScript theme={null}
const audio = await client.tts.generate({
  text: 'Postgres runs our product analytics.',
  modelId: 'kugel-3',
  voiceId: 1071,
  language: 'en',
  projectId: 42,
  dictionaryIds: [7],
});
```

```bash cURL theme={null}
curl -X POST https://api.kugelaudio.com/v1/tts/generate \
  -H "Authorization: Bearer $KUGELAUDIO_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Postgres runs our product analytics.",
    "voice_id": 1071,
    "language": "en",
    "project_id": 42,
    "dictionary_ids": [7]
  }' \
  --output output.pcm
```

For raw streaming-input sessions, set both fields once in the sticky session
config; the selection then applies to every turn:

```json theme={null}
{
  "voice_id": 123,
  "language": "en",
  "project_id": 42,
  "dictionary_ids": [7, 9]
}
```

The current Python and Java TTS request/session builders expose
`dictionary_ids` but not the required `project_id`; use the raw API (or the
JavaScript one-shot `projectId` option) for explicit dictionary selection.

## Example Entries

| Word         | Replacement       | Use case                                         |
| ------------ | ----------------- | ------------------------------------------------ |
| `Postgres`   | `post-gres`       | Make a technical term sound natural              |
| `Kubernetes` | `koo-ber-net-eez` | Fix a product pronunciation                      |
| `API`        | `A P I`           | Spell an acronym instead of reading it as a word |

## Manage Dictionaries

You can manage dictionaries from the dashboard, the SDKs, or the raw API.
Use the SDKs for application code and bulk sync jobs; use the API reference
when you need exact HTTP fields, response shapes, or error codes.

<CardGroup cols={2}>
  <Card title="Python SDK" icon="python" href="/sdks/python/dictionaries">
    Create dictionaries, add entries, and run idempotent glossary syncs.
  </Card>

  <Card title="JavaScript SDK" icon="js" href="/sdks/javascript/dictionaries">
    Manage dictionaries from Node.js, TypeScript, or browser apps.
  </Card>

  <Card title="Java SDK" icon="java" href="/sdks/java/dictionaries">
    Manage dictionaries from Java services.
  </Card>

  <Card title="Dictionaries API" icon="code" href="/api-reference/endpoints/dictionaries">
    Raw HTTP contract for dictionary and entry CRUD.
  </Card>
</CardGroup>

## Bulk Sync

For CMS, PIM, or internal glossary workflows, use the SDK bulk replace
method. It upserts every entry in the payload and deletes entries currently in
the dictionary whose `word` is omitted. Repeating the same complete payload is
idempotent.

<Warning>
  Bulk replace is intentionally destructive for omitted words. Call it only
  with the complete desired contents of that dictionary.
</Warning>

## Generate Audio

After a dictionary is active, generate normally. Keep text normalization on
unless your application has a specific reason to bypass it.

```typescript JavaScript theme={null}
const audio = await client.tts.generate({
  text: 'Postgres runs our product analytics.',
  modelId: 'kugel-3',
  voiceId: 1071,
  language: 'en',
  normalize: true,
  projectId: 42,
});
```
