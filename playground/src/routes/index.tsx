import {
  SpinnerGapIcon,
  WaveformIcon,
} from "@phosphor-icons/react"
import { createFileRoute } from "@tanstack/react-router"
import { useEffect, useState, type FormEvent } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import type {
  JsonValue,
  PropertySchema,
  ProviderOperationSchema,
  ProviderSchema,
  TypeSchema,
} from "@/lib/provider-schema"
import {
  initialValue,
  materializedRequest,
  selectDiscriminatedVariant,
  selectedVariant,
  streamingTextSegments,
} from "@/lib/provider-request"
import { listProviders, runProvider } from "@/lib/providers"
import {
  loadProviderState,
  saveLastSettings,
  saveNamedSample,
  type PlaygroundSample,
} from "@/lib/samples"

export const Route = createFileRoute("/")({
  loader: () => listProviders(),
  component: Playground,
})

type AudioResult = { base64: string; contentType: string }

function title(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^./, (character) => character.toUpperCase())
}

function setPath(root: JsonValue | undefined, path: string[], value: JsonValue): JsonValue {
  if (!path.length) return value
  const [head, ...rest] = path
  return {
    ...(root && typeof root === "object" && !Array.isArray(root) ? root : {}),
    [head!]: setPath(
      root && typeof root === "object" && !Array.isArray(root)
        ? (root as Record<string, JsonValue>)[head!]
        : undefined,
      rest,
      value,
    ),
  }
}

function valueAt(root: JsonValue, path: string[]): JsonValue | undefined {
  return path.reduce<JsonValue | undefined>((value, part) => (
    value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, JsonValue>)[part]
      : undefined
  ), root)
}

interface SchemaFieldProps {
  field: PropertySchema
  path: string[]
  rootValue: JsonValue
  onChange: (path: string[], value: JsonValue) => void
  locked?: boolean
}

function SchemaField({ field, path, rootValue, onChange, locked = false }: SchemaFieldProps) {
  const value = valueAt(rootValue, path)
  const id = path.join("-").replace(/[^a-zA-Z0-9_-]/g, "-")
  const hint = field.description
  const schema = field.schema

  if (schema.kind === "discriminatedUnion") {
    const variant = selectedVariant(schema, value) ?? schema.variants[0]
    if (!variant) return null
    const discriminatorFields = schema.variants.map(({ schema: option }) =>
      option.properties.find(({ name }) => name === schema.discriminator)
    )
    const discriminatorField = discriminatorFields.find((candidate) => candidate !== undefined)
    if (!discriminatorField) return null
    const values = schema.variants.flatMap(({ values }) => values)
    const fieldForDiscriminator: PropertySchema = {
      ...discriminatorField,
      optional: false,
      schema: { kind: "enum", label: discriminatorField.schema.label, values },
    }
    const handleChange = (changedPath: string[], nextValue: JsonValue) => {
      if (changedPath.join(".") !== [...path, schema.discriminator].join(".")) {
        onChange(changedPath, nextValue)
        return
      }
      if (typeof nextValue !== "string" && typeof nextValue !== "number" && typeof nextValue !== "boolean") return
      onChange(path, selectDiscriminatedVariant(schema, value, nextValue))
    }
    return (
      <FieldSet>
        <FieldLegend>
          {title(field.name)}
          {field.optional && <Badge variant="outline">optional</Badge>}
        </FieldLegend>
        {hint && <FieldDescription>{hint}</FieldDescription>}
        <FieldGroup className="grid gap-3 md:grid-cols-2">
          <SchemaField
            field={fieldForDiscriminator}
            path={[...path, schema.discriminator]}
            rootValue={rootValue}
            onChange={handleChange}
            locked={locked}
          />
          {variant.schema.properties
            .filter(({ name }) => name !== schema.discriminator)
            .map((property) => (
              <SchemaField
                key={property.name}
                field={property}
                path={[...path, property.name]}
                rootValue={rootValue}
                onChange={onChange}
                locked={locked}
              />
            ))}
        </FieldGroup>
      </FieldSet>
    )
  }

  if (schema.kind === "object") {
    return (
      <FieldSet>
        <FieldLegend>
          {title(field.name)}
          {field.optional && <Badge variant="outline">optional</Badge>}
        </FieldLegend>
        {hint && <FieldDescription>{hint}</FieldDescription>}
        <FieldGroup className="grid gap-3 md:grid-cols-2">
          {schema.properties.map((property) => (
            <SchemaField
              key={property.name}
              field={property}
              path={[...path, property.name]}
              rootValue={rootValue}
              onChange={onChange}
              locked={locked}
            />
          ))}
        </FieldGroup>
      </FieldSet>
    )
  }

  if (schema.kind === "boolean") {
    return (
      <Field orientation="horizontal">
        <Checkbox
          id={id}
          disabled={locked}
          checked={Boolean(value)}
          onCheckedChange={(checked) => onChange(path, checked)}
        />
        <FieldContent>
          <FieldLabel htmlFor={id}>
            {title(field.name)}
            {locked && <Badge variant="secondary">streaming</Badge>}
            {field.optional && <Badge variant="outline">optional</Badge>}
          </FieldLabel>
          {hint && <FieldDescription>{hint}</FieldDescription>}
        </FieldContent>
      </Field>
    )
  }

  return (
    <Field>
      <FieldLabel htmlFor={id}>
        {title(field.name)}
        {locked && <Badge variant="secondary">streaming</Badge>}
        {field.optional && <Badge variant="outline">optional</Badge>}
      </FieldLabel>
      {schema.kind === "enum" ? (
        <Select
          disabled={locked}
          required={!field.optional}
          value={value === undefined ? "" : String(value)}
          onValueChange={(selected) => {
            const typed = schema.values.find((candidate) => String(candidate) === selected)
            if (typed !== undefined) onChange(path, typed)
          }}
        >
          <SelectTrigger id={id}><SelectValue placeholder="Select a value" /></SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {schema.values.map((option) => (
                <SelectItem key={String(option)} value={String(option)}>{String(option)}</SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      ) : schema.kind === "array" || schema.kind === "json" || /text|instructions|description/i.test(field.name) ? (
        <Textarea
          id={id}
          disabled={locked}
          required={!field.optional}
          aria-required={!field.optional}
          value={typeof value === "string" ? value : value === undefined ? "" : JSON.stringify(value, null, 2)}
          onChange={(event) => onChange(path, event.target.value)}
          placeholder={schema.kind === "array" ? "Comma-separated values or JSON" : undefined}
        />
      ) : (
        <Input
          id={id}
          disabled={locked}
          required={!field.optional}
          aria-required={!field.optional}
          type={schema.kind === "number" ? "number" : "text"}
          value={value === undefined ? "" : String(value)}
          onChange={(event) => onChange(path, event.target.value)}
        />
      )}
      {hint && <FieldDescription>{hint}</FieldDescription>}
    </Field>
  )
}

function TextChunksField({
  field,
  rootValue,
  onChange,
}: {
  field: PropertySchema
  rootValue: JsonValue
  onChange: (path: string[], value: JsonValue) => void
}) {
  const value = valueAt(rootValue, [field.name])
  const chunks = Array.isArray(value)
    ? streamingTextSegments(value)
    : [{ text: value === undefined ? "" : String(value) }]

  function setChunks(next: typeof chunks) {
    onChange([field.name], next.length === 1 ? next[0]!.text : next)
  }

  function updateChunk(index: number, text: string) {
    setChunks(chunks.map((chunk, chunkIndex) => chunkIndex === index ? { ...chunk, text } : chunk))
  }

  function updateDelay(index: number, value: string) {
    const delayMs = value === "" ? undefined : Number(value)
    setChunks(chunks.map((chunk, chunkIndex) => chunkIndex === index
      ? { text: chunk.text, ...(delayMs === undefined ? {} : { delayMs }) }
      : chunk
    ))
  }

  function removeChunk(index: number) {
    const next = chunks.filter((_chunk, chunkIndex) => chunkIndex !== index)
    setChunks(next)
  }

  return (
    <Field>
      <FieldLabel htmlFor={`${field.name}-0`}>Text</FieldLabel>
      <div className="flex flex-col gap-2">
        {chunks.map((chunk, index) => (
          <div key={index} className="flex flex-col gap-1.5">
            {index > 0 && (
              <div className="flex items-center gap-2">
                <span aria-hidden="true" className="h-px flex-1 bg-border" />
                <Input
                  aria-label={`Delay before streaming chunk ${index + 1} in milliseconds`}
                  className="h-7 w-24 shrink-0"
                  type="number"
                  min={0}
                  max={2_147_483_647}
                  step={1}
                  placeholder="Delay (ms)"
                  value={chunk.delayMs ?? ""}
                  onChange={(event) => updateDelay(index, event.target.value)}
                />
                <Button type="button" variant="ghost" size="xs" onClick={() => removeChunk(index)}>
                  Remove
                </Button>
              </div>
            )}
            <Textarea
              id={`${field.name}-${index}`}
              aria-label={index === 0 ? "Text" : `Streaming chunk ${index + 1}`}
              required={!field.optional}
              aria-required={!field.optional}
              value={chunk.text}
              onChange={(event) => updateChunk(index, event.target.value)}
            />
          </div>
        ))}
      </div>
      {(chunks.length > 1 || field.description) && (
        <FieldDescription>
          {chunks.length > 1 ? "Delay is applied before sending each added chunk." : field.description}
        </FieldDescription>
      )}
    </Field>
  )
}

function ProviderRunner({
  provider,
  operation,
}: {
  provider: ProviderSchema
  operation: ProviderOperationSchema
}) {
  const [request, setRequest] = useState<JsonValue>(() => initialValue(operation.request) ?? null)
  const [samples, setSamples] = useState<PlaygroundSample[]>([])
  const [sampleName, setSampleName] = useState("")
  const [persistenceReady, setPersistenceReady] = useState(false)
  const [persistenceError, setPersistenceError] = useState<string>()
  const [savingSample, setSavingSample] = useState(false)
  const [audio, setAudio] = useState<AudioResult>()
  const [events, setEvents] = useState<unknown[]>([])
  const [error, setError] = useState<string>()
  const [running, setRunning] = useState(false)

  useEffect(() => {
    let active = true
    void loadProviderState({
      data: { provider: provider.id, operation: operation.id },
    }).then((state) => {
      if (!active) return
      if (state.lastRequest !== null) setRequest(state.lastRequest)
      setSamples(state.samples)
      setPersistenceReady(true)
    }).catch((cause: unknown) => {
      if (!active) return
      setPersistenceError(cause instanceof Error ? cause.message : String(cause))
    })
    return () => {
      active = false
    }
  }, [operation.id, provider.id])

  useEffect(() => {
    if (!persistenceReady) return
    const timeout = window.setTimeout(() => {
      let value: JsonValue
      try {
        value = materializedRequest(operation, request)
      } catch (cause) {
        setPersistenceError(cause instanceof Error ? cause.message : String(cause))
        return
      }
      void saveLastSettings({
        data: { provider: provider.id, operation: operation.id, request: value },
      }).then(() => setPersistenceError(undefined)).catch((cause: unknown) => {
        setPersistenceError(cause instanceof Error ? cause.message : String(cause))
      })
    }, 300)
    return () => window.clearTimeout(timeout)
  }, [operation.id, persistenceReady, provider.id, request])

  function updateRequest(path: string[], value: JsonValue) {
    setRequest((current) => setPath(current, path, value))
  }

  function addStreamingChunk(field: PropertySchema) {
    setRequest((current) => {
      const value = valueAt(current, [field.name])
      const chunks = Array.isArray(value)
        ? streamingTextSegments(value)
        : [{ text: value === undefined ? "" : String(value) }]
      const next = setPath(current, [field.name], [...chunks, { text: "" }])
      if (!operation.streamingText || !next || typeof next !== "object" || Array.isArray(next)) return next
      return { ...next, ...operation.streamingText.constraints }
    })
  }

  function loadSample(sample: PlaygroundSample) {
    setRequest(structuredClone(sample.request))
    setPersistenceError(undefined)
  }

  async function saveSample() {
    const name = sampleName.trim()
    if (!name) {
      setPersistenceError("Enter a sample name")
      return
    }
    setSavingSample(true)
    setPersistenceError(undefined)
    try {
      const saved = await saveNamedSample({
        data: {
          provider: provider.id,
          operation: operation.id,
          name,
          request: materializedRequest(operation, request),
        },
      })
      setSamples((current) => [saved, ...current.filter(({ id }) => id !== saved.id)])
      setSampleName("")
    } catch (cause) {
      setPersistenceError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSavingSample(false)
    }
  }

  async function run(event: FormEvent) {
    event.preventDefault()
    if (running) return
    setAudio(undefined)
    setEvents([])
    setError(undefined)
    setRunning(true)
    try {
      const value = materializedRequest(operation, request)
      for await (const output of await runProvider({
        data: { provider: provider.id, operation: operation.id, request: value },
      })) {
        if (output.type === "audio") setAudio(output)
        if (output.type === "event") setEvents((current) => [...current, output.value])
        if (output.type === "error") setError(output.stack || output.message)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.stack || cause.message : String(cause))
    } finally {
      setRunning(false)
    }
  }

  const properties = operation.request.kind === "object" ? operation.request.properties : []
  const textField = properties.find(({ name }) => name === "text")
  const voiceField = properties.find(({ name }) => name === "voice")
  const voice = voiceField ? valueAt(request, [voiceField.name]) : undefined
  const streaming = textField ? Array.isArray(valueAt(request, [textField.name])) : false
  const otherFields = properties.filter(({ name }) => name !== "text" && name !== "voice")

  return (
    <form onSubmit={run} className="flex flex-col gap-3">
      <Card size="sm">
        <CardContent className="flex flex-col gap-3">
          {textField && (
            <TextChunksField
              field={textField}
              rootValue={request}
              onChange={updateRequest}
            />
          )}

          <div className="flex items-end gap-3">
            {voiceField && (
              <Field className="w-1/2 max-w-[50%]">
                <FieldLabel htmlFor="voice">Voice</FieldLabel>
                <Input
                  id="voice"
                  required={!voiceField.optional}
                  aria-required={!voiceField.optional}
                  value={typeof voice === "string" ? voice : ""}
                  onChange={(event) => updateRequest([voiceField.name], event.target.value)}
                />
                {voiceField.description && <FieldDescription>{voiceField.description}</FieldDescription>}
              </Field>
            )}
            {textField && operation.streamingText && (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className="ml-auto"
                onClick={() => addStreamingChunk(textField)}
              >
                + Add streaming chunk
              </Button>
            )}
          </div>

          {otherFields.length > 0 && (
            <details className="group border-t pt-3">
              <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-medium select-none">
                Other settings
                <span aria-hidden="true" className="text-muted-foreground transition-transform group-open:rotate-45">+</span>
              </summary>
              <FieldGroup className="mt-3 gap-3">
                {otherFields.map((property) => (
                  <SchemaField
                    key={property.name}
                    field={property}
                    path={[property.name]}
                    rootValue={request}
                    onChange={updateRequest}
                    locked={streaming && Object.hasOwn(operation.streamingText?.constraints ?? {}, property.name)}
                  />
                ))}
              </FieldGroup>
            </details>
          )}

          {!textField && !voiceField && otherFields.length === 0 && (
            operation.request.kind === "object" ? (
              <p className="text-sm text-muted-foreground">This request has no fields.</p>
            ) : (
              <SchemaField
                field={{ name: "request", optional: false, schema: operation.request }}
                path={["request"]}
                rootValue={{ request }}
                onChange={(_path, value) => setRequest(value)}
              />
            )
          )}

          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={running}>
              {running && <SpinnerGapIcon data-icon="inline-start" className="animate-spin" />}
              {running ? "Running" : "Synthesize"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card size="sm">
        <CardContent className="flex flex-col gap-2">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <CardTitle className="sm:mr-auto">History</CardTitle>
            <Input
              aria-label="Sample name"
              className="sm:max-w-64"
              value={sampleName}
              onChange={(event) => setSampleName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return
                event.preventDefault()
                void saveSample()
              }}
              placeholder="Name this request"
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={!persistenceReady || savingSample}
              onClick={() => void saveSample()}
            >
              {savingSample ? "Saving" : "Save"}
            </Button>
          </div>

          {samples.length > 0 ? (
            <div className="flex flex-col gap-2">
              {samples.map((sample) => (
                <Button
                  key={sample.id}
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-auto justify-between gap-4 py-1.5 text-left"
                  onClick={() => loadSample(sample)}
                >
                  <span>{sample.name}</span>
                  <time className="text-xs font-normal text-muted-foreground">
                    {new Date(sample.updatedAt).toLocaleString()}
                  </time>
                </Button>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">No saved requests yet.</p>
          )}

          {persistenceError && (
            <p className="text-xs text-destructive">{persistenceError}</p>
          )}
        </CardContent>
      </Card>

      {(audio || events.length > 0 || error) && (
        <Card size="sm" aria-label="Provider output">
          <CardHeader>
            <CardTitle>Output</CardTitle>
            <CardDescription>Returned values are inspected on the server.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {audio && <audio controls autoPlay src={`data:${audio.contentType};base64,${audio.base64}`} className="w-full" />}
            {events.map((event, index) => (
              <pre key={index} className="overflow-auto bg-muted p-4 text-xs">{JSON.stringify(event, null, 2)}</pre>
            ))}
            {error && <pre className="overflow-auto bg-destructive/10 p-4 text-xs text-destructive">{error}</pre>}
          </CardContent>
        </Card>
      )}
    </form>
  )
}

function Playground() {
  const providers = Route.useLoaderData()
  const [selectedProviderId, setSelectedProviderId] = useState(providers[0]?.id ?? "")
  const provider = providers.find((candidate) => candidate.id === selectedProviderId) ?? providers[0]
  const operation = provider?.operations.find(({ id }) => id === "synthesize")

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-6xl flex-col gap-3 px-4 py-4">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-primary">
          <WaveformIcon weight="bold" />
          <h1 className="text-lg font-semibold tracking-tight">Speech Switch Playground</h1>
        </div>
        <span className="text-xs text-muted-foreground">Schema-driven</span>
      </header>

      <div className="grid items-start gap-3 lg:grid-cols-[10rem_minmax(0,1fr)]">
        <Card size="sm" className="lg:sticky lg:top-4">
          <CardHeader>
            <CardTitle>Providers</CardTitle>
          </CardHeader>
          <CardContent>
            <nav className="flex flex-col gap-1" aria-label="Providers">
              {providers.map((candidate) => (
                <Button
                  key={candidate.id}
                  type="button"
                  size="sm"
                  variant={candidate.id === provider?.id ? "secondary" : "ghost"}
                  className="justify-start"
                  onClick={() => setSelectedProviderId(candidate.id)}
                >
                  {candidate.label}
                </Button>
              ))}
            </nav>
          </CardContent>
        </Card>

        <section className="flex min-w-0 flex-col gap-3">
          {provider && operation ? (
            <ProviderRunner
              key={provider.id}
              provider={provider}
              operation={operation}
            />
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>No synthesis provider found</CardTitle>
                <CardDescription>Add an authored TtsRequest schema under schemas/providers.</CardDescription>
              </CardHeader>
            </Card>
          )}
        </section>
      </div>
    </main>
  )
}
