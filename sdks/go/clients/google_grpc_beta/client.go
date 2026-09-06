// Generated from cataloged Google protobuf definitions. Do not edit.
package google_grpc_beta

import ("errors"; "github.com/speechswitch/client/sdks/go/runtime")

type SsmlVoiceGender interface { isSsmlVoiceGender() }
type SsmlVoiceGender_SSML_VOICE_GENDER_UNSPECIFIED struct {}
func (SsmlVoiceGender_SSML_VOICE_GENDER_UNSPECIFIED) isSsmlVoiceGender() {}
type SsmlVoiceGender_MALE struct {}
func (SsmlVoiceGender_MALE) isSsmlVoiceGender() {}
type SsmlVoiceGender_FEMALE struct {}
func (SsmlVoiceGender_FEMALE) isSsmlVoiceGender() {}
type SsmlVoiceGender_NEUTRAL struct {}
func (SsmlVoiceGender_NEUTRAL) isSsmlVoiceGender() {}
func numberSsmlVoiceGender(value SsmlVoiceGender) (int32, error) {
switch value := value.(type) {
case SsmlVoiceGender_SSML_VOICE_GENDER_UNSPECIFIED: return 0, nil
case *SsmlVoiceGender_SSML_VOICE_GENDER_UNSPECIFIED: if value != nil { return 0, nil }
case SsmlVoiceGender_MALE: return 1, nil
case *SsmlVoiceGender_MALE: if value != nil { return 1, nil }
case SsmlVoiceGender_FEMALE: return 2, nil
case *SsmlVoiceGender_FEMALE: if value != nil { return 2, nil }
case SsmlVoiceGender_NEUTRAL: return 3, nil
case *SsmlVoiceGender_NEUTRAL: if value != nil { return 3, nil }
}
return 0, errors.New("Invalid protobuf SsmlVoiceGender")
}

type CustomVoiceParamsReportedUsage interface { isCustomVoiceParamsReportedUsage() }
type CustomVoiceParamsReportedUsage_REPORTED_USAGE_UNSPECIFIED struct {}
func (CustomVoiceParamsReportedUsage_REPORTED_USAGE_UNSPECIFIED) isCustomVoiceParamsReportedUsage() {}
type CustomVoiceParamsReportedUsage_REALTIME struct {}
func (CustomVoiceParamsReportedUsage_REALTIME) isCustomVoiceParamsReportedUsage() {}
type CustomVoiceParamsReportedUsage_OFFLINE struct {}
func (CustomVoiceParamsReportedUsage_OFFLINE) isCustomVoiceParamsReportedUsage() {}
func numberCustomVoiceParamsReportedUsage(value CustomVoiceParamsReportedUsage) (int32, error) {
switch value := value.(type) {
case CustomVoiceParamsReportedUsage_REPORTED_USAGE_UNSPECIFIED: return 0, nil
case *CustomVoiceParamsReportedUsage_REPORTED_USAGE_UNSPECIFIED: if value != nil { return 0, nil }
case CustomVoiceParamsReportedUsage_REALTIME: return 1, nil
case *CustomVoiceParamsReportedUsage_REALTIME: if value != nil { return 1, nil }
case CustomVoiceParamsReportedUsage_OFFLINE: return 2, nil
case *CustomVoiceParamsReportedUsage_OFFLINE: if value != nil { return 2, nil }
}
return 0, errors.New("Invalid protobuf CustomVoiceParamsReportedUsage")
}

type AudioEncoding interface { isAudioEncoding() }
type AudioEncoding_AUDIO_ENCODING_UNSPECIFIED struct {}
func (AudioEncoding_AUDIO_ENCODING_UNSPECIFIED) isAudioEncoding() {}
type AudioEncoding_LINEAR16 struct {}
func (AudioEncoding_LINEAR16) isAudioEncoding() {}
type AudioEncoding_MP3 struct {}
func (AudioEncoding_MP3) isAudioEncoding() {}
type AudioEncoding_MP3_64_KBPS struct {}
func (AudioEncoding_MP3_64_KBPS) isAudioEncoding() {}
type AudioEncoding_OGG_OPUS struct {}
func (AudioEncoding_OGG_OPUS) isAudioEncoding() {}
type AudioEncoding_MULAW struct {}
func (AudioEncoding_MULAW) isAudioEncoding() {}
type AudioEncoding_ALAW struct {}
func (AudioEncoding_ALAW) isAudioEncoding() {}
type AudioEncoding_PCM struct {}
func (AudioEncoding_PCM) isAudioEncoding() {}
type AudioEncoding_M4A struct {}
func (AudioEncoding_M4A) isAudioEncoding() {}
func numberAudioEncoding(value AudioEncoding) (int32, error) {
switch value := value.(type) {
case AudioEncoding_AUDIO_ENCODING_UNSPECIFIED: return 0, nil
case *AudioEncoding_AUDIO_ENCODING_UNSPECIFIED: if value != nil { return 0, nil }
case AudioEncoding_LINEAR16: return 1, nil
case *AudioEncoding_LINEAR16: if value != nil { return 1, nil }
case AudioEncoding_MP3: return 2, nil
case *AudioEncoding_MP3: if value != nil { return 2, nil }
case AudioEncoding_MP3_64_KBPS: return 4, nil
case *AudioEncoding_MP3_64_KBPS: if value != nil { return 4, nil }
case AudioEncoding_OGG_OPUS: return 3, nil
case *AudioEncoding_OGG_OPUS: if value != nil { return 3, nil }
case AudioEncoding_MULAW: return 5, nil
case *AudioEncoding_MULAW: if value != nil { return 5, nil }
case AudioEncoding_ALAW: return 6, nil
case *AudioEncoding_ALAW: if value != nil { return 6, nil }
case AudioEncoding_PCM: return 7, nil
case *AudioEncoding_PCM: if value != nil { return 7, nil }
case AudioEncoding_M4A: return 8, nil
case *AudioEncoding_M4A: if value != nil { return 8, nil }
}
return 0, errors.New("Invalid protobuf AudioEncoding")
}

type CustomPronunciationParamsPhoneticEncoding interface { isCustomPronunciationParamsPhoneticEncoding() }
type CustomPronunciationParamsPhoneticEncoding_PHONETIC_ENCODING_UNSPECIFIED struct {}
func (CustomPronunciationParamsPhoneticEncoding_PHONETIC_ENCODING_UNSPECIFIED) isCustomPronunciationParamsPhoneticEncoding() {}
type CustomPronunciationParamsPhoneticEncoding_PHONETIC_ENCODING_IPA struct {}
func (CustomPronunciationParamsPhoneticEncoding_PHONETIC_ENCODING_IPA) isCustomPronunciationParamsPhoneticEncoding() {}
type CustomPronunciationParamsPhoneticEncoding_PHONETIC_ENCODING_X_SAMPA struct {}
func (CustomPronunciationParamsPhoneticEncoding_PHONETIC_ENCODING_X_SAMPA) isCustomPronunciationParamsPhoneticEncoding() {}
type CustomPronunciationParamsPhoneticEncoding_PHONETIC_ENCODING_JAPANESE_YOMIGANA struct {}
func (CustomPronunciationParamsPhoneticEncoding_PHONETIC_ENCODING_JAPANESE_YOMIGANA) isCustomPronunciationParamsPhoneticEncoding() {}
type CustomPronunciationParamsPhoneticEncoding_PHONETIC_ENCODING_PINYIN struct {}
func (CustomPronunciationParamsPhoneticEncoding_PHONETIC_ENCODING_PINYIN) isCustomPronunciationParamsPhoneticEncoding() {}
func numberCustomPronunciationParamsPhoneticEncoding(value CustomPronunciationParamsPhoneticEncoding) (int32, error) {
switch value := value.(type) {
case CustomPronunciationParamsPhoneticEncoding_PHONETIC_ENCODING_UNSPECIFIED: return 0, nil
case *CustomPronunciationParamsPhoneticEncoding_PHONETIC_ENCODING_UNSPECIFIED: if value != nil { return 0, nil }
case CustomPronunciationParamsPhoneticEncoding_PHONETIC_ENCODING_IPA: return 1, nil
case *CustomPronunciationParamsPhoneticEncoding_PHONETIC_ENCODING_IPA: if value != nil { return 1, nil }
case CustomPronunciationParamsPhoneticEncoding_PHONETIC_ENCODING_X_SAMPA: return 2, nil
case *CustomPronunciationParamsPhoneticEncoding_PHONETIC_ENCODING_X_SAMPA: if value != nil { return 2, nil }
case CustomPronunciationParamsPhoneticEncoding_PHONETIC_ENCODING_JAPANESE_YOMIGANA: return 3, nil
case *CustomPronunciationParamsPhoneticEncoding_PHONETIC_ENCODING_JAPANESE_YOMIGANA: if value != nil { return 3, nil }
case CustomPronunciationParamsPhoneticEncoding_PHONETIC_ENCODING_PINYIN: return 4, nil
case *CustomPronunciationParamsPhoneticEncoding_PHONETIC_ENCODING_PINYIN: if value != nil { return 4, nil }
}
return 0, errors.New("Invalid protobuf CustomPronunciationParamsPhoneticEncoding")
}

type AdvancedVoiceOptionsHarmCategory interface { isAdvancedVoiceOptionsHarmCategory() }
type AdvancedVoiceOptionsHarmCategory_HARM_CATEGORY_UNSPECIFIED struct {}
func (AdvancedVoiceOptionsHarmCategory_HARM_CATEGORY_UNSPECIFIED) isAdvancedVoiceOptionsHarmCategory() {}
type AdvancedVoiceOptionsHarmCategory_HARM_CATEGORY_HATE_SPEECH struct {}
func (AdvancedVoiceOptionsHarmCategory_HARM_CATEGORY_HATE_SPEECH) isAdvancedVoiceOptionsHarmCategory() {}
type AdvancedVoiceOptionsHarmCategory_HARM_CATEGORY_DANGEROUS_CONTENT struct {}
func (AdvancedVoiceOptionsHarmCategory_HARM_CATEGORY_DANGEROUS_CONTENT) isAdvancedVoiceOptionsHarmCategory() {}
type AdvancedVoiceOptionsHarmCategory_HARM_CATEGORY_HARASSMENT struct {}
func (AdvancedVoiceOptionsHarmCategory_HARM_CATEGORY_HARASSMENT) isAdvancedVoiceOptionsHarmCategory() {}
type AdvancedVoiceOptionsHarmCategory_HARM_CATEGORY_SEXUALLY_EXPLICIT struct {}
func (AdvancedVoiceOptionsHarmCategory_HARM_CATEGORY_SEXUALLY_EXPLICIT) isAdvancedVoiceOptionsHarmCategory() {}
func numberAdvancedVoiceOptionsHarmCategory(value AdvancedVoiceOptionsHarmCategory) (int32, error) {
switch value := value.(type) {
case AdvancedVoiceOptionsHarmCategory_HARM_CATEGORY_UNSPECIFIED: return 0, nil
case *AdvancedVoiceOptionsHarmCategory_HARM_CATEGORY_UNSPECIFIED: if value != nil { return 0, nil }
case AdvancedVoiceOptionsHarmCategory_HARM_CATEGORY_HATE_SPEECH: return 1, nil
case *AdvancedVoiceOptionsHarmCategory_HARM_CATEGORY_HATE_SPEECH: if value != nil { return 1, nil }
case AdvancedVoiceOptionsHarmCategory_HARM_CATEGORY_DANGEROUS_CONTENT: return 2, nil
case *AdvancedVoiceOptionsHarmCategory_HARM_CATEGORY_DANGEROUS_CONTENT: if value != nil { return 2, nil }
case AdvancedVoiceOptionsHarmCategory_HARM_CATEGORY_HARASSMENT: return 3, nil
case *AdvancedVoiceOptionsHarmCategory_HARM_CATEGORY_HARASSMENT: if value != nil { return 3, nil }
case AdvancedVoiceOptionsHarmCategory_HARM_CATEGORY_SEXUALLY_EXPLICIT: return 4, nil
case *AdvancedVoiceOptionsHarmCategory_HARM_CATEGORY_SEXUALLY_EXPLICIT: if value != nil { return 4, nil }
}
return 0, errors.New("Invalid protobuf AdvancedVoiceOptionsHarmCategory")
}

type AdvancedVoiceOptionsHarmBlockThreshold interface { isAdvancedVoiceOptionsHarmBlockThreshold() }
type AdvancedVoiceOptionsHarmBlockThreshold_HARM_BLOCK_THRESHOLD_UNSPECIFIED struct {}
func (AdvancedVoiceOptionsHarmBlockThreshold_HARM_BLOCK_THRESHOLD_UNSPECIFIED) isAdvancedVoiceOptionsHarmBlockThreshold() {}
type AdvancedVoiceOptionsHarmBlockThreshold_BLOCK_LOW_AND_ABOVE struct {}
func (AdvancedVoiceOptionsHarmBlockThreshold_BLOCK_LOW_AND_ABOVE) isAdvancedVoiceOptionsHarmBlockThreshold() {}
type AdvancedVoiceOptionsHarmBlockThreshold_BLOCK_MEDIUM_AND_ABOVE struct {}
func (AdvancedVoiceOptionsHarmBlockThreshold_BLOCK_MEDIUM_AND_ABOVE) isAdvancedVoiceOptionsHarmBlockThreshold() {}
type AdvancedVoiceOptionsHarmBlockThreshold_BLOCK_ONLY_HIGH struct {}
func (AdvancedVoiceOptionsHarmBlockThreshold_BLOCK_ONLY_HIGH) isAdvancedVoiceOptionsHarmBlockThreshold() {}
type AdvancedVoiceOptionsHarmBlockThreshold_BLOCK_NONE struct {}
func (AdvancedVoiceOptionsHarmBlockThreshold_BLOCK_NONE) isAdvancedVoiceOptionsHarmBlockThreshold() {}
type AdvancedVoiceOptionsHarmBlockThreshold_OFF struct {}
func (AdvancedVoiceOptionsHarmBlockThreshold_OFF) isAdvancedVoiceOptionsHarmBlockThreshold() {}
func numberAdvancedVoiceOptionsHarmBlockThreshold(value AdvancedVoiceOptionsHarmBlockThreshold) (int32, error) {
switch value := value.(type) {
case AdvancedVoiceOptionsHarmBlockThreshold_HARM_BLOCK_THRESHOLD_UNSPECIFIED: return 0, nil
case *AdvancedVoiceOptionsHarmBlockThreshold_HARM_BLOCK_THRESHOLD_UNSPECIFIED: if value != nil { return 0, nil }
case AdvancedVoiceOptionsHarmBlockThreshold_BLOCK_LOW_AND_ABOVE: return 1, nil
case *AdvancedVoiceOptionsHarmBlockThreshold_BLOCK_LOW_AND_ABOVE: if value != nil { return 1, nil }
case AdvancedVoiceOptionsHarmBlockThreshold_BLOCK_MEDIUM_AND_ABOVE: return 2, nil
case *AdvancedVoiceOptionsHarmBlockThreshold_BLOCK_MEDIUM_AND_ABOVE: if value != nil { return 2, nil }
case AdvancedVoiceOptionsHarmBlockThreshold_BLOCK_ONLY_HIGH: return 3, nil
case *AdvancedVoiceOptionsHarmBlockThreshold_BLOCK_ONLY_HIGH: if value != nil { return 3, nil }
case AdvancedVoiceOptionsHarmBlockThreshold_BLOCK_NONE: return 4, nil
case *AdvancedVoiceOptionsHarmBlockThreshold_BLOCK_NONE: if value != nil { return 4, nil }
case AdvancedVoiceOptionsHarmBlockThreshold_OFF: return 5, nil
case *AdvancedVoiceOptionsHarmBlockThreshold_OFF: if value != nil { return 5, nil }
}
return 0, errors.New("Invalid protobuf AdvancedVoiceOptionsHarmBlockThreshold")
}

type StreamingSynthesizeRequest struct {
StreamingRequest StreamingSynthesizeRequestStreamingRequest
}
type StreamingSynthesizeRequestStreamingRequest interface { isStreamingSynthesizeRequestStreamingRequest() }
type StreamingSynthesizeRequest_StreamingConfig struct { Value StreamingSynthesizeConfig }
func (StreamingSynthesizeRequest_StreamingConfig) isStreamingSynthesizeRequestStreamingRequest() {}
type StreamingSynthesizeRequest_Input struct { Value StreamingSynthesisInput }
func (StreamingSynthesizeRequest_Input) isStreamingSynthesizeRequestStreamingRequest() {}

func EncodeStreamingSynthesizeRequest(value StreamingSynthesizeRequest) ([]byte, error) {
var writer runtime.ProtoWriter
switch item := value.StreamingRequest.(type) {
case nil:
case StreamingSynthesizeRequest_StreamingConfig:
data, err := EncodeStreamingSynthesizeConfig(item.Value); if err != nil { return nil, err }
writer.Uint32(10).Bytes(data)
case *StreamingSynthesizeRequest_StreamingConfig:
if item == nil { return nil, errors.New("Invalid protobuf StreamingSynthesizeRequest.streamingRequest") }
data, err := EncodeStreamingSynthesizeConfig(item.Value); if err != nil { return nil, err }
writer.Uint32(10).Bytes(data)
case StreamingSynthesizeRequest_Input:
data, err := EncodeStreamingSynthesisInput(item.Value); if err != nil { return nil, err }
writer.Uint32(18).Bytes(data)
case *StreamingSynthesizeRequest_Input:
if item == nil { return nil, errors.New("Invalid protobuf StreamingSynthesizeRequest.streamingRequest") }
data, err := EncodeStreamingSynthesisInput(item.Value); if err != nil { return nil, err }
writer.Uint32(18).Bytes(data)
default: return nil, errors.New("Invalid protobuf StreamingSynthesizeRequest.streamingRequest")
}
return writer.Finish()
}

type StreamingSynthesizeConfig struct {
Voice VoiceSelectionParams
StreamingAudioConfig runtime.Optional[StreamingAudioConfig]
CustomPronunciations runtime.Optional[CustomPronunciations]
AdvancedVoiceOptions runtime.Optional[AdvancedVoiceOptions]
}

func EncodeStreamingSynthesizeConfig(value StreamingSynthesizeConfig) ([]byte, error) {
var writer runtime.ProtoWriter
{
data, err := EncodeVoiceSelectionParams(value.Voice); if err != nil { return nil, err }
writer.Uint32(10).Bytes(data)
}
if value.StreamingAudioConfig.Present {
data, err := EncodeStreamingAudioConfig(value.StreamingAudioConfig.Value); if err != nil { return nil, err }
writer.Uint32(34).Bytes(data)
}
if value.CustomPronunciations.Present {
data, err := EncodeCustomPronunciations(value.CustomPronunciations.Value); if err != nil { return nil, err }
writer.Uint32(42).Bytes(data)
}
if value.AdvancedVoiceOptions.Present {
data, err := EncodeAdvancedVoiceOptions(value.AdvancedVoiceOptions.Value); if err != nil { return nil, err }
writer.Uint32(58).Bytes(data)
}
return writer.Finish()
}

type VoiceSelectionParams struct {
LanguageCode string
Name runtime.Optional[string]
SsmlGender runtime.Optional[SsmlVoiceGender]
CustomVoice runtime.Optional[CustomVoiceParams]
VoiceClone runtime.Optional[VoiceCloneParams]
ModelName runtime.Optional[string]
MultiSpeakerVoiceConfig runtime.Optional[MultiSpeakerVoiceConfig]
}

func EncodeVoiceSelectionParams(value VoiceSelectionParams) ([]byte, error) {
var writer runtime.ProtoWriter
{
writer.Uint32(10).String(value.LanguageCode)
}
if value.Name.Present {
writer.Uint32(18).String(value.Name.Value)
}
if value.SsmlGender.Present {
number, err := numberSsmlVoiceGender(value.SsmlGender.Value); if err != nil { return nil, err }
writer.Uint32(24).Int32(number)
}
if value.CustomVoice.Present {
data, err := EncodeCustomVoiceParams(value.CustomVoice.Value); if err != nil { return nil, err }
writer.Uint32(34).Bytes(data)
}
if value.VoiceClone.Present {
data, err := EncodeVoiceCloneParams(value.VoiceClone.Value); if err != nil { return nil, err }
writer.Uint32(42).Bytes(data)
}
if value.ModelName.Present {
writer.Uint32(50).String(value.ModelName.Value)
}
if value.MultiSpeakerVoiceConfig.Present {
data, err := EncodeMultiSpeakerVoiceConfig(value.MultiSpeakerVoiceConfig.Value); if err != nil { return nil, err }
writer.Uint32(58).Bytes(data)
}
return writer.Finish()
}

type CustomVoiceParams struct {
Model string
ReportedUsage runtime.Optional[CustomVoiceParamsReportedUsage]
}

func EncodeCustomVoiceParams(value CustomVoiceParams) ([]byte, error) {
var writer runtime.ProtoWriter
{
writer.Uint32(10).String(value.Model)
}
if value.ReportedUsage.Present {
number, err := numberCustomVoiceParamsReportedUsage(value.ReportedUsage.Value); if err != nil { return nil, err }
writer.Uint32(24).Int32(number)
}
return writer.Finish()
}

type VoiceCloneParams struct {
VoiceCloningKey string
}

func EncodeVoiceCloneParams(value VoiceCloneParams) ([]byte, error) {
var writer runtime.ProtoWriter
{
writer.Uint32(10).String(value.VoiceCloningKey)
}
return writer.Finish()
}

type MultiSpeakerVoiceConfig struct {
SpeakerVoiceConfigs []MultispeakerPrebuiltVoice
}

func EncodeMultiSpeakerVoiceConfig(value MultiSpeakerVoiceConfig) ([]byte, error) {
var writer runtime.ProtoWriter
if value.SpeakerVoiceConfigs == nil { return nil, errors.New("Missing MultiSpeakerVoiceConfig.speakerVoiceConfigs") }
for _, item := range value.SpeakerVoiceConfigs {
data, err := EncodeMultispeakerPrebuiltVoice(item); if err != nil { return nil, err }
writer.Uint32(18).Bytes(data)
}
return writer.Finish()
}

type MultispeakerPrebuiltVoice struct {
SpeakerAlias string
SpeakerId string
}

func EncodeMultispeakerPrebuiltVoice(value MultispeakerPrebuiltVoice) ([]byte, error) {
var writer runtime.ProtoWriter
{
writer.Uint32(10).String(value.SpeakerAlias)
}
{
writer.Uint32(18).String(value.SpeakerId)
}
return writer.Finish()
}

type StreamingAudioConfig struct {
AudioEncoding AudioEncoding
SampleRateHertz runtime.Optional[int32]
SpeakingRate runtime.Optional[float64]
}

func EncodeStreamingAudioConfig(value StreamingAudioConfig) ([]byte, error) {
var writer runtime.ProtoWriter
{
number, err := numberAudioEncoding(value.AudioEncoding); if err != nil { return nil, err }
writer.Uint32(8).Int32(number)
}
if value.SampleRateHertz.Present {
writer.Uint32(16).Int32(value.SampleRateHertz.Value)
}
if value.SpeakingRate.Present {
writer.Uint32(25).Double(value.SpeakingRate.Value)
}
return writer.Finish()
}

type CustomPronunciations struct {
Pronunciations []CustomPronunciationParams
}

func EncodeCustomPronunciations(value CustomPronunciations) ([]byte, error) {
var writer runtime.ProtoWriter
for _, item := range value.Pronunciations {
data, err := EncodeCustomPronunciationParams(item); if err != nil { return nil, err }
writer.Uint32(10).Bytes(data)
}
return writer.Finish()
}

type CustomPronunciationParams struct {
Phrase runtime.Optional[string]
PhoneticEncoding runtime.Optional[CustomPronunciationParamsPhoneticEncoding]
Pronunciation runtime.Optional[string]
}

func EncodeCustomPronunciationParams(value CustomPronunciationParams) ([]byte, error) {
var writer runtime.ProtoWriter
if value.Phrase.Present {
writer.Uint32(10).String(value.Phrase.Value)
}
if value.PhoneticEncoding.Present {
number, err := numberCustomPronunciationParamsPhoneticEncoding(value.PhoneticEncoding.Value); if err != nil { return nil, err }
writer.Uint32(16).Int32(number)
}
if value.Pronunciation.Present {
writer.Uint32(26).String(value.Pronunciation.Value)
}
return writer.Finish()
}

type AdvancedVoiceOptions struct {
LowLatencyJourneySynthesis runtime.Optional[bool]
RelaxSafetyFilters runtime.Optional[bool]
SafetySettings runtime.Optional[AdvancedVoiceOptionsSafetySettings]
EnableTextnorm runtime.Optional[bool]
}

func EncodeAdvancedVoiceOptions(value AdvancedVoiceOptions) ([]byte, error) {
var writer runtime.ProtoWriter
if value.LowLatencyJourneySynthesis.Present {
writer.Uint32(8).Bool(value.LowLatencyJourneySynthesis.Value)
}
if value.RelaxSafetyFilters.Present {
writer.Uint32(64).Bool(value.RelaxSafetyFilters.Value)
}
if value.SafetySettings.Present {
data, err := EncodeAdvancedVoiceOptionsSafetySettings(value.SafetySettings.Value); if err != nil { return nil, err }
writer.Uint32(74).Bytes(data)
}
if value.EnableTextnorm.Present {
writer.Uint32(16).Bool(value.EnableTextnorm.Value)
}
return writer.Finish()
}

type AdvancedVoiceOptionsSafetySettings struct {
Settings []AdvancedVoiceOptionsSafetySetting
}

func EncodeAdvancedVoiceOptionsSafetySettings(value AdvancedVoiceOptionsSafetySettings) ([]byte, error) {
var writer runtime.ProtoWriter
for _, item := range value.Settings {
data, err := EncodeAdvancedVoiceOptionsSafetySetting(item); if err != nil { return nil, err }
writer.Uint32(10).Bytes(data)
}
return writer.Finish()
}

type AdvancedVoiceOptionsSafetySetting struct {
Category runtime.Optional[AdvancedVoiceOptionsHarmCategory]
Threshold runtime.Optional[AdvancedVoiceOptionsHarmBlockThreshold]
}

func EncodeAdvancedVoiceOptionsSafetySetting(value AdvancedVoiceOptionsSafetySetting) ([]byte, error) {
var writer runtime.ProtoWriter
if value.Category.Present {
number, err := numberAdvancedVoiceOptionsHarmCategory(value.Category.Value); if err != nil { return nil, err }
writer.Uint32(8).Int32(number)
}
if value.Threshold.Present {
number, err := numberAdvancedVoiceOptionsHarmBlockThreshold(value.Threshold.Value); if err != nil { return nil, err }
writer.Uint32(16).Int32(number)
}
return writer.Finish()
}

type StreamingSynthesisInput struct {
Prompt runtime.Optional[string]
InputSource StreamingSynthesisInputInputSource
}
type StreamingSynthesisInputInputSource interface { isStreamingSynthesisInputInputSource() }
type StreamingSynthesisInput_Text struct { Value string }
func (StreamingSynthesisInput_Text) isStreamingSynthesisInputInputSource() {}
type StreamingSynthesisInput_Markup struct { Value string }
func (StreamingSynthesisInput_Markup) isStreamingSynthesisInputInputSource() {}
type StreamingSynthesisInput_MultiSpeakerMarkup struct { Value MultiSpeakerMarkup }
func (StreamingSynthesisInput_MultiSpeakerMarkup) isStreamingSynthesisInputInputSource() {}

func EncodeStreamingSynthesisInput(value StreamingSynthesisInput) ([]byte, error) {
var writer runtime.ProtoWriter
switch item := value.InputSource.(type) {
case nil:
case StreamingSynthesisInput_Text:
writer.Uint32(10).String(item.Value)
case *StreamingSynthesisInput_Text:
if item == nil { return nil, errors.New("Invalid protobuf StreamingSynthesisInput.inputSource") }
writer.Uint32(10).String(item.Value)
case StreamingSynthesisInput_Markup:
writer.Uint32(42).String(item.Value)
case *StreamingSynthesisInput_Markup:
if item == nil { return nil, errors.New("Invalid protobuf StreamingSynthesisInput.inputSource") }
writer.Uint32(42).String(item.Value)
case StreamingSynthesisInput_MultiSpeakerMarkup:
data, err := EncodeMultiSpeakerMarkup(item.Value); if err != nil { return nil, err }
writer.Uint32(58).Bytes(data)
case *StreamingSynthesisInput_MultiSpeakerMarkup:
if item == nil { return nil, errors.New("Invalid protobuf StreamingSynthesisInput.inputSource") }
data, err := EncodeMultiSpeakerMarkup(item.Value); if err != nil { return nil, err }
writer.Uint32(58).Bytes(data)
default: return nil, errors.New("Invalid protobuf StreamingSynthesisInput.inputSource")
}
if value.Prompt.Present {
writer.Uint32(50).String(value.Prompt.Value)
}
return writer.Finish()
}

type MultiSpeakerMarkup struct {
Turns []MultiSpeakerMarkupTurn
}

func EncodeMultiSpeakerMarkup(value MultiSpeakerMarkup) ([]byte, error) {
var writer runtime.ProtoWriter
if value.Turns == nil { return nil, errors.New("Missing MultiSpeakerMarkup.turns") }
for _, item := range value.Turns {
data, err := EncodeMultiSpeakerMarkupTurn(item); if err != nil { return nil, err }
writer.Uint32(10).Bytes(data)
}
return writer.Finish()
}

type MultiSpeakerMarkupTurn struct {
Speaker string
Text string
}

func EncodeMultiSpeakerMarkupTurn(value MultiSpeakerMarkupTurn) ([]byte, error) {
var writer runtime.ProtoWriter
{
writer.Uint32(10).String(value.Speaker)
}
{
writer.Uint32(18).String(value.Text)
}
return writer.Finish()
}

type StreamingSynthesizeResponse struct {
AudioContent runtime.Optional[[]byte]
}

func EncodeStreamingSynthesizeResponse(value StreamingSynthesizeResponse) ([]byte, error) {
var writer runtime.ProtoWriter
if value.AudioContent.Present {
writer.Uint32(10).Bytes(value.AudioContent.Value)
}
return writer.Finish()
}

func DecodeStreamingSynthesizeResponse(data []byte) (StreamingSynthesizeResponse, error) {
var value StreamingSynthesizeResponse
reader := runtime.NewProtoReader(data)
for !reader.Done() {
tag := reader.Uint32()
if reader.Err() != nil { return StreamingSynthesizeResponse{}, reader.Err() }
if tag >> 3 == 0 { return StreamingSynthesizeResponse{}, errors.New("Invalid protobuf field number") }
switch tag >> 3 {
case 1:
if tag & 7 != 2 { return StreamingSynthesizeResponse{}, errors.New("Invalid protobuf wire type for StreamingSynthesizeResponse.audioContent") }
item := reader.Bytes()
value.AudioContent = runtime.Some(item)
default: reader.Skip(tag & 7)
}
}
if reader.Err() != nil { return StreamingSynthesizeResponse{}, reader.Err() }
return value, nil
}

const StreamingSynthesizePath = "/google.cloud.texttospeech.v1beta1.TextToSpeech/StreamingSynthesize"
func EncodeStreamingRequest(value StreamingSynthesizeRequest) ([]byte, error) { return EncodeStreamingSynthesizeRequest(value) }
func DecodeStreamingResponse(data []byte) (StreamingSynthesizeResponse, error) { return DecodeStreamingSynthesizeResponse(data) }
