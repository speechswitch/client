type Output =
  | { readonly format: "mp3"; readonly sampleRateHz: 22050; readonly bitRateBps: 32000 }
  | { readonly format: "mp3"; readonly sampleRateHz?: 44100; readonly bitRateBps?: 64000 | 128000 }
  | { readonly format: "pcm"; readonly sampleRateHz: 16000 | 24000; readonly bitRateBps?: never };

interface Common {
  readonly voice: string;
  readonly output?: Output;
}
interface Legacy extends Common {
  readonly model?: "legacy";
  readonly speed?: number;
  readonly language?: never;
}
interface Modern extends Common {
  readonly model: "modern" | "modern-fast";
  readonly language?: string;
  readonly speed?: number;
}
interface Dialogue extends Common {
  readonly model: "dialogue";
  readonly language?: string;
  readonly speed?: never;
}
interface Static {
  readonly text: string;
  readonly textBuffering?: never;
  readonly textBufferThresholds?: never;
}
interface Untimed {
  readonly timestampGranularity?: never;
  readonly timestampText?: never;
}
interface Timed {
  readonly timestampGranularity: "character";
  readonly timestampText?: "original" | "normalized";
}
interface Buffered {
  readonly text: AsyncIterable<string>;
  readonly textBuffering?: true;
  readonly textBufferThresholds?: readonly number[];
}
interface Unbuffered {
  readonly text: AsyncIterable<string>;
  readonly textBuffering: false;
  readonly textBufferThresholds?: never;
}
interface LegacyStatic extends Legacy, Static, Untimed {}
interface ModernStatic extends Modern, Static, Untimed {}
interface ModernTimed extends Modern, Static, Timed {}
interface DialogueStatic extends Dialogue, Static, Untimed {}
interface ModernBuffered extends Modern, Buffered, Untimed {}
interface ModernUnbuffered extends Modern, Unbuffered, Untimed {}
interface DialogueInput extends Dialogue, Untimed {
  readonly text: string | AsyncIterable<string>;
  readonly textBuffering?: never;
  readonly textBufferThresholds?: never;
}
export type TtsRequest = LegacyStatic | ModernStatic | ModernTimed | DialogueStatic
  | ModernBuffered | ModernUnbuffered | DialogueInput;
