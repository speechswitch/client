package smallest_ai

import (
	"context"
	"errors"
	"strings"

	schema "github.com/speechswitch/client/sdks/go/generated/smallest_ai"
	"github.com/speechswitch/client/sdks/go/runtime"
)

type inputItem = schema.TtsRequestLightningV31ProStreamingTextVoice8f1b36fbTextItem
type inputEvent struct {
	text  string
	clear bool
}
type textSource struct {
	source   runtime.Input[string]
	validate runtime.InputValidator
}

func (s *textSource) Next(ctx context.Context) (inputEvent, error) {
	value, err := s.source.Next(ctx)
	if err != nil {
		return inputEvent{}, err
	}
	if err = s.validate(value); err != nil {
		return inputEvent{}, err
	}
	return inputEvent{text: value}, nil
}
func (s *textSource) Close() error { return s.source.Close() }

type commandSource struct {
	source   runtime.Input[inputItem]
	validate runtime.InputValidator
}

func (s *commandSource) Next(ctx context.Context) (inputEvent, error) {
	value, err := s.source.Next(ctx)
	if err != nil {
		return inputEvent{}, err
	}
	if err = s.validate(value); err != nil {
		return inputEvent{}, err
	}
	switch v := value.(type) {
	case schema.TtsRequestLightningV31ProStreamingTextVoice8f1b36fbTextItemAsString:
		return inputEvent{text: v.Value}, nil
	case *schema.TtsRequestLightningV31ProStreamingTextVoice8f1b36fbTextItemAsString:
		return inputEvent{text: v.Value}, nil
	case schema.TtsRequestLightningV31ProStreamingTextVoice8f1b36fbTextItemAsClear, *schema.TtsRequestLightningV31ProStreamingTextVoice8f1b36fbTextItemAsClear:
		return inputEvent{clear: true}, nil
	default:
		return inputEvent{}, errors.New("Unsupported generated Smallest.ai input representation")
	}
}
func (s *commandSource) Close() error { return s.source.Close() }

type settings struct {
	text, voice, contextID         string
	input                          runtime.Input[inputEvent]
	timed, retention, dictionaries bool
	bufferDelay, completionDelay   float64
	wire                           map[string]any
}

// Whole-text preprocessing copies the generated value, never the caller's pointer.
func trimRequest(request schema.TtsRequest) schema.TtsRequest {
	switch r := request.(type) {
	case *schema.TtsRequestAsLightningV31ProTextVoice74d06326:
		if r != nil {
			return trimRequest(*r)
		}
	case schema.TtsRequestAsLightningV31ProTextVoice74d06326:
		r.Value.Text = strings.Trim(r.Value.Text, "\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff")
		return r
	case *schema.TtsRequestAsLightningV31ProTextVoice3c7c5185:
		if r != nil {
			return trimRequest(*r)
		}
	case schema.TtsRequestAsLightningV31ProTextVoice3c7c5185:
		r.Value.Text = strings.Trim(r.Value.Text, "\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff")
		return r
	case *schema.TtsRequestAsLightningV31TextVoice5e2ae2e5:
		if r != nil {
			return trimRequest(*r)
		}
	case schema.TtsRequestAsLightningV31TextVoice5e2ae2e5:
		r.Value.Text = strings.Trim(r.Value.Text, "\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff")
		return r
	case *schema.TtsRequestAsLightningV31TextVoice727240a7:
		if r != nil {
			return trimRequest(*r)
		}
	case schema.TtsRequestAsLightningV31TextVoice727240a7:
		r.Value.Text = strings.Trim(r.Value.Text, "\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff")
		return r
	}
	return request
}

// Generated validation owns model/language combinations and all authored bounds.
func resolve(request schema.TtsRequest, validate runtime.InputValidator) (settings, error) {
	var result settings
	var model string
	var language, numberLanguage interface{ LiteralValue() string }
	var output runtime.Optional[schema.TtsRequestLightningV31ProStreamingTextVoice8f1b36fbOutput]
	var speed, bufferDelay, completionDelay runtime.Optional[float64]
	var formula runtime.Optional[schema.TtsRequestLightningV31ProStreamingTextVoice8f1b36fbFormulaReading]
	var retention runtime.Optional[schema.TtsRequestLightningV31ProStreamingTextVoice8f1b36fbContentRetentionDays]
	var requestID, sessionID runtime.Optional[string]
	var dictionaries runtime.Optional[[]schema.TtsRequestLightningV31ProTextVoice74d06326PronunciationDictionariesItem]
	switch r := request.(type) {
	case *schema.TtsRequestAsLightningV31ProStreamingTextVoice8f1b36fb:
		return resolve(*r, validate)
	case *schema.TtsRequestAsLightningV31ProStreamingTextVoiced206187f:
		return resolve(*r, validate)
	case *schema.TtsRequestAsLightningV31ProTextVoice74d06326:
		return resolve(*r, validate)
	case *schema.TtsRequestAsLightningV31ProStreamingTextVoice4f8c2395:
		return resolve(*r, validate)
	case *schema.TtsRequestAsLightningV31ProStreamingTextVoice2da2f6d9:
		return resolve(*r, validate)
	case *schema.TtsRequestAsLightningV31ProTextVoice3c7c5185:
		return resolve(*r, validate)
	case *schema.TtsRequestAsLightningV31StreamingTextVoicebf9ab904:
		return resolve(*r, validate)
	case *schema.TtsRequestAsLightningV31StreamingTextVoiced272850b:
		return resolve(*r, validate)
	case *schema.TtsRequestAsLightningV31TextVoice5e2ae2e5:
		return resolve(*r, validate)
	case *schema.TtsRequestAsLightningV31StreamingTextVoice90b1878c:
		return resolve(*r, validate)
	case *schema.TtsRequestAsLightningV31StreamingTextVoicea9844e06:
		return resolve(*r, validate)
	case *schema.TtsRequestAsLightningV31TextVoice727240a7:
		return resolve(*r, validate)
	case schema.TtsRequestAsLightningV31ProStreamingTextVoice8f1b36fb:
		v := r.Value
		model = "lightning_v3.1_pro"
		result.voice = v.Voice
		result.timed = false
		output, speed, formula, retention, requestID, sessionID = v.Output, v.Speed, v.FormulaReading, v.ContentRetentionDays, v.RequestId, v.SessionId
		if v.Language.Present {
			language = v.Language.Value
		}
		if v.NumberPronunciationLanguage.Present {
			numberLanguage = v.NumberPronunciationLanguage.Value
		}
		result.input = &commandSource{source: v.Text, validate: validate}
		result.contextID = v.Continuation.Id
		bufferDelay = v.Continuation.MaxBufferDelayMs
	case schema.TtsRequestAsLightningV31ProStreamingTextVoiced206187f:
		v := r.Value
		model = "lightning_v3.1_pro"
		result.voice = v.Voice
		result.timed = false
		output, speed, formula, retention, requestID, sessionID = v.Output, v.Speed, v.FormulaReading, v.ContentRetentionDays, v.RequestId, v.SessionId
		if v.Language.Present {
			language = v.Language.Value
		}
		if v.NumberPronunciationLanguage.Present {
			numberLanguage = v.NumberPronunciationLanguage.Value
		}
		result.input = &textSource{source: v.Text, validate: validate}
		bufferDelay, completionDelay = v.MaxBufferDelayMs, v.CompletionDelayMs
	case schema.TtsRequestAsLightningV31ProTextVoice74d06326:
		v := r.Value
		model = "lightning_v3.1_pro"
		result.voice = v.Voice
		result.timed = false
		output, speed, formula, retention, requestID, sessionID = v.Output, v.Speed, v.FormulaReading, v.ContentRetentionDays, v.RequestId, v.SessionId
		if v.Language.Present {
			language = v.Language.Value
		}
		if v.NumberPronunciationLanguage.Present {
			numberLanguage = v.NumberPronunciationLanguage.Value
		}
		result.text = v.Text
		dictionaries = v.PronunciationDictionaries
	case schema.TtsRequestAsLightningV31ProStreamingTextVoice4f8c2395:
		v := r.Value
		model = "lightning_v3.1_pro"
		result.voice = v.Voice.LiteralValue()
		result.timed = true
		output, speed, formula, retention, requestID, sessionID = v.Output, v.Speed, v.FormulaReading, v.ContentRetentionDays, v.RequestId, v.SessionId
		if v.Language.Present {
			language = v.Language.Value
		}
		if v.NumberPronunciationLanguage.Present {
			numberLanguage = v.NumberPronunciationLanguage.Value
		}
		result.input = &commandSource{source: v.Text, validate: validate}
		result.contextID = v.Continuation.Id
		bufferDelay = v.Continuation.MaxBufferDelayMs
	case schema.TtsRequestAsLightningV31ProStreamingTextVoice2da2f6d9:
		v := r.Value
		model = "lightning_v3.1_pro"
		result.voice = v.Voice.LiteralValue()
		result.timed = true
		output, speed, formula, retention, requestID, sessionID = v.Output, v.Speed, v.FormulaReading, v.ContentRetentionDays, v.RequestId, v.SessionId
		if v.Language.Present {
			language = v.Language.Value
		}
		if v.NumberPronunciationLanguage.Present {
			numberLanguage = v.NumberPronunciationLanguage.Value
		}
		result.input = &textSource{source: v.Text, validate: validate}
		bufferDelay, completionDelay = v.MaxBufferDelayMs, v.CompletionDelayMs
	case schema.TtsRequestAsLightningV31ProTextVoice3c7c5185:
		v := r.Value
		model = "lightning_v3.1_pro"
		result.voice = v.Voice.LiteralValue()
		result.timed = true
		output, speed, formula, retention, requestID, sessionID = v.Output, v.Speed, v.FormulaReading, v.ContentRetentionDays, v.RequestId, v.SessionId
		if v.Language.Present {
			language = v.Language.Value
		}
		if v.NumberPronunciationLanguage.Present {
			numberLanguage = v.NumberPronunciationLanguage.Value
		}
		result.text = v.Text
	case schema.TtsRequestAsLightningV31StreamingTextVoicebf9ab904:
		v := r.Value
		model = "lightning_v3.1"
		result.voice = v.Voice
		result.timed = false
		output, speed, formula, retention, requestID, sessionID = v.Output, v.Speed, v.FormulaReading, v.ContentRetentionDays, v.RequestId, v.SessionId
		if v.Language.Present {
			language = v.Language.Value
		}
		if v.NumberPronunciationLanguage.Present {
			numberLanguage = v.NumberPronunciationLanguage.Value
		}
		result.input = &commandSource{source: v.Text, validate: validate}
		result.contextID = v.Continuation.Id
		bufferDelay = v.Continuation.MaxBufferDelayMs
	case schema.TtsRequestAsLightningV31StreamingTextVoiced272850b:
		v := r.Value
		model = "lightning_v3.1"
		result.voice = v.Voice
		result.timed = false
		output, speed, formula, retention, requestID, sessionID = v.Output, v.Speed, v.FormulaReading, v.ContentRetentionDays, v.RequestId, v.SessionId
		if v.Language.Present {
			language = v.Language.Value
		}
		if v.NumberPronunciationLanguage.Present {
			numberLanguage = v.NumberPronunciationLanguage.Value
		}
		result.input = &textSource{source: v.Text, validate: validate}
		bufferDelay, completionDelay = v.MaxBufferDelayMs, v.CompletionDelayMs
	case schema.TtsRequestAsLightningV31TextVoice5e2ae2e5:
		v := r.Value
		model = "lightning_v3.1"
		result.voice = v.Voice
		result.timed = false
		output, speed, formula, retention, requestID, sessionID = v.Output, v.Speed, v.FormulaReading, v.ContentRetentionDays, v.RequestId, v.SessionId
		if v.Language.Present {
			language = v.Language.Value
		}
		if v.NumberPronunciationLanguage.Present {
			numberLanguage = v.NumberPronunciationLanguage.Value
		}
		result.text = v.Text
		dictionaries = v.PronunciationDictionaries
	case schema.TtsRequestAsLightningV31StreamingTextVoice90b1878c:
		v := r.Value
		model = "lightning_v3.1"
		result.voice = v.Voice.LiteralValue()
		result.timed = true
		output, speed, formula, retention, requestID, sessionID = v.Output, v.Speed, v.FormulaReading, v.ContentRetentionDays, v.RequestId, v.SessionId
		if v.Language.Present {
			language = v.Language.Value
		}
		if v.NumberPronunciationLanguage.Present {
			numberLanguage = v.NumberPronunciationLanguage.Value
		}
		result.input = &commandSource{source: v.Text, validate: validate}
		result.contextID = v.Continuation.Id
		bufferDelay = v.Continuation.MaxBufferDelayMs
	case schema.TtsRequestAsLightningV31StreamingTextVoicea9844e06:
		v := r.Value
		model = "lightning_v3.1"
		result.voice = v.Voice.LiteralValue()
		result.timed = true
		output, speed, formula, retention, requestID, sessionID = v.Output, v.Speed, v.FormulaReading, v.ContentRetentionDays, v.RequestId, v.SessionId
		if v.Language.Present {
			language = v.Language.Value
		}
		if v.NumberPronunciationLanguage.Present {
			numberLanguage = v.NumberPronunciationLanguage.Value
		}
		result.input = &textSource{source: v.Text, validate: validate}
		bufferDelay, completionDelay = v.MaxBufferDelayMs, v.CompletionDelayMs
	case schema.TtsRequestAsLightningV31TextVoice727240a7:
		v := r.Value
		model = "lightning_v3.1"
		result.voice = v.Voice.LiteralValue()
		result.timed = true
		output, speed, formula, retention, requestID, sessionID = v.Output, v.Speed, v.FormulaReading, v.ContentRetentionDays, v.RequestId, v.SessionId
		if v.Language.Present {
			language = v.Language.Value
		}
		if v.NumberPronunciationLanguage.Present {
			numberLanguage = v.NumberPronunciationLanguage.Value
		}
		result.text = v.Text
	default:
		return result, errors.New("Unsupported generated Smallest.ai request representation")
	}
	lang := "auto"
	if result.timed {
		lang = "en"
	}
	if language != nil {
		lang = language.LiteralValue()
	}
	format, rate := "pcm", 44100.0
	if output.Present {
		value := output.Value
		switch p := value.(type) {
		case *schema.TtsRequestLightningV31ProStreamingTextVoice8f1b36fbOutputAsObject1e4e72b8:
			value = *p
		case *schema.TtsRequestLightningV31ProStreamingTextVoice8f1b36fbOutputAsObject172ee74a:
			value = *p
		}
		switch p := value.(type) {
		case schema.TtsRequestLightningV31ProStreamingTextVoice8f1b36fbOutputAsObject1e4e72b8:
			format = p.Value.Format.LiteralValue()
			if p.Value.SampleRateHz.Present {
				rate = p.Value.SampleRateHz.Value.LiteralValue()
			}
		case schema.TtsRequestLightningV31ProStreamingTextVoice8f1b36fbOutputAsObject172ee74a:
			format = p.Value.Format.LiteralValue()
			if p.Value.SampleRateHz.Present {
				rate = p.Value.SampleRateHz.Value.LiteralValue()
			}
		default:
			return result, errors.New("Unsupported generated Smallest.ai output representation")
		}
	}
	if format == "mulaw" {
		format = "ulaw"
	}
	speedValue := 1.0
	if speed.Present {
		speedValue = speed.Value
	}
	mathNotation := false
	if formula.Present {
		switch formula.Value.(type) {
		case schema.TtsRequestLightningV31ProStreamingTextVoice8f1b36fbFormulaReadingAsPlainText, *schema.TtsRequestLightningV31ProStreamingTextVoice8f1b36fbFormulaReadingAsPlainText:
			mathNotation = true
		}
	}
	result.wire = map[string]any{"voice_id": result.voice, "model": model, "language": lang, "sample_rate": rate, "output_format": format, "speed": speedValue, "math_notation": mathNotation}
	if numberLanguage != nil {
		result.wire["number_pronunciation_language"] = numberLanguage.LiteralValue()
	}
	if requestID.Present {
		result.wire["request_id"] = requestID.Value
	}
	if sessionID.Present {
		result.wire["session_id"] = sessionID.Value
	}
	if dictionaries.Present {
		ids := make([]string, len(dictionaries.Value))
		for i, d := range dictionaries.Value {
			ids[i] = d.Id
		}
		result.wire["pronunciation_dicts"] = ids
	}
	result.dictionaries = dictionaries.Present
	result.retention = retention.Present
	if result.timed {
		result.wire["word_timestamps"] = true
	}
	if result.contextID != "" {
		result.bufferDelay = 3000
	}
	if bufferDelay.Present {
		result.bufferDelay = bufferDelay.Value
	}
	result.completionDelay = 4000
	if completionDelay.Present {
		result.completionDelay = completionDelay.Value
	}
	return result, nil
}
