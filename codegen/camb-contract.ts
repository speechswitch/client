/** Selected and validated contract metadata shared by the wire emitters. */
export interface CambContract {
  http: (value: unknown) => Record<string, unknown>;
  live: (value: unknown) => Record<string, unknown>;
  input: unknown;
  messages: ReadonlyMap<string, unknown>;
  groups: readonly (readonly string[])[];
  baseUrl: string;
  webSocketUrl: string;
  path: string;
  method: string;
  header: string;
  urls: readonly string[];
}
