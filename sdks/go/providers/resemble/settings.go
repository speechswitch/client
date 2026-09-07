package resemble

import (
	"errors"

	schema "github.com/speechswitch/client/sdks/go/generated/resemble"
	"github.com/speechswitch/client/sdks/go/runtime"
)

type input struct {
	host, api      string
	data           []any
	reference      runtime.Optional[[]byte]
	needsReference bool
}

// Generated validation has already checked the model union and numeric bounds.
func settings(request schema.TtsRequest) (input, error) {
	var result input
	switch value := request.(type) {
	case *schema.TtsRequestAsText:
		return settings(*value)
	case *schema.TtsRequestAsChatterboxMultilingualText:
		return settings(*value)
	case *schema.TtsRequestAsChatterboxTurboText:
		return settings(*value)
	case schema.TtsRequestAsText:
		r := value.Value
		trimming := false
		if r.ReferenceAudioTrimming.Present {
			trimming = r.ReferenceAudioTrimming.Value.LiteralValue()
		}
		result = input{host: "https://resembleai-chatterbox.hf.space", api: "generate_tts_audio", reference: r.ReferenceAudio,
			data: []any{r.Text, nil, number(r.StyleExaggeration, 0.5), number(r.Temperature, 0.8), number(r.RandomSeed, 0), number(r.VoiceGuidance, 0.5), trimming}}
	case schema.TtsRequestAsChatterboxMultilingualText:
		r := value.Value
		language := "en"
		if r.Language.Present {
			language = r.Language.Value.LiteralValue()
		}
		result = input{host: "https://resembleai-chatterbox-multilingual-tts-v3.hf.space", api: "generate_tts_audio", reference: r.ReferenceAudio,
			data: []any{r.Text, nil, language, number(r.StyleExaggeration, 0.5), number(r.Temperature, 0.8), number(r.RandomSeed, 0), number(r.VoiceGuidance, 0.5)}}
	case schema.TtsRequestAsChatterboxTurboText:
		r := value.Value
		normalize := true
		if r.LoudnessNormalization.Present {
			normalize = r.LoudnessNormalization.Value.LiteralValue()
		}
		result = input{host: "https://resembleai-chatterbox-turbo-demo.hf.space", api: "generate", reference: r.ReferenceAudio, needsReference: true,
			data: []any{r.Text, nil, number(r.Temperature, 0.8), number(r.RandomSeed, 0), number(r.MinP, 0), number(r.TopP, 0.95), number(r.TopK, 1000), number(r.RepetitionPenalty, 1.2), normalize}}
	default:
		return input{}, errors.New("Unsupported generated Resemble request representation")
	}
	if result.reference.Present {
		result.reference.Value = append([]byte{}, result.reference.Value...)
	}
	return result, nil
}

func number(value runtime.Optional[float64], fallback float64) float64 {
	if value.Present {
		return value.Value
	}
	return fallback
}
