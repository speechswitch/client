package invalidtypecast
import ("github.com/speechswitch/client/sdks/go/generated/typecast"; out "github.com/speechswitch/client/sdks/go/generated/typecast_output"; "github.com/speechswitch/client/sdks/go/runtime")
var _ = typecast.TtsRequestObjectSegmentsItemSsfmV21TextVoiceb3babbe2EmotionAsAuto{}
var _ = typecast.TtsRequestSsfmV30TextVoicebb79df90{EmotionIntensity: runtime.Some(1.0)}
var _ = typecast.TtsRequestObjectSegmentsItemSsfmV21TextVoiceb3babbe2LanguageAsHi{}
var _ = typecast.TtsRequestSsfmV30TextVoice2e7e5231{TargetLoudnessLufs: runtime.Some(-20.0)}
var _ = typecast.TtsRequestObject{Text: "Hi"}
var _ = typecast.TtsRequestObjectSegmentsItemObject{Voice: "tc_voice"}
var _ = typecast.TtsRequestObjectOutputWav{SampleRateHz: runtime.Some(typecast.TtsRequestSsfmV21TextVoicef82be0f4OutputWavSampleRateHzNumber32000{})}
var _ = out.SynthesisItemAsClear{}
var _ = typecast.TtsRequestSsfmV30TextVoicec9d5257e{Text: runtime.Input[string](nil)}
