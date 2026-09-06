package google

import (
	"errors"
	"fmt"
	"strings"

	schema "github.com/speechswitch/client/sdks/go/generated/google"
	"github.com/speechswitch/client/sdks/go/runtime"
)

type Turn = schema.TtsRequestTurnsTurnsItem
type configuration struct {
	model, language, voice, inputType, format, encoding string
	text                                                string
	turns                                               []Turn
	dialogue                                            bool
	textInput                                           runtime.Input[string]
	turnInput                                           runtime.Input[Turn]
	speed                                               float64
	rate                                                runtime.Optional[int32]
	normalize                                           bool
	limit                                               int
	aliases                                             map[string]struct{}
	Instructions                                        runtime.Optional[string]
	Replacements                                        runtime.Optional[[]schema.TtsRequestChirp3HdTextVoicebb77af5cReplacementsItem]
	SafetySettings                                      runtime.Optional[[]schema.TtsRequestTextSafetySettingsItem]
	Speakers                                            []schema.TtsRequestTextSpeakersItem
	EffectsProfiles                                     runtime.Optional[[]string]
	VolumeDb, PitchSemitones                            runtime.Optional[float64]
}

func choose[T any](value runtime.Optional[T], fallback T) T {
	if value.Present {
		return value.Value
	}
	return fallback
}
func optionalLiteral[T interface{ LiteralValue() string }](value runtime.Optional[T], fallback string) string {
	if value.Present {
		return value.Value.LiteralValue()
	}
	return fallback
}

// Representation conversion follows generated validation; it does not repeat
// provider/model unions, literal restrictions, numeric bounds or array lengths.
func settings(request schema.TtsRequest) (configuration, error) {
	c := configuration{inputType: "text", normalize: true, aliases: make(map[string]struct{})}
	var output, input any
	var speed runtime.Optional[float64]
	switch r := request.(type) {
	case *schema.TtsRequestAsChirp3HdTextVoicebb77af5c:
		return settings(*r)
	case *schema.TtsRequestAsChirp3Hda92b414c:
		return settings(*r)
	case *schema.TtsRequestAsChirp3HdTextVoicec6612bf7:
		return settings(*r)
	case *schema.TtsRequestAsChirp3Hd9b5c25a8:
		return settings(*r)
	case *schema.TtsRequestAsChirp3HdTextVoiceab6ef40e:
		return settings(*r)
	case *schema.TtsRequestAsChirp3Hd562ca724:
		return settings(*r)
	case *schema.TtsRequestAsChirp3InstantCustomVoiceTextVoicedb488368:
		return settings(*r)
	case *schema.TtsRequestAsChirp3InstantCustomVoicefa2d40ff:
		return settings(*r)
	case *schema.TtsRequestAsChirp3InstantCustomVoiceTextVoice298c5192:
		return settings(*r)
	case *schema.TtsRequestAsChirp3InstantCustomVoiceaec4d903:
		return settings(*r)
	case *schema.TtsRequestAsText:
		return settings(*r)
	case *schema.TtsRequestAsObjectd20064bc:
		return settings(*r)
	case *schema.TtsRequestAsTextVoice:
		return settings(*r)
	case *schema.TtsRequestAsObject7d956f3d:
		return settings(*r)
	case *schema.TtsRequestAsTurns:
		return settings(*r)
	case *schema.TtsRequestAsObject8dbffa0c:
		return settings(*r)
	case schema.TtsRequestAsChirp3HdTextVoicebb77af5c:
		v := r.Value
		c.model, c.language, c.voice = v.Model.Value(), v.Language.LiteralValue(), v.Voice.LiteralValue()
		output, input, speed = v.Output, v.Text, v.Speed
		c.inputType = optionalLiteral(v.InputType, "text")
		c.EffectsProfiles = v.EffectsProfiles
		c.VolumeDb = v.VolumeDb
		c.Replacements = v.Replacements
	case schema.TtsRequestAsChirp3Hda92b414c:
		v := r.Value
		c.model, c.language, c.voice = v.Model.Value(), v.Language.LiteralValue(), v.Voice.LiteralValue()
		output, input, speed = v.Output, v.Text, v.Speed
		c.inputType = optionalLiteral(v.InputType, "text")
		c.Replacements = v.Replacements
	case schema.TtsRequestAsChirp3HdTextVoicec6612bf7:
		v := r.Value
		c.model, c.language, c.voice = v.Model.Value(), v.Language.LiteralValue(), v.Voice.LiteralValue()
		output, input, speed = v.Output, v.Text, v.Speed
		c.inputType = optionalLiteral(v.InputType, "text")
		c.EffectsProfiles = v.EffectsProfiles
		c.VolumeDb = v.VolumeDb
	case schema.TtsRequestAsChirp3Hd9b5c25a8:
		v := r.Value
		c.model, c.language, c.voice = v.Model.Value(), v.Language.LiteralValue(), v.Voice.LiteralValue()
		output, input, speed = v.Output, v.Text, v.Speed
		c.inputType = optionalLiteral(v.InputType, "text")
	case schema.TtsRequestAsChirp3HdTextVoiceab6ef40e:
		v := r.Value
		c.model, c.language, c.voice = v.Model.Value(), v.Language.LiteralValue(), v.Voice.LiteralValue()
		output, input, speed = v.Output, v.Text, v.Speed
		c.inputType = optionalLiteral(v.InputType, "text")
		c.EffectsProfiles = v.EffectsProfiles
		c.VolumeDb = v.VolumeDb
	case schema.TtsRequestAsChirp3Hd562ca724:
		v := r.Value
		c.model, c.language, c.voice = v.Model.Value(), v.Language.LiteralValue(), v.Voice.LiteralValue()
		output, input, speed = v.Output, v.Text, v.Speed
	case schema.TtsRequestAsChirp3InstantCustomVoiceTextVoicedb488368:
		v := r.Value
		c.model, c.language, c.voice = v.Model.Value(), v.Language.LiteralValue(), v.Voice
		output, input, speed = v.Output, v.Text, v.Speed
		c.inputType = optionalLiteral(v.InputType, "text")
		c.Replacements = v.Replacements
	case schema.TtsRequestAsChirp3InstantCustomVoicefa2d40ff:
		v := r.Value
		c.model, c.language, c.voice = v.Model.Value(), v.Language.LiteralValue(), v.Voice
		output, input, speed = v.Output, v.Text, v.Speed
		c.inputType = optionalLiteral(v.InputType, "text")
		c.Replacements = v.Replacements
	case schema.TtsRequestAsChirp3InstantCustomVoiceTextVoice298c5192:
		v := r.Value
		c.model, c.language, c.voice = v.Model.Value(), v.Language.LiteralValue(), v.Voice
		output, input, speed = v.Output, v.Text, v.Speed
		c.inputType = optionalLiteral(v.InputType, "text")
	case schema.TtsRequestAsChirp3InstantCustomVoiceaec4d903:
		v := r.Value
		c.model, c.language, c.voice = v.Model.Value(), v.Language.LiteralValue(), v.Voice
		output, input, speed = v.Output, v.Text, v.Speed
		c.inputType = optionalLiteral(v.InputType, "text")
	case schema.TtsRequestAsText:
		v := r.Value
		c.model, c.language, c.voice = v.Model.LiteralValue(), v.Language, ""
		output, input, speed = v.Output, v.Text, v.Speed
		c.EffectsProfiles = v.EffectsProfiles
		c.VolumeDb = v.VolumeDb
		c.PitchSemitones = v.PitchSemitones
		c.Instructions = v.Instructions
		c.SafetySettings = v.SafetySettings
		if v.TextNormalization.Present {
			c.normalize = v.TextNormalization.Value.LiteralValue()
		}
		c.Speakers = v.Speakers
	case schema.TtsRequestAsObjectd20064bc:
		v := r.Value
		c.model, c.language, c.voice = v.Model.LiteralValue(), v.Language, ""
		output, input, speed = v.Output, v.Text, v.Speed
		c.Instructions = v.Instructions
		c.SafetySettings = v.SafetySettings
		if v.TextNormalization.Present {
			c.normalize = v.TextNormalization.Value.LiteralValue()
		}
		c.Speakers = v.Speakers
	case schema.TtsRequestAsTextVoice:
		v := r.Value
		c.model, c.language, c.voice = v.Model.LiteralValue(), v.Language, v.Voice.LiteralValue()
		output, input, speed = v.Output, v.Text, v.Speed
		c.EffectsProfiles = v.EffectsProfiles
		c.VolumeDb = v.VolumeDb
		c.PitchSemitones = v.PitchSemitones
		c.Instructions = v.Instructions
		c.SafetySettings = v.SafetySettings
		if v.TextNormalization.Present {
			c.normalize = v.TextNormalization.Value.LiteralValue()
		}
	case schema.TtsRequestAsObject7d956f3d:
		v := r.Value
		c.model, c.language, c.voice = v.Model.LiteralValue(), v.Language, v.Voice.LiteralValue()
		output, input, speed = v.Output, v.Text, v.Speed
		c.Instructions = v.Instructions
		c.SafetySettings = v.SafetySettings
		if v.TextNormalization.Present {
			c.normalize = v.TextNormalization.Value.LiteralValue()
		}
	case schema.TtsRequestAsTurns:
		v := r.Value
		c.model, c.language, c.voice = v.Model.LiteralValue(), v.Language, ""
		output, input, speed = v.Output, v.Turns, v.Speed
		c.EffectsProfiles = v.EffectsProfiles
		c.VolumeDb = v.VolumeDb
		c.PitchSemitones = v.PitchSemitones
		c.Instructions = v.Instructions
		c.SafetySettings = v.SafetySettings
		if v.TextNormalization.Present {
			c.normalize = v.TextNormalization.Value.LiteralValue()
		}
		c.Speakers = v.Speakers
	case schema.TtsRequestAsObject8dbffa0c:
		v := r.Value
		c.model, c.language, c.voice = v.Model.LiteralValue(), v.Language, ""
		output, input, speed = v.Output, v.Turns, v.Speed
		c.Instructions = v.Instructions
		c.SafetySettings = v.SafetySettings
		if v.TextNormalization.Present {
			c.normalize = v.TextNormalization.Value.LiteralValue()
		}
		c.Speakers = v.Speakers
	default:
		return c, errors.New("Invalid Google request representation")
	}
	c.speed = choose(speed, 1)
	c.limit = 5000
	if strings.HasPrefix(c.model, "gemini-") {
		c.limit = 4000
	}
	var rate runtime.Optional[float64]
	var err error
	c.format, c.encoding, rate, err = outputSettings(output)
	if err != nil {
		return c, err
	}
	// The generated validator already enforces integer and int32 bounds.
	if rate.Present {
		c.rate = runtime.Some(int32(rate.Value))
	}
	switch v := input.(type) {
	case string:
		c.text = v
	case []Turn:
		c.turns, c.dialogue = v, true
	case schema.TtsRequestChirp3Hda92b414cTextAsString:
		c.text = v.Value
	case *schema.TtsRequestChirp3Hda92b414cTextAsString:
		c.text = v.Value
	case schema.TtsRequestChirp3Hda92b414cTextAsAsyncIterable:
		c.textInput = v.Value
	case *schema.TtsRequestChirp3Hda92b414cTextAsAsyncIterable:
		c.textInput = v.Value
	case schema.TtsRequestObject8dbffa0cTurnsAsArray:
		c.turns, c.dialogue = v.Value, true
	case *schema.TtsRequestObject8dbffa0cTurnsAsArray:
		c.turns, c.dialogue = v.Value, true
	case schema.TtsRequestObject8dbffa0cTurnsAsAsyncIterable:
		c.turnInput, c.dialogue = v.Value, true
	case *schema.TtsRequestObject8dbffa0cTurnsAsAsyncIterable:
		c.turnInput, c.dialogue = v.Value, true
	default:
		return c, errors.New("Invalid Google input representation")
	}
	for _, speaker := range c.Speakers {
		if _, exists := c.aliases[speaker.Alias]; exists {
			return c, errors.New("Google dialogue requires exactly two distinct speaker aliases")
		}
		c.aliases[speaker.Alias] = struct{}{}
	}
	categories := make(map[string]struct{})
	if c.SafetySettings.Present {
		for _, setting := range c.SafetySettings.Value {
			category := setting.Category.LiteralValue()
			if _, exists := categories[category]; exists {
				return c, errors.New("Google safety categories must be unique")
			}
			categories[category] = struct{}{}
		}
	}
	if c.Instructions.Present {
		if err := checkText(c.Instructions.Value, 4000); err != nil {
			return c, err
		}
	}
	if c.dialogue && c.turnInput == nil {
		if err := c.checkTurns(c.turns); err != nil {
			return c, err
		}
	} else if c.textInput == nil {
		if err := checkText(c.text, c.limit); err != nil {
			return c, err
		}
	}
	return c, nil
}

func checkText(text string, limit int) error {
	if len(text) > limit {
		return fmt.Errorf("Google input exceeds %d UTF-8 bytes", limit)
	}
	return nil
}
func (c configuration) checkTurns(turns []Turn) error {
	if len(turns) == 0 {
		return errors.New("Google dialogue turns must not be empty")
	}
	size := 0
	for _, turn := range turns {
		if _, exists := c.aliases[turn.Speaker]; !exists {
			return fmt.Errorf("Google dialogue references an unknown speaker: %s", turn.Speaker)
		}
		if len(turn.Text) > c.limit-size {
			return fmt.Errorf("Google input exceeds %d UTF-8 bytes", c.limit)
		}
		size += len(turn.Text)
	}
	return nil
}
func outputSettings(output any) (string, string, runtime.Optional[float64], error) {
	switch v := output.(type) {
	case *schema.TtsRequestChirp3HdTextVoicebb77af5cOutputAsOggOpus:
		return outputSettings(*v)
	case *schema.TtsRequestChirp3HdTextVoicebb77af5cOutputAsMp3:
		return outputSettings(*v)
	case *schema.TtsRequestChirp3HdTextVoicebb77af5cOutputAsPcm:
		return outputSettings(*v)
	case *schema.TtsRequestChirp3HdTextVoicebb77af5cOutputAsWav:
		return outputSettings(*v)
	case *schema.TtsRequestChirp3Hda92b414cOutputAsOggOpus:
		return outputSettings(*v)
	case *schema.TtsRequestChirp3Hda92b414cOutputAsPcm:
		return outputSettings(*v)
	case *schema.TtsRequestChirp3Hda92b414cOutputAsObject:
		return outputSettings(*v)
	case *schema.TtsRequestChirp3InstantCustomVoiceTextVoicedb488368OutputAsOggOpus:
		return outputSettings(*v)
	case *schema.TtsRequestChirp3InstantCustomVoiceTextVoicedb488368OutputAsPcm:
		return outputSettings(*v)
	case *schema.TtsRequestChirp3InstantCustomVoiceTextVoicedb488368OutputAsWav:
		return outputSettings(*v)
	case schema.TtsRequestChirp3HdTextVoicebb77af5cOutputAsOggOpus:
		return "ogg_opus", "OGG_OPUS", v.Value.SampleRateHz, nil
	case schema.TtsRequestChirp3HdTextVoicebb77af5cOutputAsMp3:
		return "mp3", "MP3", v.Value.SampleRateHz, nil
	case schema.TtsRequestChirp3HdTextVoicebb77af5cOutputAsPcm:
		return "pcm", "PCM", v.Value.SampleRateHz, nil
	case schema.TtsRequestChirp3HdTextVoicebb77af5cOutputAsWav:
		encoding := "LINEAR16"
		if v.Value.SampleEncoding.Present {
			switch v.Value.SampleEncoding.Value.LiteralValue() {
			case "alaw":
				encoding = "ALAW"
			case "mulaw":
				encoding = "MULAW"
			}
		}
		return "wav", encoding, v.Value.SampleRateHz, nil
	case schema.TtsRequestChirp3Hda92b414cOutputAsOggOpus:
		return "ogg_opus", "OGG_OPUS", v.Value.SampleRateHz, nil
	case schema.TtsRequestChirp3Hda92b414cOutputAsPcm:
		return "pcm", "PCM", v.Value.SampleRateHz, nil
	case schema.TtsRequestChirp3Hda92b414cOutputAsObject:
		format := v.Value.Format.LiteralValue()
		return format, strings.ToUpper(format), v.Value.SampleRateHz, nil
	case schema.TtsRequestChirp3InstantCustomVoiceTextVoicedb488368OutputAsOggOpus:
		return "ogg_opus", "OGG_OPUS", v.Value.SampleRateHz, nil
	case schema.TtsRequestChirp3InstantCustomVoiceTextVoicedb488368OutputAsPcm:
		return "pcm", "PCM", v.Value.SampleRateHz, nil
	case schema.TtsRequestChirp3InstantCustomVoiceTextVoicedb488368OutputAsWav:
		encoding := "LINEAR16"
		if v.Value.SampleEncoding.Present {
			switch v.Value.SampleEncoding.Value.LiteralValue() {
			case "alaw":
				encoding = "ALAW"
			case "mulaw":
				encoding = "MULAW"
			}
		}
		return "wav", encoding, v.Value.SampleRateHz, nil
	default:
		return "", "", runtime.Optional[float64]{}, errors.New("Invalid Google output representation")
	}
}
