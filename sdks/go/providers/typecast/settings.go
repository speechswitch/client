package typecast

import (
	"errors"
	schema "github.com/speechswitch/client/sdks/go/generated/typecast"
	"github.com/speechswitch/client/sdks/go/runtime"
	"math"
	"unicode/utf8"
)

type settings struct {
	payload                 map[string]any
	format                  string
	rate                    float64
	full, words, characters bool
	composed                bool
}
type speech struct {
	model, text, voice, language, emotion, before, after string
	speed, pitch, intensity, seed, volume, loudness      runtime.Optional[float64]
}

var languages = map[string]string{
	"ar": "ara", "bg": "bul", "cs": "ces", "da": "dan", "de": "deu", "el": "ell", "en": "eng", "fi": "fin", "fr": "fra", "hr": "hrv", "id": "ind", "it": "ita", "ja": "jpn", "ko": "kor",
	"ms": "msa", "nl": "nld", "pl": "pol", "pt": "por", "ro": "ron", "ru": "rus", "sk": "slk", "es": "spa", "sv": "swe", "ta": "tam", "tl": "tgl", "uk": "ukr", "zh": "zho",
	"bn": "ben", "hi": "hin", "hu": "hun", "nan": "nan", "no": "nor", "pa": "pan", "th": "tha", "tr": "tur", "vi": "vie", "yue": "yue",
}

// Only called at the public boundary, after generated validation.
func (s speech) wire(format string) map[string]any {
	pitch, speed, intensity := 0.0, 1.0, 1.0
	if s.pitch.Present {
		pitch = s.pitch.Value
	}
	if s.speed.Present {
		speed = s.speed.Value
	}
	if s.intensity.Present {
		intensity = s.intensity.Value
	}
	output := map[string]any{"audio_format": format, "audio_pitch": pitch, "audio_tempo": speed}
	if s.volume.Present {
		output["volume"] = math.Round(s.volume.Value * 100)
	}
	if s.loudness.Present {
		output["target_lufs"] = s.loudness.Value
	}
	prompt := map[string]any{"emotion_preset": s.emotion, "emotion_intensity": intensity}
	if s.model == "ssfm-v30" {
		prompt["emotion_type"] = "preset"
	}
	if s.emotion == "auto" {
		prompt = map[string]any{"emotion_type": "smart", "previous_text": s.before, "next_text": s.after}
	}
	result := map[string]any{"model": s.model, "text": s.text, "voice_id": s.voice, "prompt": prompt, "output": output}
	if s.language != "auto" {
		result["language"] = languages[s.language]
	}
	if s.seed.Present {
		result["seed"] = s.seed.Value
	}
	return result
}

func resolve(request schema.TtsRequest) (settings, error) {
	result := settings{format: "wav"}
	var s speech
	var fullOutput runtime.Optional[schema.TtsRequestObjectOutput]
	var streamOutput runtime.Optional[schema.TtsRequestSsfmV21TextVoicef82be0f4Output]
	var granularity runtime.Optional[schema.TtsRequestSsfmV21TextVoicec8409957TimestampGranularity]
	var segments []schema.TtsRequestObjectSegmentsItem
	switch value := request.(type) {
	case *schema.TtsRequestAsObject:
		return resolve(*value)
	case *schema.TtsRequestAsSsfmV21TextVoicec8409957:
		return resolve(*value)
	case *schema.TtsRequestAsSsfmV21TextVoicef82be0f4:
		return resolve(*value)
	case *schema.TtsRequestAsSsfmV21TextVoiceb54b9734:
		return resolve(*value)
	case *schema.TtsRequestAsSsfmV30TextVoiceda7d6fa9:
		return resolve(*value)
	case *schema.TtsRequestAsSsfmV30TextVoicec9d5257e:
		return resolve(*value)
	case *schema.TtsRequestAsSsfmV30TextVoice2e7e5231:
		return resolve(*value)
	case *schema.TtsRequestAsSsfmV30TextVoice862867af:
		return resolve(*value)
	case *schema.TtsRequestAsSsfmV30TextVoicebb79df90:
		return resolve(*value)
	case *schema.TtsRequestAsSsfmV30TextVoicec3047c31:
		return resolve(*value)
	case schema.TtsRequestAsObject:
		segments, fullOutput, result.composed = value.Value.Segments, value.Value.Output, true
	case schema.TtsRequestAsSsfmV21TextVoicec8409957:
		r := value.Value
		s = speech{model: "ssfm-v21", text: r.Text, voice: r.Voice, language: "auto", emotion: "normal", speed: r.Speed, pitch: r.PitchSemitones, seed: r.RandomSeed}
		if r.Language.Present {
			s.language = r.Language.Value.LiteralValue()
		}
		s.intensity = r.EmotionIntensity
		if r.Emotion.Present {
			s.emotion = r.Emotion.Value.LiteralValue()
		}
		s.loudness = r.TargetLoudnessLufs
		fullOutput = r.Output
		granularity = runtime.Some(r.TimestampGranularity)
	case schema.TtsRequestAsSsfmV21TextVoicef82be0f4:
		r := value.Value
		s = speech{model: "ssfm-v21", text: r.Text, voice: r.Voice, language: "auto", emotion: "normal", speed: r.Speed, pitch: r.PitchSemitones, seed: r.RandomSeed}
		if r.Language.Present {
			s.language = r.Language.Value.LiteralValue()
		}
		s.intensity = r.EmotionIntensity
		if r.Emotion.Present {
			s.emotion = r.Emotion.Value.LiteralValue()
		}
		s.loudness = r.TargetLoudnessLufs
		streamOutput = r.Output

	case schema.TtsRequestAsSsfmV21TextVoiceb54b9734:
		r := value.Value
		s = speech{model: "ssfm-v21", text: r.Text, voice: r.Voice, language: "auto", emotion: "normal", speed: r.Speed, pitch: r.PitchSemitones, seed: r.RandomSeed}
		if r.Language.Present {
			s.language = r.Language.Value.LiteralValue()
		}
		s.intensity = r.EmotionIntensity
		if r.Emotion.Present {
			s.emotion = r.Emotion.Value.LiteralValue()
		}
		s.volume = runtime.Some(r.VolumeScale)
		fullOutput = r.Output
		granularity = r.TimestampGranularity
	case schema.TtsRequestAsSsfmV30TextVoiceda7d6fa9:
		r := value.Value
		s = speech{model: "ssfm-v30", text: r.Text, voice: r.Voice, language: "auto", emotion: "normal", speed: r.Speed, pitch: r.PitchSemitones, seed: r.RandomSeed}
		if r.Language.Present {
			s.language = r.Language.Value.LiteralValue()
		}
		s.intensity = r.EmotionIntensity
		if r.Emotion.Present {
			s.emotion = r.Emotion.Value.LiteralValue()
		}
		s.loudness = r.TargetLoudnessLufs
		fullOutput = r.Output
		granularity = runtime.Some(r.TimestampGranularity)
	case schema.TtsRequestAsSsfmV30TextVoicec9d5257e:
		r := value.Value
		s = speech{model: "ssfm-v30", text: r.Text, voice: r.Voice, language: "auto", emotion: "normal", speed: r.Speed, pitch: r.PitchSemitones, seed: r.RandomSeed}
		if r.Language.Present {
			s.language = r.Language.Value.LiteralValue()
		}
		s.intensity = r.EmotionIntensity
		if r.Emotion.Present {
			s.emotion = r.Emotion.Value.LiteralValue()
		}
		s.loudness = r.TargetLoudnessLufs
		streamOutput = r.Output

	case schema.TtsRequestAsSsfmV30TextVoice2e7e5231:
		r := value.Value
		s = speech{model: "ssfm-v30", text: r.Text, voice: r.Voice, language: "auto", emotion: "normal", speed: r.Speed, pitch: r.PitchSemitones, seed: r.RandomSeed}
		if r.Language.Present {
			s.language = r.Language.Value.LiteralValue()
		}
		s.intensity = r.EmotionIntensity
		if r.Emotion.Present {
			s.emotion = r.Emotion.Value.LiteralValue()
		}
		s.volume = runtime.Some(r.VolumeScale)
		fullOutput = r.Output
		granularity = r.TimestampGranularity
	case schema.TtsRequestAsSsfmV30TextVoice862867af:
		r := value.Value
		s = speech{model: "ssfm-v30", text: r.Text, voice: r.Voice, language: "auto", emotion: "normal", speed: r.Speed, pitch: r.PitchSemitones, seed: r.RandomSeed}
		if r.Language.Present {
			s.language = r.Language.Value.LiteralValue()
		}
		s.emotion = "auto"
		if r.ContextBefore.Present {
			s.before = r.ContextBefore.Value.Text
		}
		if r.ContextAfter.Present {
			s.after = r.ContextAfter.Value.Text
		}
		s.loudness = r.TargetLoudnessLufs
		fullOutput = r.Output
		granularity = runtime.Some(r.TimestampGranularity)
	case schema.TtsRequestAsSsfmV30TextVoicebb79df90:
		r := value.Value
		s = speech{model: "ssfm-v30", text: r.Text, voice: r.Voice, language: "auto", emotion: "normal", speed: r.Speed, pitch: r.PitchSemitones, seed: r.RandomSeed}
		if r.Language.Present {
			s.language = r.Language.Value.LiteralValue()
		}
		s.emotion = "auto"
		if r.ContextBefore.Present {
			s.before = r.ContextBefore.Value.Text
		}
		if r.ContextAfter.Present {
			s.after = r.ContextAfter.Value.Text
		}
		s.loudness = r.TargetLoudnessLufs
		streamOutput = r.Output

	case schema.TtsRequestAsSsfmV30TextVoicec3047c31:
		r := value.Value
		s = speech{model: "ssfm-v30", text: r.Text, voice: r.Voice, language: "auto", emotion: "normal", speed: r.Speed, pitch: r.PitchSemitones, seed: r.RandomSeed}
		if r.Language.Present {
			s.language = r.Language.Value.LiteralValue()
		}
		s.emotion = "auto"
		if r.ContextBefore.Present {
			s.before = r.ContextBefore.Value.Text
		}
		if r.ContextAfter.Present {
			s.after = r.ContextAfter.Value.Text
		}
		s.volume = runtime.Some(r.VolumeScale)
		fullOutput = r.Output
		granularity = r.TimestampGranularity
	default:
		return result, errors.New("Unsupported generated Typecast request representation")
	}
	var err error
	if fullOutput.Present {
		result.format, result.rate, err = output(fullOutput.Value)
	}
	if streamOutput.Present {
		result.format, result.rate, err = output(streamOutput.Value)
	}
	if err != nil {
		return result, err
	}
	if granularity.Present {
		result.words, result.characters, err = timing(granularity.Value)
		if err != nil {
			return result, err
		}
	}
	result.full = result.composed || granularity.Present || s.volume.Present || result.format == "wav" && result.rate == 44100
	if !result.composed {
		result.payload = s.wire(result.format)
		return result, nil
	}
	native := make([]map[string]any, 0, len(segments))
	totalText, totalPause, speechPresent := 0, 0.0, false
	for _, segment := range segments {
		item, text, pause, err := composeSegment(segment, result.format)
		if err != nil {
			return result, err
		}
		if item["type"] == "tts" {
			speechPresent = true
			totalText += utf8.RuneCountInString(text)
		}
		totalPause += pause
		native = append(native, item)
	}
	if !speechPresent || totalText > 2000 || totalPause > 60000 {
		return result, errors.New("Typecast composition requires speech, at most 2000 total text code points and at most 60000 ms total pauses")
	}
	result.payload = map[string]any{"segments": native}
	return result, nil
}

func composeSegment(segment schema.TtsRequestObjectSegmentsItem, format string) (map[string]any, string, float64, error) {
	var s speech
	switch value := segment.(type) {
	case *schema.TtsRequestObjectSegmentsItemAsObject:
		return composeSegment(*value, format)
	case *schema.TtsRequestObjectSegmentsItemAsSsfmV21TextVoiceb3babbe2:
		return composeSegment(*value, format)
	case *schema.TtsRequestObjectSegmentsItemAsSsfmV21TextVoice4e8a729e:
		return composeSegment(*value, format)
	case *schema.TtsRequestObjectSegmentsItemAsSsfmV30TextVoiceaa70b792:
		return composeSegment(*value, format)
	case *schema.TtsRequestObjectSegmentsItemAsSsfmV30TextVoice0a18e1a3:
		return composeSegment(*value, format)
	case *schema.TtsRequestObjectSegmentsItemAsSsfmV30TextVoice0e2e956c:
		return composeSegment(*value, format)
	case *schema.TtsRequestObjectSegmentsItemAsSsfmV30TextVoice9cf1a777:
		return composeSegment(*value, format)
	case schema.TtsRequestObjectSegmentsItemAsObject:
		seconds := value.Value.PauseMs / 1000
		if seconds == 0 {
			return nil, "", 0, errors.New("Typecast pause cannot be represented as positive seconds")
		}
		return map[string]any{"type": "pause", "duration_seconds": seconds}, "", value.Value.PauseMs, nil
	case schema.TtsRequestObjectSegmentsItemAsSsfmV21TextVoiceb3babbe2:
		r := value.Value
		s = speech{model: "ssfm-v21", text: r.Text, voice: r.Voice, language: "auto", emotion: "normal", speed: r.Speed, pitch: r.PitchSemitones, seed: r.RandomSeed}
		if r.Language.Present {
			s.language = r.Language.Value.LiteralValue()
		}
		s.intensity = r.EmotionIntensity
		if r.Emotion.Present {
			s.emotion = r.Emotion.Value.LiteralValue()
		}
		s.loudness = runtime.Some(r.TargetLoudnessLufs)
	case schema.TtsRequestObjectSegmentsItemAsSsfmV21TextVoice4e8a729e:
		r := value.Value
		s = speech{model: "ssfm-v21", text: r.Text, voice: r.Voice, language: "auto", emotion: "normal", speed: r.Speed, pitch: r.PitchSemitones, seed: r.RandomSeed}
		if r.Language.Present {
			s.language = r.Language.Value.LiteralValue()
		}
		s.intensity = r.EmotionIntensity
		if r.Emotion.Present {
			s.emotion = r.Emotion.Value.LiteralValue()
		}
		s.volume = r.VolumeScale
	case schema.TtsRequestObjectSegmentsItemAsSsfmV30TextVoiceaa70b792:
		r := value.Value
		s = speech{model: "ssfm-v30", text: r.Text, voice: r.Voice, language: "auto", emotion: "normal", speed: r.Speed, pitch: r.PitchSemitones, seed: r.RandomSeed}
		if r.Language.Present {
			s.language = r.Language.Value.LiteralValue()
		}
		s.intensity = r.EmotionIntensity
		if r.Emotion.Present {
			s.emotion = r.Emotion.Value.LiteralValue()
		}
		s.loudness = runtime.Some(r.TargetLoudnessLufs)
	case schema.TtsRequestObjectSegmentsItemAsSsfmV30TextVoice0a18e1a3:
		r := value.Value
		s = speech{model: "ssfm-v30", text: r.Text, voice: r.Voice, language: "auto", emotion: "normal", speed: r.Speed, pitch: r.PitchSemitones, seed: r.RandomSeed}
		if r.Language.Present {
			s.language = r.Language.Value.LiteralValue()
		}
		s.intensity = r.EmotionIntensity
		if r.Emotion.Present {
			s.emotion = r.Emotion.Value.LiteralValue()
		}
		s.volume = r.VolumeScale
	case schema.TtsRequestObjectSegmentsItemAsSsfmV30TextVoice0e2e956c:
		r := value.Value
		s = speech{model: "ssfm-v30", text: r.Text, voice: r.Voice, language: "auto", emotion: "normal", speed: r.Speed, pitch: r.PitchSemitones, seed: r.RandomSeed}
		if r.Language.Present {
			s.language = r.Language.Value.LiteralValue()
		}
		s.emotion = "auto"
		if r.ContextBefore.Present {
			s.before = r.ContextBefore.Value.Text
		}
		if r.ContextAfter.Present {
			s.after = r.ContextAfter.Value.Text
		}
		s.loudness = runtime.Some(r.TargetLoudnessLufs)
	case schema.TtsRequestObjectSegmentsItemAsSsfmV30TextVoice9cf1a777:
		r := value.Value
		s = speech{model: "ssfm-v30", text: r.Text, voice: r.Voice, language: "auto", emotion: "normal", speed: r.Speed, pitch: r.PitchSemitones, seed: r.RandomSeed}
		if r.Language.Present {
			s.language = r.Language.Value.LiteralValue()
		}
		s.emotion = "auto"
		if r.ContextBefore.Present {
			s.before = r.ContextBefore.Value.Text
		}
		if r.ContextAfter.Present {
			s.after = r.ContextAfter.Value.Text
		}
		s.volume = r.VolumeScale
	default:
		return nil, "", 0, errors.New("Unsupported generated Typecast segment representation")
	}
	result := s.wire(format)
	result["type"] = "tts"
	return result, s.text, 0, nil
}

func output(value any) (string, float64, error) {
	switch v := value.(type) {
	case *schema.TtsRequestObjectOutputAsWav:
		return output(*v)
	case *schema.TtsRequestObjectOutputAsMp3:
		return output(*v)
	case *schema.TtsRequestSsfmV21TextVoicef82be0f4OutputAsWav:
		return output(*v)
	case *schema.TtsRequestSsfmV21TextVoicef82be0f4OutputAsMp3:
		return output(*v)
	case schema.TtsRequestObjectOutputAsWav:
		if v.Value.SampleRateHz.Present {
			return "wav", v.Value.SampleRateHz.Value.Value(), nil
		}
		return "wav", 0, nil
	case schema.TtsRequestObjectOutputAsMp3, schema.TtsRequestSsfmV21TextVoicef82be0f4OutputAsMp3:
		return "mp3", 44100, nil
	case schema.TtsRequestSsfmV21TextVoicef82be0f4OutputAsWav:
		if v.Value.SampleRateHz.Present {
			return "wav", v.Value.SampleRateHz.Value.LiteralValue(), nil
		}
		return "wav", 0, nil
	default:
		return "", 0, errors.New("Unsupported generated Typecast output representation")
	}
}

func timing(value schema.TtsRequestSsfmV21TextVoicec8409957TimestampGranularity) (bool, bool, error) {
	switch v := value.(type) {
	case *schema.TtsRequestSsfmV21TextVoicec8409957TimestampGranularityAsWord:
		return timing(*v)
	case *schema.TtsRequestSsfmV21TextVoicec8409957TimestampGranularityAsCharacter:
		return timing(*v)
	case *schema.TtsRequestSsfmV21TextVoicec8409957TimestampGranularityAsArray:
		return timing(*v)
	case schema.TtsRequestSsfmV21TextVoicec8409957TimestampGranularityAsWord:
		return true, false, nil
	case schema.TtsRequestSsfmV21TextVoicec8409957TimestampGranularityAsCharacter:
		return false, true, nil
	case schema.TtsRequestSsfmV21TextVoicec8409957TimestampGranularityAsArray:
		words, characters := false, false
		for _, kind := range v.Value {
			words = words || kind.LiteralValue() == "word"
			characters = characters || kind.LiteralValue() == "character"
		}
		return words, characters, nil
	default:
		return false, false, errors.New("Unsupported generated Typecast timestamp selection")
	}
}
