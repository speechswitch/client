import { providers } from "../generated/provider-registry.ts";

export type Provider = keyof typeof providers;
export type AudioStream = AsyncIterable<Uint8Array>;

type Synthesis = (...arguments_: never[]) => AudioStream;
type ProviderModule<Name extends Provider> = (typeof providers)[Name];
type SynthesisOf<Name extends Provider> =
  ProviderModule<Name> extends { readonly synthesize: infer FunctionType extends Synthesis }
    ? FunctionType
    : never;
type SynthesisProvider = {
  [Name in Provider]: SynthesisOf<Name> extends never ? never : Name;
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
