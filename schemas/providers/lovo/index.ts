export interface TtsRequest {
  /** @minLength 1 @maxLength 500 */
  readonly text: string;
  readonly voice: string;
  readonly voiceVariant?: string;
  /** @minimum 0.05 @maximum 3 */
  readonly speed?: number;
}
