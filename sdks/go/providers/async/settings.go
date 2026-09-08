package async

import (
	"errors"
	schema "github.com/speechswitch/client/sdks/go/generated/async_"
	"github.com/speechswitch/client/sdks/go/runtime"
	"math"
)

type wireRequest struct {
	settings map[string]any
	format   string
	text     string
	input    runtime.Input[string]
	timed    bool
	force    bool
}

// Conversion starts only after generated validation. Keep the provider/model
// alternatives explicit; never serialize generated union wrappers as wire JSON.
func settings(request schema.TtsRequest) (wireRequest, error) {
	switch request := request.(type) {
	case *schema.TtsRequestAsFlashV15StreamingTextVoice:
		return settings(*request)
	case schema.TtsRequestAsFlashV15StreamingTextVoice:
		value := request.Value
		result, err := configuration(value.Model.Value(), value.Voice, value.Output)
		if err != nil {
			return result, err
		}
		if err := putLiteral(result.settings, "language", value.Language); err != nil {
			return result, err
		}
		result.input = value.Text
		if value.Segmentation.Present {
			segmentation, err := literal(value.Segmentation.Value)
			if err != nil {
				return result, err
			}
			result.force = segmentation == "immediate"
		}
		return result, nil
	case *schema.TtsRequestAsFlashV15TextVoicee827622b:
		return settings(*request)
	case schema.TtsRequestAsFlashV15TextVoicee827622b:
		value := request.Value
		result, err := configuration(value.Model.Value(), value.Voice, value.Output)
		if err != nil {
			return result, err
		}
		if err := putLiteral(result.settings, "language", value.Language); err != nil {
			return result, err
		}
		result.text = value.Text
		return result, nil
	case *schema.TtsRequestAsFlashV15TextVoice7c30ce7a:
		return settings(*request)
	case schema.TtsRequestAsFlashV15TextVoice7c30ce7a:
		value := request.Value
		result, err := configuration(value.Model.Value(), value.Voice, value.Output)
		if err != nil {
			return result, err
		}
		if err := putLiteral(result.settings, "language", value.Language); err != nil {
			return result, err
		}
		result.text = value.Text
		result.timed = true
		return result, nil
	case *schema.TtsRequestAsCastleflow10StreamingTextVoice:
		return settings(*request)
	case schema.TtsRequestAsCastleflow10StreamingTextVoice:
		value := request.Value
		result, err := configuration(value.Model.Value(), value.Voice, value.Output)
		if err != nil {
			return result, err
		}
		if err := putLiteral(result.settings, "language", value.Language); err != nil {
			return result, err
		}
		if value.Speed.Present {
			result.settings["speed_control"] = value.Speed.Value
		}
		if value.Stability.Present {
			result.settings["stability"] = math.Floor(value.Stability.Value*100 + 0.5)
		}
		result.input = value.Text
		if value.Segmentation.Present {
			segmentation, err := literal(value.Segmentation.Value)
			if err != nil {
				return result, err
			}
			result.force = segmentation == "immediate"
		}
		return result, nil
	case *schema.TtsRequestAsCastleflow10TextVoice8e858d00:
		return settings(*request)
	case schema.TtsRequestAsCastleflow10TextVoice8e858d00:
		value := request.Value
		result, err := configuration(value.Model.Value(), value.Voice, value.Output)
		if err != nil {
			return result, err
		}
		if err := putLiteral(result.settings, "language", value.Language); err != nil {
			return result, err
		}
		if value.Speed.Present {
			result.settings["speed_control"] = value.Speed.Value
		}
		if value.Stability.Present {
			result.settings["stability"] = math.Floor(value.Stability.Value*100 + 0.5)
		}
		result.text = value.Text
		return result, nil
	case *schema.TtsRequestAsCastleflow10TextVoice09f4eeb0:
		return settings(*request)
	case schema.TtsRequestAsCastleflow10TextVoice09f4eeb0:
		value := request.Value
		result, err := configuration(value.Model.Value(), value.Voice, value.Output)
		if err != nil {
			return result, err
		}
		if err := putLiteral(result.settings, "language", value.Language); err != nil {
			return result, err
		}
		if value.Speed.Present {
			result.settings["speed_control"] = value.Speed.Value
		}
		if value.Stability.Present {
			result.settings["stability"] = math.Floor(value.Stability.Value*100 + 0.5)
		}
		result.text = value.Text
		result.timed = true
		return result, nil
	case *schema.TtsRequestAsProV10StreamingTextVoice:
		return settings(*request)
	case schema.TtsRequestAsProV10StreamingTextVoice:
		value := request.Value
		result, err := configuration(value.Model.Value(), value.Voice, value.Output)
		if err != nil {
			return result, err
		}
		if err := putLiteral(result.settings, "language", value.Language); err != nil {
			return result, err
		}
		result.input = value.Text
		if value.Segmentation.Present {
			segmentation, err := literal(value.Segmentation.Value)
			if err != nil {
				return result, err
			}
			result.force = segmentation == "immediate"
		}
		return result, nil
	case *schema.TtsRequestAsProV10TextVoice54fc4ea5:
		return settings(*request)
	case schema.TtsRequestAsProV10TextVoice54fc4ea5:
		value := request.Value
		result, err := configuration(value.Model.Value(), value.Voice, value.Output)
		if err != nil {
			return result, err
		}
		if err := putLiteral(result.settings, "language", value.Language); err != nil {
			return result, err
		}
		result.text = value.Text
		return result, nil
	case *schema.TtsRequestAsProV10TextVoice96f74303:
		return settings(*request)
	case schema.TtsRequestAsProV10TextVoice96f74303:
		value := request.Value
		result, err := configuration(value.Model.Value(), value.Voice, value.Output)
		if err != nil {
			return result, err
		}
		if err := putLiteral(result.settings, "language", value.Language); err != nil {
			return result, err
		}
		result.text = value.Text
		result.timed = true
		return result, nil
	default:
		return wireRequest{}, errors.New("Unsupported generated Async request representation")
	}
}

func putLiteral[T any](wire map[string]any, name string, value runtime.Optional[T]) error {
	if !value.Present {
		return nil
	}
	text, err := literal(value.Value)
	if err != nil {
		return err
	}
	wire[name] = text
	return nil
}

func literal(value any) (string, error) {
	switch value := value.(type) {
	case interface{ Value() string }:
		return value.Value(), nil
	case schema.TtsRequestFlashV15StreamingTextVoiceLanguageAsDe:
		return value.Value.Value(), nil
	case *schema.TtsRequestFlashV15StreamingTextVoiceLanguageAsDe:
		return value.Value.Value(), nil
	case schema.TtsRequestFlashV15StreamingTextVoiceLanguageAsEn:
		return value.Value.Value(), nil
	case *schema.TtsRequestFlashV15StreamingTextVoiceLanguageAsEn:
		return value.Value.Value(), nil
	case schema.TtsRequestFlashV15StreamingTextVoiceLanguageAsEs:
		return value.Value.Value(), nil
	case *schema.TtsRequestFlashV15StreamingTextVoiceLanguageAsEs:
		return value.Value.Value(), nil
	case schema.TtsRequestFlashV15StreamingTextVoiceLanguageAsFr:
		return value.Value.Value(), nil
	case *schema.TtsRequestFlashV15StreamingTextVoiceLanguageAsFr:
		return value.Value.Value(), nil
	case schema.TtsRequestFlashV15StreamingTextVoiceLanguageAsIt:
		return value.Value.Value(), nil
	case *schema.TtsRequestFlashV15StreamingTextVoiceLanguageAsIt:
		return value.Value.Value(), nil
	case schema.TtsRequestFlashV15StreamingTextVoiceLanguageAsPt:
		return value.Value.Value(), nil
	case *schema.TtsRequestFlashV15StreamingTextVoiceLanguageAsPt:
		return value.Value.Value(), nil
	case schema.TtsRequestCastleflow10StreamingTextVoiceLanguageAsAr:
		return value.Value.Value(), nil
	case *schema.TtsRequestCastleflow10StreamingTextVoiceLanguageAsAr:
		return value.Value.Value(), nil
	case schema.TtsRequestCastleflow10StreamingTextVoiceLanguageAsDe:
		return value.Value.Value(), nil
	case *schema.TtsRequestCastleflow10StreamingTextVoiceLanguageAsDe:
		return value.Value.Value(), nil
	case schema.TtsRequestCastleflow10StreamingTextVoiceLanguageAsEn:
		return value.Value.Value(), nil
	case *schema.TtsRequestCastleflow10StreamingTextVoiceLanguageAsEn:
		return value.Value.Value(), nil
	case schema.TtsRequestCastleflow10StreamingTextVoiceLanguageAsEs:
		return value.Value.Value(), nil
	case *schema.TtsRequestCastleflow10StreamingTextVoiceLanguageAsEs:
		return value.Value.Value(), nil
	case schema.TtsRequestCastleflow10StreamingTextVoiceLanguageAsFr:
		return value.Value.Value(), nil
	case *schema.TtsRequestCastleflow10StreamingTextVoiceLanguageAsFr:
		return value.Value.Value(), nil
	case schema.TtsRequestCastleflow10StreamingTextVoiceLanguageAsHe:
		return value.Value.Value(), nil
	case *schema.TtsRequestCastleflow10StreamingTextVoiceLanguageAsHe:
		return value.Value.Value(), nil
	case schema.TtsRequestCastleflow10StreamingTextVoiceLanguageAsHi:
		return value.Value.Value(), nil
	case *schema.TtsRequestCastleflow10StreamingTextVoiceLanguageAsHi:
		return value.Value.Value(), nil
	case schema.TtsRequestCastleflow10StreamingTextVoiceLanguageAsHy:
		return value.Value.Value(), nil
	case *schema.TtsRequestCastleflow10StreamingTextVoiceLanguageAsHy:
		return value.Value.Value(), nil
	case schema.TtsRequestCastleflow10StreamingTextVoiceLanguageAsIt:
		return value.Value.Value(), nil
	case *schema.TtsRequestCastleflow10StreamingTextVoiceLanguageAsIt:
		return value.Value.Value(), nil
	case schema.TtsRequestCastleflow10StreamingTextVoiceLanguageAsJa:
		return value.Value.Value(), nil
	case *schema.TtsRequestCastleflow10StreamingTextVoiceLanguageAsJa:
		return value.Value.Value(), nil
	case schema.TtsRequestCastleflow10StreamingTextVoiceLanguageAsPt:
		return value.Value.Value(), nil
	case *schema.TtsRequestCastleflow10StreamingTextVoiceLanguageAsPt:
		return value.Value.Value(), nil
	case schema.TtsRequestCastleflow10StreamingTextVoiceLanguageAsRo:
		return value.Value.Value(), nil
	case *schema.TtsRequestCastleflow10StreamingTextVoiceLanguageAsRo:
		return value.Value.Value(), nil
	case schema.TtsRequestCastleflow10StreamingTextVoiceLanguageAsRu:
		return value.Value.Value(), nil
	case *schema.TtsRequestCastleflow10StreamingTextVoiceLanguageAsRu:
		return value.Value.Value(), nil
	case schema.TtsRequestCastleflow10StreamingTextVoiceLanguageAsTr:
		return value.Value.Value(), nil
	case *schema.TtsRequestCastleflow10StreamingTextVoiceLanguageAsTr:
		return value.Value.Value(), nil
	case schema.TtsRequestCastleflow10StreamingTextVoiceLanguageAsZh:
		return value.Value.Value(), nil
	case *schema.TtsRequestCastleflow10StreamingTextVoiceLanguageAsZh:
		return value.Value.Value(), nil
	case schema.TtsRequestFlashV15StreamingTextVoiceOutputPcmSampleEncodingAsFloat32:
		return value.Value.Value(), nil
	case *schema.TtsRequestFlashV15StreamingTextVoiceOutputPcmSampleEncodingAsFloat32:
		return value.Value.Value(), nil
	case schema.TtsRequestFlashV15StreamingTextVoiceOutputPcmSampleEncodingAsSignedInteger16:
		return value.Value.Value(), nil
	case *schema.TtsRequestFlashV15StreamingTextVoiceOutputPcmSampleEncodingAsSignedInteger16:
		return value.Value.Value(), nil
	case schema.TtsRequestFlashV15StreamingTextVoiceSegmentationAsImmediate:
		return value.Value.Value(), nil
	case *schema.TtsRequestFlashV15StreamingTextVoiceSegmentationAsImmediate:
		return value.Value.Value(), nil
	case schema.TtsRequestFlashV15StreamingTextVoiceSegmentationAsSentence:
		return value.Value.Value(), nil
	case *schema.TtsRequestFlashV15StreamingTextVoiceSegmentationAsSentence:
		return value.Value.Value(), nil
	default:
		return "", errors.New("Unsupported generated Async literal representation")
	}
}

func configuration(model, voice string, output any) (wireRequest, error) {
	format, err := outputFormat(output)
	if err != nil {
		return wireRequest{}, err
	}
	nativeModel := ""
	switch model {
	case "castleflow-1.0":
		nativeModel = "async_flash_v1.0"
	case "flash_v1.5":
		nativeModel = "async_flash_v1.5"
	case "pro_v1.0":
		nativeModel = "async_pro_v1.0"
	default:
		return wireRequest{}, errors.New("Unsupported generated Async model representation")
	}
	return wireRequest{format: format["container"].(string), settings: map[string]any{"model_id": nativeModel, "voice": map[string]any{"mode": "id", "id": voice}, "output_format": format}}, nil
}

func outputFormat(output any) (map[string]any, error) {
	switch output := output.(type) {
	case schema.TtsRequestFlashV15StreamingTextVoiceOutputAsMp3:
		return outputFormat(output.Value)
	case *schema.TtsRequestFlashV15StreamingTextVoiceOutputAsMp3:
		return outputFormat(output.Value)
	case schema.TtsRequestFlashV15StreamingTextVoiceOutputAsMulaw:
		return outputFormat(output.Value)
	case *schema.TtsRequestFlashV15StreamingTextVoiceOutputAsMulaw:
		return outputFormat(output.Value)
	case schema.TtsRequestFlashV15StreamingTextVoiceOutputAsPcm:
		return outputFormat(output.Value)
	case *schema.TtsRequestFlashV15StreamingTextVoiceOutputAsPcm:
		return outputFormat(output.Value)
	case schema.TtsRequestFlashV15TextVoicee827622bOutputAsMp3:
		return outputFormat(output.Value)
	case *schema.TtsRequestFlashV15TextVoicee827622bOutputAsMp3:
		return outputFormat(output.Value)
	case schema.TtsRequestFlashV15TextVoicee827622bOutputAsMulaw:
		return outputFormat(output.Value)
	case *schema.TtsRequestFlashV15TextVoicee827622bOutputAsMulaw:
		return outputFormat(output.Value)
	case schema.TtsRequestFlashV15TextVoicee827622bOutputAsPcm:
		return outputFormat(output.Value)
	case *schema.TtsRequestFlashV15TextVoicee827622bOutputAsPcm:
		return outputFormat(output.Value)
	case schema.TtsRequestFlashV15TextVoicee827622bOutputAsWav:
		return outputFormat(output.Value)
	case *schema.TtsRequestFlashV15TextVoicee827622bOutputAsWav:
		return outputFormat(output.Value)
	case schema.TtsRequestFlashV15TextVoice7c30ce7aOutputAsMp3:
		return outputFormat(output.Value)
	case *schema.TtsRequestFlashV15TextVoice7c30ce7aOutputAsMp3:
		return outputFormat(output.Value)
	case schema.TtsRequestFlashV15TextVoice7c30ce7aOutputAsPcm:
		return outputFormat(output.Value)
	case *schema.TtsRequestFlashV15TextVoice7c30ce7aOutputAsPcm:
		return outputFormat(output.Value)
	case schema.TtsRequestFlashV15TextVoice7c30ce7aOutputAsWav:
		return outputFormat(output.Value)
	case *schema.TtsRequestFlashV15TextVoice7c30ce7aOutputAsWav:
		return outputFormat(output.Value)
	case schema.TtsRequestFlashV15StreamingTextVoiceOutputMp3:
		rate := 192000.0
		if output.BitRateBps.Present {
			rate = output.BitRateBps.Value
		}
		return map[string]any{"container": "mp3", "sample_rate": output.SampleRateHz, "bit_rate": rate}, nil
	case schema.TtsRequestFlashV15StreamingTextVoiceOutputMulaw:
		return map[string]any{"container": "raw", "sample_rate": output.SampleRateHz, "encoding": "pcm_mulaw"}, nil
	case schema.TtsRequestFlashV15StreamingTextVoiceOutputPcm:
		return pcmFormat("raw", output.SampleRateHz, output.SampleEncoding)
	case schema.TtsRequestFlashV15TextVoicee827622bOutputWav:
		return pcmFormat("wav", output.SampleRateHz, output.SampleEncoding)
	default:
		return nil, errors.New("Unsupported generated Async output representation")
	}
}

func pcmFormat(container string, rate float64, encoding runtime.Optional[schema.TtsRequestFlashV15StreamingTextVoiceOutputPcmSampleEncoding]) (map[string]any, error) {
	native := "pcm_s16le"
	if encoding.Present {
		value, err := literal(encoding.Value)
		if err != nil {
			return nil, err
		}
		if value == "float_32" {
			native = "pcm_f32le"
		}
	}
	return map[string]any{"container": container, "sample_rate": rate, "encoding": native}, nil
}
