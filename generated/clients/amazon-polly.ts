// Generated from https://raw.githubusercontent.com/boto/botocore/develop/botocore/data/polly/2016-06-10/service-2.json. Do not edit.

import type { Fetch } from "../../sdk/runtime/fetch.ts";
import { encodeAwsEventStreamMessage, type AwsEventStreamClient, type AwsEventStreamMessage } from "../../sdk/runtime/aws/event-stream.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export type AudioChunk = Uint8Array;

export type AudioEvent = {
  readonly "AudioChunk"?: AudioChunk;
};

export type AudioStream = Uint8Array;

export type AvailabilityErrorMessage = string;

export type CloseStreamEvent = {

};

export type ContentType = string;

export type CoralAvailabilityThrottledResource = string;

export type CoralAvailabilityThrottlingReason = string;

export type Engine = "standard" | "neural" | "long-form" | "generative";

export type ErrorMessage = string;

export type FlushStreamConfiguration = {
  readonly "Force"?: Force;
};

export type Force = boolean;

export type LanguageCode = "arb" | "cmn-CN" | "cy-GB" | "da-DK" | "de-DE" | "en-AU" | "en-GB" | "en-GB-WLS" | "en-IN" | "en-US" | "es-ES" | "es-MX" | "es-US" | "fr-CA" | "fr-FR" | "is-IS" | "it-IT" | "ja-JP" | "hi-IN" | "ko-KR" | "nb-NO" | "nl-NL" | "pl-PL" | "pt-BR" | "pt-PT" | "ro-RO" | "ru-RU" | "sv-SE" | "tr-TR" | "en-NZ" | "en-ZA" | "ca-ES" | "de-AT" | "yue-CN" | "ar-AE" | "fi-FI" | "en-IE" | "nl-BE" | "fr-BE" | "cs-CZ" | "de-CH" | "en-SG";

export type LexiconName = string;

export type LexiconNameList = readonly LexiconName[];

export type OutputFormat = "json" | "mp3" | "ogg_opus" | "ogg_vorbis" | "pcm" | "mulaw" | "alaw";

export type QuotaCode = "input-stream-inbound-event-timeout" | "input-stream-timeout";

export type RequestCharacters = number;

export type SampleRate = string;

export type ServiceCode = "polly";

export type ServiceFailureException = {
  readonly "message"?: ErrorMessage;
};

export type ServiceQuotaExceededException = {
  readonly "message": ErrorMessage;
  readonly "quotaCode": QuotaCode;
  readonly "serviceCode": ServiceCode;
};

export type SpeechMarkType = "sentence" | "ssml" | "viseme" | "word";

export type SpeechMarkTypeList = readonly SpeechMarkType[];

export type StartSpeechSynthesisStreamActionStream =
  | { readonly "TextEvent": TextEvent }
  | { readonly "CloseStreamEvent": CloseStreamEvent };

export type StartSpeechSynthesisStreamEventStream =
  | { readonly "AudioEvent": AudioEvent }
  | { readonly "StreamClosedEvent": StreamClosedEvent }
  | { readonly "ValidationException": ValidationException }
  | { readonly "ServiceQuotaExceededException": ServiceQuotaExceededException }
  | { readonly "ServiceFailureException": ServiceFailureException }
  | { readonly "ThrottlingException": ThrottlingException };

export type StartSpeechSynthesisStreamInput = {
  readonly "Engine": Engine;
  readonly "LanguageCode"?: LanguageCode;
  readonly "LexiconNames"?: LexiconNameList;
  readonly "OutputFormat": OutputFormat;
  readonly "SampleRate"?: SampleRate;
  readonly "VoiceId": VoiceId;
  readonly "ActionStream"?: AsyncIterable<StartSpeechSynthesisStreamActionStream>;
};

export type StartSpeechSynthesisStreamOutput = {
  readonly "EventStream"?: AsyncIterable<StartSpeechSynthesisStreamEventStream>;
};

export type StreamClosedEvent = {
  readonly "RequestCharacters"?: RequestCharacters;
};

export type SynthesizeSpeechInput = {
  readonly "Engine"?: Engine;
  readonly "LanguageCode"?: LanguageCode;
  readonly "LexiconNames"?: LexiconNameList;
  readonly "OutputFormat": OutputFormat;
  readonly "SampleRate"?: SampleRate;
  readonly "SpeechMarkTypes"?: SpeechMarkTypeList;
  readonly "Text": Text;
  readonly "TextType"?: TextType;
  readonly "VoiceId": VoiceId;
};

export type SynthesizeSpeechOutput = {
  readonly "AudioStream"?: AudioStream;
  readonly "ContentType"?: ContentType;
  readonly "RequestCharacters"?: RequestCharacters;
};

export type Text = string;

export type TextEvent = {
  readonly "Text": Text;
  readonly "TextType"?: TextType;
  readonly "FlushStreamConfiguration"?: FlushStreamConfiguration;
};

export type TextType = "ssml" | "text";

export type ThrottlingException = {
  readonly "message"?: AvailabilityErrorMessage;
  readonly "throttlingReasons"?: ThrottlingReasonList;
};

export type ThrottlingReason = {
  readonly "reason"?: CoralAvailabilityThrottlingReason;
  readonly "resource"?: CoralAvailabilityThrottledResource;
};

export type ThrottlingReasonList = readonly ThrottlingReason[];

export type ValidationException = {
  readonly "message": ErrorMessage;
  readonly "reason": ValidationExceptionReason;
  readonly "fields"?: ValidationExceptionFieldList;
};

export type ValidationExceptionField = {
  readonly "name": ValidationExceptionFieldName;
  readonly "message": ValidationExceptionFieldMessage;
};

export type ValidationExceptionFieldList = readonly ValidationExceptionField[];

export type ValidationExceptionFieldMessage = string;

export type ValidationExceptionFieldName = string;

export type ValidationExceptionReason = "unsupportedOperation" | "fieldValidationFailed" | "other" | "invalidInboundEvent";

export type VoiceId = "Aditi" | "Amy" | "Astrid" | "Bianca" | "Brian" | "Camila" | "Carla" | "Carmen" | "Celine" | "Chantal" | "Conchita" | "Cristiano" | "Dora" | "Emma" | "Enrique" | "Ewa" | "Filiz" | "Gabrielle" | "Geraint" | "Giorgio" | "Gwyneth" | "Hans" | "Ines" | "Ivy" | "Jacek" | "Jan" | "Joanna" | "Joey" | "Justin" | "Karl" | "Kendra" | "Kevin" | "Kimberly" | "Lea" | "Liv" | "Lotte" | "Lucia" | "Lupe" | "Mads" | "Maja" | "Marlene" | "Mathieu" | "Matthew" | "Maxim" | "Mia" | "Miguel" | "Mizuki" | "Naja" | "Nicole" | "Olivia" | "Penelope" | "Raveena" | "Ricardo" | "Ruben" | "Russell" | "Salli" | "Seoyeon" | "Takumi" | "Tatyana" | "Vicki" | "Vitoria" | "Zeina" | "Zhiyu" | "Aria" | "Ayanda" | "Arlet" | "Hannah" | "Arthur" | "Daniel" | "Liam" | "Pedro" | "Kajal" | "Hiujin" | "Laura" | "Elin" | "Ida" | "Suvi" | "Ola" | "Hala" | "Andres" | "Sergio" | "Remi" | "Adriano" | "Thiago" | "Ruth" | "Stephen" | "Kazuha" | "Tomoko" | "Niamh" | "Sofie" | "Lisa" | "Isabelle" | "Zayd" | "Danielle" | "Gregory" | "Burcu" | "Jitka" | "Sabrina" | "Jasmine" | "Jihye" | "Ambre" | "Beatrice" | "Florian" | "Lennart" | "Lorenzo" | "Tiffany";

export interface ClientOptions {
  readonly baseUrl: string;
  readonly fetch: Fetch;
  readonly signal: AbortSignal | null;
}

export function synthesizeSpeech(input: SynthesizeSpeechInput, options: ClientOptions): Promise<Response> {
  return options.fetch(new URL("/v1/speech", options.baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
    signal: options.signal,
  });
}

async function* encodeStartSpeechSynthesisStreamActionStream(events: AsyncIterable<StartSpeechSynthesisStreamActionStream>): AsyncIterableIterator<Uint8Array> {
  for await (const event of events) {
    if ("TextEvent" in event) {
      yield encodeAwsEventStreamMessage({
        headers: { ":event-type": "TextEvent", ":message-type": "event", ":content-type": "application/json" },
        body: encoder.encode(JSON.stringify(event["TextEvent"])),
      });
      continue;
    }
    if ("CloseStreamEvent" in event) {
      yield encodeAwsEventStreamMessage({
        headers: { ":event-type": "CloseStreamEvent", ":message-type": "event", ":content-type": "application/json" },
        body: encoder.encode(JSON.stringify(event["CloseStreamEvent"])),
      });
      continue;
    }
    throw new TypeError("Unknown StartSpeechSynthesisStreamActionStream member");
  }
}

async function* decodeStartSpeechSynthesisStreamEventStream(messages: AsyncIterable<AwsEventStreamMessage>): AsyncIterableIterator<StartSpeechSynthesisStreamEventStream> {
  for await (const message of messages) {
    const messageType = message.headers[":message-type"];
    const eventType = messageType === "exception" ? message.headers[":exception-type"] : message.headers[":event-type"];
    if (messageType === "error") {
      const detail = message.headers[":error-message"];
      throw new TypeError(typeof detail === "string" ? detail : "AWS event stream error");
    }
    switch (eventType) {
      case "AudioEvent":
        yield { "AudioEvent": { "AudioChunk": message.body } };
        break;
      case "StreamClosedEvent":
        yield { "StreamClosedEvent": JSON.parse(decoder.decode(message.body)) as StreamClosedEvent };
        break;
      case "ValidationException":
        yield { "ValidationException": JSON.parse(decoder.decode(message.body)) as ValidationException };
        break;
      case "ServiceQuotaExceededException":
        yield { "ServiceQuotaExceededException": JSON.parse(decoder.decode(message.body)) as ServiceQuotaExceededException };
        break;
      case "ServiceFailureException":
        yield { "ServiceFailureException": JSON.parse(decoder.decode(message.body)) as ServiceFailureException };
        break;
      case "ThrottlingException":
        yield { "ThrottlingException": JSON.parse(decoder.decode(message.body)) as ThrottlingException };
        break;
      default:
        throw new TypeError(`Unknown StartSpeechSynthesisStreamEventStream member ${String(eventType)}`);
    }
  }
}

export interface EventStreamClientOptions {
  readonly baseUrl: string;
  readonly eventStream: AwsEventStreamClient;
  readonly signal: AbortSignal | undefined;
}

export async function startSpeechSynthesisStream(input: StartSpeechSynthesisStreamInput, options: EventStreamClientOptions): Promise<StartSpeechSynthesisStreamOutput> {
  if (!input.ActionStream) throw new TypeError("StartSpeechSynthesisStream.ActionStream is required");
  const messages = await options.eventStream.request(
    "POST",
    new URL("/v1/synthesisStream", options.baseUrl),
    {
      "x-amzn-engine": String(input.Engine),
      ...(input.LanguageCode !== undefined ? { "x-amzn-languagecode": String(input.LanguageCode) } : {}),
      ...(input.LexiconNames !== undefined ? { "x-amzn-lexiconnames": input.LexiconNames.join(", ") } : {}),
      "x-amzn-outputformat": String(input.OutputFormat),
      ...(input.SampleRate !== undefined ? { "x-amzn-samplerate": String(input.SampleRate) } : {}),
      "x-amzn-voiceid": String(input.VoiceId),
    },
    encodeStartSpeechSynthesisStreamActionStream(input.ActionStream),
    options.signal,
  );
  return { EventStream: decodeStartSpeechSynthesisStreamEventStream(messages) };
}
