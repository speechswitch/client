// Generated from https://texttospeech.googleapis.com/$discovery/rest?version=v1. Do not edit.
import type { Fetch } from "../../runtime/fetch.ts";

export type SynthesizeSpeechRequest = {
  readonly "advancedVoiceOptions"?: AdvancedVoiceOptions;
  readonly "audioConfig"?: AudioConfig;
  readonly "input"?: SynthesisInput;
  readonly "voice"?: VoiceSelectionParams;
};

export type SynthesizeSpeechResponse = {
  readonly "audioContent"?: string;
};

export type ListVoicesResponse = {
  readonly "voices"?: readonly (Voice)[];
};

export type AdvancedVoiceOptions = {
  readonly "enableTextnorm"?: boolean;
  readonly "lowLatencyJourneySynthesis"?: boolean;
  readonly "relaxSafetyFilters"?: boolean;
  readonly "safetySettings"?: SafetySettings;
};

export type AudioConfig = {
  readonly "audioEncoding"?: "AUDIO_ENCODING_UNSPECIFIED" | "LINEAR16" | "MP3" | "OGG_OPUS" | "MULAW" | "ALAW" | "PCM" | "M4A";
  readonly "effectsProfileId"?: readonly (string)[];
  readonly "pitch"?: number;
  readonly "sampleRateHertz"?: number;
  readonly "speakingRate"?: number;
  readonly "volumeGainDb"?: number;
};

export type SynthesisInput = {
  readonly "customPronunciations"?: CustomPronunciations;
  readonly "markup"?: string;
  readonly "multiSpeakerMarkup"?: MultiSpeakerMarkup;
  readonly "prompt"?: string;
  readonly "ssml"?: string;
  readonly "text"?: string;
};

export type VoiceSelectionParams = {
  readonly "customVoice"?: CustomVoiceParams;
  readonly "languageCode"?: string;
  readonly "modelName"?: string;
  readonly "multiSpeakerVoiceConfig"?: MultiSpeakerVoiceConfig;
  readonly "name"?: string;
  readonly "ssmlGender"?: "SSML_VOICE_GENDER_UNSPECIFIED" | "MALE" | "FEMALE" | "NEUTRAL";
  readonly "voiceClone"?: VoiceCloneParams;
};

export type Voice = {
  readonly "languageCodes"?: readonly (string)[];
  readonly "name"?: string;
  readonly "naturalSampleRateHertz"?: number;
  readonly "ssmlGender"?: "SSML_VOICE_GENDER_UNSPECIFIED" | "MALE" | "FEMALE" | "NEUTRAL";
};

export type SafetySettings = {
  readonly "settings"?: readonly (SafetySetting)[];
};

export type CustomPronunciations = {
  readonly "pronunciations"?: readonly (CustomPronunciationParams)[];
};

export type MultiSpeakerMarkup = {
  readonly "turns"?: readonly (Turn)[];
};

export type CustomVoiceParams = {
  readonly "model"?: string;
  readonly "reportedUsage"?: "REPORTED_USAGE_UNSPECIFIED" | "REALTIME" | "OFFLINE";
};

export type MultiSpeakerVoiceConfig = {
  readonly "speakerVoiceConfigs"?: readonly (MultispeakerPrebuiltVoice)[];
};

export type VoiceCloneParams = {
  readonly "voiceCloningKey"?: string;
};

export type SafetySetting = {
  readonly "category"?: "HARM_CATEGORY_UNSPECIFIED" | "HARM_CATEGORY_HATE_SPEECH" | "HARM_CATEGORY_DANGEROUS_CONTENT" | "HARM_CATEGORY_HARASSMENT" | "HARM_CATEGORY_SEXUALLY_EXPLICIT";
  readonly "threshold"?: "HARM_BLOCK_THRESHOLD_UNSPECIFIED" | "BLOCK_LOW_AND_ABOVE" | "BLOCK_MEDIUM_AND_ABOVE" | "BLOCK_ONLY_HIGH" | "BLOCK_NONE" | "OFF";
};

export type CustomPronunciationParams = {
  readonly "phoneticEncoding"?: "PHONETIC_ENCODING_UNSPECIFIED" | "PHONETIC_ENCODING_IPA" | "PHONETIC_ENCODING_X_SAMPA" | "PHONETIC_ENCODING_JAPANESE_YOMIGANA" | "PHONETIC_ENCODING_PINYIN";
  readonly "phrase"?: string;
  readonly "pronunciation"?: string;
};

export type Turn = {
  readonly "speaker"?: string;
  readonly "text"?: string;
};

export type MultispeakerPrebuiltVoice = {
  readonly "speakerAlias"?: string;
  readonly "speakerId"?: string;
};

export interface ClientOptions {
  readonly fetch: Fetch;
  readonly baseUrl: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly signal: AbortSignal;
}

export const defaultBaseUrl = "https://texttospeech.googleapis.com/";

export function synthesizeSpeech(input: SynthesizeSpeechRequest, options: ClientOptions): Promise<Response> {
  const url = new URL(options.baseUrl);
  url.pathname = (url.pathname.endsWith("/") ? url.pathname.slice(0, -1) : url.pathname) + "/v1/text:synthesize";
  return options.fetch(url, {
    method: "POST",
    headers: { ...options.headers, "content-type": "application/json" },
    body: JSON.stringify(input),
    signal: options.signal,
  });
}

export function listVoices(input: { readonly "languageCode"?: string; }, options: ClientOptions): Promise<Response> {
  const url = new URL(options.baseUrl);
  url.pathname = (url.pathname.endsWith("/") ? url.pathname.slice(0, -1) : url.pathname) + "/v1/voices";
  if (input["languageCode"] !== undefined) url.searchParams.set("languageCode", String(input["languageCode"]));
  return options.fetch(url, {
    method: "GET",
    headers: options.headers,
    signal: options.signal,
  });
}
