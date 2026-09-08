package microsoft

import (
	"errors"
	schema "github.com/speechswitch/client/sdks/go/generated/microsoft"
	"github.com/speechswitch/client/sdks/go/runtime"
	"strconv"
	"strings"
)

type configuration struct {
	input          runtime.Input[string]
	markup, format string
	wave, timed    bool
	tracks         map[string]bool
	native         map[string]any
}

// Generated validation precedes these explicit wire conversions.
func settings(request schema.TtsRequest) (configuration, error) {
	c := configuration{tracks: map[string]bool{}, native: map[string]any{}}
	model, voice, text := "neural", "", ""
	var output any
	var outputPresent bool
	var language, emotion, lexicon runtime.Optional[string]
	var languages runtime.Optional[[]string]
	var temperature, speed, pitch, volume, topK, topP, guidance runtime.Optional[float64]
	var enhance runtime.Optional[schema.TtsRequestDragonHdTextVoiceNamedEntityPronunciationEnhancement]
	raw := false
	switch r := request.(type) {
	case *schema.TtsRequestAsDragonHdFlashTextVoice:
		return settings(*r)
	case schema.TtsRequestAsDragonHdFlashTextVoice:
		outputPresent = r.Value.Output.Present
		model, voice, text, output, emotion = r.Value.Model.Value(), r.Value.Voice, r.Value.Text, r.Value.Output.Value, r.Value.Emotion
		if r.Value.Language.Present {
			language = runtime.Some(r.Value.Language.Value.LiteralValue())
		}
	case *schema.TtsRequestAsDragonHdFlashStreamingTextVoice:
		return settings(*r)
	case schema.TtsRequestAsDragonHdFlashStreamingTextVoice:
		outputPresent = r.Value.Output.Present
		model, voice, c.input, output, emotion = r.Value.Model.Value(), r.Value.Voice, r.Value.Text, r.Value.Output.Value, r.Value.Emotion
		if r.Value.Language.Present {
			language = runtime.Some(r.Value.Language.Value.LiteralValue())
		}
		lexicon, languages = r.Value.LexiconUrl, r.Value.PreferredLanguages
	case *schema.TtsRequestAsDragonHdTextVoice:
		return settings(*r)
	case schema.TtsRequestAsDragonHdTextVoice:
		outputPresent = r.Value.Output.Present
		model, voice, text, output, language, temperature, enhance = r.Value.Model.Value(), r.Value.Voice, r.Value.Text, r.Value.Output.Value, r.Value.Language, r.Value.Temperature, r.Value.NamedEntityPronunciationEnhancement
	case *schema.TtsRequestAsDragonHdStreamingTextVoice:
		return settings(*r)
	case schema.TtsRequestAsDragonHdStreamingTextVoice:
		outputPresent = r.Value.Output.Present
		model, voice, c.input, output, language, temperature = r.Value.Model.Value(), r.Value.Voice, r.Value.Text, r.Value.Output.Value, r.Value.Language, r.Value.Temperature
		lexicon, languages = r.Value.LexiconUrl, r.Value.PreferredLanguages
	case *schema.TtsRequestAsTextVoicefd836b1e:
		return settings(*r)
	case schema.TtsRequestAsTextVoicefd836b1e:
		outputPresent = r.Value.Output.Present
		model, voice, text, output, language, emotion = r.Value.Model.LiteralValue(), r.Value.Voice, r.Value.Text, r.Value.Output.Value, r.Value.Language, r.Value.Emotion
	case *schema.TtsRequestAsStreamingTextVoicee690c86a:
		return settings(*r)
	case schema.TtsRequestAsStreamingTextVoicee690c86a:
		outputPresent = r.Value.Output.Present
		model, voice, c.input, output, language, emotion = r.Value.Model.LiteralValue(), r.Value.Voice, r.Value.Text, r.Value.Output.Value, r.Value.Language, r.Value.Emotion
		lexicon, languages = r.Value.LexiconUrl, r.Value.PreferredLanguages
	case *schema.TtsRequestAsTextVoice4ff226b4:
		return settings(*r)
	case schema.TtsRequestAsTextVoice4ff226b4:
		outputPresent = r.Value.Output.Present
		voice, text, output, language, emotion = r.Value.Voice, r.Value.Text, r.Value.Output.Value, r.Value.Language, r.Value.Emotion
		speed, pitch, volume = r.Value.Speed, r.Value.PitchSemitones, r.Value.VolumeScale
	case *schema.TtsRequestAsStreamingTextVoicee86a65c0:
		return settings(*r)
	case schema.TtsRequestAsStreamingTextVoicee86a65c0:
		outputPresent = r.Value.Output.Present
		voice, c.input, output, language, emotion = r.Value.Voice, r.Value.Text, r.Value.Output.Value, r.Value.Language, r.Value.Emotion
		speed, pitch, volume = r.Value.Speed, r.Value.PitchSemitones, r.Value.VolumeScale
		lexicon, languages = r.Value.LexiconUrl, r.Value.PreferredLanguages
		c.timed = r.Value.TimestampGranularity.Present
		if c.timed {
			tracks(r.Value.TimestampGranularity.Value, c.tracks)
		}
	case *schema.TtsRequestAsTextVoicef6245d6f:
		return settings(*r)
	case schema.TtsRequestAsTextVoicef6245d6f:
		outputPresent = r.Value.Output.Present
		voice, text, output, language, emotion = r.Value.Voice, r.Value.Text, r.Value.Output.Value, r.Value.Language, r.Value.Emotion
		speed, pitch, volume = r.Value.Speed, r.Value.PitchSemitones, r.Value.VolumeScale
		c.timed = true
		tracks(r.Value.TimestampGranularity, c.tracks)
	case *schema.TtsRequestAsDragonHdOmniTextVoicea5a77562:
		return settings(*r)
	case schema.TtsRequestAsDragonHdOmniTextVoicea5a77562:
		outputPresent = r.Value.Output.Present
		model, voice, text, output, language, emotion, temperature = r.Value.Model.Value(), r.Value.Voice, r.Value.Text, r.Value.Output.Value, r.Value.Language, r.Value.Emotion, r.Value.Temperature
		topK, topP, guidance = r.Value.TopK, r.Value.TopP, r.Value.VoiceGuidance
	case *schema.TtsRequestAsDragonHdOmniStreamingTextVoice:
		return settings(*r)
	case schema.TtsRequestAsDragonHdOmniStreamingTextVoice:
		outputPresent = r.Value.Output.Present
		model, voice, c.input, output, language, emotion, temperature = r.Value.Model.Value(), r.Value.Voice, r.Value.Text, r.Value.Output.Value, r.Value.Language, r.Value.Emotion, r.Value.Temperature
		lexicon, languages = r.Value.LexiconUrl, r.Value.PreferredLanguages
		c.timed = r.Value.TimestampGranularity.Present
		if c.timed {
			c.tracks["word"] = true
		}
	case *schema.TtsRequestAsDragonHdOmniTextVoice4088531e:
		return settings(*r)
	case schema.TtsRequestAsDragonHdOmniTextVoice4088531e:
		outputPresent = r.Value.Output.Present
		model, voice, text, output, language, emotion, temperature = r.Value.Model.Value(), r.Value.Voice, r.Value.Text, r.Value.Output.Value, r.Value.Language, r.Value.Emotion, r.Value.Temperature
		topK, topP, guidance = r.Value.TopK, r.Value.TopP, r.Value.VoiceGuidance
		c.timed = true
		c.tracks["word"] = true
	case *schema.TtsRequestAsText404f3d9b:
		return settings(*r)
	case schema.TtsRequestAsText404f3d9b:
		outputPresent = r.Value.Output.Present
		text, output, raw = r.Value.Text, r.Value.Output.Value, true
	case *schema.TtsRequestAsText686f0afb:
		return settings(*r)
	case schema.TtsRequestAsText686f0afb:
		outputPresent = r.Value.Output.Present
		text, output, raw = r.Value.Text, r.Value.Output.Value, true
		c.timed = true
		tracks(r.Value.TimestampGranularity, c.tracks)
	}
	if !outputPresent {
		output = nil
	}
	c.format, c.wave = audioFormat(output)
	if raw {
		c.markup = text
		return c, nil
	}
	suffix := map[string]string{"dragon-hd": ":DragonHDLatestNeural", "dragon-hd-omni": ":DragonHDOmniLatestNeural", "dragon-hd-flash": ":DragonHDFlashLatestNeural", "mai-voice-2": ":MAI-Voice-2", "mai-voice-2-flash": ":MAI-Voice-2-Flash"}[model]
	voice += suffix
	locale := "en-US"
	if language.Present {
		locale = language.Value
	}
	c.native = map[string]any{"bidirectionalStreamingMode": true, "voiceName": voice, "language": locale}
	if !temperature.Present {
		if model == "dragon-hd" {
			temperature = runtime.Some(1.0)
		} else if model == "dragon-hd-omni" {
			temperature = runtime.Some(0.7)
		}
	}
	var parameters []string
	if temperature.Present {
		value := strconv.FormatFloat(temperature.Value, 'f', -1, 64)
		c.native["temperature"] = value
		parameters = append(parameters, "temperature="+value)
	}
	for _, entry := range []struct {
		name  string
		value runtime.Optional[float64]
	}{{"top_p", topP}, {"top_k", topK}, {"cfg_scale", guidance}} {
		if entry.value.Present {
			parameters = append(parameters, entry.name+"="+strconv.FormatFloat(entry.value.Value, 'f', -1, 64))
		}
	}
	if enhance.Present {
		parameters = append(parameters, "enhancePronunciation="+strconv.FormatBool(enhance.Value.LiteralValue()))
	}
	if speed.Present {
		c.native["rate"] = strconv.FormatFloat(speed.Value, 'f', -1, 64)
	}
	if pitch.Present {
		sign := ""
		if pitch.Value >= 0 {
			sign = "+"
		}
		c.native["pitch"] = sign + strconv.FormatFloat(pitch.Value, 'f', -1, 64) + "st"
	}
	if volume.Present {
		c.native["volume"] = strconv.FormatFloat(volume.Value*100, 'f', -1, 64)
	}
	if emotion.Present {
		c.native["style"] = emotion.Value
	}
	if lexicon.Present {
		c.native["customLexiconUrl"] = lexicon.Value
	}
	if languages.Present {
		for _, value := range languages.Value {
			if strings.ContainsAny(value, ",\r\n") {
				return c, errors.New("Microsoft preferred languages cannot contain commas or line breaks")
			}
		}
		c.native["preferLocales"] = strings.Join(languages.Value, ",")
	}
	if c.input != nil {
		return c, nil
	}
	body := xml(text)
	hd := strings.HasPrefix(model, "dragon-hd")
	if hd && language.Present {
		body = "<lang xml:lang=\"" + xml(locale) + "\">" + body + "</lang>"
	}
	prosody := ""
	for _, key := range []string{"rate", "pitch", "volume"} {
		if value, ok := c.native[key]; ok {
			prosody += " " + key + "=\"" + value.(string) + "\""
		}
	}
	if prosody != "" {
		body = "<prosody" + prosody + ">" + body + "</prosody>"
	}
	if emotion.Present {
		body = "<mstts:express-as style=\"" + xml(emotion.Value) + "\">" + body + "</mstts:express-as>"
	}
	params := ""
	if len(parameters) > 0 {
		params = " parameters=\"" + xml(strings.Join(parameters, ";")) + "\""
	}
	if hd {
		locale = "en-US"
	}
	c.markup = "<speak version=\"1.0\" xmlns=\"http://www.w3.org/2001/10/synthesis\" xmlns:mstts=\"http://www.w3.org/2001/mstts\" xml:lang=\"" + xml(locale) + "\"><voice name=\"" + xml(voice) + "\"" + params + ">" + body + "</voice></speak>"
	return c, nil
}

func xml(value string) string {
	return strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", "\"", "&quot;", "'", "&apos;").Replace(value)
}

func tracks(value any, result map[string]bool) {
	switch v := value.(type) {
	case *schema.TtsRequestStreamingTextVoicee86a65c0TimestampGranularityAsSentence:
		tracks(*v, result)
	case schema.TtsRequestStreamingTextVoicee86a65c0TimestampGranularityAsSentence:
		result[v.Value.Value()] = true
	case *schema.TtsRequestStreamingTextVoicee86a65c0TimestampGranularityAsWord:
		tracks(*v, result)
	case schema.TtsRequestStreamingTextVoicee86a65c0TimestampGranularityAsWord:
		result[v.Value.Value()] = true
	case *schema.TtsRequestStreamingTextVoicee86a65c0TimestampGranularityAsArray:
		tracks(*v, result)
	case schema.TtsRequestStreamingTextVoicee86a65c0TimestampGranularityAsArray:
		for _, item := range v.Value {
			result[item.LiteralValue()] = true
		}
	case *schema.TtsRequestText686f0afbTimestampGranularityAsSentence:
		tracks(*v, result)
	case schema.TtsRequestText686f0afbTimestampGranularityAsSentence:
		result[v.Value.Value()] = true
	case *schema.TtsRequestText686f0afbTimestampGranularityAsWord:
		tracks(*v, result)
	case schema.TtsRequestText686f0afbTimestampGranularityAsWord:
		result[v.Value.Value()] = true
	case *schema.TtsRequestText686f0afbTimestampGranularityAsSsml:
		tracks(*v, result)
	case schema.TtsRequestText686f0afbTimestampGranularityAsSsml:
		result[v.Value.Value()] = true
	case *schema.TtsRequestText686f0afbTimestampGranularityAsViseme:
		tracks(*v, result)
	case schema.TtsRequestText686f0afbTimestampGranularityAsViseme:
		result[v.Value.Value()] = true
	case *schema.TtsRequestText686f0afbTimestampGranularityAsArray:
		tracks(*v, result)
	case schema.TtsRequestText686f0afbTimestampGranularityAsArray:
		for _, item := range v.Value {
			result[item.LiteralValue()] = true
		}
	}
}
