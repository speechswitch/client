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

function initialValue(schema: TypeSchema, optional = false): JsonValue | undefined {
  if (optional) return undefined
  switch (schema.kind) {
    case "string": return ""
    case "number": return 0
    case "boolean": return false
    case "enum": return schema.values[0]
    case "array": return []
    case "object": return Object.fromEntries(schema.properties.flatMap((property) => {
      const value = initialValue(property.schema, property.optional)
      return value === undefined ? [] : [[property.name, value]]
    }))
    case "json": return ""
  }
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

function materialize(schema: TypeSchema, value: JsonValue | undefined, optional: boolean): JsonValue | undefined {
  if ((value === undefined || value === "") && optional) return undefined
  switch (schema.kind) {
    case "string": return value == null ? "" : String(value)
    case "number": {
      const parsed = typeof value === "number" ? value : Number(value)
      if (!Number.isFinite(parsed)) throw new TypeError(`Expected ${schema.label}`)
      return parsed
    }
    case "boolean": return Boolean(value)
    case "enum": return value
    case "array": {
      const item = (candidate: JsonValue): JsonValue => {
        const result = materialize(schema.item, candidate, false)
        if (result === undefined) throw new TypeError(`Expected ${schema.item.label}`)
        return result
      }
      if (Array.isArray(value)) return value.map(item)
      const text = String(value ?? "").trim()
      if (!text) return []
      if (text.startsWith("[")) {
        const parsed = JSON.parse(text) as JsonValue
        if (!Array.isArray(parsed)) throw new TypeError(`Expected an array for ${schema.label}`)
        return parsed.map(item)
      }
      return text.split(/[,\n]/).map((value) => item(value.trim()))
    }
    case "object": {
      const source = value && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, JsonValue>
        : {}
      return Object.fromEntries(schema.properties.flatMap((property) => {
        const result = materialize(property.schema, source[property.name], property.optional)
        return result === undefined ? [] : [[property.name, result]]
      }))
    }
    case "json": {
      if (typeof value !== "string") return value
      return value.trim() ? JSON.parse(value) as JsonValue : undefined
    }
  }
}

function materializedRequest(operation: ProviderOperationSchema, request: JsonValue): JsonValue {
  const source = request && typeof request === "object" && !Array.isArray(request)
    ? request as Record<string, JsonValue>
    : undefined
  const streamingChunks = operation.id === "synthesize" && Array.isArray(source?.text)
    ? source.text.map((chunk) => String(chunk))
    : undefined
  const value = materialize(
    operation.request,
    streamingChunks ? { ...source, text: streamingChunks[0] ?? "" } : request,
    false,
  )
  if (value === undefined) throw new TypeError("The provider request is required")
  if (!streamingChunks || !value || typeof value !== "object" || Array.isArray(value)) return value
  return { ...value, text: streamingChunks, ...operation.streamingText?.constraints }
}

interface SchemaFieldProps {
  field: PropertySchema
  path: string[]
  rootValue: JsonValue
  onChange: (path: string[], value: JsonValue) => void
}

function SchemaField({ field, path, rootValue, onChange }: SchemaFieldProps) {
  const value = valueAt(rootValue, path)
  const id = path.join("-").replace(/[^a-zA-Z0-9_-]/g, "-")
  const hint = field.description
  const schema = field.schema

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
          checked={Boolean(value)}
          onCheckedChange={(checked) => onChange(path, checked)}
        />
        <FieldContent>
          <FieldLabel htmlFor={id}>
            {title(field.name)}
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
        {field.optional && <Badge variant="outline">optional</Badge>}
      </FieldLabel>
      {schema.kind === "enum" ? (
        <Select
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
          value={typeof value === "string" ? value : value === undefined ? "" : JSON.stringify(value, null, 2)}
          onChange={(event) => onChange(path, event.target.value)}
          placeholder={schema.kind === "array" ? "Comma-separated values or JSON" : undefined}
        />
      ) : (
        <Input
          id={id}
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
  allowStreaming,
}: {
  field: PropertySchema
  rootValue: JsonValue
  onChange: (path: string[], value: JsonValue) => void
  allowStreaming: boolean
}) {
  const value = valueAt(rootValue, [field.name])
  const chunks = Array.isArray(value)
    ? value.map((chunk) => String(chunk))
    : [value === undefined ? "" : String(value)]

  function updateChunk(index: number, text: string) {
    const next = chunks.map((chunk, chunkIndex) => chunkIndex === index ? text : chunk)
    onChange([field.name], next.length === 1 ? next[0]! : next)
  }

  function removeChunk(index: number) {
    const next = chunks.filter((_chunk, chunkIndex) => chunkIndex !== index)
    onChange([field.name], next.length === 1 ? next[0]! : next)
  }

  return (
    <Field>
      <FieldLabel htmlFor={`${field.name}-0`}>Text</FieldLabel>
      <div className="flex flex-col gap-2">
        {chunks.map((chunk, index) => (
          <div key={index} className="flex flex-col gap-1.5">
            {index > 0 && (
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Streaming chunk {index + 1}</span>
                <Button type="button" variant="ghost" size="xs" onClick={() => removeChunk(index)}>
                  Remove
                </Button>
              </div>
            )}
            <Textarea
              id={`${field.name}-${index}`}
              aria-label={index === 0 ? "Text" : `Streaming chunk ${index + 1}`}
              value={chunk}
              onChange={(event) => updateChunk(index, event.target.value)}
            />
          </div>
        ))}
      </div>
      {allowStreaming && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-fit"
          onClick={() => onChange([field.name], [...chunks, ""])}
        >
          + Add streaming chunk
        </Button>
      )}
      {(chunks.length > 1 || field.description) && (
        <FieldDescription>
          {chunks.length > 1 ? "Chunks are streamed in order." : field.description}
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
              allowStreaming={Boolean(operation.streamingText)}
            />
          )}

          {voiceField && (
            <Field>
              <FieldLabel htmlFor="voice">Voice</FieldLabel>
              <Input
                id="voice"
                value={typeof voice === "string" ? voice : ""}
                onChange={(event) => updateRequest([voiceField.name], event.target.value)}
              />
              {voiceField.description && <FieldDescription>{voiceField.description}</FieldDescription>}
            </Field>
          )}

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
