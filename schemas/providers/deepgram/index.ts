export type TtsInput = string | { readonly command: "clear" } | { readonly command: "flush" };

type StreamingOutput =
  | { readonly format: "pcm"; readonly sampleRateHz?: 8000 | 16000 | 24000 | 32000 | 48000; readonly sampleEncoding?: "signed_integer_16"; readonly bitRateBps?: never }
  | { readonly format: "mulaw" | "alaw"; readonly sampleRateHz?: 8000 | 16000; readonly sampleEncoding?: never; readonly bitRateBps?: never };

type RestOutput = StreamingOutput
  | { readonly format: "wav"; readonly sampleRateHz?: 8000 | 16000 | 24000 | 32000 | 48000; readonly sampleEncoding?: "signed_integer_16"; readonly bitRateBps?: never }
  | { readonly format: "wav"; readonly sampleRateHz?: 8000 | 16000; readonly sampleEncoding: "mulaw" | "alaw"; readonly bitRateBps?: never }
  | { readonly format: "mp3"; readonly sampleRateHz?: 22050; readonly bitRateBps?: 32000 | 48000; readonly sampleEncoding?: never }
  | {
      readonly format: "ogg_opus";
      readonly sampleRateHz?: 48000;
      /** @minimum 4000 @maximum 650000 */
      readonly bitRateBps?: number;
      readonly sampleEncoding?: never;
    }
  | { readonly format: "flac"; readonly sampleRateHz?: 8000 | 16000 | 22050 | 32000 | 48000; readonly bitRateBps?: never; readonly sampleEncoding?: never }
  | {
      readonly format: "aac";
      readonly sampleRateHz?: 22050;
      /** @minimum 4000 @maximum 192000 */
      readonly bitRateBps?: number;
      readonly sampleEncoding?: never;
    };

interface Common {
  readonly modelImprovementOptOut?: boolean;
  /** @minimum 0.7 @maximum 1.5 */
  readonly speed?: number;
}
interface SingleInput {
  readonly tags?: readonly string[];
  readonly text: string;
  readonly output: RestOutput;
}
interface StreamingInput {
  readonly tags?: never;
  readonly text: AsyncIterable<TtsInput>;
  readonly output: StreamingOutput;
}

interface Aura1EN extends Common {
  readonly model: "aura-1";
  readonly language: "en";
  readonly voice: "angus" | "arcas" | "asteria" | "athena" | "helios" | "hera" | "luna" | "orion" | "orpheus" | "perseus" | "stella" | "zeus";
}
interface Aura1ENSingle extends Aura1EN, SingleInput {}
interface Aura1ENStreaming extends Aura1EN, StreamingInput {}

interface Aura2EN extends Common {
  readonly model: "aura-2";
  readonly language: "en";
  readonly voice: "amalthea" | "andromeda" | "apollo" | "arcas" | "aries" | "asteria" | "athena" | "atlas" | "aurora" | "callista" | "cora" | "cordelia" | "delia" | "draco" | "electra" | "harmonia" | "helena" | "hera" | "hermes" | "hyperion" | "iris" | "janus" | "juno" | "jupiter" | "luna" | "mars" | "minerva" | "neptune" | "odysseus" | "ophelia" | "orion" | "orpheus" | "pandora" | "phoebe" | "pluto" | "saturn" | "selene" | "thalia" | "theia" | "vesta" | "zeus";
}
interface Aura2ENSingle extends Aura2EN, SingleInput {}
interface Aura2ENStreaming extends Aura2EN, StreamingInput {}

interface Aura2ES extends Common {
  readonly model: "aura-2";
  readonly language: "es";
  readonly voice: "agustina" | "alvaro" | "antonia" | "aquila" | "carina" | "celeste" | "diana" | "estrella" | "gloria" | "javier" | "luciano" | "nestor" | "olivia" | "selena" | "silvia" | "sirio" | "valerio";
}
interface Aura2ESSingle extends Aura2ES, SingleInput {}
interface Aura2ESStreaming extends Aura2ES, StreamingInput {}

interface Aura2DE extends Common {
  readonly model: "aura-2";
  readonly language: "de";
  readonly voice: "aurelia" | "elara" | "fabian" | "julius" | "kara" | "lara" | "viktoria";
}
interface Aura2DESingle extends Aura2DE, SingleInput {}
interface Aura2DEStreaming extends Aura2DE, StreamingInput {}

interface Aura2NL extends Common {
  readonly model: "aura-2";
  readonly language: "nl";
  readonly voice: "beatrix" | "cornelia" | "daphne" | "hestia" | "lars" | "leda" | "rhea" | "roman" | "sander";
}
interface Aura2NLSingle extends Aura2NL, SingleInput {}
interface Aura2NLStreaming extends Aura2NL, StreamingInput {}

interface Aura2FR extends Common {
  readonly model: "aura-2";
  readonly language: "fr";
  readonly voice: "agathe" | "hector";
}
interface Aura2FRSingle extends Aura2FR, SingleInput {}
interface Aura2FRStreaming extends Aura2FR, StreamingInput {}

interface Aura2IT extends Common {
  readonly model: "aura-2";
  readonly language: "it";
  readonly voice: "cesare" | "cinzia" | "demetra" | "dionisio" | "elio" | "flavio" | "livia" | "maia" | "melia";
}
interface Aura2ITSingle extends Aura2IT, SingleInput {}
interface Aura2ITStreaming extends Aura2IT, StreamingInput {}

interface Aura2JA extends Common {
  readonly model: "aura-2";
  readonly language: "ja";
  readonly voice: "ama" | "ebisu" | "fujin" | "izanami" | "uzume";
}
interface Aura2JASingle extends Aura2JA, SingleInput {}
interface Aura2JAStreaming extends Aura2JA, StreamingInput {}

export type TtsRequest =
  | Aura1ENSingle | Aura1ENStreaming
  | Aura2ENSingle | Aura2ENStreaming
  | Aura2ESSingle | Aura2ESStreaming
  | Aura2DESingle | Aura2DEStreaming
  | Aura2NLSingle | Aura2NLStreaming
  | Aura2FRSingle | Aura2FRStreaming
  | Aura2ITSingle | Aura2ITStreaming
  | Aura2JASingle | Aura2JAStreaming;
