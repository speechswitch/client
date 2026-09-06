export interface SchemaConstraints {
  readonly minimum?: number;
  readonly exclusiveMinimum?: number;
  readonly integer?: true;
  readonly maximum?: number;
  readonly pattern?: string;
  readonly maxLength?: number;
  readonly minItems?: number;
  readonly maxItems?: number;
  readonly itemMinimum?: number;
  readonly itemMaximum?: number;
  readonly itemInteger?: true;
}

/** Lower numeric array-element annotations into the same scalar constraints. */
export function arrayItemConstraints(constraints: SchemaConstraints | undefined): SchemaConstraints | undefined {
  if (constraints?.itemMinimum === undefined && constraints?.itemMaximum === undefined && !constraints?.itemInteger) return undefined;
  return {
    ...(constraints.itemMinimum === undefined ? {} : { minimum: constraints.itemMinimum }),
    ...(constraints.itemMaximum === undefined ? {} : { maximum: constraints.itemMaximum }),
    ...(constraints.itemInteger ? { integer: true } : {}),
  };
}

export type SchemaLiteral = string | number | boolean | null;

export type SchemaType =
  | { readonly kind: "string" }
  | { readonly kind: "number" }
  | { readonly kind: "boolean" }
  | { readonly kind: "bigint" }
  | { readonly kind: "literal"; readonly value: SchemaLiteral }
  | { readonly kind: "array"; readonly items: SchemaType }
  | { readonly kind: "async-iterable"; readonly items: SchemaType }
  | { readonly kind: "bytes" }
  | { readonly kind: "json-value" }
  | { readonly kind: "record"; readonly values: SchemaType }
  | { readonly kind: "object"; readonly fields: readonly SchemaField[]; readonly forbidden?: readonly string[] }
  | { readonly kind: "union"; readonly anyOf: readonly SchemaType[] };

export interface SchemaField {
  readonly name: string;
  readonly optional: boolean;
  readonly documentation: string;
  readonly typeScriptType: string;
  readonly type: SchemaType;
  readonly constraints?: SchemaConstraints;
  readonly deprecated?: string;
  readonly examples?: readonly string[];
  readonly default?: SchemaLiteral;
}

export interface TtsProviderSpec {
  readonly id: string;
  readonly documentation?: string;
  readonly request: SchemaType;
}

export interface SpeechSpec {
  readonly tts: {
    readonly request: {
      readonly name: "TtsRequest";
      readonly documentation: string;
      readonly fields: readonly SchemaField[];
    };
    readonly providers: readonly TtsProviderSpec[];
  };
}
