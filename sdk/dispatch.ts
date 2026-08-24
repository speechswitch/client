import { providers } from "../generated/provider-registry.ts";

export type Provider = keyof typeof providers;
export type Operation =
  | "synthesize"
  | "synthesizeWithTimestamps"
  | "synthesizeStreaming"
  | "synthesizeStreamingWithTimestamps";

type AnyOperation = (...arguments_: never[]) => unknown;
type ProviderModule<Name extends Provider> = (typeof providers)[Name];
type OperationOf<Name extends Provider, NameOfOperation extends Operation> =
  ProviderModule<Name> extends Record<NameOfOperation, infer FunctionType extends AnyOperation>
    ? FunctionType
    : never;
type ProvidersWith<NameOfOperation extends Operation> = {
  [Name in Provider]: OperationOf<Name, NameOfOperation> extends never ? never : Name;
}[Provider];

function operation<Name extends Provider, NameOfOperation extends Operation>(
  provider: Name,
  name: NameOfOperation,
): OperationOf<Name, NameOfOperation> {
  const module = (providers as Record<string, Partial<Record<Operation, AnyOperation>>>)[provider];
  const implementation = module?.[name];
  if (!implementation) throw new TypeError(`Provider ${String(provider)} does not implement ${name}`);
  return implementation as OperationOf<Name, NameOfOperation>;
}

export function synthesize<Name extends ProvidersWith<"synthesize">>(
  provider: Name,
  ...arguments_: Parameters<OperationOf<Name, "synthesize">>
): ReturnType<OperationOf<Name, "synthesize">> {
  return operation(provider, "synthesize")(...arguments_) as ReturnType<OperationOf<Name, "synthesize">>;
}

export function synthesizeWithTimestamps<Name extends ProvidersWith<"synthesizeWithTimestamps">>(
  provider: Name,
  ...arguments_: Parameters<OperationOf<Name, "synthesizeWithTimestamps">>
): ReturnType<OperationOf<Name, "synthesizeWithTimestamps">> {
  return operation(provider, "synthesizeWithTimestamps")(...arguments_) as ReturnType<OperationOf<Name, "synthesizeWithTimestamps">>;
}

export function synthesizeStreaming<Name extends ProvidersWith<"synthesizeStreaming">>(
  provider: Name,
  ...arguments_: Parameters<OperationOf<Name, "synthesizeStreaming">>
): ReturnType<OperationOf<Name, "synthesizeStreaming">> {
  return operation(provider, "synthesizeStreaming")(...arguments_) as ReturnType<OperationOf<Name, "synthesizeStreaming">>;
}

export function synthesizeStreamingWithTimestamps<Name extends ProvidersWith<"synthesizeStreamingWithTimestamps">>(
  provider: Name,
  ...arguments_: Parameters<OperationOf<Name, "synthesizeStreamingWithTimestamps">>
): ReturnType<OperationOf<Name, "synthesizeStreamingWithTimestamps">> {
  return operation(provider, "synthesizeStreamingWithTimestamps")(...arguments_) as ReturnType<OperationOf<Name, "synthesizeStreamingWithTimestamps">>;
}
