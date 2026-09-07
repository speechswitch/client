package minimax

import (
	"errors"
	schema "github.com/speechswitch/client/sdks/go/generated/minimax"
	"github.com/speechswitch/client/sdks/go/runtime"
)

type Input = schema.TtsRequestStreamingText12421ea0TextItem

type configuration struct {
	text      string
	input     runtime.Input[Input]
	wire      map[string]any
	streaming bool
	timing    string
}

// Generated validation precedes these explicit wire conversions.
func settings(request schema.TtsRequest) (configuration, error) {
	c := configuration{}
	model, voice, language := "speech-2.8-hd", "", ""
	var output any
	var speed, volume, pitch runtime.Optional[float64]
	var emotion runtime.Optional[string]
	var normalize, split runtime.Optional[bool]
	var replacements runtime.Optional[[]schema.TtsRequestText77d171beReplacementsItem]
	var blend []schema.TtsRequestText77d171beVoiceBlendItem
	var transform runtime.Optional[schema.TtsRequestText77d171beVoiceTransform]
	formula := false
	switch r := request.(type) {
	case *schema.TtsRequestAsText77d171be:
		return settings(*r)
	case schema.TtsRequestAsText77d171be:
		speed, volume, pitch, replacements = r.Value.Speed, r.Value.VolumeScale, r.Value.PitchBias, r.Value.Replacements
		c.text = r.Value.Text
		model = r.Value.Model.LiteralValue()
		if r.Value.Language.Present {
			language = r.Value.Language.Value.LiteralValue()
		}
		if r.Value.Emotion.Present {
			emotion = runtime.Some(r.Value.Emotion.Value.LiteralValue())
		}
		if r.Value.Output.Present {
			output = r.Value.Output.Value
		}
		blend = r.Value.VoiceBlend
		transform = runtime.Some(r.Value.VoiceTransform)
		if r.Value.TextNormalization.Present {
			normalize = runtime.Some(r.Value.TextNormalization.Value.LiteralValue())
		}
		if r.Value.TimestampGranularity.Present {
			c.timing = r.Value.TimestampGranularity.Value.LiteralValue()
		}
	case *schema.TtsRequestAsText8a99d813:
		return settings(*r)
	case schema.TtsRequestAsText8a99d813:
		speed, volume, pitch, replacements = r.Value.Speed, r.Value.VolumeScale, r.Value.PitchBias, r.Value.Replacements
		c.text = r.Value.Text
		model = r.Value.Model.LiteralValue()
		if r.Value.Language.Present {
			language = r.Value.Language.Value.Value()
		}
		if r.Value.Emotion.Present {
			emotion = runtime.Some(r.Value.Emotion.Value.LiteralValue())
		}
		if r.Value.Output.Present {
			output = r.Value.Output.Value
		}
		blend = r.Value.VoiceBlend
		transform = runtime.Some(r.Value.VoiceTransform)
		formula = true
		if r.Value.TextNormalization.Present {
			normalize = runtime.Some(r.Value.TextNormalization.Value.LiteralValue())
		}
		if r.Value.TimestampGranularity.Present {
			c.timing = r.Value.TimestampGranularity.Value.LiteralValue()
		}
	case *schema.TtsRequestAsTextf2dcc77e:
		return settings(*r)
	case schema.TtsRequestAsTextf2dcc77e:
		speed, volume, pitch, replacements = r.Value.Speed, r.Value.VolumeScale, r.Value.PitchBias, r.Value.Replacements
		c.text = r.Value.Text
		model = r.Value.Model.LiteralValue()
		if r.Value.Language.Present {
			language = r.Value.Language.Value.Value()
		}
		if r.Value.Emotion.Present {
			emotion = runtime.Some(r.Value.Emotion.Value.LiteralValue())
		}
		if r.Value.Output.Present {
			output = r.Value.Output.Value
		}
		blend = r.Value.VoiceBlend
		formula = true
		if r.Value.TextNormalization.Present {
			normalize = runtime.Some(r.Value.TextNormalization.Value.LiteralValue())
		}
		if r.Value.TimestampGranularity.Present {
			c.timing = r.Value.TimestampGranularity.Value.LiteralValue()
		}
	case *schema.TtsRequestAsTextbc3e8901:
		return settings(*r)
	case schema.TtsRequestAsTextbc3e8901:
		speed, volume, pitch, replacements = r.Value.Speed, r.Value.VolumeScale, r.Value.PitchBias, r.Value.Replacements
		c.text = r.Value.Text
		model = r.Value.Model.LiteralValue()
		if r.Value.Language.Present {
			language = r.Value.Language.Value.LiteralValue()
		}
		if r.Value.Emotion.Present {
			emotion = runtime.Some(r.Value.Emotion.Value.LiteralValue())
		}
		if r.Value.Output.Present {
			output = r.Value.Output.Value
		}
		blend = r.Value.VoiceBlend
		if r.Value.TextNormalization.Present {
			normalize = runtime.Some(r.Value.TextNormalization.Value.LiteralValue())
		}
		if r.Value.TimestampGranularity.Present {
			c.timing = r.Value.TimestampGranularity.Value.LiteralValue()
		}
	case *schema.TtsRequestAsTextVoice9d11e112:
		return settings(*r)
	case schema.TtsRequestAsTextVoice9d11e112:
		speed, volume, pitch, replacements = r.Value.Speed, r.Value.VolumeScale, r.Value.PitchBias, r.Value.Replacements
		c.text = r.Value.Text
		model = r.Value.Model.LiteralValue()
		if r.Value.Language.Present {
			language = r.Value.Language.Value.LiteralValue()
		}
		if r.Value.Emotion.Present {
			emotion = runtime.Some(r.Value.Emotion.Value.LiteralValue())
		}
		if r.Value.Output.Present {
			output = r.Value.Output.Value
		}
		voice = r.Value.Voice
		transform = runtime.Some(r.Value.VoiceTransform)
		if r.Value.TextNormalization.Present {
			normalize = runtime.Some(r.Value.TextNormalization.Value.LiteralValue())
		}
		if r.Value.TimestampGranularity.Present {
			c.timing = r.Value.TimestampGranularity.Value.LiteralValue()
		}
	case *schema.TtsRequestAsTextVoicec9541dfe:
		return settings(*r)
	case schema.TtsRequestAsTextVoicec9541dfe:
		speed, volume, pitch, replacements = r.Value.Speed, r.Value.VolumeScale, r.Value.PitchBias, r.Value.Replacements
		c.text = r.Value.Text
		model = r.Value.Model.LiteralValue()
		if r.Value.Language.Present {
			language = r.Value.Language.Value.Value()
		}
		if r.Value.Emotion.Present {
			emotion = runtime.Some(r.Value.Emotion.Value.LiteralValue())
		}
		if r.Value.Output.Present {
			output = r.Value.Output.Value
		}
		voice = r.Value.Voice
		transform = runtime.Some(r.Value.VoiceTransform)
		formula = true
		if r.Value.TextNormalization.Present {
			normalize = runtime.Some(r.Value.TextNormalization.Value.LiteralValue())
		}
		if r.Value.TimestampGranularity.Present {
			c.timing = r.Value.TimestampGranularity.Value.LiteralValue()
		}
	case *schema.TtsRequestAsTextVoice579df7d3:
		return settings(*r)
	case schema.TtsRequestAsTextVoice579df7d3:
		speed, volume, pitch, replacements = r.Value.Speed, r.Value.VolumeScale, r.Value.PitchBias, r.Value.Replacements
		c.text = r.Value.Text
		model = r.Value.Model.LiteralValue()
		if r.Value.Language.Present {
			language = r.Value.Language.Value.Value()
		}
		if r.Value.Emotion.Present {
			emotion = runtime.Some(r.Value.Emotion.Value.LiteralValue())
		}
		if r.Value.Output.Present {
			output = r.Value.Output.Value
		}
		voice = r.Value.Voice
		formula = true
		if r.Value.TextNormalization.Present {
			normalize = runtime.Some(r.Value.TextNormalization.Value.LiteralValue())
		}
		if r.Value.TimestampGranularity.Present {
			c.timing = r.Value.TimestampGranularity.Value.LiteralValue()
		}
	case *schema.TtsRequestAsTextVoiceab653629:
		return settings(*r)
	case schema.TtsRequestAsTextVoiceab653629:
		speed, volume, pitch, replacements = r.Value.Speed, r.Value.VolumeScale, r.Value.PitchBias, r.Value.Replacements
		c.text = r.Value.Text
		model = r.Value.Model.LiteralValue()
		if r.Value.Language.Present {
			language = r.Value.Language.Value.LiteralValue()
		}
		if r.Value.Emotion.Present {
			emotion = runtime.Some(r.Value.Emotion.Value.LiteralValue())
		}
		if r.Value.Output.Present {
			output = r.Value.Output.Value
		}
		voice = r.Value.Voice
		if r.Value.TextNormalization.Present {
			normalize = runtime.Some(r.Value.TextNormalization.Value.LiteralValue())
		}
		if r.Value.TimestampGranularity.Present {
			c.timing = r.Value.TimestampGranularity.Value.LiteralValue()
		}
	case *schema.TtsRequestAsStreamingText12421ea0:
		return settings(*r)
	case schema.TtsRequestAsStreamingText12421ea0:
		speed, volume, pitch, replacements = r.Value.Speed, r.Value.VolumeScale, r.Value.PitchBias, r.Value.Replacements
		c.input = r.Value.Text
		model = r.Value.Model.LiteralValue()
		if r.Value.Language.Present {
			language = r.Value.Language.Value.LiteralValue()
		}
		if r.Value.Emotion.Present {
			emotion = runtime.Some(r.Value.Emotion.Value.LiteralValue())
		}
		if r.Value.Output.Present {
			output = r.Value.Output.Value
		}
		blend = r.Value.VoiceBlend
		transform = runtime.Some(r.Value.VoiceTransform)
		if r.Value.LanguageTextNormalization.Present {
			normalize = runtime.Some(r.Value.LanguageTextNormalization.Value.LiteralValue())
		}
	case *schema.TtsRequestAsStreamingText3a58293c:
		return settings(*r)
	case schema.TtsRequestAsStreamingText3a58293c:
		speed, volume, pitch, replacements = r.Value.Speed, r.Value.VolumeScale, r.Value.PitchBias, r.Value.Replacements
		c.input = r.Value.Text
		model = r.Value.Model.LiteralValue()
		if r.Value.Language.Present {
			language = r.Value.Language.Value.Value()
		}
		if r.Value.Emotion.Present {
			emotion = runtime.Some(r.Value.Emotion.Value.LiteralValue())
		}
		if r.Value.Output.Present {
			output = r.Value.Output.Value
		}
		blend = r.Value.VoiceBlend
		transform = runtime.Some(r.Value.VoiceTransform)
		formula = true
		if r.Value.LanguageTextNormalization.Present {
			normalize = runtime.Some(r.Value.LanguageTextNormalization.Value.LiteralValue())
		}
	case *schema.TtsRequestAsStreamingTextaa771f19:
		return settings(*r)
	case schema.TtsRequestAsStreamingTextaa771f19:
		speed, volume, pitch, replacements = r.Value.Speed, r.Value.VolumeScale, r.Value.PitchBias, r.Value.Replacements
		c.input = r.Value.Text
		model = r.Value.Model.LiteralValue()
		if r.Value.Language.Present {
			language = r.Value.Language.Value.Value()
		}
		if r.Value.Emotion.Present {
			emotion = runtime.Some(r.Value.Emotion.Value.LiteralValue())
		}
		if r.Value.Output.Present {
			output = r.Value.Output.Value
		}
		blend = r.Value.VoiceBlend
		formula = true
		if r.Value.LanguageTextNormalization.Present {
			normalize = runtime.Some(r.Value.LanguageTextNormalization.Value.LiteralValue())
		}
	case *schema.TtsRequestAsStreamingText62be105a:
		return settings(*r)
	case schema.TtsRequestAsStreamingText62be105a:
		speed, volume, pitch, replacements = r.Value.Speed, r.Value.VolumeScale, r.Value.PitchBias, r.Value.Replacements
		c.input = r.Value.Text
		model = r.Value.Model.LiteralValue()
		if r.Value.Language.Present {
			language = r.Value.Language.Value.LiteralValue()
		}
		if r.Value.Emotion.Present {
			emotion = runtime.Some(r.Value.Emotion.Value.LiteralValue())
		}
		if r.Value.Output.Present {
			output = r.Value.Output.Value
		}
		blend = r.Value.VoiceBlend
		if r.Value.LanguageTextNormalization.Present {
			normalize = runtime.Some(r.Value.LanguageTextNormalization.Value.LiteralValue())
		}
	case *schema.TtsRequestAsStreamingTextVoice6d21fc54:
		return settings(*r)
	case schema.TtsRequestAsStreamingTextVoice6d21fc54:
		speed, volume, pitch, replacements = r.Value.Speed, r.Value.VolumeScale, r.Value.PitchBias, r.Value.Replacements
		c.input = r.Value.Text
		model = r.Value.Model.LiteralValue()
		if r.Value.Language.Present {
			language = r.Value.Language.Value.LiteralValue()
		}
		if r.Value.Emotion.Present {
			emotion = runtime.Some(r.Value.Emotion.Value.LiteralValue())
		}
		if r.Value.Output.Present {
			output = r.Value.Output.Value
		}
		voice = r.Value.Voice
		transform = runtime.Some(r.Value.VoiceTransform)
		if r.Value.LanguageTextNormalization.Present {
			normalize = runtime.Some(r.Value.LanguageTextNormalization.Value.LiteralValue())
		}
	case *schema.TtsRequestAsStreamingTextVoice80c0de17:
		return settings(*r)
	case schema.TtsRequestAsStreamingTextVoice80c0de17:
		speed, volume, pitch, replacements = r.Value.Speed, r.Value.VolumeScale, r.Value.PitchBias, r.Value.Replacements
		c.input = r.Value.Text
		model = r.Value.Model.LiteralValue()
		if r.Value.Language.Present {
			language = r.Value.Language.Value.Value()
		}
		if r.Value.Emotion.Present {
			emotion = runtime.Some(r.Value.Emotion.Value.LiteralValue())
		}
		if r.Value.Output.Present {
			output = r.Value.Output.Value
		}
		voice = r.Value.Voice
		transform = runtime.Some(r.Value.VoiceTransform)
		formula = true
		if r.Value.LanguageTextNormalization.Present {
			normalize = runtime.Some(r.Value.LanguageTextNormalization.Value.LiteralValue())
		}
	case *schema.TtsRequestAsStreamingTextVoiceb9340145:
		return settings(*r)
	case schema.TtsRequestAsStreamingTextVoiceb9340145:
		speed, volume, pitch, replacements = r.Value.Speed, r.Value.VolumeScale, r.Value.PitchBias, r.Value.Replacements
		c.input = r.Value.Text
		model = r.Value.Model.LiteralValue()
		if r.Value.Language.Present {
			language = r.Value.Language.Value.Value()
		}
		if r.Value.Emotion.Present {
			emotion = runtime.Some(r.Value.Emotion.Value.LiteralValue())
		}
		if r.Value.Output.Present {
			output = r.Value.Output.Value
		}
		voice = r.Value.Voice
		formula = true
		if r.Value.LanguageTextNormalization.Present {
			normalize = runtime.Some(r.Value.LanguageTextNormalization.Value.LiteralValue())
		}
	case *schema.TtsRequestAsStreamingTextVoice40504229:
		return settings(*r)
	case schema.TtsRequestAsStreamingTextVoice40504229:
		speed, volume, pitch, replacements = r.Value.Speed, r.Value.VolumeScale, r.Value.PitchBias, r.Value.Replacements
		c.input = r.Value.Text
		model = r.Value.Model.LiteralValue()
		if r.Value.Language.Present {
			language = r.Value.Language.Value.LiteralValue()
		}
		if r.Value.Emotion.Present {
			emotion = runtime.Some(r.Value.Emotion.Value.LiteralValue())
		}
		if r.Value.Output.Present {
			output = r.Value.Output.Value
		}
		voice = r.Value.Voice
		if r.Value.LanguageTextNormalization.Present {
			normalize = runtime.Some(r.Value.LanguageTextNormalization.Value.LiteralValue())
		}
	case *schema.TtsRequestAsTexte253c939:
		return settings(*r)
	case schema.TtsRequestAsTexte253c939:
		speed, volume, pitch, replacements = r.Value.Speed, r.Value.VolumeScale, r.Value.PitchBias, r.Value.Replacements
		c.text = r.Value.Text
		model = r.Value.Model.LiteralValue()
		if r.Value.Language.Present {
			language = r.Value.Language.Value.LiteralValue()
		}
		if r.Value.Emotion.Present {
			emotion = runtime.Some(r.Value.Emotion.Value.LiteralValue())
		}
		if r.Value.Output.Present {
			output = r.Value.Output.Value
		}
		blend = r.Value.VoiceBlend
		transform = runtime.Some(r.Value.VoiceTransform)
		if r.Value.TextNormalization.Present {
			normalize = runtime.Some(r.Value.TextNormalization.Value.LiteralValue())
		}
		if r.Value.TimestampGranularity.Present {
			c.timing = r.Value.TimestampGranularity.Value.LiteralValue()
		}
	case *schema.TtsRequestAsText75fe6b00:
		return settings(*r)
	case schema.TtsRequestAsText75fe6b00:
		speed, volume, pitch, replacements = r.Value.Speed, r.Value.VolumeScale, r.Value.PitchBias, r.Value.Replacements
		c.text = r.Value.Text
		model = r.Value.Model.LiteralValue()
		if r.Value.Language.Present {
			language = r.Value.Language.Value.Value()
		}
		if r.Value.Emotion.Present {
			emotion = runtime.Some(r.Value.Emotion.Value.LiteralValue())
		}
		if r.Value.Output.Present {
			output = r.Value.Output.Value
		}
		blend = r.Value.VoiceBlend
		transform = runtime.Some(r.Value.VoiceTransform)
		formula = true
		if r.Value.TextNormalization.Present {
			normalize = runtime.Some(r.Value.TextNormalization.Value.LiteralValue())
		}
		if r.Value.TimestampGranularity.Present {
			c.timing = r.Value.TimestampGranularity.Value.LiteralValue()
		}
	case *schema.TtsRequestAsText1ddad1c5:
		return settings(*r)
	case schema.TtsRequestAsText1ddad1c5:
		speed, volume, pitch, replacements = r.Value.Speed, r.Value.VolumeScale, r.Value.PitchBias, r.Value.Replacements
		c.text = r.Value.Text
		model = r.Value.Model.LiteralValue()
		if r.Value.Language.Present {
			language = r.Value.Language.Value.Value()
		}
		if r.Value.Emotion.Present {
			emotion = runtime.Some(r.Value.Emotion.Value.LiteralValue())
		}
		if r.Value.Output.Present {
			output = r.Value.Output.Value
		}
		blend = r.Value.VoiceBlend
		formula = true
		if r.Value.TextNormalization.Present {
			normalize = runtime.Some(r.Value.TextNormalization.Value.LiteralValue())
		}
		if r.Value.TimestampGranularity.Present {
			c.timing = r.Value.TimestampGranularity.Value.LiteralValue()
		}
	case *schema.TtsRequestAsText7c0eb1eb:
		return settings(*r)
	case schema.TtsRequestAsText7c0eb1eb:
		speed, volume, pitch, replacements = r.Value.Speed, r.Value.VolumeScale, r.Value.PitchBias, r.Value.Replacements
		c.text = r.Value.Text
		model = r.Value.Model.LiteralValue()
		if r.Value.Language.Present {
			language = r.Value.Language.Value.LiteralValue()
		}
		if r.Value.Emotion.Present {
			emotion = runtime.Some(r.Value.Emotion.Value.LiteralValue())
		}
		if r.Value.Output.Present {
			output = r.Value.Output.Value
		}
		blend = r.Value.VoiceBlend
		if r.Value.TextNormalization.Present {
			normalize = runtime.Some(r.Value.TextNormalization.Value.LiteralValue())
		}
		if r.Value.TimestampGranularity.Present {
			c.timing = r.Value.TimestampGranularity.Value.LiteralValue()
		}
	case *schema.TtsRequestAsTextVoicedd885701:
		return settings(*r)
	case schema.TtsRequestAsTextVoicedd885701:
		speed, volume, pitch, replacements = r.Value.Speed, r.Value.VolumeScale, r.Value.PitchBias, r.Value.Replacements
		c.text = r.Value.Text
		model = r.Value.Model.LiteralValue()
		if r.Value.Language.Present {
			language = r.Value.Language.Value.LiteralValue()
		}
		if r.Value.Emotion.Present {
			emotion = runtime.Some(r.Value.Emotion.Value.LiteralValue())
		}
		if r.Value.Output.Present {
			output = r.Value.Output.Value
		}
		voice = r.Value.Voice
		transform = runtime.Some(r.Value.VoiceTransform)
		if r.Value.TextNormalization.Present {
			normalize = runtime.Some(r.Value.TextNormalization.Value.LiteralValue())
		}
		if r.Value.TimestampGranularity.Present {
			c.timing = r.Value.TimestampGranularity.Value.LiteralValue()
		}
	case *schema.TtsRequestAsTextVoice36766bcb:
		return settings(*r)
	case schema.TtsRequestAsTextVoice36766bcb:
		speed, volume, pitch, replacements = r.Value.Speed, r.Value.VolumeScale, r.Value.PitchBias, r.Value.Replacements
		c.text = r.Value.Text
		model = r.Value.Model.LiteralValue()
		if r.Value.Language.Present {
			language = r.Value.Language.Value.Value()
		}
		if r.Value.Emotion.Present {
			emotion = runtime.Some(r.Value.Emotion.Value.LiteralValue())
		}
		if r.Value.Output.Present {
			output = r.Value.Output.Value
		}
		voice = r.Value.Voice
		transform = runtime.Some(r.Value.VoiceTransform)
		formula = true
		if r.Value.TextNormalization.Present {
			normalize = runtime.Some(r.Value.TextNormalization.Value.LiteralValue())
		}
		if r.Value.TimestampGranularity.Present {
			c.timing = r.Value.TimestampGranularity.Value.LiteralValue()
		}
	case *schema.TtsRequestAsTextVoicea492ec5e:
		return settings(*r)
	case schema.TtsRequestAsTextVoicea492ec5e:
		speed, volume, pitch, replacements = r.Value.Speed, r.Value.VolumeScale, r.Value.PitchBias, r.Value.Replacements
		c.text = r.Value.Text
		model = r.Value.Model.LiteralValue()
		if r.Value.Language.Present {
			language = r.Value.Language.Value.Value()
		}
		if r.Value.Emotion.Present {
			emotion = runtime.Some(r.Value.Emotion.Value.LiteralValue())
		}
		if r.Value.Output.Present {
			output = r.Value.Output.Value
		}
		voice = r.Value.Voice
		formula = true
		if r.Value.TextNormalization.Present {
			normalize = runtime.Some(r.Value.TextNormalization.Value.LiteralValue())
		}
		if r.Value.TimestampGranularity.Present {
			c.timing = r.Value.TimestampGranularity.Value.LiteralValue()
		}
	case *schema.TtsRequestAsTextVoicecbe3fac7:
		return settings(*r)
	case schema.TtsRequestAsTextVoicecbe3fac7:
		speed, volume, pitch, replacements = r.Value.Speed, r.Value.VolumeScale, r.Value.PitchBias, r.Value.Replacements
		c.text = r.Value.Text
		model = r.Value.Model.LiteralValue()
		if r.Value.Language.Present {
			language = r.Value.Language.Value.LiteralValue()
		}
		if r.Value.Emotion.Present {
			emotion = runtime.Some(r.Value.Emotion.Value.LiteralValue())
		}
		if r.Value.Output.Present {
			output = r.Value.Output.Value
		}
		voice = r.Value.Voice
		if r.Value.TextNormalization.Present {
			normalize = runtime.Some(r.Value.TextNormalization.Value.LiteralValue())
		}
		if r.Value.TimestampGranularity.Present {
			c.timing = r.Value.TimestampGranularity.Value.LiteralValue()
		}
	case *schema.TtsRequestAsStreamingText81902e1a:
		return settings(*r)
	case schema.TtsRequestAsStreamingText81902e1a:
		speed, volume, pitch, replacements = r.Value.Speed, r.Value.VolumeScale, r.Value.PitchBias, r.Value.Replacements
		c.input = r.Value.Text
		model = r.Value.Model.LiteralValue()
		if r.Value.Language.Present {
			language = r.Value.Language.Value.LiteralValue()
		}
		if r.Value.Emotion.Present {
			emotion = runtime.Some(r.Value.Emotion.Value.LiteralValue())
		}
		if r.Value.Output.Present {
			output = r.Value.Output.Value
		}
		blend = r.Value.VoiceBlend
		transform = runtime.Some(r.Value.VoiceTransform)
		if r.Value.LanguageTextNormalization.Present {
			normalize = runtime.Some(r.Value.LanguageTextNormalization.Value.LiteralValue())
		}
	case *schema.TtsRequestAsStreamingText909fab39:
		return settings(*r)
	case schema.TtsRequestAsStreamingText909fab39:
		speed, volume, pitch, replacements = r.Value.Speed, r.Value.VolumeScale, r.Value.PitchBias, r.Value.Replacements
		c.input = r.Value.Text
		model = r.Value.Model.LiteralValue()
		if r.Value.Language.Present {
			language = r.Value.Language.Value.Value()
		}
		if r.Value.Emotion.Present {
			emotion = runtime.Some(r.Value.Emotion.Value.LiteralValue())
		}
		if r.Value.Output.Present {
			output = r.Value.Output.Value
		}
		blend = r.Value.VoiceBlend
		transform = runtime.Some(r.Value.VoiceTransform)
		formula = true
		if r.Value.LanguageTextNormalization.Present {
			normalize = runtime.Some(r.Value.LanguageTextNormalization.Value.LiteralValue())
		}
	case *schema.TtsRequestAsStreamingText67fca2f3:
		return settings(*r)
	case schema.TtsRequestAsStreamingText67fca2f3:
		speed, volume, pitch, replacements = r.Value.Speed, r.Value.VolumeScale, r.Value.PitchBias, r.Value.Replacements
		c.input = r.Value.Text
		model = r.Value.Model.LiteralValue()
		if r.Value.Language.Present {
			language = r.Value.Language.Value.Value()
		}
		if r.Value.Emotion.Present {
			emotion = runtime.Some(r.Value.Emotion.Value.LiteralValue())
		}
		if r.Value.Output.Present {
			output = r.Value.Output.Value
		}
		blend = r.Value.VoiceBlend
		formula = true
		if r.Value.LanguageTextNormalization.Present {
			normalize = runtime.Some(r.Value.LanguageTextNormalization.Value.LiteralValue())
		}
	case *schema.TtsRequestAsStreamingText5ae80cbf:
		return settings(*r)
	case schema.TtsRequestAsStreamingText5ae80cbf:
		speed, volume, pitch, replacements = r.Value.Speed, r.Value.VolumeScale, r.Value.PitchBias, r.Value.Replacements
		c.input = r.Value.Text
		model = r.Value.Model.LiteralValue()
		if r.Value.Language.Present {
			language = r.Value.Language.Value.LiteralValue()
		}
		if r.Value.Emotion.Present {
			emotion = runtime.Some(r.Value.Emotion.Value.LiteralValue())
		}
		if r.Value.Output.Present {
			output = r.Value.Output.Value
		}
		blend = r.Value.VoiceBlend
		if r.Value.LanguageTextNormalization.Present {
			normalize = runtime.Some(r.Value.LanguageTextNormalization.Value.LiteralValue())
		}
	case *schema.TtsRequestAsStreamingTextVoicee206c70a:
		return settings(*r)
	case schema.TtsRequestAsStreamingTextVoicee206c70a:
		speed, volume, pitch, replacements = r.Value.Speed, r.Value.VolumeScale, r.Value.PitchBias, r.Value.Replacements
		c.input = r.Value.Text
		model = r.Value.Model.LiteralValue()
		if r.Value.Language.Present {
			language = r.Value.Language.Value.LiteralValue()
		}
		if r.Value.Emotion.Present {
			emotion = runtime.Some(r.Value.Emotion.Value.LiteralValue())
		}
		if r.Value.Output.Present {
			output = r.Value.Output.Value
		}
		voice = r.Value.Voice
		transform = runtime.Some(r.Value.VoiceTransform)
		if r.Value.LanguageTextNormalization.Present {
			normalize = runtime.Some(r.Value.LanguageTextNormalization.Value.LiteralValue())
		}
	case *schema.TtsRequestAsStreamingTextVoiceeb83b1ec:
		return settings(*r)
	case schema.TtsRequestAsStreamingTextVoiceeb83b1ec:
		speed, volume, pitch, replacements = r.Value.Speed, r.Value.VolumeScale, r.Value.PitchBias, r.Value.Replacements
		c.input = r.Value.Text
		model = r.Value.Model.LiteralValue()
		if r.Value.Language.Present {
			language = r.Value.Language.Value.Value()
		}
		if r.Value.Emotion.Present {
			emotion = runtime.Some(r.Value.Emotion.Value.LiteralValue())
		}
		if r.Value.Output.Present {
			output = r.Value.Output.Value
		}
		voice = r.Value.Voice
		transform = runtime.Some(r.Value.VoiceTransform)
		formula = true
		if r.Value.LanguageTextNormalization.Present {
			normalize = runtime.Some(r.Value.LanguageTextNormalization.Value.LiteralValue())
		}
	case *schema.TtsRequestAsStreamingTextVoice96bca430:
		return settings(*r)
	case schema.TtsRequestAsStreamingTextVoice96bca430:
		speed, volume, pitch, replacements = r.Value.Speed, r.Value.VolumeScale, r.Value.PitchBias, r.Value.Replacements
		c.input = r.Value.Text
		model = r.Value.Model.LiteralValue()
		if r.Value.Language.Present {
			language = r.Value.Language.Value.Value()
		}
		if r.Value.Emotion.Present {
			emotion = runtime.Some(r.Value.Emotion.Value.LiteralValue())
		}
		if r.Value.Output.Present {
			output = r.Value.Output.Value
		}
		voice = r.Value.Voice
		formula = true
		if r.Value.LanguageTextNormalization.Present {
			normalize = runtime.Some(r.Value.LanguageTextNormalization.Value.LiteralValue())
		}
	case *schema.TtsRequestAsStreamingTextVoice21264c0c:
		return settings(*r)
	case schema.TtsRequestAsStreamingTextVoice21264c0c:
		speed, volume, pitch, replacements = r.Value.Speed, r.Value.VolumeScale, r.Value.PitchBias, r.Value.Replacements
		c.input = r.Value.Text
		model = r.Value.Model.LiteralValue()
		if r.Value.Language.Present {
			language = r.Value.Language.Value.LiteralValue()
		}
		if r.Value.Emotion.Present {
			emotion = runtime.Some(r.Value.Emotion.Value.LiteralValue())
		}
		if r.Value.Output.Present {
			output = r.Value.Output.Value
		}
		voice = r.Value.Voice
		if r.Value.LanguageTextNormalization.Present {
			normalize = runtime.Some(r.Value.LanguageTextNormalization.Value.LiteralValue())
		}
	case *schema.TtsRequestAsText21d6f721:
		return settings(*r)
	case schema.TtsRequestAsText21d6f721:
		speed, volume, pitch, replacements = r.Value.Speed, r.Value.VolumeScale, r.Value.PitchBias, r.Value.Replacements
		c.text = r.Value.Text
		if r.Value.Model.Present {
			model = r.Value.Model.Value.LiteralValue()
		}
		if r.Value.Language.Present {
			language = r.Value.Language.Value.LiteralValue()
		}
		if r.Value.Emotion.Present {
			emotion = runtime.Some(r.Value.Emotion.Value.LiteralValue())
		}
		if r.Value.Output.Present {
			output = r.Value.Output.Value
		}
		blend = r.Value.VoiceBlend
		transform = runtime.Some(r.Value.VoiceTransform)
		if r.Value.TextNormalization.Present {
			normalize = runtime.Some(r.Value.TextNormalization.Value.LiteralValue())
		}
		if r.Value.TimestampGranularity.Present {
			c.timing = r.Value.TimestampGranularity.Value.LiteralValue()
		}
	case *schema.TtsRequestAsText5b5ff955:
		return settings(*r)
	case schema.TtsRequestAsText5b5ff955:
		speed, volume, pitch, replacements = r.Value.Speed, r.Value.VolumeScale, r.Value.PitchBias, r.Value.Replacements
		c.text = r.Value.Text
		if r.Value.Model.Present {
			model = r.Value.Model.Value.LiteralValue()
		}
		if r.Value.Language.Present {
			language = r.Value.Language.Value.Value()
		}
		if r.Value.Emotion.Present {
			emotion = runtime.Some(r.Value.Emotion.Value.LiteralValue())
		}
		if r.Value.Output.Present {
			output = r.Value.Output.Value
		}
		blend = r.Value.VoiceBlend
		transform = runtime.Some(r.Value.VoiceTransform)
		formula = true
		if r.Value.TextNormalization.Present {
			normalize = runtime.Some(r.Value.TextNormalization.Value.LiteralValue())
		}
		if r.Value.TimestampGranularity.Present {
			c.timing = r.Value.TimestampGranularity.Value.LiteralValue()
		}
	case *schema.TtsRequestAsText6f172e70:
		return settings(*r)
	case schema.TtsRequestAsText6f172e70:
		speed, volume, pitch, replacements = r.Value.Speed, r.Value.VolumeScale, r.Value.PitchBias, r.Value.Replacements
		c.text = r.Value.Text
		if r.Value.Model.Present {
			model = r.Value.Model.Value.LiteralValue()
		}
		if r.Value.Language.Present {
			language = r.Value.Language.Value.Value()
		}
		if r.Value.Emotion.Present {
			emotion = runtime.Some(r.Value.Emotion.Value.LiteralValue())
		}
		if r.Value.Output.Present {
			output = r.Value.Output.Value
		}
		blend = r.Value.VoiceBlend
		formula = true
		if r.Value.TextNormalization.Present {
			normalize = runtime.Some(r.Value.TextNormalization.Value.LiteralValue())
		}
		if r.Value.TimestampGranularity.Present {
			c.timing = r.Value.TimestampGranularity.Value.LiteralValue()
		}
	case *schema.TtsRequestAsTexta20d3295:
		return settings(*r)
	case schema.TtsRequestAsTexta20d3295:
		speed, volume, pitch, replacements = r.Value.Speed, r.Value.VolumeScale, r.Value.PitchBias, r.Value.Replacements
		c.text = r.Value.Text
		if r.Value.Model.Present {
			model = r.Value.Model.Value.LiteralValue()
		}
		if r.Value.Language.Present {
			language = r.Value.Language.Value.LiteralValue()
		}
		if r.Value.Emotion.Present {
			emotion = runtime.Some(r.Value.Emotion.Value.LiteralValue())
		}
		if r.Value.Output.Present {
			output = r.Value.Output.Value
		}
		blend = r.Value.VoiceBlend
		if r.Value.TextNormalization.Present {
			normalize = runtime.Some(r.Value.TextNormalization.Value.LiteralValue())
		}
		if r.Value.TimestampGranularity.Present {
			c.timing = r.Value.TimestampGranularity.Value.LiteralValue()
		}
	case *schema.TtsRequestAsTextVoice472a8ec3:
		return settings(*r)
	case schema.TtsRequestAsTextVoice472a8ec3:
		speed, volume, pitch, replacements = r.Value.Speed, r.Value.VolumeScale, r.Value.PitchBias, r.Value.Replacements
		c.text = r.Value.Text
		if r.Value.Model.Present {
			model = r.Value.Model.Value.LiteralValue()
		}
		if r.Value.Language.Present {
			language = r.Value.Language.Value.LiteralValue()
		}
		if r.Value.Emotion.Present {
			emotion = runtime.Some(r.Value.Emotion.Value.LiteralValue())
		}
		if r.Value.Output.Present {
			output = r.Value.Output.Value
		}
		voice = r.Value.Voice
		transform = runtime.Some(r.Value.VoiceTransform)
		if r.Value.TextNormalization.Present {
			normalize = runtime.Some(r.Value.TextNormalization.Value.LiteralValue())
		}
		if r.Value.TimestampGranularity.Present {
			c.timing = r.Value.TimestampGranularity.Value.LiteralValue()
		}
	case *schema.TtsRequestAsTextVoice6862a939:
		return settings(*r)
	case schema.TtsRequestAsTextVoice6862a939:
		speed, volume, pitch, replacements = r.Value.Speed, r.Value.VolumeScale, r.Value.PitchBias, r.Value.Replacements
		c.text = r.Value.Text
		if r.Value.Model.Present {
			model = r.Value.Model.Value.LiteralValue()
		}
		if r.Value.Language.Present {
			language = r.Value.Language.Value.Value()
		}
		if r.Value.Emotion.Present {
			emotion = runtime.Some(r.Value.Emotion.Value.LiteralValue())
		}
		if r.Value.Output.Present {
			output = r.Value.Output.Value
		}
		voice = r.Value.Voice
		transform = runtime.Some(r.Value.VoiceTransform)
		formula = true
		if r.Value.TextNormalization.Present {
			normalize = runtime.Some(r.Value.TextNormalization.Value.LiteralValue())
		}
		if r.Value.TimestampGranularity.Present {
			c.timing = r.Value.TimestampGranularity.Value.LiteralValue()
		}
	case *schema.TtsRequestAsTextVoice7c08f303:
		return settings(*r)
	case schema.TtsRequestAsTextVoice7c08f303:
		speed, volume, pitch, replacements = r.Value.Speed, r.Value.VolumeScale, r.Value.PitchBias, r.Value.Replacements
		c.text = r.Value.Text
		if r.Value.Model.Present {
			model = r.Value.Model.Value.LiteralValue()
		}
		if r.Value.Language.Present {
			language = r.Value.Language.Value.Value()
		}
		if r.Value.Emotion.Present {
			emotion = runtime.Some(r.Value.Emotion.Value.LiteralValue())
		}
		if r.Value.Output.Present {
			output = r.Value.Output.Value
		}
		voice = r.Value.Voice
		formula = true
		if r.Value.TextNormalization.Present {
			normalize = runtime.Some(r.Value.TextNormalization.Value.LiteralValue())
		}
		if r.Value.TimestampGranularity.Present {
			c.timing = r.Value.TimestampGranularity.Value.LiteralValue()
		}
	case *schema.TtsRequestAsTextVoice9b47fc40:
		return settings(*r)
	case schema.TtsRequestAsTextVoice9b47fc40:
		speed, volume, pitch, replacements = r.Value.Speed, r.Value.VolumeScale, r.Value.PitchBias, r.Value.Replacements
		c.text = r.Value.Text
		if r.Value.Model.Present {
			model = r.Value.Model.Value.LiteralValue()
		}
		if r.Value.Language.Present {
			language = r.Value.Language.Value.LiteralValue()
		}
		if r.Value.Emotion.Present {
			emotion = runtime.Some(r.Value.Emotion.Value.LiteralValue())
		}
		if r.Value.Output.Present {
			output = r.Value.Output.Value
		}
		voice = r.Value.Voice
		if r.Value.TextNormalization.Present {
			normalize = runtime.Some(r.Value.TextNormalization.Value.LiteralValue())
		}
		if r.Value.TimestampGranularity.Present {
			c.timing = r.Value.TimestampGranularity.Value.LiteralValue()
		}
	case *schema.TtsRequestAsStreamingText1aae4cf9:
		return settings(*r)
	case schema.TtsRequestAsStreamingText1aae4cf9:
		speed, volume, pitch, replacements = r.Value.Speed, r.Value.VolumeScale, r.Value.PitchBias, r.Value.Replacements
		c.input = r.Value.Text
		if r.Value.Model.Present {
			model = r.Value.Model.Value.LiteralValue()
		}
		if r.Value.Language.Present {
			language = r.Value.Language.Value.LiteralValue()
		}
		if r.Value.Emotion.Present {
			emotion = runtime.Some(r.Value.Emotion.Value.LiteralValue())
		}
		if r.Value.Output.Present {
			output = r.Value.Output.Value
		}
		blend = r.Value.VoiceBlend
		transform = runtime.Some(r.Value.VoiceTransform)
		if r.Value.LanguageTextNormalization.Present {
			normalize = runtime.Some(r.Value.LanguageTextNormalization.Value.LiteralValue())
		}
		if r.Value.SplitTurns.Present {
			split = runtime.Some(r.Value.SplitTurns.Value.LiteralValue())
		}
	case *schema.TtsRequestAsStreamingText09035640:
		return settings(*r)
	case schema.TtsRequestAsStreamingText09035640:
		speed, volume, pitch, replacements = r.Value.Speed, r.Value.VolumeScale, r.Value.PitchBias, r.Value.Replacements
		c.input = r.Value.Text
		if r.Value.Model.Present {
			model = r.Value.Model.Value.LiteralValue()
		}
		if r.Value.Language.Present {
			language = r.Value.Language.Value.Value()
		}
		if r.Value.Emotion.Present {
			emotion = runtime.Some(r.Value.Emotion.Value.LiteralValue())
		}
		if r.Value.Output.Present {
			output = r.Value.Output.Value
		}
		blend = r.Value.VoiceBlend
		transform = runtime.Some(r.Value.VoiceTransform)
		formula = true
		if r.Value.LanguageTextNormalization.Present {
			normalize = runtime.Some(r.Value.LanguageTextNormalization.Value.LiteralValue())
		}
		if r.Value.SplitTurns.Present {
			split = runtime.Some(r.Value.SplitTurns.Value.LiteralValue())
		}
	case *schema.TtsRequestAsStreamingTexte79a87b2:
		return settings(*r)
	case schema.TtsRequestAsStreamingTexte79a87b2:
		speed, volume, pitch, replacements = r.Value.Speed, r.Value.VolumeScale, r.Value.PitchBias, r.Value.Replacements
		c.input = r.Value.Text
		if r.Value.Model.Present {
			model = r.Value.Model.Value.LiteralValue()
		}
		if r.Value.Language.Present {
			language = r.Value.Language.Value.Value()
		}
		if r.Value.Emotion.Present {
			emotion = runtime.Some(r.Value.Emotion.Value.LiteralValue())
		}
		if r.Value.Output.Present {
			output = r.Value.Output.Value
		}
		blend = r.Value.VoiceBlend
		formula = true
		if r.Value.LanguageTextNormalization.Present {
			normalize = runtime.Some(r.Value.LanguageTextNormalization.Value.LiteralValue())
		}
		if r.Value.SplitTurns.Present {
			split = runtime.Some(r.Value.SplitTurns.Value.LiteralValue())
		}
	case *schema.TtsRequestAsStreamingTextb71a212f:
		return settings(*r)
	case schema.TtsRequestAsStreamingTextb71a212f:
		speed, volume, pitch, replacements = r.Value.Speed, r.Value.VolumeScale, r.Value.PitchBias, r.Value.Replacements
		c.input = r.Value.Text
		if r.Value.Model.Present {
			model = r.Value.Model.Value.LiteralValue()
		}
		if r.Value.Language.Present {
			language = r.Value.Language.Value.LiteralValue()
		}
		if r.Value.Emotion.Present {
			emotion = runtime.Some(r.Value.Emotion.Value.LiteralValue())
		}
		if r.Value.Output.Present {
			output = r.Value.Output.Value
		}
		blend = r.Value.VoiceBlend
		if r.Value.LanguageTextNormalization.Present {
			normalize = runtime.Some(r.Value.LanguageTextNormalization.Value.LiteralValue())
		}
		if r.Value.SplitTurns.Present {
			split = runtime.Some(r.Value.SplitTurns.Value.LiteralValue())
		}
	case *schema.TtsRequestAsStreamingTextVoice84ca6717:
		return settings(*r)
	case schema.TtsRequestAsStreamingTextVoice84ca6717:
		speed, volume, pitch, replacements = r.Value.Speed, r.Value.VolumeScale, r.Value.PitchBias, r.Value.Replacements
		c.input = r.Value.Text
		if r.Value.Model.Present {
			model = r.Value.Model.Value.LiteralValue()
		}
		if r.Value.Language.Present {
			language = r.Value.Language.Value.LiteralValue()
		}
		if r.Value.Emotion.Present {
			emotion = runtime.Some(r.Value.Emotion.Value.LiteralValue())
		}
		if r.Value.Output.Present {
			output = r.Value.Output.Value
		}
		voice = r.Value.Voice
		transform = runtime.Some(r.Value.VoiceTransform)
		if r.Value.LanguageTextNormalization.Present {
			normalize = runtime.Some(r.Value.LanguageTextNormalization.Value.LiteralValue())
		}
		if r.Value.SplitTurns.Present {
			split = runtime.Some(r.Value.SplitTurns.Value.LiteralValue())
		}
	case *schema.TtsRequestAsStreamingTextVoicee1061835:
		return settings(*r)
	case schema.TtsRequestAsStreamingTextVoicee1061835:
		speed, volume, pitch, replacements = r.Value.Speed, r.Value.VolumeScale, r.Value.PitchBias, r.Value.Replacements
		c.input = r.Value.Text
		if r.Value.Model.Present {
			model = r.Value.Model.Value.LiteralValue()
		}
		if r.Value.Language.Present {
			language = r.Value.Language.Value.Value()
		}
		if r.Value.Emotion.Present {
			emotion = runtime.Some(r.Value.Emotion.Value.LiteralValue())
		}
		if r.Value.Output.Present {
			output = r.Value.Output.Value
		}
		voice = r.Value.Voice
		transform = runtime.Some(r.Value.VoiceTransform)
		formula = true
		if r.Value.LanguageTextNormalization.Present {
			normalize = runtime.Some(r.Value.LanguageTextNormalization.Value.LiteralValue())
		}
		if r.Value.SplitTurns.Present {
			split = runtime.Some(r.Value.SplitTurns.Value.LiteralValue())
		}
	case *schema.TtsRequestAsStreamingTextVoice94f805c2:
		return settings(*r)
	case schema.TtsRequestAsStreamingTextVoice94f805c2:
		speed, volume, pitch, replacements = r.Value.Speed, r.Value.VolumeScale, r.Value.PitchBias, r.Value.Replacements
		c.input = r.Value.Text
		if r.Value.Model.Present {
			model = r.Value.Model.Value.LiteralValue()
		}
		if r.Value.Language.Present {
			language = r.Value.Language.Value.Value()
		}
		if r.Value.Emotion.Present {
			emotion = runtime.Some(r.Value.Emotion.Value.LiteralValue())
		}
		if r.Value.Output.Present {
			output = r.Value.Output.Value
		}
		voice = r.Value.Voice
		formula = true
		if r.Value.LanguageTextNormalization.Present {
			normalize = runtime.Some(r.Value.LanguageTextNormalization.Value.LiteralValue())
		}
		if r.Value.SplitTurns.Present {
			split = runtime.Some(r.Value.SplitTurns.Value.LiteralValue())
		}
	case *schema.TtsRequestAsStreamingTextVoice9e2e17ce:
		return settings(*r)
	case schema.TtsRequestAsStreamingTextVoice9e2e17ce:
		speed, volume, pitch, replacements = r.Value.Speed, r.Value.VolumeScale, r.Value.PitchBias, r.Value.Replacements
		c.input = r.Value.Text
		if r.Value.Model.Present {
			model = r.Value.Model.Value.LiteralValue()
		}
		if r.Value.Language.Present {
			language = r.Value.Language.Value.LiteralValue()
		}
		if r.Value.Emotion.Present {
			emotion = runtime.Some(r.Value.Emotion.Value.LiteralValue())
		}
		if r.Value.Output.Present {
			output = r.Value.Output.Value
		}
		voice = r.Value.Voice
		if r.Value.LanguageTextNormalization.Present {
			normalize = runtime.Some(r.Value.LanguageTextNormalization.Value.LiteralValue())
		}
		if r.Value.SplitTurns.Present {
			split = runtime.Some(r.Value.SplitTurns.Value.LiteralValue())
		}
	default:
		return c, errors.New("Invalid minimax TTS request")
	}
	if language == "" {
		language = "auto"
		if formula {
			language = "zh"
		}
	}
	voiceSettings := map[string]any{"voice_id": voice, "speed": float64(1), "vol": float64(1), "pitch": float64(0), "latex_read": formula}
	if speed.Present {
		voiceSettings["speed"] = speed.Value
	}
	if volume.Present {
		voiceSettings["vol"] = volume.Value
	}
	if pitch.Present {
		voiceSettings["pitch"] = pitch.Value
	}
	if emotion.Present {
		voiceSettings["emotion"] = emotion.Value
	}
	normalization := false
	if normalize.Present {
		normalization = normalize.Value
	}
	if c.input == nil {
		voiceSettings["text_normalization"] = normalization
	} else {
		voiceSettings["english_normalization"] = normalization
	}
	audio := audioSettings(output, c.input != nil)
	c.wire = map[string]any{"model": model, "language_boost": languages[language], "voice_setting": voiceSettings, "audio_setting": audio}
	if blend != nil {
		weights := make([]map[string]any, len(blend))
		for i, v := range blend {
			weights[i] = map[string]any{"voice_id": v.Voice, "weight": v.Weight}
		}
		c.wire["timbre_weights"] = weights
	}
	if replacements.Present {
		tones := make([]string, len(replacements.Value))
		for i, v := range replacements.Value {
			tones[i] = v.Pattern + "/" + v.Replacement
		}
		c.wire["pronunciation_dict"] = map[string]any{"tone": tones}
	}
	if transform.Present {
		v := transform.Value
		effects := map[string]any{}
		if v.Brightness.Present {
			effects["pitch"] = v.Brightness.Value
		}
		if v.Softness.Present {
			effects["intensity"] = v.Softness.Value
		}
		if v.Crispness.Present {
			effects["timbre"] = v.Crispness.Value
		}
		if v.Effect.Present {
			effect := v.Effect.Value.LiteralValue()
			if effect == "telephone" {
				effect = "lofi_telephone"
			}
			effects["sound_effects"] = effect
		}
		c.wire["voice_modify"] = effects
	}
	if c.input != nil && (model == "speech-2.8-hd" || model == "speech-2.8-turbo") {
		continuous := false
		if split.Present {
			continuous = !split.Value
		}
		c.wire["continuous_sound"] = continuous
	}
	c.streaming = audio["format"] != "wav" && !(transform.Present && audio["format"] == "flac")
	return c, nil
}

var languages = map[string]string{
	"zh": "Chinese", "yue": "Chinese,Yue", "en": "English", "ar": "Arabic", "ru": "Russian", "es": "Spanish", "fr": "French", "pt": "Portuguese", "de": "German", "tr": "Turkish", "nl": "Dutch", "uk": "Ukrainian", "vi": "Vietnamese", "id": "Indonesian", "ja": "Japanese", "it": "Italian", "ko": "Korean", "th": "Thai", "pl": "Polish", "ro": "Romanian", "el": "Greek", "cs": "Czech", "fi": "Finnish", "hi": "Hindi", "bg": "Bulgarian", "da": "Danish", "he": "Hebrew", "ms": "Malay", "fa": "Persian", "sk": "Slovak", "sv": "Swedish", "hr": "Croatian", "fil": "Filipino", "hu": "Hungarian", "no": "Norwegian", "sl": "Slovenian", "ca": "Catalan", "nn": "Nynorsk", "ta": "Tamil", "af": "Afrikaans", "auto": "auto",
}
