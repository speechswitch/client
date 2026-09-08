package google

import (
	proto "github.com/speechswitch/client/sdks/go/clients/google_grpc"
	beta "github.com/speechswitch/client/sdks/go/clients/google_grpc_beta"
	rest "github.com/speechswitch/client/sdks/go/clients/google_rest"
	restbeta "github.com/speechswitch/client/sdks/go/clients/google_rest_beta"
	"github.com/speechswitch/client/sdks/go/runtime"
)

var protoEncodings = map[string]proto.AudioEncoding{
	"LINEAR16": proto.AudioEncoding_LINEAR16{},
	"MP3":      proto.AudioEncoding_MP3{},
	"OGG_OPUS": proto.AudioEncoding_OGG_OPUS{},
	"MULAW":    proto.AudioEncoding_MULAW{},
	"ALAW":     proto.AudioEncoding_ALAW{},
	"PCM":      proto.AudioEncoding_PCM{},
}
var protoPhonetics = map[string]proto.CustomPronunciationParamsPhoneticEncoding{
	"ipa":               proto.CustomPronunciationParamsPhoneticEncoding_PHONETIC_ENCODING_IPA{},
	"x_sampa":           proto.CustomPronunciationParamsPhoneticEncoding_PHONETIC_ENCODING_X_SAMPA{},
	"japanese_yomigana": proto.CustomPronunciationParamsPhoneticEncoding_PHONETIC_ENCODING_JAPANESE_YOMIGANA{},
	"pinyin":            proto.CustomPronunciationParamsPhoneticEncoding_PHONETIC_ENCODING_PINYIN{},
}

func (c configuration) protoReplacements() runtime.Optional[proto.CustomPronunciations] {
	if !c.Replacements.Present {
		return runtime.Optional[proto.CustomPronunciations]{}
	}
	items := make([]proto.CustomPronunciationParams, 0, len(c.Replacements.Value))
	for _, item := range c.Replacements.Value {
		items = append(items, proto.CustomPronunciationParams{Phrase: runtime.Some(item.Pattern), Pronunciation: runtime.Some(item.Replacement), PhoneticEncoding: runtime.Some(protoPhonetics[item.Alphabet.LiteralValue()])})
	}
	return runtime.Some(proto.CustomPronunciations{Pronunciations: items})
}

var betaEncodings = map[string]beta.AudioEncoding{
	"LINEAR16": beta.AudioEncoding_LINEAR16{},
	"MP3":      beta.AudioEncoding_MP3{},
	"OGG_OPUS": beta.AudioEncoding_OGG_OPUS{},
	"MULAW":    beta.AudioEncoding_MULAW{},
	"ALAW":     beta.AudioEncoding_ALAW{},
	"PCM":      beta.AudioEncoding_PCM{},
}
var betaPhonetics = map[string]beta.CustomPronunciationParamsPhoneticEncoding{
	"ipa":               beta.CustomPronunciationParamsPhoneticEncoding_PHONETIC_ENCODING_IPA{},
	"x_sampa":           beta.CustomPronunciationParamsPhoneticEncoding_PHONETIC_ENCODING_X_SAMPA{},
	"japanese_yomigana": beta.CustomPronunciationParamsPhoneticEncoding_PHONETIC_ENCODING_JAPANESE_YOMIGANA{},
	"pinyin":            beta.CustomPronunciationParamsPhoneticEncoding_PHONETIC_ENCODING_PINYIN{},
}

func (c configuration) betaReplacements() runtime.Optional[beta.CustomPronunciations] {
	if !c.Replacements.Present {
		return runtime.Optional[beta.CustomPronunciations]{}
	}
	items := make([]beta.CustomPronunciationParams, 0, len(c.Replacements.Value))
	for _, item := range c.Replacements.Value {
		items = append(items, beta.CustomPronunciationParams{Phrase: runtime.Some(item.Pattern), Pronunciation: runtime.Some(item.Replacement), PhoneticEncoding: runtime.Some(betaPhonetics[item.Alphabet.LiteralValue()])})
	}
	return runtime.Some(beta.CustomPronunciations{Pronunciations: items})
}

var restEncodings = map[string]rest.AudioConfigAudioEncoding{
	"LINEAR16": rest.AudioConfigAudioEncodingLINEAR16{},
	"MP3":      rest.AudioConfigAudioEncodingMP3{},
	"OGG_OPUS": rest.AudioConfigAudioEncodingOGGOPUS{},
	"MULAW":    rest.AudioConfigAudioEncodingMULAW{},
	"ALAW":     rest.AudioConfigAudioEncodingALAW{},
	"PCM":      rest.AudioConfigAudioEncodingPCM{},
}
var restPhonetics = map[string]rest.CustomPronunciationParamsPhoneticEncoding{
	"ipa":               rest.CustomPronunciationParamsPhoneticEncodingPHONETICENCODINGIPA{},
	"x_sampa":           rest.CustomPronunciationParamsPhoneticEncodingPHONETICENCODINGXSAMPA{},
	"japanese_yomigana": rest.CustomPronunciationParamsPhoneticEncodingPHONETICENCODINGJAPANESEYOMIGANA{},
	"pinyin":            rest.CustomPronunciationParamsPhoneticEncodingPHONETICENCODINGPINYIN{},
}

func (c configuration) restReplacements() runtime.Optional[rest.CustomPronunciations] {
	if !c.Replacements.Present {
		return runtime.Optional[rest.CustomPronunciations]{}
	}
	items := make([]rest.CustomPronunciationParams, 0, len(c.Replacements.Value))
	for _, item := range c.Replacements.Value {
		items = append(items, rest.CustomPronunciationParams{Phrase: runtime.Some(item.Pattern), Pronunciation: runtime.Some(item.Replacement), PhoneticEncoding: runtime.Some(restPhonetics[item.Alphabet.LiteralValue()])})
	}
	return runtime.Some(rest.CustomPronunciations{Pronunciations: runtime.Some(items)})
}

var restbetaEncodings = map[string]restbeta.AudioConfigAudioEncoding{
	"LINEAR16": restbeta.AudioConfigAudioEncodingLINEAR16{},
	"MP3":      restbeta.AudioConfigAudioEncodingMP3{},
	"OGG_OPUS": restbeta.AudioConfigAudioEncodingOGGOPUS{},
	"MULAW":    restbeta.AudioConfigAudioEncodingMULAW{},
	"ALAW":     restbeta.AudioConfigAudioEncodingALAW{},
	"PCM":      restbeta.AudioConfigAudioEncodingPCM{},
}
var restbetaPhonetics = map[string]restbeta.CustomPronunciationParamsPhoneticEncoding{
	"ipa":               restbeta.CustomPronunciationParamsPhoneticEncodingPHONETICENCODINGIPA{},
	"x_sampa":           restbeta.CustomPronunciationParamsPhoneticEncodingPHONETICENCODINGXSAMPA{},
	"japanese_yomigana": restbeta.CustomPronunciationParamsPhoneticEncodingPHONETICENCODINGJAPANESEYOMIGANA{},
	"pinyin":            restbeta.CustomPronunciationParamsPhoneticEncodingPHONETICENCODINGPINYIN{},
}

func (c configuration) restbetaReplacements() runtime.Optional[restbeta.CustomPronunciations] {
	if !c.Replacements.Present {
		return runtime.Optional[restbeta.CustomPronunciations]{}
	}
	items := make([]restbeta.CustomPronunciationParams, 0, len(c.Replacements.Value))
	for _, item := range c.Replacements.Value {
		items = append(items, restbeta.CustomPronunciationParams{Phrase: runtime.Some(item.Pattern), Pronunciation: runtime.Some(item.Replacement), PhoneticEncoding: runtime.Some(restbetaPhonetics[item.Alphabet.LiteralValue()])})
	}
	return runtime.Some(restbeta.CustomPronunciations{Pronunciations: runtime.Some(items)})
}

var protoCategories = map[string]proto.AdvancedVoiceOptionsHarmCategory{
	"hate_speech":       proto.AdvancedVoiceOptionsHarmCategory_HARM_CATEGORY_HATE_SPEECH{},
	"dangerous_content": proto.AdvancedVoiceOptionsHarmCategory_HARM_CATEGORY_DANGEROUS_CONTENT{},
	"harassment":        proto.AdvancedVoiceOptionsHarmCategory_HARM_CATEGORY_HARASSMENT{},
	"sexually_explicit": proto.AdvancedVoiceOptionsHarmCategory_HARM_CATEGORY_SEXUALLY_EXPLICIT{},
}
var protoThresholds = map[string]proto.AdvancedVoiceOptionsHarmBlockThreshold{
	"low":    proto.AdvancedVoiceOptionsHarmBlockThreshold_BLOCK_LOW_AND_ABOVE{},
	"medium": proto.AdvancedVoiceOptionsHarmBlockThreshold_BLOCK_MEDIUM_AND_ABOVE{},
	"high":   proto.AdvancedVoiceOptionsHarmBlockThreshold_BLOCK_ONLY_HIGH{},
	"none":   proto.AdvancedVoiceOptionsHarmBlockThreshold_BLOCK_NONE{},
	"off":    proto.AdvancedVoiceOptionsHarmBlockThreshold_OFF{},
}

func (c configuration) protoAdvanced() runtime.Optional[proto.AdvancedVoiceOptions] {
	if c.model == "chirp-3-hd" || c.model == "chirp-3-instant-custom-voice" {
		return runtime.Optional[proto.AdvancedVoiceOptions]{}
	}
	result := proto.AdvancedVoiceOptions{EnableTextnorm: runtime.Some(c.normalize)}
	if c.SafetySettings.Present {
		settings := make([]proto.AdvancedVoiceOptionsSafetySetting, 0, len(c.SafetySettings.Value))
		for _, item := range c.SafetySettings.Value {
			settings = append(settings, proto.AdvancedVoiceOptionsSafetySetting{Category: runtime.Some(protoCategories[item.Category.LiteralValue()]), Threshold: runtime.Some(protoThresholds[item.Threshold.LiteralValue()])})
		}
		result.SafetySettings = runtime.Some(proto.AdvancedVoiceOptionsSafetySettings{Settings: settings})
	}
	return runtime.Some(result)
}

var restCategories = map[string]rest.SafetySettingCategory{
	"hate_speech":       rest.SafetySettingCategoryHARMCATEGORYHATESPEECH{},
	"dangerous_content": rest.SafetySettingCategoryHARMCATEGORYDANGEROUSCONTENT{},
	"harassment":        rest.SafetySettingCategoryHARMCATEGORYHARASSMENT{},
	"sexually_explicit": rest.SafetySettingCategoryHARMCATEGORYSEXUALLYEXPLICIT{},
}
var restThresholds = map[string]rest.SafetySettingThreshold{
	"low":    rest.SafetySettingThresholdBLOCKLOWANDABOVE{},
	"medium": rest.SafetySettingThresholdBLOCKMEDIUMANDABOVE{},
	"high":   rest.SafetySettingThresholdBLOCKONLYHIGH{},
	"none":   rest.SafetySettingThresholdBLOCKNONE{},
	"off":    rest.SafetySettingThresholdOFF{},
}

func (c configuration) restAdvanced() runtime.Optional[rest.AdvancedVoiceOptions] {
	if c.model == "chirp-3-hd" || c.model == "chirp-3-instant-custom-voice" {
		return runtime.Optional[rest.AdvancedVoiceOptions]{}
	}
	result := rest.AdvancedVoiceOptions{EnableTextnorm: runtime.Some(c.normalize)}
	if c.SafetySettings.Present {
		settings := make([]rest.SafetySetting, 0, len(c.SafetySettings.Value))
		for _, item := range c.SafetySettings.Value {
			settings = append(settings, rest.SafetySetting{Category: runtime.Some(restCategories[item.Category.LiteralValue()]), Threshold: runtime.Some(restThresholds[item.Threshold.LiteralValue()])})
		}
		result.SafetySettings = runtime.Some(rest.SafetySettings{Settings: runtime.Some(settings)})
	}
	return runtime.Some(result)
}

func (c configuration) protoVoice() proto.VoiceSelectionParams {
	voice := proto.VoiceSelectionParams{LanguageCode: c.language}
	if c.model == "chirp-3-hd" {
		voice.Name = runtime.Some(c.language + "-Chirp3-HD-" + c.voice)
		return voice
	}
	voice.ModelName = runtime.Some(c.model)
	if len(c.Speakers) == 0 {
		voice.Name = runtime.Some(c.voice)
	} else {
		speakers := make([]proto.MultispeakerPrebuiltVoice, 0, len(c.Speakers))
		for _, item := range c.Speakers {
			speakers = append(speakers, proto.MultispeakerPrebuiltVoice{SpeakerAlias: item.Alias, SpeakerId: item.Voice.LiteralValue()})
		}
		voice.MultiSpeakerVoiceConfig = runtime.Some(proto.MultiSpeakerVoiceConfig{SpeakerVoiceConfigs: speakers})
	}
	return voice
}
func (c configuration) opening() ([]byte, error) {
	if c.model == "chirp-3-instant-custom-voice" {
		config := beta.StreamingSynthesizeConfig{
			Voice:                beta.VoiceSelectionParams{LanguageCode: c.language, VoiceClone: runtime.Some(beta.VoiceCloneParams{VoiceCloningKey: c.voice})},
			StreamingAudioConfig: runtime.Some(beta.StreamingAudioConfig{AudioEncoding: betaEncodings[c.encoding], SampleRateHertz: c.rate, SpeakingRate: runtime.Some(c.speed)}),
			CustomPronunciations: c.betaReplacements(),
		}
		return beta.EncodeStreamingRequest(beta.StreamingSynthesizeRequest{StreamingRequest: beta.StreamingSynthesizeRequest_StreamingConfig{Value: config}})
	}
	config := proto.StreamingSynthesizeConfig{
		Voice: c.protoVoice(), StreamingAudioConfig: runtime.Some(proto.StreamingAudioConfig{AudioEncoding: protoEncodings[c.encoding], SampleRateHertz: c.rate, SpeakingRate: runtime.Some(c.speed)}),
		CustomPronunciations: c.protoReplacements(), AdvancedVoiceOptions: c.protoAdvanced(),
	}
	return proto.EncodeStreamingRequest(proto.StreamingSynthesizeRequest{StreamingRequest: proto.StreamingSynthesizeRequest_StreamingConfig{Value: config}})
}
func (c configuration) encodeInput(text string, turns []Turn, first bool) ([]byte, error) {
	var prompt runtime.Optional[string]
	if first {
		prompt = c.Instructions
	}
	if c.model == "chirp-3-instant-custom-voice" {
		var source beta.StreamingSynthesisInputInputSource = beta.StreamingSynthesisInput_Text{Value: text}
		if c.inputType == "markup" {
			source = beta.StreamingSynthesisInput_Markup{Value: text}
		}
		return beta.EncodeStreamingRequest(beta.StreamingSynthesizeRequest{StreamingRequest: beta.StreamingSynthesizeRequest_Input{Value: beta.StreamingSynthesisInput{Prompt: prompt, InputSource: source}}})
	}
	var source proto.StreamingSynthesisInputInputSource = proto.StreamingSynthesisInput_Text{Value: text}
	if c.dialogue {
		items := make([]proto.MultiSpeakerMarkupTurn, 0, len(turns))
		for _, turn := range turns {
			items = append(items, proto.MultiSpeakerMarkupTurn{Speaker: turn.Speaker, Text: turn.Text})
		}
		source = proto.StreamingSynthesisInput_MultiSpeakerMarkup{Value: proto.MultiSpeakerMarkup{Turns: items}}
	} else if c.inputType == "markup" {
		source = proto.StreamingSynthesisInput_Markup{Value: text}
	}
	return proto.EncodeStreamingRequest(proto.StreamingSynthesizeRequest{StreamingRequest: proto.StreamingSynthesizeRequest_Input{Value: proto.StreamingSynthesisInput{Prompt: prompt, InputSource: source}}})
}
func (c configuration) decodeAudio(data []byte) ([]byte, error) {
	if c.model == "chirp-3-instant-custom-voice" {
		packet, err := beta.DecodeStreamingResponse(data)
		return packet.AudioContent.Value, err
	}
	packet, err := proto.DecodeStreamingResponse(data)
	return packet.AudioContent.Value, err
}
func (c configuration) restRequest() rest.SynthesizeSpeechRequest {
	voice := rest.VoiceSelectionParams{LanguageCode: runtime.Some(c.language)}
	if c.model == "chirp-3-hd" {
		voice.Name = runtime.Some(c.language + "-Chirp3-HD-" + c.voice)
	} else {
		voice.ModelName = runtime.Some(c.model)
		if len(c.Speakers) == 0 {
			voice.Name = runtime.Some(c.voice)
		} else {
			speakers := make([]rest.MultispeakerPrebuiltVoice, 0, len(c.Speakers))
			for _, item := range c.Speakers {
				speakers = append(speakers, rest.MultispeakerPrebuiltVoice{SpeakerAlias: runtime.Some(item.Alias), SpeakerId: runtime.Some(item.Voice.LiteralValue())})
			}
			voice.MultiSpeakerVoiceConfig = runtime.Some(rest.MultiSpeakerVoiceConfig{SpeakerVoiceConfigs: runtime.Some(speakers)})
		}
	}
	input := rest.SynthesisInput{Prompt: c.Instructions, CustomPronunciations: c.restReplacements()}
	if c.dialogue {
		turns := make([]rest.Turn, 0, len(c.turns))
		for _, turn := range c.turns {
			turns = append(turns, rest.Turn{Speaker: runtime.Some(turn.Speaker), Text: runtime.Some(turn.Text)})
		}
		input.MultiSpeakerMarkup = runtime.Some(rest.MultiSpeakerMarkup{Turns: runtime.Some(turns)})
	} else {
		switch c.inputType {
		case "ssml":
			input.Ssml = runtime.Some(c.text)
		case "markup":
			input.Markup = runtime.Some(c.text)
		default:
			input.Text = runtime.Some(c.text)
		}
	}
	return rest.SynthesizeSpeechRequest{
		Voice: runtime.Some(voice), Input: runtime.Some(input), AdvancedVoiceOptions: c.restAdvanced(),
		AudioConfig: runtime.Some(rest.AudioConfig{AudioEncoding: runtime.Some(restEncodings[c.encoding]), SampleRateHertz: c.rate, SpeakingRate: runtime.Some(c.speed), Pitch: c.PitchSemitones, VolumeGainDb: c.VolumeDb, EffectsProfileId: c.EffectsProfiles}),
	}
}
func (c configuration) betaRestRequest() restbeta.SynthesizeSpeechRequest {
	input := restbeta.SynthesisInput{CustomPronunciations: c.restbetaReplacements()}
	if c.inputType == "markup" {
		input.Markup = runtime.Some(c.text)
	} else {
		input.Text = runtime.Some(c.text)
	}
	return restbeta.SynthesizeSpeechRequest{
		Voice:       runtime.Some(restbeta.VoiceSelectionParams{LanguageCode: runtime.Some(c.language), VoiceClone: runtime.Some(restbeta.VoiceCloneParams{VoiceCloningKey: runtime.Some(c.voice)})}),
		Input:       runtime.Some(input),
		AudioConfig: runtime.Some(restbeta.AudioConfig{AudioEncoding: runtime.Some(restbetaEncodings[c.encoding]), SampleRateHertz: c.rate, SpeakingRate: runtime.Some(c.speed)}),
	}
}
