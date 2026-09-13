export type TtsInput = string | { readonly command: "clear" } | { readonly command: "flush" };

type StreamingOutput =
  | {
      readonly container: "raw";
      readonly codec: "pcm";
      readonly sampleRateHz?: 8000 | 16000 | 24000 | 32000 | 48000;
      readonly sampleFormat?: "int16";
      readonly bitRateBps?: never;
    }
  | {
      readonly container: "raw";
      readonly codec: "mulaw" | "alaw";
      readonly sampleRateHz?: 8000 | 16000;
      readonly sampleFormat?: never;
      readonly bitRateBps?: never;
    };

type RestOutput =
  | StreamingOutput
  | {
      readonly container: "wav";
      readonly codec: "pcm";
      readonly sampleRateHz?: 8000 | 16000 | 24000 | 32000 | 48000;
      readonly sampleFormat?: "int16";
      readonly bitRateBps?: never;
    }
  | {
      readonly container: "wav";
      readonly codec: "mulaw" | "alaw";
      readonly sampleRateHz?: 8000 | 16000;
      readonly sampleFormat?: never;
      readonly bitRateBps?: never;
    }
  | {
      readonly container?: never;
      readonly codec: "mp3";
      readonly sampleRateHz?: 22050;
      readonly bitRateBps?: 32000 | 48000;
      readonly sampleFormat?: never;
    }
  | {
      readonly container: "ogg";
      readonly codec: "opus";
      readonly sampleRateHz?: 48000;
      /** @minimum 4000 @maximum 650000 */
      readonly bitRateBps?: number;
      readonly sampleFormat?: never;
    }
  | {
      readonly container?: never;
      readonly codec: "flac";
      readonly sampleRateHz?: 8000 | 16000 | 22050 | 32000 | 48000;
      readonly bitRateBps?: never;
      readonly sampleFormat?: never;
    }
  | {
      readonly container?: never;
      readonly codec: "aac";
      readonly sampleRateHz?: 22050;
      /** @minimum 4000 @maximum 192000 */
      readonly bitRateBps?: number;
      readonly sampleFormat?: never;
    };

interface Common {
  /** @minimum 0.7 @maximum 1.5
   * @serializeAs rest speed
   * @serializeAs streaming speed */
  readonly speed?: number;
  /** @serializeAs rest dataGovernance
   * @serializeAs streaming dataGovernance */
  readonly dataGovernance?: {
    /** @serializeAs rest mip_opt_out
     * @serializeAs streaming mip_opt_out */
    readonly modelImprovementOptOut?: boolean;
  };
}
interface SingleInput {
  /** @serializeAs rest telemetry
   * @serializeAs streaming telemetry */
  readonly telemetry?: {
    /** @serializeAs rest tag
     * @serializeAs streaming tag */
    readonly tags?: readonly string[];
  };
  readonly text: string;
  readonly output: RestOutput;
}
interface StreamingInput {
  readonly telemetry?: never;
  readonly text: AsyncIterable<TtsInput>;
  readonly output: StreamingOutput;
}

interface Aura1EN extends Common {
  readonly model: "aura-1";
  readonly language: "en";
  readonly voice:
    | "angus"
    | "arcas"
    | "asteria"
    | "athena"
    | "helios"
    | "hera"
    | "luna"
    | "orion"
    | "orpheus"
    | "perseus"
    | "stella"
    | "zeus";
}
interface Aura1ENSingle extends Aura1EN, SingleInput {}
interface Aura1ENStreaming extends Aura1EN, StreamingInput {}

interface Aura2EN extends Common {
  readonly model: "aura-2";
  readonly language: "en";
  readonly voice:
    | "amalthea"
    | "andromeda"
    | "apollo"
    | "arcas"
    | "aries"
    | "asteria"
    | "athena"
    | "atlas"
    | "aurora"
    | "callista"
    | "cora"
    | "cordelia"
    | "delia"
    | "draco"
    | "electra"
    | "harmonia"
    | "helena"
    | "hera"
    | "hermes"
    | "hyperion"
    | "iris"
    | "janus"
    | "juno"
    | "jupiter"
    | "luna"
    | "mars"
    | "minerva"
    | "neptune"
    | "odysseus"
    | "ophelia"
    | "orion"
    | "orpheus"
    | "pandora"
    | "phoebe"
    | "pluto"
    | "saturn"
    | "selene"
    | "thalia"
    | "theia"
    | "vesta"
    | "zeus";
}
interface Aura2ENSingle extends Aura2EN, SingleInput {}
interface Aura2ENStreaming extends Aura2EN, StreamingInput {}

interface Aura2ES extends Common {
  readonly model: "aura-2";
  readonly language: "es";
  readonly voice:
    | "agustina"
    | "alvaro"
    | "antonia"
    | "aquila"
    | "carina"
    | "celeste"
    | "diana"
    | "estrella"
    | "gloria"
    | "javier"
    | "luciano"
    | "nestor"
    | "olivia"
    | "selena"
    | "silvia"
    | "sirio"
    | "valerio";
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
  readonly voice:
    | "beatrix"
    | "cornelia"
    | "daphne"
    | "hestia"
    | "lars"
    | "leda"
    | "rhea"
    | "roman"
    | "sander";
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
  readonly voice:
    | "cesare"
    | "cinzia"
    | "demetra"
    | "dionisio"
    | "elio"
    | "flavio"
    | "livia"
    | "maia"
    | "melia";
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

type FluxStreamingOutput =
  | StreamingOutput
  | {
      readonly container: "raw";
      readonly codec: "pcm";
      readonly sampleRateHz?: 8000 | 16000 | 24000 | 32000 | 44100 | 48000;
      readonly sampleFormat?: "int16";
      readonly bitRateBps?: never;
    };
type FluxRestOutput =
  | RestOutput
  | FluxStreamingOutput
  | {
      readonly container: "wav";
      readonly codec: "pcm";
      readonly sampleRateHz?: 8000 | 16000 | 24000 | 32000 | 44100 | 48000;
      readonly sampleFormat?: "int16";
      readonly bitRateBps?: never;
    }
  | {
      readonly codec: "mp3";
      readonly container?: never;
      readonly sampleFormat?: never;
      readonly sampleRateHz?: 22050;
      readonly bitRateBps?: 8000 | 16000 | 24000 | 32000 | 40000 | 48000;
    };
interface Flux {
  /** @serializeAs rest expressivity
   * @serializeAs streaming expressivity */
  readonly expressivity?: -2 | -1 | 0 | 1 | 2;
  readonly model: "flux";
  readonly language: "en";
  readonly voice:
    | "alexis"
    | "bree"
    | "brittany"
    | "brooke"
    | "bruce"
    | "cliff"
    | "cole"
    | "colin"
    | "conor"
    | "donovan"
    | "drew"
    | "elise"
    | "gemma"
    | "haley"
    | "hannah"
    | "heather"
    | "jack"
    | "kai"
    | "kelsey"
    | "kit"
    | "maeve"
    | "marcelo"
    | "marcus"
    | "meena"
    | "meghan"
    | "miles"
    | "naveen"
    | "paige"
    | "priya"
    | "rufus"
    | "sean"
    | "sharon"
    | "sienna"
    | "tanner"
    | "wade"
    | "wes";
  /** @serializeAs rest speed
   * @serializeAs streaming speed */
  readonly speed?:
    | 0.5
    | 0.55
    | 0.6
    | 0.65
    | 0.7
    | 0.75
    | 0.8
    | 0.85
    | 0.9
    | 0.95
    | 1.0
    | 1.05
    | 1.1
    | 1.15
    | 1.2
    | 1.25
    | 1.3
    | 1.35
    | 1.4
    | 1.45
    | 1.5;
  /** @serializeAs rest dataGovernance
   * @serializeAs streaming dataGovernance */
  readonly dataGovernance?: {
    /** @serializeAs rest mip_opt_out
     * @serializeAs streaming mip_opt_out */
    readonly modelImprovementOptOut?: boolean;
  };
  /** @serializeAs rest telemetry
   * @serializeAs streaming telemetry */
  readonly telemetry?: {
    /** @serializeAs rest tag
     * @serializeAs streaming tag */
    readonly tags?: readonly string[];
  };
}
interface FluxSingle extends Flux {
  readonly text: string;
  readonly output: FluxRestOutput;
}
interface FluxStreaming extends Flux {
  readonly text: AsyncIterable<TtsInput>;
  readonly output: FluxStreamingOutput;
}

export type TtsRequest =
  | FluxSingle
  | FluxStreaming
  | Aura1ENSingle
  | Aura1ENStreaming
  | Aura2ENSingle
  | Aura2ENStreaming
  | Aura2ESSingle
  | Aura2ESStreaming
  | Aura2DESingle
  | Aura2DEStreaming
  | Aura2NLSingle
  | Aura2NLStreaming
  | Aura2FRSingle
  | Aura2FRStreaming
  | Aura2ITSingle
  | Aura2ITStreaming
  | Aura2JASingle
  | Aura2JAStreaming;
