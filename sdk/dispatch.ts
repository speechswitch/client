import { providers } from "./generated/provider-registry.ts";
import type { SynthesisEnvelope, Timestamp } from "./timestamps.ts";

export type Provider = keyof typeof providers;
export interface ClearEvent { readonly event: "clear" }
export interface FlushEvent {
  readonly event: "flush";
  readonly correlationId: string;
  readonly inputGroupId: string;
}
export type AudioStream = AsyncIterable<Uint8Array | SynthesisEnvelope<Timestamp> | ClearEvent | FlushEvent>;
export type TimestampStream = AsyncIterable<SynthesisEnvelope<Timestamp> | ClearEvent | FlushEvent>;

type Synthesis = (...arguments_: never[]) => AudioStream;
type TimestampSynthesis = (...arguments_: never[]) => TimestampStream;
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

function implementation<Name extends SynthesisProvider>(provider: Name): SynthesisOf<Name> {
  const synthesize = (providers as Record<string, { readonly synthesize?: Synthesis }>)[provider]?.synthesize;
  if (!synthesize) throw new TypeError(`Provider ${String(provider)} does not implement synthesize`);
  return synthesize as SynthesisOf<Name>;
}

export function synthesize<Name extends SynthesisProvider>(
  provider: Name,
  ...arguments_: Parameters<SynthesisOf<Name>>
): ReturnType<SynthesisOf<Name>> {
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
  ...arguments_: Parameters<TimestampSynthesisOf<Name>>
): ReturnType<TimestampSynthesisOf<Name>> {
  return timestampImplementation(provider)(...arguments_) as ReturnType<TimestampSynthesisOf<Name>>;
}
