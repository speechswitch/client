type PrebuiltVoice = "Achernar" | "Achird" | "Algenib" | "Algieba" | "Alnilam" | "Aoede" | "Autonoe" | "Callirrhoe"
  | "Charon" | "Despina" | "Enceladus" | "Erinome" | "Fenrir" | "Gacrux" | "Iapetus" | "Kore" | "Laomedeia"
  | "Leda" | "Orus" | "Pulcherrima" | "Puck" | "Rasalgethi" | "Sadachbia" | "Sadaltager" | "Schedar"
  | "Sulafat" | "Umbriel" | "Vindemiatrix" | "Zephyr" | "Zubenelgenubi";

interface Audio {
  /** Omission uses the voice's natural sample rate. @minimum 1 @maximum 2147483647 */
  readonly sampleRateHz?: number;
  readonly bitRateBps?: never;
}
interface Pcm extends Audio {
  readonly format: "pcm";
  readonly sampleEncoding?: "signed_integer_16";
  readonly byteOrder?: "little_endian";
}
interface Wav extends Audio {
  readonly format: "wav";
  /** HTTP G.711 output includes a WAV header. @default "signed_integer_16" */
  readonly sampleEncoding?: "signed_integer_16" | "mulaw" | "alaw";
  readonly byteOrder?: "little_endian";
}
interface Encoded extends Audio {
  readonly format: "ogg_opus";
  readonly sampleEncoding?: never;
  readonly byteOrder?: never;
}
interface RawG711 extends Audio {
  /** Headerless G.711 is available only over the streaming transport. */
  readonly format: "mulaw" | "alaw";
  readonly sampleEncoding?: never;
  readonly byteOrder?: never;
}
interface Mp3 {
  readonly format: "mp3";
  /** @minimum 1 @maximum 2147483647 */
  readonly sampleRateHz?: number;
  readonly bitRateBps?: 32000;
  readonly sampleEncoding?: never;
  readonly byteOrder?: never;
}
interface Common {
  /** @minimum 0.25 @maximum 2 @default 1 */
  readonly speed?: number;
}
interface Http extends Common {
  readonly output: Wav | Pcm | Encoded | Mp3;
  /** HTTP-only gain adjustment. @minimum -96 @maximum 16 */
  readonly volumeDb?: number;
  readonly effectsProfiles?: readonly string[];
}
interface Live extends Common {
  readonly output: Pcm | Encoded | RawG711;
  readonly volumeDb?: never;
  readonly pitchSemitones?: never;
  readonly effectsProfiles?: never;
}
interface HttpText {
  readonly text: string;
  readonly turns?: never;
}
interface LiveText {
  readonly text: string | AsyncIterable<string>;
  readonly turns?: never;
}
interface Gemini {
  /** BCP-47 locale, including numeric regions such as es-419. @pattern ^[\s\S]+$ */
  readonly language: string;
  readonly inputType?: "text";
  readonly instructions?: string;
  /** @default true */
  readonly textNormalization?: boolean;
  readonly safetySettings?: readonly {
    readonly category: "hate_speech" | "dangerous_content" | "harassment" | "sexually_explicit";
    readonly threshold: "low" | "medium" | "high" | "none" | "off";
  }[];
  readonly replacements?: never;
}
interface Single {
  readonly model: "gemini-2.5-flash-lite-preview-tts" | "gemini-2.5-flash-tts" | "gemini-2.5-pro-tts" | "gemini-3.1-flash-tts-preview";
  readonly voice: PrebuiltVoice;
  readonly speakers?: never;
}
interface Dialogue {
  readonly model: "gemini-2.5-flash-tts" | "gemini-2.5-pro-tts" | "gemini-3.1-flash-tts-preview";
  readonly voice?: never;
  /** Exactly two speakers with distinct aliases. */
  readonly speakers: readonly {
    /** @pattern ^[A-Za-z0-9]+$ */
    readonly alias: string;
    readonly voice: PrebuiltVoice;
  }[];
}
interface GeminiHttp extends Gemini, Http {
  /** HTTP-only pitch adjustment. @minimum -20 @maximum 20 */
  readonly pitchSemitones?: number;
}
interface GeminiSingleHttp extends GeminiHttp, Single, HttpText {}
interface GeminiSingleLive extends Gemini, Live, Single, LiveText {}
interface GeminiDialogueHttp extends GeminiHttp, Dialogue, HttpText {}
interface GeminiDialogueLive extends Gemini, Live, Dialogue, LiveText {}
interface Turn {
  /** Must name a configured speaker alias. @pattern ^[A-Za-z0-9]+$ */
  readonly speaker: string;
  readonly text: string;
}
interface GeminiTurnsHttp extends GeminiHttp, Dialogue {
  readonly text?: never;
  readonly turns: readonly Turn[];
}
interface GeminiTurnsLive extends Gemini, Live, Dialogue {
  readonly text?: never;
  readonly turns: readonly Turn[] | AsyncIterable<Turn>;
}

// Model guides document three language capability groups. Keep these in the
// authored schema so both request checks and the playground inherit them.
type ChirpFullLanguage = "ar-XA" | "cmn-CN" | "de-DE" | "en-AU" | "en-GB" | "en-IN" | "en-US" | "es-ES" | "es-US"
  | "fr-CA" | "fr-FR" | "hi-IN" | "id-ID" | "it-IT" | "ja-JP" | "kn-IN" | "ko-KR" | "ml-IN" | "mr-IN"
  | "nl-NL" | "pl-PL" | "pt-BR" | "ru-RU" | "ta-IN" | "te-IN" | "tr-TR";
type ChirpPauseLanguage = "bn-IN" | "da-DK" | "fi-FI" | "gu-IN" | "nb-NO" | "nl-BE" | "sv-SE" | "sw-KE" | "th-TH" | "uk-UA" | "ur-IN" | "vi-VN";
type ChirpTextLanguage = "bg-BG" | "cs-CZ" | "el-GR" | "et-EE" | "he-IL" | "hr-HR" | "hu-HU" | "lt-LT" | "lv-LV" | "pa-IN" | "ro-RO" | "sk-SK" | "sl-SI" | "sr-RS" | "yue-HK";
interface Pronunciation {
  /** @pattern ^[\s\S]+$ */
  readonly pattern: string;
  /** @pattern ^[\s\S]+$ */
  readonly replacement: string;
  readonly alphabet: "ipa" | "x_sampa" | "japanese_yomigana" | "pinyin";
}
interface Chirp {
  readonly model: "chirp-3-hd";
  /** Prebuilt name without the locale/Chirp3-HD prefix. */
  readonly voice: PrebuiltVoice;
  readonly speakers?: never;
  readonly instructions?: never;
  readonly textNormalization?: never;
  readonly safetySettings?: never;
  readonly pitchSemitones?: never;
}
interface ChirpFull {
  readonly language: ChirpFullLanguage;
  readonly replacements?: readonly Pronunciation[];
}
interface ChirpPause {
  readonly language: ChirpPauseLanguage;
  readonly replacements?: never;
}
interface ChirpText {
  readonly language: ChirpTextLanguage;
  readonly replacements?: never;
}
interface MarkupHttp { readonly inputType?: "text" | "markup" | "ssml"; }
interface MarkupLive { readonly inputType?: "text" | "markup"; }
interface PlainHttp { readonly inputType?: "text" | "ssml"; }
interface PlainLive { readonly inputType?: "text"; }
interface ChirpFullHttp extends Chirp, ChirpFull, Http, HttpText, MarkupHttp {}
interface ChirpFullLive extends Chirp, ChirpFull, Live, LiveText, MarkupLive {}
interface ChirpPauseHttp extends Chirp, ChirpPause, Http, HttpText, MarkupHttp {}
interface ChirpPauseLive extends Chirp, ChirpPause, Live, LiveText, MarkupLive {}
interface ChirpTextHttp extends Chirp, ChirpText, Http, HttpText, PlainHttp {}
interface ChirpTextLive extends Chirp, ChirpText, Live, LiveText, PlainLive {}

interface Clone {
  readonly model: "chirp-3-instant-custom-voice";
  /** Existing voice cloning key; creating a voice is a separate operation. @pattern ^[\s\S]+$ */
  readonly voice: string;
  readonly speakers?: never;
  readonly instructions?: never;
  readonly textNormalization?: never;
  readonly safetySettings?: never;
  readonly pitchSemitones?: never;
}
interface CloneFull {
  readonly language: ChirpFullLanguage;
  readonly replacements?: readonly Pronunciation[];
}
interface ClonePause {
  readonly language: "bn-IN" | "gu-IN" | "th-TH" | "vi-VN";
  readonly replacements?: never;
}
interface CloneHttp extends Common, HttpText {
  readonly output: Wav | Pcm | Encoded;
  readonly inputType?: "text" | "markup";
  readonly volumeDb?: never;
  readonly effectsProfiles?: never;
}
interface CloneFullHttp extends Clone, CloneFull, CloneHttp {}
interface CloneFullLive extends Clone, CloneFull, Live, LiveText, MarkupLive {}
interface ClonePauseHttp extends Clone, ClonePause, CloneHttp {}
interface ClonePauseLive extends Clone, ClonePause, Live, LiveText, MarkupLive {}

export type TtsRequest = GeminiSingleHttp | GeminiSingleLive | GeminiDialogueHttp | GeminiDialogueLive | GeminiTurnsHttp | GeminiTurnsLive
  | ChirpFullHttp | ChirpFullLive | ChirpPauseHttp | ChirpPauseLive | ChirpTextHttp | ChirpTextLive
  | CloneFullHttp | CloneFullLive | ClonePauseHttp | ClonePauseLive;
