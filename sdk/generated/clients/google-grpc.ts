// Generated from cataloged Google protobuf definitions. Do not edit.
import { ProtoReader, ProtoWriter } from "../../runtime/protobuf.ts";

export const SsmlVoiceGender = {"SSML_VOICE_GENDER_UNSPECIFIED":0,"MALE":1,"FEMALE":2,"NEUTRAL":3} as const;
export type SsmlVoiceGender = keyof typeof SsmlVoiceGender;

export const CustomVoiceParamsReportedUsage = {"REPORTED_USAGE_UNSPECIFIED":0,"REALTIME":1,"OFFLINE":2} as const;
export type CustomVoiceParamsReportedUsage = keyof typeof CustomVoiceParamsReportedUsage;

export const AudioEncoding = {"AUDIO_ENCODING_UNSPECIFIED":0,"LINEAR16":1,"MP3":2,"OGG_OPUS":3,"MULAW":5,"ALAW":6,"PCM":7,"M4A":8} as const;
export type AudioEncoding = keyof typeof AudioEncoding;

export const CustomPronunciationParamsPhoneticEncoding = {"PHONETIC_ENCODING_UNSPECIFIED":0,"PHONETIC_ENCODING_IPA":1,"PHONETIC_ENCODING_X_SAMPA":2,"PHONETIC_ENCODING_JAPANESE_YOMIGANA":3,"PHONETIC_ENCODING_PINYIN":4} as const;
export type CustomPronunciationParamsPhoneticEncoding = keyof typeof CustomPronunciationParamsPhoneticEncoding;

export const AdvancedVoiceOptionsHarmCategory = {"HARM_CATEGORY_UNSPECIFIED":0,"HARM_CATEGORY_HATE_SPEECH":1,"HARM_CATEGORY_DANGEROUS_CONTENT":2,"HARM_CATEGORY_HARASSMENT":3,"HARM_CATEGORY_SEXUALLY_EXPLICIT":4} as const;
export type AdvancedVoiceOptionsHarmCategory = keyof typeof AdvancedVoiceOptionsHarmCategory;

export const AdvancedVoiceOptionsHarmBlockThreshold = {"HARM_BLOCK_THRESHOLD_UNSPECIFIED":0,"BLOCK_LOW_AND_ABOVE":1,"BLOCK_MEDIUM_AND_ABOVE":2,"BLOCK_ONLY_HIGH":3,"BLOCK_NONE":4,"OFF":5} as const;
export type AdvancedVoiceOptionsHarmBlockThreshold = keyof typeof AdvancedVoiceOptionsHarmBlockThreshold;

export type StreamingSynthesizeRequest = {
} & ({ readonly streamingConfig: StreamingSynthesizeConfig; readonly input?: never; } | { readonly streamingConfig?: never; readonly input: StreamingSynthesisInput; } | { readonly streamingConfig?: never; readonly input?: never; });

export function encodeStreamingSynthesizeRequest(value: StreamingSynthesizeRequest): Uint8Array<ArrayBuffer> {
  const writer = new ProtoWriter();
  if (Number(value.streamingConfig !== undefined) + Number(value.input !== undefined) > 1) throw new TypeError("StreamingSynthesizeRequest.streamingRequest permits at most one field");
  if (value.streamingConfig !== undefined) writer.uint32(10).bytes(encodeStreamingSynthesizeConfig(value.streamingConfig));
  if (value.input !== undefined) writer.uint32(18).bytes(encodeStreamingSynthesisInput(value.input));
  return writer.finish();
}

export type StreamingSynthesizeConfig = {
  readonly voice: VoiceSelectionParams;
  readonly streamingAudioConfig?: StreamingAudioConfig;
  readonly customPronunciations?: CustomPronunciations;
  readonly advancedVoiceOptions?: AdvancedVoiceOptions;
};

export function encodeStreamingSynthesizeConfig(value: StreamingSynthesizeConfig): Uint8Array<ArrayBuffer> {
  const writer = new ProtoWriter();
  if (value.voice === undefined) throw new TypeError("Missing StreamingSynthesizeConfig.voice");
  if (value.voice !== undefined) writer.uint32(10).bytes(encodeVoiceSelectionParams(value.voice));
  if (value.streamingAudioConfig !== undefined) writer.uint32(34).bytes(encodeStreamingAudioConfig(value.streamingAudioConfig));
  if (value.customPronunciations !== undefined) writer.uint32(42).bytes(encodeCustomPronunciations(value.customPronunciations));
  if (value.advancedVoiceOptions !== undefined) writer.uint32(58).bytes(encodeAdvancedVoiceOptions(value.advancedVoiceOptions));
  return writer.finish();
}

export type VoiceSelectionParams = {
  readonly languageCode: string;
  readonly name?: string;
  readonly ssmlGender?: SsmlVoiceGender;
  readonly customVoice?: CustomVoiceParams;
  readonly voiceClone?: VoiceCloneParams;
  readonly modelName?: string;
  readonly multiSpeakerVoiceConfig?: MultiSpeakerVoiceConfig;
};

export function encodeVoiceSelectionParams(value: VoiceSelectionParams): Uint8Array<ArrayBuffer> {
  const writer = new ProtoWriter();
  if (value.languageCode === undefined) throw new TypeError("Missing VoiceSelectionParams.languageCode");
  if (value.languageCode !== undefined) writer.uint32(10).string(value.languageCode);
  if (value.name !== undefined) writer.uint32(18).string(value.name);
  if (value.ssmlGender !== undefined) writer.uint32(24).int32(SsmlVoiceGender[value.ssmlGender]);
  if (value.customVoice !== undefined) writer.uint32(34).bytes(encodeCustomVoiceParams(value.customVoice));
  if (value.voiceClone !== undefined) writer.uint32(42).bytes(encodeVoiceCloneParams(value.voiceClone));
  if (value.modelName !== undefined) writer.uint32(50).string(value.modelName);
  if (value.multiSpeakerVoiceConfig !== undefined) writer.uint32(58).bytes(encodeMultiSpeakerVoiceConfig(value.multiSpeakerVoiceConfig));
  return writer.finish();
}

export type CustomVoiceParams = {
  readonly model: string;
  readonly reportedUsage?: CustomVoiceParamsReportedUsage;
};

export function encodeCustomVoiceParams(value: CustomVoiceParams): Uint8Array<ArrayBuffer> {
  const writer = new ProtoWriter();
  if (value.model === undefined) throw new TypeError("Missing CustomVoiceParams.model");
  if (value.model !== undefined) writer.uint32(10).string(value.model);
  if (value.reportedUsage !== undefined) writer.uint32(24).int32(CustomVoiceParamsReportedUsage[value.reportedUsage]);
  return writer.finish();
}

export type VoiceCloneParams = {
  readonly voiceCloningKey: string;
};

export function encodeVoiceCloneParams(value: VoiceCloneParams): Uint8Array<ArrayBuffer> {
  const writer = new ProtoWriter();
  if (value.voiceCloningKey === undefined) throw new TypeError("Missing VoiceCloneParams.voiceCloningKey");
  if (value.voiceCloningKey !== undefined) writer.uint32(10).string(value.voiceCloningKey);
  return writer.finish();
}

export type MultiSpeakerVoiceConfig = {
  readonly speakerVoiceConfigs: readonly (MultispeakerPrebuiltVoice)[];
};

export function encodeMultiSpeakerVoiceConfig(value: MultiSpeakerVoiceConfig): Uint8Array<ArrayBuffer> {
  const writer = new ProtoWriter();
  if (value.speakerVoiceConfigs === undefined) throw new TypeError("Missing MultiSpeakerVoiceConfig.speakerVoiceConfigs");
  if (value.speakerVoiceConfigs !== undefined) { for (const item of value.speakerVoiceConfigs) writer.uint32(18).bytes(encodeMultispeakerPrebuiltVoice(item)); }
  return writer.finish();
}

export type MultispeakerPrebuiltVoice = {
  readonly speakerAlias: string;
  readonly speakerId: string;
};

export function encodeMultispeakerPrebuiltVoice(value: MultispeakerPrebuiltVoice): Uint8Array<ArrayBuffer> {
  const writer = new ProtoWriter();
  if (value.speakerAlias === undefined) throw new TypeError("Missing MultispeakerPrebuiltVoice.speakerAlias");
  if (value.speakerAlias !== undefined) writer.uint32(10).string(value.speakerAlias);
  if (value.speakerId === undefined) throw new TypeError("Missing MultispeakerPrebuiltVoice.speakerId");
  if (value.speakerId !== undefined) writer.uint32(18).string(value.speakerId);
  return writer.finish();
}

export type StreamingAudioConfig = {
  readonly audioEncoding: AudioEncoding;
  readonly sampleRateHertz?: number;
  readonly speakingRate?: number;
};

export function encodeStreamingAudioConfig(value: StreamingAudioConfig): Uint8Array<ArrayBuffer> {
  const writer = new ProtoWriter();
  if (value.audioEncoding === undefined) throw new TypeError("Missing StreamingAudioConfig.audioEncoding");
  if (value.audioEncoding !== undefined) writer.uint32(8).int32(AudioEncoding[value.audioEncoding]);
  if (value.sampleRateHertz !== undefined) writer.uint32(16).int32(value.sampleRateHertz);
  if (value.speakingRate !== undefined) writer.uint32(25).double(value.speakingRate);
  return writer.finish();
}

export type CustomPronunciations = {
  readonly pronunciations?: readonly (CustomPronunciationParams)[];
};

export function encodeCustomPronunciations(value: CustomPronunciations): Uint8Array<ArrayBuffer> {
  const writer = new ProtoWriter();
  if (value.pronunciations !== undefined) { for (const item of value.pronunciations) writer.uint32(10).bytes(encodeCustomPronunciationParams(item)); }
  return writer.finish();
}

export type CustomPronunciationParams = {
  readonly phrase?: string;
  readonly phoneticEncoding?: CustomPronunciationParamsPhoneticEncoding;
  readonly pronunciation?: string;
};

export function encodeCustomPronunciationParams(value: CustomPronunciationParams): Uint8Array<ArrayBuffer> {
  const writer = new ProtoWriter();
  if (value.phrase !== undefined) writer.uint32(10).string(value.phrase);
  if (value.phoneticEncoding !== undefined) writer.uint32(16).int32(CustomPronunciationParamsPhoneticEncoding[value.phoneticEncoding]);
  if (value.pronunciation !== undefined) writer.uint32(26).string(value.pronunciation);
  return writer.finish();
}

export type AdvancedVoiceOptions = {
  readonly lowLatencyJourneySynthesis?: boolean;
  readonly relaxSafetyFilters?: boolean;
  readonly safetySettings?: AdvancedVoiceOptionsSafetySettings;
  readonly enableTextnorm?: boolean;
};

export function encodeAdvancedVoiceOptions(value: AdvancedVoiceOptions): Uint8Array<ArrayBuffer> {
  const writer = new ProtoWriter();
  if (value.lowLatencyJourneySynthesis !== undefined) writer.uint32(8).bool(value.lowLatencyJourneySynthesis);
  if (value.relaxSafetyFilters !== undefined) writer.uint32(64).bool(value.relaxSafetyFilters);
  if (value.safetySettings !== undefined) writer.uint32(74).bytes(encodeAdvancedVoiceOptionsSafetySettings(value.safetySettings));
  if (value.enableTextnorm !== undefined) writer.uint32(16).bool(value.enableTextnorm);
  return writer.finish();
}

export type AdvancedVoiceOptionsSafetySettings = {
  readonly settings?: readonly (AdvancedVoiceOptionsSafetySetting)[];
};

export function encodeAdvancedVoiceOptionsSafetySettings(value: AdvancedVoiceOptionsSafetySettings): Uint8Array<ArrayBuffer> {
  const writer = new ProtoWriter();
  if (value.settings !== undefined) { for (const item of value.settings) writer.uint32(10).bytes(encodeAdvancedVoiceOptionsSafetySetting(item)); }
  return writer.finish();
}

export type AdvancedVoiceOptionsSafetySetting = {
  readonly category?: AdvancedVoiceOptionsHarmCategory;
  readonly threshold?: AdvancedVoiceOptionsHarmBlockThreshold;
};

export function encodeAdvancedVoiceOptionsSafetySetting(value: AdvancedVoiceOptionsSafetySetting): Uint8Array<ArrayBuffer> {
  const writer = new ProtoWriter();
  if (value.category !== undefined) writer.uint32(8).int32(AdvancedVoiceOptionsHarmCategory[value.category]);
  if (value.threshold !== undefined) writer.uint32(16).int32(AdvancedVoiceOptionsHarmBlockThreshold[value.threshold]);
  return writer.finish();
}

export type StreamingSynthesisInput = {
  readonly prompt?: string;
} & ({ readonly text: string; readonly markup?: never; readonly multiSpeakerMarkup?: never; } | { readonly text?: never; readonly markup: string; readonly multiSpeakerMarkup?: never; } | { readonly text?: never; readonly markup?: never; readonly multiSpeakerMarkup: MultiSpeakerMarkup; } | { readonly text?: never; readonly markup?: never; readonly multiSpeakerMarkup?: never; });

export function encodeStreamingSynthesisInput(value: StreamingSynthesisInput): Uint8Array<ArrayBuffer> {
  const writer = new ProtoWriter();
  if (Number(value.text !== undefined) + Number(value.markup !== undefined) + Number(value.multiSpeakerMarkup !== undefined) > 1) throw new TypeError("StreamingSynthesisInput.inputSource permits at most one field");
  if (value.text !== undefined) writer.uint32(10).string(value.text);
  if (value.markup !== undefined) writer.uint32(42).string(value.markup);
  if (value.multiSpeakerMarkup !== undefined) writer.uint32(58).bytes(encodeMultiSpeakerMarkup(value.multiSpeakerMarkup));
  if (value.prompt !== undefined) writer.uint32(50).string(value.prompt);
  return writer.finish();
}

export type MultiSpeakerMarkup = {
  readonly turns: readonly (MultiSpeakerMarkupTurn)[];
};

export function encodeMultiSpeakerMarkup(value: MultiSpeakerMarkup): Uint8Array<ArrayBuffer> {
  const writer = new ProtoWriter();
  if (value.turns === undefined) throw new TypeError("Missing MultiSpeakerMarkup.turns");
  if (value.turns !== undefined) { for (const item of value.turns) writer.uint32(10).bytes(encodeMultiSpeakerMarkupTurn(item)); }
  return writer.finish();
}

export type MultiSpeakerMarkupTurn = {
  readonly speaker: string;
  readonly text: string;
};

export function encodeMultiSpeakerMarkupTurn(value: MultiSpeakerMarkupTurn): Uint8Array<ArrayBuffer> {
  const writer = new ProtoWriter();
  if (value.speaker === undefined) throw new TypeError("Missing MultiSpeakerMarkupTurn.speaker");
  if (value.speaker !== undefined) writer.uint32(10).string(value.speaker);
  if (value.text === undefined) throw new TypeError("Missing MultiSpeakerMarkupTurn.text");
  if (value.text !== undefined) writer.uint32(18).string(value.text);
  return writer.finish();
}

export type StreamingSynthesizeResponse = {
  readonly audioContent?: Uint8Array;
};

export function encodeStreamingSynthesizeResponse(value: StreamingSynthesizeResponse): Uint8Array<ArrayBuffer> {
  const writer = new ProtoWriter();
  if (value.audioContent !== undefined) writer.uint32(10).bytes(value.audioContent);
  return writer.finish();
}

export function decodeStreamingSynthesizeResponse(data: Uint8Array): StreamingSynthesizeResponse {
  const reader = new ProtoReader(data);
  const value: { audioContent?: Uint8Array; } = {};
  while (!reader.done) {
    const tag = reader.uint32();
    if ((tag >>> 3) === 0) throw new TypeError("Invalid protobuf field number");
    switch (tag >>> 3) {
      case 1:
        if ((tag & 7) !== 2) throw new TypeError("Invalid protobuf wire type for StreamingSynthesizeResponse.audioContent");
        value.audioContent = reader.bytes();
        break;
      default: reader.skip(tag & 7);
    }
  }
  return value as StreamingSynthesizeResponse;
}

export const streamingSynthesizePath = "/google.cloud.texttospeech.v1.TextToSpeech/StreamingSynthesize";
export const encodeStreamingRequest = encodeStreamingSynthesizeRequest;
export const decodeStreamingResponse = decodeStreamingSynthesizeResponse;
