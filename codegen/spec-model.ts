export interface SchemaConstraints {
  readonly minimum?: number;
  readonly maximum?: number;
  readonly pattern?: string;
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
  | { readonly kind: "object"; readonly fields: readonly SchemaField[] }
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
