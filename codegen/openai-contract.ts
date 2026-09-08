/** Selected graph and transport, validated before target-language emission. */
export interface OpenaiContract {
  readonly document: Record<string, unknown>;
  readonly sourceUrl: string;
  readonly baseUrl: string;
  readonly path: string;
  readonly method: string;
  readonly status: number;
  readonly input: unknown;
  readonly event: unknown;
}
