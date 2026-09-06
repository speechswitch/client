/** An SSE data event, before any provider-specific JSON or audio decoding. */
export interface SseMessage {
  /** Last event field in the block, or "message" when absent or empty. */
  readonly event: string;
  /** Data lines joined with LF; an explicitly empty data field is preserved. */
  readonly data: string;
}
