import { providers } from "./generated/provider-registry.ts";
export type { ClearEvent, UpdatedEvent, DoneEvent } from "./providers/xai/index.ts";

export type Provider = keyof typeof providers;

type Synthesis = (...arguments_: never[]) => AsyncIterable<Uint8Array>;
type TimestampSynthesis = (...arguments_: never[]) => AsyncIterable<unknown>;
type ProviderModule<Name extends Provider> = (typeof providers)[Name];
type SynthesisOf<Name extends Provider> =
  ProviderModule<Name> extends { readonly synthesize: infer FunctionType extends Synthesis }
    ? FunctionType
    : never;
type SynthesisProvider = {
  [Name in Provider]: SynthesisOf<Name> extends never ? never : Name;
}[Provider];
type TimestampSynthesisOf<Name extends Provider> =
  ProviderModule<Name> extends {
    readonly synthesizeWithTimestamps: infer FunctionType extends TimestampSynthesis;
  }
    ? FunctionType
    : never;
type TimestampSynthesisProvider = {
  [Name in Provider]: TimestampSynthesisOf<Name> extends never ? never : Name;
}[Provider];

/** The selected provider's raw audio stream. */
export type AudioStream<Name extends SynthesisProvider = SynthesisProvider> = ReturnType<
  SynthesisOf<Name>
>;
/** The selected provider's timestamp stream, including only its own event types. */
export type TimestampStream<Name extends TimestampSynthesisProvider = TimestampSynthesisProvider> =
  ReturnType<TimestampSynthesisOf<Name>>;

function implementation<Name extends SynthesisProvider>(provider: Name): SynthesisOf<Name> {
  const synthesize = (providers as Record<string, { readonly synthesize?: Synthesis }>)[provider]
    ?.synthesize;
  if (!synthesize)
    throw new TypeError(`Provider ${String(provider)} does not implement synthesize`);
  return synthesize as SynthesisOf<Name>;
}

export function synthesize<Name extends SynthesisProvider>(
  provider: Name,
  ...arguments_: Parameters<SynthesisOf<NoInfer<Name>>>
): AudioStream<Name> {
  return implementation(provider)(...arguments_) as ReturnType<SynthesisOf<Name>>;
}

function timestampImplementation<Name extends TimestampSynthesisProvider>(
  provider: Name,
): TimestampSynthesisOf<Name> {
  const synthesize = (
    providers as Record<string, { readonly synthesizeWithTimestamps?: TimestampSynthesis }>
  )[provider]?.synthesizeWithTimestamps;
  if (!synthesize) {
    throw new TypeError(`Provider ${String(provider)} does not implement synthesizeWithTimestamps`);
  }
  return synthesize as TimestampSynthesisOf<Name>;
}

export function synthesizeWithTimestamps<Name extends TimestampSynthesisProvider>(
  provider: Name,
  ...arguments_: Parameters<TimestampSynthesisOf<NoInfer<Name>>>
): TimestampStream<Name> {
  return timestampImplementation(provider)(...arguments_) as ReturnType<TimestampSynthesisOf<Name>>;
}
