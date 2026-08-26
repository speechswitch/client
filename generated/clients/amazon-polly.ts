// Generated from https://raw.githubusercontent.com/boto/botocore/develop/botocore/data/polly/2016-06-10/service-2.json. Do not edit.

import type { Fetch } from "../../sdk/fetch.ts";

export type Engine = "standard" | "neural" | "long-form" | "generative";

export type LanguageCode = "arb" | "cmn-CN" | "cy-GB" | "da-DK" | "de-DE" | "en-AU" | "en-GB" | "en-GB-WLS" | "en-IN" | "en-US" | "es-ES" | "es-MX" | "es-US" | "fr-CA" | "fr-FR" | "is-IS" | "it-IT" | "ja-JP" | "hi-IN" | "ko-KR" | "nb-NO" | "nl-NL" | "pl-PL" | "pt-BR" | "pt-PT" | "ro-RO" | "ru-RU" | "sv-SE" | "tr-TR" | "en-NZ" | "en-ZA" | "ca-ES" | "de-AT" | "yue-CN" | "ar-AE" | "fi-FI" | "en-IE" | "nl-BE" | "fr-BE" | "cs-CZ" | "de-CH" | "en-SG";

export type LexiconName = string;

export type LexiconNameList = readonly LexiconName[];

export type OutputFormat = "json" | "mp3" | "ogg_opus" | "ogg_vorbis" | "pcm" | "mulaw" | "alaw";

export type SampleRate = string;

export type SpeechMarkType = "sentence" | "ssml" | "viseme" | "word";

export type SpeechMarkTypeList = readonly SpeechMarkType[];

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

export type Text = string;

export type TextType = "ssml" | "text";

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
