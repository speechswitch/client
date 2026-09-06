// Generated from https://texttospeech.googleapis.com/$discovery/rest?version=v1beta1. Do not edit.
package google_rest_beta

import (
"bytes"
"context"
"encoding/json"
"errors"
"fmt"
"math"
"net/http"
"net/url"
"strconv"
"strings"
"unicode/utf8"
"github.com/speechswitch/client/sdks/go/runtime"
)

const DefaultBaseURL = "https://texttospeech.googleapis.com/"
var errWireValue = errors.New("Invalid Google wire value")
type ClientOptions struct { BaseURL string; Headers http.Header; Transport runtime.HTTPTransport }

type SynthesizeSpeechRequest struct {
AdvancedVoiceOptions runtime.Optional[AdvancedVoiceOptions]
AudioConfig runtime.Optional[AudioConfig]
EnableTimePointing runtime.Optional[SynthesizeSpeechRequestEnableTimePointing]
Input runtime.Optional[SynthesisInput]
Voice runtime.Optional[VoiceSelectionParams]
}
func encodeSynthesizeSpeechRequest(value SynthesizeSpeechRequest) (any, error) {
object := map[string]any{}
if value.AdvancedVoiceOptions.Present {
item, err := encodeAdvancedVoiceOptions(value.AdvancedVoiceOptions.Value); if err != nil { return nil, err }; object["advancedVoiceOptions"] = item
}
if value.AudioConfig.Present {
item, err := encodeAudioConfig(value.AudioConfig.Value); if err != nil { return nil, err }; object["audioConfig"] = item
}
if value.EnableTimePointing.Present {
item, err := encodeSynthesizeSpeechRequestEnableTimePointing(value.EnableTimePointing.Value); if err != nil { return nil, err }; object["enableTimePointing"] = item
}
if value.Input.Present {
item, err := encodeSynthesisInput(value.Input.Value); if err != nil { return nil, err }; object["input"] = item
}
if value.Voice.Present {
item, err := encodeVoiceSelectionParams(value.Voice.Value); if err != nil { return nil, err }; object["voice"] = item
}
return object, nil
}
func decodeSynthesizeSpeechRequest(value any) (SynthesizeSpeechRequest, error) {
var result SynthesizeSpeechRequest; object, ok := value.(map[string]any); if !ok || object == nil { return result, errWireValue }
if item, present := object["advancedVoiceOptions"]; present {
decoded, err := decodeAdvancedVoiceOptions(item); if err != nil { return SynthesizeSpeechRequest{}, err }; result.AdvancedVoiceOptions = runtime.Some(decoded)
}
if item, present := object["audioConfig"]; present {
decoded, err := decodeAudioConfig(item); if err != nil { return SynthesizeSpeechRequest{}, err }; result.AudioConfig = runtime.Some(decoded)
}
if item, present := object["enableTimePointing"]; present {
decoded, err := decodeSynthesizeSpeechRequestEnableTimePointing(item); if err != nil { return SynthesizeSpeechRequest{}, err }; result.EnableTimePointing = runtime.Some(decoded)
}
if item, present := object["input"]; present {
decoded, err := decodeSynthesisInput(item); if err != nil { return SynthesizeSpeechRequest{}, err }; result.Input = runtime.Some(decoded)
}
if item, present := object["voice"]; present {
decoded, err := decodeVoiceSelectionParams(item); if err != nil { return SynthesizeSpeechRequest{}, err }; result.Voice = runtime.Some(decoded)
}
return result, nil
}

type AdvancedVoiceOptions struct {
EnableTextnorm runtime.Optional[AdvancedVoiceOptionsEnableTextnorm]
LowLatencyJourneySynthesis runtime.Optional[AdvancedVoiceOptionsLowLatencyJourneySynthesis]
RelaxSafetyFilters runtime.Optional[AdvancedVoiceOptionsRelaxSafetyFilters]
SafetySettings runtime.Optional[SafetySettings]
}
func encodeAdvancedVoiceOptions(value AdvancedVoiceOptions) (any, error) {
object := map[string]any{}
if value.EnableTextnorm.Present {
item, err := encodeAdvancedVoiceOptionsEnableTextnorm(value.EnableTextnorm.Value); if err != nil { return nil, err }; object["enableTextnorm"] = item
}
if value.LowLatencyJourneySynthesis.Present {
item, err := encodeAdvancedVoiceOptionsLowLatencyJourneySynthesis(value.LowLatencyJourneySynthesis.Value); if err != nil { return nil, err }; object["lowLatencyJourneySynthesis"] = item
}
if value.RelaxSafetyFilters.Present {
item, err := encodeAdvancedVoiceOptionsRelaxSafetyFilters(value.RelaxSafetyFilters.Value); if err != nil { return nil, err }; object["relaxSafetyFilters"] = item
}
if value.SafetySettings.Present {
item, err := encodeSafetySettings(value.SafetySettings.Value); if err != nil { return nil, err }; object["safetySettings"] = item
}
return object, nil
}
func decodeAdvancedVoiceOptions(value any) (AdvancedVoiceOptions, error) {
var result AdvancedVoiceOptions; object, ok := value.(map[string]any); if !ok || object == nil { return result, errWireValue }
if item, present := object["enableTextnorm"]; present {
decoded, err := decodeAdvancedVoiceOptionsEnableTextnorm(item); if err != nil { return AdvancedVoiceOptions{}, err }; result.EnableTextnorm = runtime.Some(decoded)
}
if item, present := object["lowLatencyJourneySynthesis"]; present {
decoded, err := decodeAdvancedVoiceOptionsLowLatencyJourneySynthesis(item); if err != nil { return AdvancedVoiceOptions{}, err }; result.LowLatencyJourneySynthesis = runtime.Some(decoded)
}
if item, present := object["relaxSafetyFilters"]; present {
decoded, err := decodeAdvancedVoiceOptionsRelaxSafetyFilters(item); if err != nil { return AdvancedVoiceOptions{}, err }; result.RelaxSafetyFilters = runtime.Some(decoded)
}
if item, present := object["safetySettings"]; present {
decoded, err := decodeSafetySettings(item); if err != nil { return AdvancedVoiceOptions{}, err }; result.SafetySettings = runtime.Some(decoded)
}
return result, nil
}

type AdvancedVoiceOptionsEnableTextnorm = bool
func encodeAdvancedVoiceOptionsEnableTextnorm(value AdvancedVoiceOptionsEnableTextnorm) (any, error) {
return value, nil
}
func decodeAdvancedVoiceOptionsEnableTextnorm(value any) (AdvancedVoiceOptionsEnableTextnorm, error) {
decoded, ok := value.(bool); if !ok { var zero AdvancedVoiceOptionsEnableTextnorm; return zero, errWireValue }; return decoded, nil
}

type AdvancedVoiceOptionsLowLatencyJourneySynthesis = bool
func encodeAdvancedVoiceOptionsLowLatencyJourneySynthesis(value AdvancedVoiceOptionsLowLatencyJourneySynthesis) (any, error) {
return value, nil
}
func decodeAdvancedVoiceOptionsLowLatencyJourneySynthesis(value any) (AdvancedVoiceOptionsLowLatencyJourneySynthesis, error) {
decoded, ok := value.(bool); if !ok { var zero AdvancedVoiceOptionsLowLatencyJourneySynthesis; return zero, errWireValue }; return decoded, nil
}

type AdvancedVoiceOptionsRelaxSafetyFilters = bool
func encodeAdvancedVoiceOptionsRelaxSafetyFilters(value AdvancedVoiceOptionsRelaxSafetyFilters) (any, error) {
return value, nil
}
func decodeAdvancedVoiceOptionsRelaxSafetyFilters(value any) (AdvancedVoiceOptionsRelaxSafetyFilters, error) {
decoded, ok := value.(bool); if !ok { var zero AdvancedVoiceOptionsRelaxSafetyFilters; return zero, errWireValue }; return decoded, nil
}

type SafetySettings struct {
Settings runtime.Optional[SafetySettingsSettings]
}
func encodeSafetySettings(value SafetySettings) (any, error) {
object := map[string]any{}
if value.Settings.Present {
item, err := encodeSafetySettingsSettings(value.Settings.Value); if err != nil { return nil, err }; object["settings"] = item
}
return object, nil
}
func decodeSafetySettings(value any) (SafetySettings, error) {
var result SafetySettings; object, ok := value.(map[string]any); if !ok || object == nil { return result, errWireValue }
if item, present := object["settings"]; present {
decoded, err := decodeSafetySettingsSettings(item); if err != nil { return SafetySettings{}, err }; result.Settings = runtime.Some(decoded)
}
return result, nil
}

type SafetySettingsSettings = []SafetySetting
func encodeSafetySettingsSettings(value SafetySettingsSettings) (any, error) {
items := make([]any, len(value)); for index, item := range value { encoded, err := encodeSafetySetting(item); if err != nil { return nil, err }; items[index] = encoded }; return items, nil
}
func decodeSafetySettingsSettings(value any) (SafetySettingsSettings, error) {
items, ok := value.([]any); if !ok { return nil, errWireValue }; result := make(SafetySettingsSettings, len(items)); for index, item := range items { decoded, err := decodeSafetySetting(item); if err != nil { return nil, err }; result[index] = decoded }; return result, nil
}

type SafetySetting struct {
Category runtime.Optional[SafetySettingCategory]
Threshold runtime.Optional[SafetySettingThreshold]
}
func encodeSafetySetting(value SafetySetting) (any, error) {
object := map[string]any{}
if value.Category.Present {
item, err := encodeSafetySettingCategory(value.Category.Value); if err != nil { return nil, err }; object["category"] = item
}
if value.Threshold.Present {
item, err := encodeSafetySettingThreshold(value.Threshold.Value); if err != nil { return nil, err }; object["threshold"] = item
}
return object, nil
}
func decodeSafetySetting(value any) (SafetySetting, error) {
var result SafetySetting; object, ok := value.(map[string]any); if !ok || object == nil { return result, errWireValue }
if item, present := object["category"]; present {
decoded, err := decodeSafetySettingCategory(item); if err != nil { return SafetySetting{}, err }; result.Category = runtime.Some(decoded)
}
if item, present := object["threshold"]; present {
decoded, err := decodeSafetySettingThreshold(item); if err != nil { return SafetySetting{}, err }; result.Threshold = runtime.Some(decoded)
}
return result, nil
}

type SafetySettingCategory interface { isSafetySettingCategory() }
type SafetySettingCategoryHARMCATEGORYUNSPECIFIED struct {}
func (SafetySettingCategoryHARMCATEGORYUNSPECIFIED) isSafetySettingCategory() {}
type SafetySettingCategoryHARMCATEGORYHATESPEECH struct {}
func (SafetySettingCategoryHARMCATEGORYHATESPEECH) isSafetySettingCategory() {}
type SafetySettingCategoryHARMCATEGORYDANGEROUSCONTENT struct {}
func (SafetySettingCategoryHARMCATEGORYDANGEROUSCONTENT) isSafetySettingCategory() {}
type SafetySettingCategoryHARMCATEGORYHARASSMENT struct {}
func (SafetySettingCategoryHARMCATEGORYHARASSMENT) isSafetySettingCategory() {}
type SafetySettingCategoryHARMCATEGORYSEXUALLYEXPLICIT struct {}
func (SafetySettingCategoryHARMCATEGORYSEXUALLYEXPLICIT) isSafetySettingCategory() {}
func encodeSafetySettingCategory(value SafetySettingCategory) (any, error) {
switch value := value.(type) {
case SafetySettingCategoryHARMCATEGORYUNSPECIFIED: return "HARM_CATEGORY_UNSPECIFIED", nil
case *SafetySettingCategoryHARMCATEGORYUNSPECIFIED: if value != nil { return "HARM_CATEGORY_UNSPECIFIED", nil }
case SafetySettingCategoryHARMCATEGORYHATESPEECH: return "HARM_CATEGORY_HATE_SPEECH", nil
case *SafetySettingCategoryHARMCATEGORYHATESPEECH: if value != nil { return "HARM_CATEGORY_HATE_SPEECH", nil }
case SafetySettingCategoryHARMCATEGORYDANGEROUSCONTENT: return "HARM_CATEGORY_DANGEROUS_CONTENT", nil
case *SafetySettingCategoryHARMCATEGORYDANGEROUSCONTENT: if value != nil { return "HARM_CATEGORY_DANGEROUS_CONTENT", nil }
case SafetySettingCategoryHARMCATEGORYHARASSMENT: return "HARM_CATEGORY_HARASSMENT", nil
case *SafetySettingCategoryHARMCATEGORYHARASSMENT: if value != nil { return "HARM_CATEGORY_HARASSMENT", nil }
case SafetySettingCategoryHARMCATEGORYSEXUALLYEXPLICIT: return "HARM_CATEGORY_SEXUALLY_EXPLICIT", nil
case *SafetySettingCategoryHARMCATEGORYSEXUALLYEXPLICIT: if value != nil { return "HARM_CATEGORY_SEXUALLY_EXPLICIT", nil }
}; return nil, errWireValue
}
func decodeSafetySettingCategory(value any) (SafetySettingCategory, error) {
text, ok := value.(string); if !ok { return nil, errWireValue }; switch text {
case "HARM_CATEGORY_UNSPECIFIED": return SafetySettingCategoryHARMCATEGORYUNSPECIFIED{}, nil
case "HARM_CATEGORY_HATE_SPEECH": return SafetySettingCategoryHARMCATEGORYHATESPEECH{}, nil
case "HARM_CATEGORY_DANGEROUS_CONTENT": return SafetySettingCategoryHARMCATEGORYDANGEROUSCONTENT{}, nil
case "HARM_CATEGORY_HARASSMENT": return SafetySettingCategoryHARMCATEGORYHARASSMENT{}, nil
case "HARM_CATEGORY_SEXUALLY_EXPLICIT": return SafetySettingCategoryHARMCATEGORYSEXUALLYEXPLICIT{}, nil
}; return nil, errWireValue
}

type SafetySettingThreshold interface { isSafetySettingThreshold() }
type SafetySettingThresholdHARMBLOCKTHRESHOLDUNSPECIFIED struct {}
func (SafetySettingThresholdHARMBLOCKTHRESHOLDUNSPECIFIED) isSafetySettingThreshold() {}
type SafetySettingThresholdBLOCKLOWANDABOVE struct {}
func (SafetySettingThresholdBLOCKLOWANDABOVE) isSafetySettingThreshold() {}
type SafetySettingThresholdBLOCKMEDIUMANDABOVE struct {}
func (SafetySettingThresholdBLOCKMEDIUMANDABOVE) isSafetySettingThreshold() {}
type SafetySettingThresholdBLOCKONLYHIGH struct {}
func (SafetySettingThresholdBLOCKONLYHIGH) isSafetySettingThreshold() {}
type SafetySettingThresholdBLOCKNONE struct {}
func (SafetySettingThresholdBLOCKNONE) isSafetySettingThreshold() {}
type SafetySettingThresholdOFF struct {}
func (SafetySettingThresholdOFF) isSafetySettingThreshold() {}
func encodeSafetySettingThreshold(value SafetySettingThreshold) (any, error) {
switch value := value.(type) {
case SafetySettingThresholdHARMBLOCKTHRESHOLDUNSPECIFIED: return "HARM_BLOCK_THRESHOLD_UNSPECIFIED", nil
case *SafetySettingThresholdHARMBLOCKTHRESHOLDUNSPECIFIED: if value != nil { return "HARM_BLOCK_THRESHOLD_UNSPECIFIED", nil }
case SafetySettingThresholdBLOCKLOWANDABOVE: return "BLOCK_LOW_AND_ABOVE", nil
case *SafetySettingThresholdBLOCKLOWANDABOVE: if value != nil { return "BLOCK_LOW_AND_ABOVE", nil }
case SafetySettingThresholdBLOCKMEDIUMANDABOVE: return "BLOCK_MEDIUM_AND_ABOVE", nil
case *SafetySettingThresholdBLOCKMEDIUMANDABOVE: if value != nil { return "BLOCK_MEDIUM_AND_ABOVE", nil }
case SafetySettingThresholdBLOCKONLYHIGH: return "BLOCK_ONLY_HIGH", nil
case *SafetySettingThresholdBLOCKONLYHIGH: if value != nil { return "BLOCK_ONLY_HIGH", nil }
case SafetySettingThresholdBLOCKNONE: return "BLOCK_NONE", nil
case *SafetySettingThresholdBLOCKNONE: if value != nil { return "BLOCK_NONE", nil }
case SafetySettingThresholdOFF: return "OFF", nil
case *SafetySettingThresholdOFF: if value != nil { return "OFF", nil }
}; return nil, errWireValue
}
func decodeSafetySettingThreshold(value any) (SafetySettingThreshold, error) {
text, ok := value.(string); if !ok { return nil, errWireValue }; switch text {
case "HARM_BLOCK_THRESHOLD_UNSPECIFIED": return SafetySettingThresholdHARMBLOCKTHRESHOLDUNSPECIFIED{}, nil
case "BLOCK_LOW_AND_ABOVE": return SafetySettingThresholdBLOCKLOWANDABOVE{}, nil
case "BLOCK_MEDIUM_AND_ABOVE": return SafetySettingThresholdBLOCKMEDIUMANDABOVE{}, nil
case "BLOCK_ONLY_HIGH": return SafetySettingThresholdBLOCKONLYHIGH{}, nil
case "BLOCK_NONE": return SafetySettingThresholdBLOCKNONE{}, nil
case "OFF": return SafetySettingThresholdOFF{}, nil
}; return nil, errWireValue
}

type AudioConfig struct {
AudioEncoding runtime.Optional[AudioConfigAudioEncoding]
EffectsProfileId runtime.Optional[AudioConfigEffectsProfileId]
Pitch runtime.Optional[AudioConfigPitch]
SampleRateHertz runtime.Optional[AudioConfigSampleRateHertz]
SpeakingRate runtime.Optional[AudioConfigSpeakingRate]
VolumeGainDb runtime.Optional[AudioConfigVolumeGainDb]
}
func encodeAudioConfig(value AudioConfig) (any, error) {
object := map[string]any{}
if value.AudioEncoding.Present {
item, err := encodeAudioConfigAudioEncoding(value.AudioEncoding.Value); if err != nil { return nil, err }; object["audioEncoding"] = item
}
if value.EffectsProfileId.Present {
item, err := encodeAudioConfigEffectsProfileId(value.EffectsProfileId.Value); if err != nil { return nil, err }; object["effectsProfileId"] = item
}
if value.Pitch.Present {
item, err := encodeAudioConfigPitch(value.Pitch.Value); if err != nil { return nil, err }; object["pitch"] = item
}
if value.SampleRateHertz.Present {
item, err := encodeAudioConfigSampleRateHertz(value.SampleRateHertz.Value); if err != nil { return nil, err }; object["sampleRateHertz"] = item
}
if value.SpeakingRate.Present {
item, err := encodeAudioConfigSpeakingRate(value.SpeakingRate.Value); if err != nil { return nil, err }; object["speakingRate"] = item
}
if value.VolumeGainDb.Present {
item, err := encodeAudioConfigVolumeGainDb(value.VolumeGainDb.Value); if err != nil { return nil, err }; object["volumeGainDb"] = item
}
return object, nil
}
func decodeAudioConfig(value any) (AudioConfig, error) {
var result AudioConfig; object, ok := value.(map[string]any); if !ok || object == nil { return result, errWireValue }
if item, present := object["audioEncoding"]; present {
decoded, err := decodeAudioConfigAudioEncoding(item); if err != nil { return AudioConfig{}, err }; result.AudioEncoding = runtime.Some(decoded)
}
if item, present := object["effectsProfileId"]; present {
decoded, err := decodeAudioConfigEffectsProfileId(item); if err != nil { return AudioConfig{}, err }; result.EffectsProfileId = runtime.Some(decoded)
}
if item, present := object["pitch"]; present {
decoded, err := decodeAudioConfigPitch(item); if err != nil { return AudioConfig{}, err }; result.Pitch = runtime.Some(decoded)
}
if item, present := object["sampleRateHertz"]; present {
decoded, err := decodeAudioConfigSampleRateHertz(item); if err != nil { return AudioConfig{}, err }; result.SampleRateHertz = runtime.Some(decoded)
}
if item, present := object["speakingRate"]; present {
decoded, err := decodeAudioConfigSpeakingRate(item); if err != nil { return AudioConfig{}, err }; result.SpeakingRate = runtime.Some(decoded)
}
if item, present := object["volumeGainDb"]; present {
decoded, err := decodeAudioConfigVolumeGainDb(item); if err != nil { return AudioConfig{}, err }; result.VolumeGainDb = runtime.Some(decoded)
}
return result, nil
}

type AudioConfigAudioEncoding interface { isAudioConfigAudioEncoding() }
type AudioConfigAudioEncodingAUDIOENCODINGUNSPECIFIED struct {}
func (AudioConfigAudioEncodingAUDIOENCODINGUNSPECIFIED) isAudioConfigAudioEncoding() {}
type AudioConfigAudioEncodingLINEAR16 struct {}
func (AudioConfigAudioEncodingLINEAR16) isAudioConfigAudioEncoding() {}
type AudioConfigAudioEncodingMP3 struct {}
func (AudioConfigAudioEncodingMP3) isAudioConfigAudioEncoding() {}
type AudioConfigAudioEncodingMP364KBPS struct {}
func (AudioConfigAudioEncodingMP364KBPS) isAudioConfigAudioEncoding() {}
type AudioConfigAudioEncodingOGGOPUS struct {}
func (AudioConfigAudioEncodingOGGOPUS) isAudioConfigAudioEncoding() {}
type AudioConfigAudioEncodingMULAW struct {}
func (AudioConfigAudioEncodingMULAW) isAudioConfigAudioEncoding() {}
type AudioConfigAudioEncodingALAW struct {}
func (AudioConfigAudioEncodingALAW) isAudioConfigAudioEncoding() {}
type AudioConfigAudioEncodingPCM struct {}
func (AudioConfigAudioEncodingPCM) isAudioConfigAudioEncoding() {}
type AudioConfigAudioEncodingM4A struct {}
func (AudioConfigAudioEncodingM4A) isAudioConfigAudioEncoding() {}
func encodeAudioConfigAudioEncoding(value AudioConfigAudioEncoding) (any, error) {
switch value := value.(type) {
case AudioConfigAudioEncodingAUDIOENCODINGUNSPECIFIED: return "AUDIO_ENCODING_UNSPECIFIED", nil
case *AudioConfigAudioEncodingAUDIOENCODINGUNSPECIFIED: if value != nil { return "AUDIO_ENCODING_UNSPECIFIED", nil }
case AudioConfigAudioEncodingLINEAR16: return "LINEAR16", nil
case *AudioConfigAudioEncodingLINEAR16: if value != nil { return "LINEAR16", nil }
case AudioConfigAudioEncodingMP3: return "MP3", nil
case *AudioConfigAudioEncodingMP3: if value != nil { return "MP3", nil }
case AudioConfigAudioEncodingMP364KBPS: return "MP3_64_KBPS", nil
case *AudioConfigAudioEncodingMP364KBPS: if value != nil { return "MP3_64_KBPS", nil }
case AudioConfigAudioEncodingOGGOPUS: return "OGG_OPUS", nil
case *AudioConfigAudioEncodingOGGOPUS: if value != nil { return "OGG_OPUS", nil }
case AudioConfigAudioEncodingMULAW: return "MULAW", nil
case *AudioConfigAudioEncodingMULAW: if value != nil { return "MULAW", nil }
case AudioConfigAudioEncodingALAW: return "ALAW", nil
case *AudioConfigAudioEncodingALAW: if value != nil { return "ALAW", nil }
case AudioConfigAudioEncodingPCM: return "PCM", nil
case *AudioConfigAudioEncodingPCM: if value != nil { return "PCM", nil }
case AudioConfigAudioEncodingM4A: return "M4A", nil
case *AudioConfigAudioEncodingM4A: if value != nil { return "M4A", nil }
}; return nil, errWireValue
}
func decodeAudioConfigAudioEncoding(value any) (AudioConfigAudioEncoding, error) {
text, ok := value.(string); if !ok { return nil, errWireValue }; switch text {
case "AUDIO_ENCODING_UNSPECIFIED": return AudioConfigAudioEncodingAUDIOENCODINGUNSPECIFIED{}, nil
case "LINEAR16": return AudioConfigAudioEncodingLINEAR16{}, nil
case "MP3": return AudioConfigAudioEncodingMP3{}, nil
case "MP3_64_KBPS": return AudioConfigAudioEncodingMP364KBPS{}, nil
case "OGG_OPUS": return AudioConfigAudioEncodingOGGOPUS{}, nil
case "MULAW": return AudioConfigAudioEncodingMULAW{}, nil
case "ALAW": return AudioConfigAudioEncodingALAW{}, nil
case "PCM": return AudioConfigAudioEncodingPCM{}, nil
case "M4A": return AudioConfigAudioEncodingM4A{}, nil
}; return nil, errWireValue
}

type AudioConfigEffectsProfileId = []AudioConfigEffectsProfileIdItem
func encodeAudioConfigEffectsProfileId(value AudioConfigEffectsProfileId) (any, error) {
items := make([]any, len(value)); for index, item := range value { encoded, err := encodeAudioConfigEffectsProfileIdItem(item); if err != nil { return nil, err }; items[index] = encoded }; return items, nil
}
func decodeAudioConfigEffectsProfileId(value any) (AudioConfigEffectsProfileId, error) {
items, ok := value.([]any); if !ok { return nil, errWireValue }; result := make(AudioConfigEffectsProfileId, len(items)); for index, item := range items { decoded, err := decodeAudioConfigEffectsProfileIdItem(item); if err != nil { return nil, err }; result[index] = decoded }; return result, nil
}

type AudioConfigEffectsProfileIdItem = string
func encodeAudioConfigEffectsProfileIdItem(value AudioConfigEffectsProfileIdItem) (any, error) {
if !utf8.ValidString(value) { return nil, errWireValue }; return value, nil
}
func decodeAudioConfigEffectsProfileIdItem(value any) (AudioConfigEffectsProfileIdItem, error) {
decoded, ok := value.(string); if !ok { var zero AudioConfigEffectsProfileIdItem; return zero, errWireValue }; return decoded, nil
}

type AudioConfigPitch = float64
func encodeAudioConfigPitch(value AudioConfigPitch) (any, error) {
if math.IsNaN(value) || math.IsInf(value, 0) { return nil, errWireValue }; return value, nil
}
func decodeAudioConfigPitch(value any) (AudioConfigPitch, error) {
number, ok := value.(json.Number); if !ok { return 0, errWireValue }; decoded, err := number.Float64(); if err != nil || math.IsNaN(decoded) || math.IsInf(decoded, 0) { return 0, errWireValue }; return decoded, nil
}

type AudioConfigSampleRateHertz = int32
func encodeAudioConfigSampleRateHertz(value AudioConfigSampleRateHertz) (any, error) {
return value, nil
}
func decodeAudioConfigSampleRateHertz(value any) (AudioConfigSampleRateHertz, error) {
number, ok := value.(json.Number); if !ok { return 0, errWireValue }; decoded, err := strconv.ParseInt(string(number), 10, 32); if err != nil { return 0, errWireValue }; return int32(decoded), nil
}

type AudioConfigSpeakingRate = float64
func encodeAudioConfigSpeakingRate(value AudioConfigSpeakingRate) (any, error) {
if math.IsNaN(value) || math.IsInf(value, 0) { return nil, errWireValue }; return value, nil
}
func decodeAudioConfigSpeakingRate(value any) (AudioConfigSpeakingRate, error) {
number, ok := value.(json.Number); if !ok { return 0, errWireValue }; decoded, err := number.Float64(); if err != nil || math.IsNaN(decoded) || math.IsInf(decoded, 0) { return 0, errWireValue }; return decoded, nil
}

type AudioConfigVolumeGainDb = float64
func encodeAudioConfigVolumeGainDb(value AudioConfigVolumeGainDb) (any, error) {
if math.IsNaN(value) || math.IsInf(value, 0) { return nil, errWireValue }; return value, nil
}
func decodeAudioConfigVolumeGainDb(value any) (AudioConfigVolumeGainDb, error) {
number, ok := value.(json.Number); if !ok { return 0, errWireValue }; decoded, err := number.Float64(); if err != nil || math.IsNaN(decoded) || math.IsInf(decoded, 0) { return 0, errWireValue }; return decoded, nil
}

type SynthesizeSpeechRequestEnableTimePointing = []SynthesizeSpeechRequestEnableTimePointingItem
func encodeSynthesizeSpeechRequestEnableTimePointing(value SynthesizeSpeechRequestEnableTimePointing) (any, error) {
items := make([]any, len(value)); for index, item := range value { encoded, err := encodeSynthesizeSpeechRequestEnableTimePointingItem(item); if err != nil { return nil, err }; items[index] = encoded }; return items, nil
}
func decodeSynthesizeSpeechRequestEnableTimePointing(value any) (SynthesizeSpeechRequestEnableTimePointing, error) {
items, ok := value.([]any); if !ok { return nil, errWireValue }; result := make(SynthesizeSpeechRequestEnableTimePointing, len(items)); for index, item := range items { decoded, err := decodeSynthesizeSpeechRequestEnableTimePointingItem(item); if err != nil { return nil, err }; result[index] = decoded }; return result, nil
}

type SynthesizeSpeechRequestEnableTimePointingItem interface { isSynthesizeSpeechRequestEnableTimePointingItem() }
type SynthesizeSpeechRequestEnableTimePointingItemTIMEPOINTTYPEUNSPECIFIED struct {}
func (SynthesizeSpeechRequestEnableTimePointingItemTIMEPOINTTYPEUNSPECIFIED) isSynthesizeSpeechRequestEnableTimePointingItem() {}
type SynthesizeSpeechRequestEnableTimePointingItemSSMLMARK struct {}
func (SynthesizeSpeechRequestEnableTimePointingItemSSMLMARK) isSynthesizeSpeechRequestEnableTimePointingItem() {}
func encodeSynthesizeSpeechRequestEnableTimePointingItem(value SynthesizeSpeechRequestEnableTimePointingItem) (any, error) {
switch value := value.(type) {
case SynthesizeSpeechRequestEnableTimePointingItemTIMEPOINTTYPEUNSPECIFIED: return "TIMEPOINT_TYPE_UNSPECIFIED", nil
case *SynthesizeSpeechRequestEnableTimePointingItemTIMEPOINTTYPEUNSPECIFIED: if value != nil { return "TIMEPOINT_TYPE_UNSPECIFIED", nil }
case SynthesizeSpeechRequestEnableTimePointingItemSSMLMARK: return "SSML_MARK", nil
case *SynthesizeSpeechRequestEnableTimePointingItemSSMLMARK: if value != nil { return "SSML_MARK", nil }
}; return nil, errWireValue
}
func decodeSynthesizeSpeechRequestEnableTimePointingItem(value any) (SynthesizeSpeechRequestEnableTimePointingItem, error) {
text, ok := value.(string); if !ok { return nil, errWireValue }; switch text {
case "TIMEPOINT_TYPE_UNSPECIFIED": return SynthesizeSpeechRequestEnableTimePointingItemTIMEPOINTTYPEUNSPECIFIED{}, nil
case "SSML_MARK": return SynthesizeSpeechRequestEnableTimePointingItemSSMLMARK{}, nil
}; return nil, errWireValue
}

type SynthesisInput struct {
CustomPronunciations runtime.Optional[CustomPronunciations]
Markup runtime.Optional[SynthesisInputMarkup]
MultiSpeakerMarkup runtime.Optional[MultiSpeakerMarkup]
Prompt runtime.Optional[SynthesisInputPrompt]
Ssml runtime.Optional[SynthesisInputSsml]
Text runtime.Optional[SynthesisInputText]
}
func encodeSynthesisInput(value SynthesisInput) (any, error) {
object := map[string]any{}
if value.CustomPronunciations.Present {
item, err := encodeCustomPronunciations(value.CustomPronunciations.Value); if err != nil { return nil, err }; object["customPronunciations"] = item
}
if value.Markup.Present {
item, err := encodeSynthesisInputMarkup(value.Markup.Value); if err != nil { return nil, err }; object["markup"] = item
}
if value.MultiSpeakerMarkup.Present {
item, err := encodeMultiSpeakerMarkup(value.MultiSpeakerMarkup.Value); if err != nil { return nil, err }; object["multiSpeakerMarkup"] = item
}
if value.Prompt.Present {
item, err := encodeSynthesisInputPrompt(value.Prompt.Value); if err != nil { return nil, err }; object["prompt"] = item
}
if value.Ssml.Present {
item, err := encodeSynthesisInputSsml(value.Ssml.Value); if err != nil { return nil, err }; object["ssml"] = item
}
if value.Text.Present {
item, err := encodeSynthesisInputText(value.Text.Value); if err != nil { return nil, err }; object["text"] = item
}
return object, nil
}
func decodeSynthesisInput(value any) (SynthesisInput, error) {
var result SynthesisInput; object, ok := value.(map[string]any); if !ok || object == nil { return result, errWireValue }
if item, present := object["customPronunciations"]; present {
decoded, err := decodeCustomPronunciations(item); if err != nil { return SynthesisInput{}, err }; result.CustomPronunciations = runtime.Some(decoded)
}
if item, present := object["markup"]; present {
decoded, err := decodeSynthesisInputMarkup(item); if err != nil { return SynthesisInput{}, err }; result.Markup = runtime.Some(decoded)
}
if item, present := object["multiSpeakerMarkup"]; present {
decoded, err := decodeMultiSpeakerMarkup(item); if err != nil { return SynthesisInput{}, err }; result.MultiSpeakerMarkup = runtime.Some(decoded)
}
if item, present := object["prompt"]; present {
decoded, err := decodeSynthesisInputPrompt(item); if err != nil { return SynthesisInput{}, err }; result.Prompt = runtime.Some(decoded)
}
if item, present := object["ssml"]; present {
decoded, err := decodeSynthesisInputSsml(item); if err != nil { return SynthesisInput{}, err }; result.Ssml = runtime.Some(decoded)
}
if item, present := object["text"]; present {
decoded, err := decodeSynthesisInputText(item); if err != nil { return SynthesisInput{}, err }; result.Text = runtime.Some(decoded)
}
return result, nil
}

type CustomPronunciations struct {
Pronunciations runtime.Optional[CustomPronunciationsPronunciations]
}
func encodeCustomPronunciations(value CustomPronunciations) (any, error) {
object := map[string]any{}
if value.Pronunciations.Present {
item, err := encodeCustomPronunciationsPronunciations(value.Pronunciations.Value); if err != nil { return nil, err }; object["pronunciations"] = item
}
return object, nil
}
func decodeCustomPronunciations(value any) (CustomPronunciations, error) {
var result CustomPronunciations; object, ok := value.(map[string]any); if !ok || object == nil { return result, errWireValue }
if item, present := object["pronunciations"]; present {
decoded, err := decodeCustomPronunciationsPronunciations(item); if err != nil { return CustomPronunciations{}, err }; result.Pronunciations = runtime.Some(decoded)
}
return result, nil
}

type CustomPronunciationsPronunciations = []CustomPronunciationParams
func encodeCustomPronunciationsPronunciations(value CustomPronunciationsPronunciations) (any, error) {
items := make([]any, len(value)); for index, item := range value { encoded, err := encodeCustomPronunciationParams(item); if err != nil { return nil, err }; items[index] = encoded }; return items, nil
}
func decodeCustomPronunciationsPronunciations(value any) (CustomPronunciationsPronunciations, error) {
items, ok := value.([]any); if !ok { return nil, errWireValue }; result := make(CustomPronunciationsPronunciations, len(items)); for index, item := range items { decoded, err := decodeCustomPronunciationParams(item); if err != nil { return nil, err }; result[index] = decoded }; return result, nil
}

type CustomPronunciationParams struct {
PhoneticEncoding runtime.Optional[CustomPronunciationParamsPhoneticEncoding]
Phrase runtime.Optional[CustomPronunciationParamsPhrase]
Pronunciation runtime.Optional[CustomPronunciationParamsPronunciation]
}
func encodeCustomPronunciationParams(value CustomPronunciationParams) (any, error) {
object := map[string]any{}
if value.PhoneticEncoding.Present {
item, err := encodeCustomPronunciationParamsPhoneticEncoding(value.PhoneticEncoding.Value); if err != nil { return nil, err }; object["phoneticEncoding"] = item
}
if value.Phrase.Present {
item, err := encodeCustomPronunciationParamsPhrase(value.Phrase.Value); if err != nil { return nil, err }; object["phrase"] = item
}
if value.Pronunciation.Present {
item, err := encodeCustomPronunciationParamsPronunciation(value.Pronunciation.Value); if err != nil { return nil, err }; object["pronunciation"] = item
}
return object, nil
}
func decodeCustomPronunciationParams(value any) (CustomPronunciationParams, error) {
var result CustomPronunciationParams; object, ok := value.(map[string]any); if !ok || object == nil { return result, errWireValue }
if item, present := object["phoneticEncoding"]; present {
decoded, err := decodeCustomPronunciationParamsPhoneticEncoding(item); if err != nil { return CustomPronunciationParams{}, err }; result.PhoneticEncoding = runtime.Some(decoded)
}
if item, present := object["phrase"]; present {
decoded, err := decodeCustomPronunciationParamsPhrase(item); if err != nil { return CustomPronunciationParams{}, err }; result.Phrase = runtime.Some(decoded)
}
if item, present := object["pronunciation"]; present {
decoded, err := decodeCustomPronunciationParamsPronunciation(item); if err != nil { return CustomPronunciationParams{}, err }; result.Pronunciation = runtime.Some(decoded)
}
return result, nil
}

type CustomPronunciationParamsPhoneticEncoding interface { isCustomPronunciationParamsPhoneticEncoding() }
type CustomPronunciationParamsPhoneticEncodingPHONETICENCODINGUNSPECIFIED struct {}
func (CustomPronunciationParamsPhoneticEncodingPHONETICENCODINGUNSPECIFIED) isCustomPronunciationParamsPhoneticEncoding() {}
type CustomPronunciationParamsPhoneticEncodingPHONETICENCODINGIPA struct {}
func (CustomPronunciationParamsPhoneticEncodingPHONETICENCODINGIPA) isCustomPronunciationParamsPhoneticEncoding() {}
type CustomPronunciationParamsPhoneticEncodingPHONETICENCODINGXSAMPA struct {}
func (CustomPronunciationParamsPhoneticEncodingPHONETICENCODINGXSAMPA) isCustomPronunciationParamsPhoneticEncoding() {}
type CustomPronunciationParamsPhoneticEncodingPHONETICENCODINGJAPANESEYOMIGANA struct {}
func (CustomPronunciationParamsPhoneticEncodingPHONETICENCODINGJAPANESEYOMIGANA) isCustomPronunciationParamsPhoneticEncoding() {}
type CustomPronunciationParamsPhoneticEncodingPHONETICENCODINGPINYIN struct {}
func (CustomPronunciationParamsPhoneticEncodingPHONETICENCODINGPINYIN) isCustomPronunciationParamsPhoneticEncoding() {}
func encodeCustomPronunciationParamsPhoneticEncoding(value CustomPronunciationParamsPhoneticEncoding) (any, error) {
switch value := value.(type) {
case CustomPronunciationParamsPhoneticEncodingPHONETICENCODINGUNSPECIFIED: return "PHONETIC_ENCODING_UNSPECIFIED", nil
case *CustomPronunciationParamsPhoneticEncodingPHONETICENCODINGUNSPECIFIED: if value != nil { return "PHONETIC_ENCODING_UNSPECIFIED", nil }
case CustomPronunciationParamsPhoneticEncodingPHONETICENCODINGIPA: return "PHONETIC_ENCODING_IPA", nil
case *CustomPronunciationParamsPhoneticEncodingPHONETICENCODINGIPA: if value != nil { return "PHONETIC_ENCODING_IPA", nil }
case CustomPronunciationParamsPhoneticEncodingPHONETICENCODINGXSAMPA: return "PHONETIC_ENCODING_X_SAMPA", nil
case *CustomPronunciationParamsPhoneticEncodingPHONETICENCODINGXSAMPA: if value != nil { return "PHONETIC_ENCODING_X_SAMPA", nil }
case CustomPronunciationParamsPhoneticEncodingPHONETICENCODINGJAPANESEYOMIGANA: return "PHONETIC_ENCODING_JAPANESE_YOMIGANA", nil
case *CustomPronunciationParamsPhoneticEncodingPHONETICENCODINGJAPANESEYOMIGANA: if value != nil { return "PHONETIC_ENCODING_JAPANESE_YOMIGANA", nil }
case CustomPronunciationParamsPhoneticEncodingPHONETICENCODINGPINYIN: return "PHONETIC_ENCODING_PINYIN", nil
case *CustomPronunciationParamsPhoneticEncodingPHONETICENCODINGPINYIN: if value != nil { return "PHONETIC_ENCODING_PINYIN", nil }
}; return nil, errWireValue
}
func decodeCustomPronunciationParamsPhoneticEncoding(value any) (CustomPronunciationParamsPhoneticEncoding, error) {
text, ok := value.(string); if !ok { return nil, errWireValue }; switch text {
case "PHONETIC_ENCODING_UNSPECIFIED": return CustomPronunciationParamsPhoneticEncodingPHONETICENCODINGUNSPECIFIED{}, nil
case "PHONETIC_ENCODING_IPA": return CustomPronunciationParamsPhoneticEncodingPHONETICENCODINGIPA{}, nil
case "PHONETIC_ENCODING_X_SAMPA": return CustomPronunciationParamsPhoneticEncodingPHONETICENCODINGXSAMPA{}, nil
case "PHONETIC_ENCODING_JAPANESE_YOMIGANA": return CustomPronunciationParamsPhoneticEncodingPHONETICENCODINGJAPANESEYOMIGANA{}, nil
case "PHONETIC_ENCODING_PINYIN": return CustomPronunciationParamsPhoneticEncodingPHONETICENCODINGPINYIN{}, nil
}; return nil, errWireValue
}

type CustomPronunciationParamsPhrase = string
func encodeCustomPronunciationParamsPhrase(value CustomPronunciationParamsPhrase) (any, error) {
if !utf8.ValidString(value) { return nil, errWireValue }; return value, nil
}
func decodeCustomPronunciationParamsPhrase(value any) (CustomPronunciationParamsPhrase, error) {
decoded, ok := value.(string); if !ok { var zero CustomPronunciationParamsPhrase; return zero, errWireValue }; return decoded, nil
}

type CustomPronunciationParamsPronunciation = string
func encodeCustomPronunciationParamsPronunciation(value CustomPronunciationParamsPronunciation) (any, error) {
if !utf8.ValidString(value) { return nil, errWireValue }; return value, nil
}
func decodeCustomPronunciationParamsPronunciation(value any) (CustomPronunciationParamsPronunciation, error) {
decoded, ok := value.(string); if !ok { var zero CustomPronunciationParamsPronunciation; return zero, errWireValue }; return decoded, nil
}

type SynthesisInputMarkup = string
func encodeSynthesisInputMarkup(value SynthesisInputMarkup) (any, error) {
if !utf8.ValidString(value) { return nil, errWireValue }; return value, nil
}
func decodeSynthesisInputMarkup(value any) (SynthesisInputMarkup, error) {
decoded, ok := value.(string); if !ok { var zero SynthesisInputMarkup; return zero, errWireValue }; return decoded, nil
}

type MultiSpeakerMarkup struct {
Turns runtime.Optional[MultiSpeakerMarkupTurns]
}
func encodeMultiSpeakerMarkup(value MultiSpeakerMarkup) (any, error) {
object := map[string]any{}
if value.Turns.Present {
item, err := encodeMultiSpeakerMarkupTurns(value.Turns.Value); if err != nil { return nil, err }; object["turns"] = item
}
return object, nil
}
func decodeMultiSpeakerMarkup(value any) (MultiSpeakerMarkup, error) {
var result MultiSpeakerMarkup; object, ok := value.(map[string]any); if !ok || object == nil { return result, errWireValue }
if item, present := object["turns"]; present {
decoded, err := decodeMultiSpeakerMarkupTurns(item); if err != nil { return MultiSpeakerMarkup{}, err }; result.Turns = runtime.Some(decoded)
}
return result, nil
}

type MultiSpeakerMarkupTurns = []Turn
func encodeMultiSpeakerMarkupTurns(value MultiSpeakerMarkupTurns) (any, error) {
items := make([]any, len(value)); for index, item := range value { encoded, err := encodeTurn(item); if err != nil { return nil, err }; items[index] = encoded }; return items, nil
}
func decodeMultiSpeakerMarkupTurns(value any) (MultiSpeakerMarkupTurns, error) {
items, ok := value.([]any); if !ok { return nil, errWireValue }; result := make(MultiSpeakerMarkupTurns, len(items)); for index, item := range items { decoded, err := decodeTurn(item); if err != nil { return nil, err }; result[index] = decoded }; return result, nil
}

type Turn struct {
Speaker runtime.Optional[TurnSpeaker]
Text runtime.Optional[TurnText]
}
func encodeTurn(value Turn) (any, error) {
object := map[string]any{}
if value.Speaker.Present {
item, err := encodeTurnSpeaker(value.Speaker.Value); if err != nil { return nil, err }; object["speaker"] = item
}
if value.Text.Present {
item, err := encodeTurnText(value.Text.Value); if err != nil { return nil, err }; object["text"] = item
}
return object, nil
}
func decodeTurn(value any) (Turn, error) {
var result Turn; object, ok := value.(map[string]any); if !ok || object == nil { return result, errWireValue }
if item, present := object["speaker"]; present {
decoded, err := decodeTurnSpeaker(item); if err != nil { return Turn{}, err }; result.Speaker = runtime.Some(decoded)
}
if item, present := object["text"]; present {
decoded, err := decodeTurnText(item); if err != nil { return Turn{}, err }; result.Text = runtime.Some(decoded)
}
return result, nil
}

type TurnSpeaker = string
func encodeTurnSpeaker(value TurnSpeaker) (any, error) {
if !utf8.ValidString(value) { return nil, errWireValue }; return value, nil
}
func decodeTurnSpeaker(value any) (TurnSpeaker, error) {
decoded, ok := value.(string); if !ok { var zero TurnSpeaker; return zero, errWireValue }; return decoded, nil
}

type TurnText = string
func encodeTurnText(value TurnText) (any, error) {
if !utf8.ValidString(value) { return nil, errWireValue }; return value, nil
}
func decodeTurnText(value any) (TurnText, error) {
decoded, ok := value.(string); if !ok { var zero TurnText; return zero, errWireValue }; return decoded, nil
}

type SynthesisInputPrompt = string
func encodeSynthesisInputPrompt(value SynthesisInputPrompt) (any, error) {
if !utf8.ValidString(value) { return nil, errWireValue }; return value, nil
}
func decodeSynthesisInputPrompt(value any) (SynthesisInputPrompt, error) {
decoded, ok := value.(string); if !ok { var zero SynthesisInputPrompt; return zero, errWireValue }; return decoded, nil
}

type SynthesisInputSsml = string
func encodeSynthesisInputSsml(value SynthesisInputSsml) (any, error) {
if !utf8.ValidString(value) { return nil, errWireValue }; return value, nil
}
func decodeSynthesisInputSsml(value any) (SynthesisInputSsml, error) {
decoded, ok := value.(string); if !ok { var zero SynthesisInputSsml; return zero, errWireValue }; return decoded, nil
}

type SynthesisInputText = string
func encodeSynthesisInputText(value SynthesisInputText) (any, error) {
if !utf8.ValidString(value) { return nil, errWireValue }; return value, nil
}
func decodeSynthesisInputText(value any) (SynthesisInputText, error) {
decoded, ok := value.(string); if !ok { var zero SynthesisInputText; return zero, errWireValue }; return decoded, nil
}

type VoiceSelectionParams struct {
CustomVoice runtime.Optional[CustomVoiceParams]
LanguageCode runtime.Optional[VoiceSelectionParamsLanguageCode]
ModelName runtime.Optional[VoiceSelectionParamsModelName]
MultiSpeakerVoiceConfig runtime.Optional[MultiSpeakerVoiceConfig]
Name runtime.Optional[VoiceSelectionParamsName]
SsmlGender runtime.Optional[VoiceSelectionParamsSsmlGender]
VoiceClone runtime.Optional[VoiceCloneParams]
}
func encodeVoiceSelectionParams(value VoiceSelectionParams) (any, error) {
object := map[string]any{}
if value.CustomVoice.Present {
item, err := encodeCustomVoiceParams(value.CustomVoice.Value); if err != nil { return nil, err }; object["customVoice"] = item
}
if value.LanguageCode.Present {
item, err := encodeVoiceSelectionParamsLanguageCode(value.LanguageCode.Value); if err != nil { return nil, err }; object["languageCode"] = item
}
if value.ModelName.Present {
item, err := encodeVoiceSelectionParamsModelName(value.ModelName.Value); if err != nil { return nil, err }; object["modelName"] = item
}
if value.MultiSpeakerVoiceConfig.Present {
item, err := encodeMultiSpeakerVoiceConfig(value.MultiSpeakerVoiceConfig.Value); if err != nil { return nil, err }; object["multiSpeakerVoiceConfig"] = item
}
if value.Name.Present {
item, err := encodeVoiceSelectionParamsName(value.Name.Value); if err != nil { return nil, err }; object["name"] = item
}
if value.SsmlGender.Present {
item, err := encodeVoiceSelectionParamsSsmlGender(value.SsmlGender.Value); if err != nil { return nil, err }; object["ssmlGender"] = item
}
if value.VoiceClone.Present {
item, err := encodeVoiceCloneParams(value.VoiceClone.Value); if err != nil { return nil, err }; object["voiceClone"] = item
}
return object, nil
}
func decodeVoiceSelectionParams(value any) (VoiceSelectionParams, error) {
var result VoiceSelectionParams; object, ok := value.(map[string]any); if !ok || object == nil { return result, errWireValue }
if item, present := object["customVoice"]; present {
decoded, err := decodeCustomVoiceParams(item); if err != nil { return VoiceSelectionParams{}, err }; result.CustomVoice = runtime.Some(decoded)
}
if item, present := object["languageCode"]; present {
decoded, err := decodeVoiceSelectionParamsLanguageCode(item); if err != nil { return VoiceSelectionParams{}, err }; result.LanguageCode = runtime.Some(decoded)
}
if item, present := object["modelName"]; present {
decoded, err := decodeVoiceSelectionParamsModelName(item); if err != nil { return VoiceSelectionParams{}, err }; result.ModelName = runtime.Some(decoded)
}
if item, present := object["multiSpeakerVoiceConfig"]; present {
decoded, err := decodeMultiSpeakerVoiceConfig(item); if err != nil { return VoiceSelectionParams{}, err }; result.MultiSpeakerVoiceConfig = runtime.Some(decoded)
}
if item, present := object["name"]; present {
decoded, err := decodeVoiceSelectionParamsName(item); if err != nil { return VoiceSelectionParams{}, err }; result.Name = runtime.Some(decoded)
}
if item, present := object["ssmlGender"]; present {
decoded, err := decodeVoiceSelectionParamsSsmlGender(item); if err != nil { return VoiceSelectionParams{}, err }; result.SsmlGender = runtime.Some(decoded)
}
if item, present := object["voiceClone"]; present {
decoded, err := decodeVoiceCloneParams(item); if err != nil { return VoiceSelectionParams{}, err }; result.VoiceClone = runtime.Some(decoded)
}
return result, nil
}

type CustomVoiceParams struct {
Model runtime.Optional[CustomVoiceParamsModel]
ReportedUsage runtime.Optional[CustomVoiceParamsReportedUsage]
}
func encodeCustomVoiceParams(value CustomVoiceParams) (any, error) {
object := map[string]any{}
if value.Model.Present {
item, err := encodeCustomVoiceParamsModel(value.Model.Value); if err != nil { return nil, err }; object["model"] = item
}
if value.ReportedUsage.Present {
item, err := encodeCustomVoiceParamsReportedUsage(value.ReportedUsage.Value); if err != nil { return nil, err }; object["reportedUsage"] = item
}
return object, nil
}
func decodeCustomVoiceParams(value any) (CustomVoiceParams, error) {
var result CustomVoiceParams; object, ok := value.(map[string]any); if !ok || object == nil { return result, errWireValue }
if item, present := object["model"]; present {
decoded, err := decodeCustomVoiceParamsModel(item); if err != nil { return CustomVoiceParams{}, err }; result.Model = runtime.Some(decoded)
}
if item, present := object["reportedUsage"]; present {
decoded, err := decodeCustomVoiceParamsReportedUsage(item); if err != nil { return CustomVoiceParams{}, err }; result.ReportedUsage = runtime.Some(decoded)
}
return result, nil
}

type CustomVoiceParamsModel = string
func encodeCustomVoiceParamsModel(value CustomVoiceParamsModel) (any, error) {
if !utf8.ValidString(value) { return nil, errWireValue }; return value, nil
}
func decodeCustomVoiceParamsModel(value any) (CustomVoiceParamsModel, error) {
decoded, ok := value.(string); if !ok { var zero CustomVoiceParamsModel; return zero, errWireValue }; return decoded, nil
}

type CustomVoiceParamsReportedUsage interface { isCustomVoiceParamsReportedUsage() }
type CustomVoiceParamsReportedUsageREPORTEDUSAGEUNSPECIFIED struct {}
func (CustomVoiceParamsReportedUsageREPORTEDUSAGEUNSPECIFIED) isCustomVoiceParamsReportedUsage() {}
type CustomVoiceParamsReportedUsageREALTIME struct {}
func (CustomVoiceParamsReportedUsageREALTIME) isCustomVoiceParamsReportedUsage() {}
type CustomVoiceParamsReportedUsageOFFLINE struct {}
func (CustomVoiceParamsReportedUsageOFFLINE) isCustomVoiceParamsReportedUsage() {}
func encodeCustomVoiceParamsReportedUsage(value CustomVoiceParamsReportedUsage) (any, error) {
switch value := value.(type) {
case CustomVoiceParamsReportedUsageREPORTEDUSAGEUNSPECIFIED: return "REPORTED_USAGE_UNSPECIFIED", nil
case *CustomVoiceParamsReportedUsageREPORTEDUSAGEUNSPECIFIED: if value != nil { return "REPORTED_USAGE_UNSPECIFIED", nil }
case CustomVoiceParamsReportedUsageREALTIME: return "REALTIME", nil
case *CustomVoiceParamsReportedUsageREALTIME: if value != nil { return "REALTIME", nil }
case CustomVoiceParamsReportedUsageOFFLINE: return "OFFLINE", nil
case *CustomVoiceParamsReportedUsageOFFLINE: if value != nil { return "OFFLINE", nil }
}; return nil, errWireValue
}
func decodeCustomVoiceParamsReportedUsage(value any) (CustomVoiceParamsReportedUsage, error) {
text, ok := value.(string); if !ok { return nil, errWireValue }; switch text {
case "REPORTED_USAGE_UNSPECIFIED": return CustomVoiceParamsReportedUsageREPORTEDUSAGEUNSPECIFIED{}, nil
case "REALTIME": return CustomVoiceParamsReportedUsageREALTIME{}, nil
case "OFFLINE": return CustomVoiceParamsReportedUsageOFFLINE{}, nil
}; return nil, errWireValue
}

type VoiceSelectionParamsLanguageCode = string
func encodeVoiceSelectionParamsLanguageCode(value VoiceSelectionParamsLanguageCode) (any, error) {
if !utf8.ValidString(value) { return nil, errWireValue }; return value, nil
}
func decodeVoiceSelectionParamsLanguageCode(value any) (VoiceSelectionParamsLanguageCode, error) {
decoded, ok := value.(string); if !ok { var zero VoiceSelectionParamsLanguageCode; return zero, errWireValue }; return decoded, nil
}

type VoiceSelectionParamsModelName = string
func encodeVoiceSelectionParamsModelName(value VoiceSelectionParamsModelName) (any, error) {
if !utf8.ValidString(value) { return nil, errWireValue }; return value, nil
}
func decodeVoiceSelectionParamsModelName(value any) (VoiceSelectionParamsModelName, error) {
decoded, ok := value.(string); if !ok { var zero VoiceSelectionParamsModelName; return zero, errWireValue }; return decoded, nil
}

type MultiSpeakerVoiceConfig struct {
SpeakerVoiceConfigs runtime.Optional[MultiSpeakerVoiceConfigSpeakerVoiceConfigs]
}
func encodeMultiSpeakerVoiceConfig(value MultiSpeakerVoiceConfig) (any, error) {
object := map[string]any{}
if value.SpeakerVoiceConfigs.Present {
item, err := encodeMultiSpeakerVoiceConfigSpeakerVoiceConfigs(value.SpeakerVoiceConfigs.Value); if err != nil { return nil, err }; object["speakerVoiceConfigs"] = item
}
return object, nil
}
func decodeMultiSpeakerVoiceConfig(value any) (MultiSpeakerVoiceConfig, error) {
var result MultiSpeakerVoiceConfig; object, ok := value.(map[string]any); if !ok || object == nil { return result, errWireValue }
if item, present := object["speakerVoiceConfigs"]; present {
decoded, err := decodeMultiSpeakerVoiceConfigSpeakerVoiceConfigs(item); if err != nil { return MultiSpeakerVoiceConfig{}, err }; result.SpeakerVoiceConfigs = runtime.Some(decoded)
}
return result, nil
}

type MultiSpeakerVoiceConfigSpeakerVoiceConfigs = []MultispeakerPrebuiltVoice
func encodeMultiSpeakerVoiceConfigSpeakerVoiceConfigs(value MultiSpeakerVoiceConfigSpeakerVoiceConfigs) (any, error) {
items := make([]any, len(value)); for index, item := range value { encoded, err := encodeMultispeakerPrebuiltVoice(item); if err != nil { return nil, err }; items[index] = encoded }; return items, nil
}
func decodeMultiSpeakerVoiceConfigSpeakerVoiceConfigs(value any) (MultiSpeakerVoiceConfigSpeakerVoiceConfigs, error) {
items, ok := value.([]any); if !ok { return nil, errWireValue }; result := make(MultiSpeakerVoiceConfigSpeakerVoiceConfigs, len(items)); for index, item := range items { decoded, err := decodeMultispeakerPrebuiltVoice(item); if err != nil { return nil, err }; result[index] = decoded }; return result, nil
}

type MultispeakerPrebuiltVoice struct {
SpeakerAlias runtime.Optional[MultispeakerPrebuiltVoiceSpeakerAlias]
SpeakerId runtime.Optional[MultispeakerPrebuiltVoiceSpeakerId]
}
func encodeMultispeakerPrebuiltVoice(value MultispeakerPrebuiltVoice) (any, error) {
object := map[string]any{}
if value.SpeakerAlias.Present {
item, err := encodeMultispeakerPrebuiltVoiceSpeakerAlias(value.SpeakerAlias.Value); if err != nil { return nil, err }; object["speakerAlias"] = item
}
if value.SpeakerId.Present {
item, err := encodeMultispeakerPrebuiltVoiceSpeakerId(value.SpeakerId.Value); if err != nil { return nil, err }; object["speakerId"] = item
}
return object, nil
}
func decodeMultispeakerPrebuiltVoice(value any) (MultispeakerPrebuiltVoice, error) {
var result MultispeakerPrebuiltVoice; object, ok := value.(map[string]any); if !ok || object == nil { return result, errWireValue }
if item, present := object["speakerAlias"]; present {
decoded, err := decodeMultispeakerPrebuiltVoiceSpeakerAlias(item); if err != nil { return MultispeakerPrebuiltVoice{}, err }; result.SpeakerAlias = runtime.Some(decoded)
}
if item, present := object["speakerId"]; present {
decoded, err := decodeMultispeakerPrebuiltVoiceSpeakerId(item); if err != nil { return MultispeakerPrebuiltVoice{}, err }; result.SpeakerId = runtime.Some(decoded)
}
return result, nil
}

type MultispeakerPrebuiltVoiceSpeakerAlias = string
func encodeMultispeakerPrebuiltVoiceSpeakerAlias(value MultispeakerPrebuiltVoiceSpeakerAlias) (any, error) {
if !utf8.ValidString(value) { return nil, errWireValue }; return value, nil
}
func decodeMultispeakerPrebuiltVoiceSpeakerAlias(value any) (MultispeakerPrebuiltVoiceSpeakerAlias, error) {
decoded, ok := value.(string); if !ok { var zero MultispeakerPrebuiltVoiceSpeakerAlias; return zero, errWireValue }; return decoded, nil
}

type MultispeakerPrebuiltVoiceSpeakerId = string
func encodeMultispeakerPrebuiltVoiceSpeakerId(value MultispeakerPrebuiltVoiceSpeakerId) (any, error) {
if !utf8.ValidString(value) { return nil, errWireValue }; return value, nil
}
func decodeMultispeakerPrebuiltVoiceSpeakerId(value any) (MultispeakerPrebuiltVoiceSpeakerId, error) {
decoded, ok := value.(string); if !ok { var zero MultispeakerPrebuiltVoiceSpeakerId; return zero, errWireValue }; return decoded, nil
}

type VoiceSelectionParamsName = string
func encodeVoiceSelectionParamsName(value VoiceSelectionParamsName) (any, error) {
if !utf8.ValidString(value) { return nil, errWireValue }; return value, nil
}
func decodeVoiceSelectionParamsName(value any) (VoiceSelectionParamsName, error) {
decoded, ok := value.(string); if !ok { var zero VoiceSelectionParamsName; return zero, errWireValue }; return decoded, nil
}

type VoiceSelectionParamsSsmlGender interface { isVoiceSelectionParamsSsmlGender() }
type VoiceSelectionParamsSsmlGenderSSMLVOICEGENDERUNSPECIFIED struct {}
func (VoiceSelectionParamsSsmlGenderSSMLVOICEGENDERUNSPECIFIED) isVoiceSelectionParamsSsmlGender() {}
type VoiceSelectionParamsSsmlGenderMALE struct {}
func (VoiceSelectionParamsSsmlGenderMALE) isVoiceSelectionParamsSsmlGender() {}
type VoiceSelectionParamsSsmlGenderFEMALE struct {}
func (VoiceSelectionParamsSsmlGenderFEMALE) isVoiceSelectionParamsSsmlGender() {}
type VoiceSelectionParamsSsmlGenderNEUTRAL struct {}
func (VoiceSelectionParamsSsmlGenderNEUTRAL) isVoiceSelectionParamsSsmlGender() {}
func encodeVoiceSelectionParamsSsmlGender(value VoiceSelectionParamsSsmlGender) (any, error) {
switch value := value.(type) {
case VoiceSelectionParamsSsmlGenderSSMLVOICEGENDERUNSPECIFIED: return "SSML_VOICE_GENDER_UNSPECIFIED", nil
case *VoiceSelectionParamsSsmlGenderSSMLVOICEGENDERUNSPECIFIED: if value != nil { return "SSML_VOICE_GENDER_UNSPECIFIED", nil }
case VoiceSelectionParamsSsmlGenderMALE: return "MALE", nil
case *VoiceSelectionParamsSsmlGenderMALE: if value != nil { return "MALE", nil }
case VoiceSelectionParamsSsmlGenderFEMALE: return "FEMALE", nil
case *VoiceSelectionParamsSsmlGenderFEMALE: if value != nil { return "FEMALE", nil }
case VoiceSelectionParamsSsmlGenderNEUTRAL: return "NEUTRAL", nil
case *VoiceSelectionParamsSsmlGenderNEUTRAL: if value != nil { return "NEUTRAL", nil }
}; return nil, errWireValue
}
func decodeVoiceSelectionParamsSsmlGender(value any) (VoiceSelectionParamsSsmlGender, error) {
text, ok := value.(string); if !ok { return nil, errWireValue }; switch text {
case "SSML_VOICE_GENDER_UNSPECIFIED": return VoiceSelectionParamsSsmlGenderSSMLVOICEGENDERUNSPECIFIED{}, nil
case "MALE": return VoiceSelectionParamsSsmlGenderMALE{}, nil
case "FEMALE": return VoiceSelectionParamsSsmlGenderFEMALE{}, nil
case "NEUTRAL": return VoiceSelectionParamsSsmlGenderNEUTRAL{}, nil
}; return nil, errWireValue
}

type VoiceCloneParams struct {
VoiceCloningKey runtime.Optional[VoiceCloneParamsVoiceCloningKey]
}
func encodeVoiceCloneParams(value VoiceCloneParams) (any, error) {
object := map[string]any{}
if value.VoiceCloningKey.Present {
item, err := encodeVoiceCloneParamsVoiceCloningKey(value.VoiceCloningKey.Value); if err != nil { return nil, err }; object["voiceCloningKey"] = item
}
return object, nil
}
func decodeVoiceCloneParams(value any) (VoiceCloneParams, error) {
var result VoiceCloneParams; object, ok := value.(map[string]any); if !ok || object == nil { return result, errWireValue }
if item, present := object["voiceCloningKey"]; present {
decoded, err := decodeVoiceCloneParamsVoiceCloningKey(item); if err != nil { return VoiceCloneParams{}, err }; result.VoiceCloningKey = runtime.Some(decoded)
}
return result, nil
}

type VoiceCloneParamsVoiceCloningKey = string
func encodeVoiceCloneParamsVoiceCloningKey(value VoiceCloneParamsVoiceCloningKey) (any, error) {
if !utf8.ValidString(value) { return nil, errWireValue }; return value, nil
}
func decodeVoiceCloneParamsVoiceCloningKey(value any) (VoiceCloneParamsVoiceCloningKey, error) {
decoded, ok := value.(string); if !ok { var zero VoiceCloneParamsVoiceCloningKey; return zero, errWireValue }; return decoded, nil
}

type SynthesizeSpeechResponse struct {
AudioConfig runtime.Optional[AudioConfig]
AudioContent runtime.Optional[SynthesizeSpeechResponseAudioContent]
Timepoints runtime.Optional[SynthesizeSpeechResponseTimepoints]
}
func encodeSynthesizeSpeechResponse(value SynthesizeSpeechResponse) (any, error) {
object := map[string]any{}
if value.AudioConfig.Present {
item, err := encodeAudioConfig(value.AudioConfig.Value); if err != nil { return nil, err }; object["audioConfig"] = item
}
if value.AudioContent.Present {
item, err := encodeSynthesizeSpeechResponseAudioContent(value.AudioContent.Value); if err != nil { return nil, err }; object["audioContent"] = item
}
if value.Timepoints.Present {
item, err := encodeSynthesizeSpeechResponseTimepoints(value.Timepoints.Value); if err != nil { return nil, err }; object["timepoints"] = item
}
return object, nil
}
func decodeSynthesizeSpeechResponse(value any) (SynthesizeSpeechResponse, error) {
var result SynthesizeSpeechResponse; object, ok := value.(map[string]any); if !ok || object == nil { return result, errWireValue }
if item, present := object["audioConfig"]; present {
decoded, err := decodeAudioConfig(item); if err != nil { return SynthesizeSpeechResponse{}, err }; result.AudioConfig = runtime.Some(decoded)
}
if item, present := object["audioContent"]; present {
decoded, err := decodeSynthesizeSpeechResponseAudioContent(item); if err != nil { return SynthesizeSpeechResponse{}, err }; result.AudioContent = runtime.Some(decoded)
}
if item, present := object["timepoints"]; present {
decoded, err := decodeSynthesizeSpeechResponseTimepoints(item); if err != nil { return SynthesizeSpeechResponse{}, err }; result.Timepoints = runtime.Some(decoded)
}
return result, nil
}

type SynthesizeSpeechResponseAudioContent = string
func encodeSynthesizeSpeechResponseAudioContent(value SynthesizeSpeechResponseAudioContent) (any, error) {
if !utf8.ValidString(value) { return nil, errWireValue }; return value, nil
}
func decodeSynthesizeSpeechResponseAudioContent(value any) (SynthesizeSpeechResponseAudioContent, error) {
decoded, ok := value.(string); if !ok { var zero SynthesizeSpeechResponseAudioContent; return zero, errWireValue }; return decoded, nil
}

type SynthesizeSpeechResponseTimepoints = []Timepoint
func encodeSynthesizeSpeechResponseTimepoints(value SynthesizeSpeechResponseTimepoints) (any, error) {
items := make([]any, len(value)); for index, item := range value { encoded, err := encodeTimepoint(item); if err != nil { return nil, err }; items[index] = encoded }; return items, nil
}
func decodeSynthesizeSpeechResponseTimepoints(value any) (SynthesizeSpeechResponseTimepoints, error) {
items, ok := value.([]any); if !ok { return nil, errWireValue }; result := make(SynthesizeSpeechResponseTimepoints, len(items)); for index, item := range items { decoded, err := decodeTimepoint(item); if err != nil { return nil, err }; result[index] = decoded }; return result, nil
}

type Timepoint struct {
MarkName runtime.Optional[TimepointMarkName]
TimeSeconds runtime.Optional[TimepointTimeSeconds]
}
func encodeTimepoint(value Timepoint) (any, error) {
object := map[string]any{}
if value.MarkName.Present {
item, err := encodeTimepointMarkName(value.MarkName.Value); if err != nil { return nil, err }; object["markName"] = item
}
if value.TimeSeconds.Present {
item, err := encodeTimepointTimeSeconds(value.TimeSeconds.Value); if err != nil { return nil, err }; object["timeSeconds"] = item
}
return object, nil
}
func decodeTimepoint(value any) (Timepoint, error) {
var result Timepoint; object, ok := value.(map[string]any); if !ok || object == nil { return result, errWireValue }
if item, present := object["markName"]; present {
decoded, err := decodeTimepointMarkName(item); if err != nil { return Timepoint{}, err }; result.MarkName = runtime.Some(decoded)
}
if item, present := object["timeSeconds"]; present {
decoded, err := decodeTimepointTimeSeconds(item); if err != nil { return Timepoint{}, err }; result.TimeSeconds = runtime.Some(decoded)
}
return result, nil
}

type TimepointMarkName = string
func encodeTimepointMarkName(value TimepointMarkName) (any, error) {
if !utf8.ValidString(value) { return nil, errWireValue }; return value, nil
}
func decodeTimepointMarkName(value any) (TimepointMarkName, error) {
decoded, ok := value.(string); if !ok { var zero TimepointMarkName; return zero, errWireValue }; return decoded, nil
}

type TimepointTimeSeconds = float64
func encodeTimepointTimeSeconds(value TimepointTimeSeconds) (any, error) {
if math.IsNaN(value) || math.IsInf(value, 0) { return nil, errWireValue }; return value, nil
}
func decodeTimepointTimeSeconds(value any) (TimepointTimeSeconds, error) {
number, ok := value.(json.Number); if !ok { return 0, errWireValue }; decoded, err := number.Float64(); if err != nil || math.IsNaN(decoded) || math.IsInf(decoded, 0) { return 0, errWireValue }; return decoded, nil
}

type ListVoicesInput struct {
LanguageCode runtime.Optional[ListVoicesInputLanguageCode]
}
func encodeListVoicesInput(value ListVoicesInput) (any, error) {
object := map[string]any{}
if value.LanguageCode.Present {
item, err := encodeListVoicesInputLanguageCode(value.LanguageCode.Value); if err != nil { return nil, err }; object["languageCode"] = item
}
return object, nil
}
func decodeListVoicesInput(value any) (ListVoicesInput, error) {
var result ListVoicesInput; object, ok := value.(map[string]any); if !ok || object == nil { return result, errWireValue }
if item, present := object["languageCode"]; present {
decoded, err := decodeListVoicesInputLanguageCode(item); if err != nil { return ListVoicesInput{}, err }; result.LanguageCode = runtime.Some(decoded)
}
return result, nil
}

type ListVoicesInputLanguageCode = string
func encodeListVoicesInputLanguageCode(value ListVoicesInputLanguageCode) (any, error) {
if !utf8.ValidString(value) { return nil, errWireValue }; return value, nil
}
func decodeListVoicesInputLanguageCode(value any) (ListVoicesInputLanguageCode, error) {
decoded, ok := value.(string); if !ok { var zero ListVoicesInputLanguageCode; return zero, errWireValue }; return decoded, nil
}

type ListVoicesResponse struct {
Voices runtime.Optional[ListVoicesResponseVoices]
}
func encodeListVoicesResponse(value ListVoicesResponse) (any, error) {
object := map[string]any{}
if value.Voices.Present {
item, err := encodeListVoicesResponseVoices(value.Voices.Value); if err != nil { return nil, err }; object["voices"] = item
}
return object, nil
}
func decodeListVoicesResponse(value any) (ListVoicesResponse, error) {
var result ListVoicesResponse; object, ok := value.(map[string]any); if !ok || object == nil { return result, errWireValue }
if item, present := object["voices"]; present {
decoded, err := decodeListVoicesResponseVoices(item); if err != nil { return ListVoicesResponse{}, err }; result.Voices = runtime.Some(decoded)
}
return result, nil
}

type ListVoicesResponseVoices = []Voice
func encodeListVoicesResponseVoices(value ListVoicesResponseVoices) (any, error) {
items := make([]any, len(value)); for index, item := range value { encoded, err := encodeVoice(item); if err != nil { return nil, err }; items[index] = encoded }; return items, nil
}
func decodeListVoicesResponseVoices(value any) (ListVoicesResponseVoices, error) {
items, ok := value.([]any); if !ok { return nil, errWireValue }; result := make(ListVoicesResponseVoices, len(items)); for index, item := range items { decoded, err := decodeVoice(item); if err != nil { return nil, err }; result[index] = decoded }; return result, nil
}

type Voice struct {
LanguageCodes runtime.Optional[VoiceLanguageCodes]
Name runtime.Optional[VoiceName]
NaturalSampleRateHertz runtime.Optional[VoiceNaturalSampleRateHertz]
SsmlGender runtime.Optional[VoiceSsmlGender]
}
func encodeVoice(value Voice) (any, error) {
object := map[string]any{}
if value.LanguageCodes.Present {
item, err := encodeVoiceLanguageCodes(value.LanguageCodes.Value); if err != nil { return nil, err }; object["languageCodes"] = item
}
if value.Name.Present {
item, err := encodeVoiceName(value.Name.Value); if err != nil { return nil, err }; object["name"] = item
}
if value.NaturalSampleRateHertz.Present {
item, err := encodeVoiceNaturalSampleRateHertz(value.NaturalSampleRateHertz.Value); if err != nil { return nil, err }; object["naturalSampleRateHertz"] = item
}
if value.SsmlGender.Present {
item, err := encodeVoiceSsmlGender(value.SsmlGender.Value); if err != nil { return nil, err }; object["ssmlGender"] = item
}
return object, nil
}
func decodeVoice(value any) (Voice, error) {
var result Voice; object, ok := value.(map[string]any); if !ok || object == nil { return result, errWireValue }
if item, present := object["languageCodes"]; present {
decoded, err := decodeVoiceLanguageCodes(item); if err != nil { return Voice{}, err }; result.LanguageCodes = runtime.Some(decoded)
}
if item, present := object["name"]; present {
decoded, err := decodeVoiceName(item); if err != nil { return Voice{}, err }; result.Name = runtime.Some(decoded)
}
if item, present := object["naturalSampleRateHertz"]; present {
decoded, err := decodeVoiceNaturalSampleRateHertz(item); if err != nil { return Voice{}, err }; result.NaturalSampleRateHertz = runtime.Some(decoded)
}
if item, present := object["ssmlGender"]; present {
decoded, err := decodeVoiceSsmlGender(item); if err != nil { return Voice{}, err }; result.SsmlGender = runtime.Some(decoded)
}
return result, nil
}

type VoiceLanguageCodes = []VoiceLanguageCodesItem
func encodeVoiceLanguageCodes(value VoiceLanguageCodes) (any, error) {
items := make([]any, len(value)); for index, item := range value { encoded, err := encodeVoiceLanguageCodesItem(item); if err != nil { return nil, err }; items[index] = encoded }; return items, nil
}
func decodeVoiceLanguageCodes(value any) (VoiceLanguageCodes, error) {
items, ok := value.([]any); if !ok { return nil, errWireValue }; result := make(VoiceLanguageCodes, len(items)); for index, item := range items { decoded, err := decodeVoiceLanguageCodesItem(item); if err != nil { return nil, err }; result[index] = decoded }; return result, nil
}

type VoiceLanguageCodesItem = string
func encodeVoiceLanguageCodesItem(value VoiceLanguageCodesItem) (any, error) {
if !utf8.ValidString(value) { return nil, errWireValue }; return value, nil
}
func decodeVoiceLanguageCodesItem(value any) (VoiceLanguageCodesItem, error) {
decoded, ok := value.(string); if !ok { var zero VoiceLanguageCodesItem; return zero, errWireValue }; return decoded, nil
}

type VoiceName = string
func encodeVoiceName(value VoiceName) (any, error) {
if !utf8.ValidString(value) { return nil, errWireValue }; return value, nil
}
func decodeVoiceName(value any) (VoiceName, error) {
decoded, ok := value.(string); if !ok { var zero VoiceName; return zero, errWireValue }; return decoded, nil
}

type VoiceNaturalSampleRateHertz = int32
func encodeVoiceNaturalSampleRateHertz(value VoiceNaturalSampleRateHertz) (any, error) {
return value, nil
}
func decodeVoiceNaturalSampleRateHertz(value any) (VoiceNaturalSampleRateHertz, error) {
number, ok := value.(json.Number); if !ok { return 0, errWireValue }; decoded, err := strconv.ParseInt(string(number), 10, 32); if err != nil { return 0, errWireValue }; return int32(decoded), nil
}

type VoiceSsmlGender interface { isVoiceSsmlGender() }
type VoiceSsmlGenderSSMLVOICEGENDERUNSPECIFIED struct {}
func (VoiceSsmlGenderSSMLVOICEGENDERUNSPECIFIED) isVoiceSsmlGender() {}
type VoiceSsmlGenderMALE struct {}
func (VoiceSsmlGenderMALE) isVoiceSsmlGender() {}
type VoiceSsmlGenderFEMALE struct {}
func (VoiceSsmlGenderFEMALE) isVoiceSsmlGender() {}
type VoiceSsmlGenderNEUTRAL struct {}
func (VoiceSsmlGenderNEUTRAL) isVoiceSsmlGender() {}
func encodeVoiceSsmlGender(value VoiceSsmlGender) (any, error) {
switch value := value.(type) {
case VoiceSsmlGenderSSMLVOICEGENDERUNSPECIFIED: return "SSML_VOICE_GENDER_UNSPECIFIED", nil
case *VoiceSsmlGenderSSMLVOICEGENDERUNSPECIFIED: if value != nil { return "SSML_VOICE_GENDER_UNSPECIFIED", nil }
case VoiceSsmlGenderMALE: return "MALE", nil
case *VoiceSsmlGenderMALE: if value != nil { return "MALE", nil }
case VoiceSsmlGenderFEMALE: return "FEMALE", nil
case *VoiceSsmlGenderFEMALE: if value != nil { return "FEMALE", nil }
case VoiceSsmlGenderNEUTRAL: return "NEUTRAL", nil
case *VoiceSsmlGenderNEUTRAL: if value != nil { return "NEUTRAL", nil }
}; return nil, errWireValue
}
func decodeVoiceSsmlGender(value any) (VoiceSsmlGender, error) {
text, ok := value.(string); if !ok { return nil, errWireValue }; switch text {
case "SSML_VOICE_GENDER_UNSPECIFIED": return VoiceSsmlGenderSSMLVOICEGENDERUNSPECIFIED{}, nil
case "MALE": return VoiceSsmlGenderMALE{}, nil
case "FEMALE": return VoiceSsmlGenderFEMALE{}, nil
case "NEUTRAL": return VoiceSsmlGenderNEUTRAL{}, nil
}; return nil, errWireValue
}

func SynthesizeSpeech(ctx context.Context, value SynthesizeSpeechRequest, options ClientOptions) (*http.Response, error) {
object, err := encodeSynthesizeSpeechRequest(value); if err != nil { return nil, errors.New("Invalid Google synthesizeSpeech input") }
target, err := url.Parse(options.BaseURL)
if err != nil || target.Hostname() == "" || target.User != nil || target.Fragment != "" || target.Opaque != "" || (target.Scheme != "http" && target.Scheme != "https") { return nil, errors.New("Google BaseURL must be an HTTP(S) URL without credentials or a fragment") }
query, err := url.ParseQuery(target.RawQuery); if err != nil { return nil, errors.New("Invalid Google query string") }
target.RawPath = strings.TrimSuffix(target.EscapedPath(), "/") + "/v1beta1/text:synthesize"
target.Path = strings.TrimSuffix(target.Path, "/") + "/v1beta1/text:synthesize"
target.RawQuery = query.Encode()
var body []byte
body, err = json.Marshal(object); if err != nil { return nil, err }
request, err := http.NewRequestWithContext(ctx, "POST", target.String(), bytes.NewReader(body)); if err != nil { return nil, err }
request.Header = make(http.Header)
for key, values := range options.Headers { for _, value := range values { request.Header.Add(key, value) } }
request.Header.Set("Content-Type", "application/json")
if options.Transport == nil { return nil, errors.New("Google HTTP transport is required") }
return options.Transport.Do(request)
}

func DecodeSynthesizeSpeechResponse(data []byte) (SynthesizeSpeechResponse, error) {
var zero SynthesizeSpeechResponse
if !runtime.ValidUTF8JSON(data) { return zero, errors.New("Invalid Google synthesizeSpeech response") }
decoder := json.NewDecoder(bytes.NewReader(data)); decoder.UseNumber(); var raw any
if err := decoder.Decode(&raw); err != nil { return zero, errors.New("Invalid Google synthesizeSpeech response") }
value, err := decodeSynthesizeSpeechResponse(raw); if err != nil { return zero, errors.New("Invalid Google synthesizeSpeech response") }; return value, nil
}

func ListVoices(ctx context.Context, value ListVoicesInput, options ClientOptions) (*http.Response, error) {
object, err := encodeListVoicesInput(value); if err != nil { return nil, errors.New("Invalid Google listVoices input") }
target, err := url.Parse(options.BaseURL)
if err != nil || target.Hostname() == "" || target.User != nil || target.Fragment != "" || target.Opaque != "" || (target.Scheme != "http" && target.Scheme != "https") { return nil, errors.New("Google BaseURL must be an HTTP(S) URL without credentials or a fragment") }
query, err := url.ParseQuery(target.RawQuery); if err != nil { return nil, errors.New("Invalid Google query string") }
fields := object.(map[string]any)
if item, present := fields["languageCode"]; present { query.Set("languageCode", fmt.Sprint(item)) }
target.RawPath = strings.TrimSuffix(target.EscapedPath(), "/") + "/v1beta1/voices"
target.Path = strings.TrimSuffix(target.Path, "/") + "/v1beta1/voices"
target.RawQuery = query.Encode()
var body []byte
request, err := http.NewRequestWithContext(ctx, "GET", target.String(), bytes.NewReader(body)); if err != nil { return nil, err }
request.Header = make(http.Header)
for key, values := range options.Headers { for _, value := range values { request.Header.Add(key, value) } }
if options.Transport == nil { return nil, errors.New("Google HTTP transport is required") }
return options.Transport.Do(request)
}

func DecodeListVoicesResponse(data []byte) (ListVoicesResponse, error) {
var zero ListVoicesResponse
if !runtime.ValidUTF8JSON(data) { return zero, errors.New("Invalid Google listVoices response") }
decoder := json.NewDecoder(bytes.NewReader(data)); decoder.UseNumber(); var raw any
if err := decoder.Decode(&raw); err != nil { return zero, errors.New("Invalid Google listVoices response") }
value, err := decodeListVoicesResponse(raw); if err != nil { return zero, errors.New("Invalid Google listVoices response") }; return value, nil
}

