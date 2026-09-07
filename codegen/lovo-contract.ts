/** Selected, validated OpenAPI metadata. It exists only during code generation. */
export interface LovoContract {
  schemas: Readonly<Record<string, unknown>>;
  baseUrl: string;
  sourceUrl: string;
  operations: readonly {
    id: string;
    name: string;
    path: string;
    method: string;
    header: string;
    input: unknown;
    output: unknown;
    status: number;
    body: boolean;
    parameters: readonly string[];
  }[];
}
