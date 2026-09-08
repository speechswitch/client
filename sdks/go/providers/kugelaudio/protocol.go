package kugelaudio

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	out "github.com/speechswitch/client/sdks/go/generated/kugelaudio_output"
	"github.com/speechswitch/client/sdks/go/runtime"
	"math"
	"strconv"
	"strings"
)

type fields struct {
	value map[string]any
	err   error
}

func object(raw any) *fields {
	value, ok := raw.(map[string]any)
	f := &fields{value: value}
	if !ok || value == nil {
		f.err = errors.New("KugelAudio returned an invalid object")
	}
	return f
}
func (f *fields) number(name string, integer bool) float64 {
	if f.err != nil {
		return 0
	}
	v, ok := f.value[name].(float64)
	if !ok || math.IsNaN(v) || math.IsInf(v, 0) || v < 0 || (integer && (math.Trunc(v) != v || v > 9007199254740991)) {
		f.err = errors.New("KugelAudio returned invalid " + name)
		return 0
	}
	return v
}
func decode(data []byte) (map[string]any, error) {
	if !runtime.ValidUTF8JSON(data) {
		return nil, errors.New("KugelAudio returned invalid JSON")
	}
	var value map[string]any
	if json.Unmarshal(data, &value) != nil || value == nil {
		return nil, errors.New("KugelAudio returned an invalid object")
	}
	return value, nil
}
func usage(packet map[string]any) (runtime.Optional[out.KugelAudioUsage], error) {
	raw, present := packet["usage"]
	if !present {
		return runtime.Optional[out.KugelAudioUsage]{}, nil
	}
	f := object(raw)
	v := out.KugelAudioUsage{AudioSeconds: f.number("audio_seconds", false), Characters: f.number("characters", true)}
	if f.err != nil {
		return runtime.Optional[out.KugelAudioUsage]{}, f.err
	}
	cost, present := f.value["cost_cents"]
	if cost == nil {
		if !present || f.value["cost_unavailable"] != true {
			return runtime.Optional[out.KugelAudioUsage]{}, errors.New("KugelAudio omitted its cost-unavailable indicator")
		}
		v.CostCents = out.KugelAudioUsageCostCentsAsNull{}
	} else {
		v.CostCents = out.KugelAudioUsageCostCentsAsNumber{Value: f.number("cost_cents", false)}
	}
	if currency, present := f.value["currency"]; present {
		if currency != "eur" {
			return runtime.Optional[out.KugelAudioUsage]{}, errors.New("KugelAudio returned an invalid usage currency")
		}
		v.Currency = runtime.Some(out.KugelAudioUsageCurrency{})
	}
	if raw, present := f.value["model_id"]; present {
		model, ok := raw.(string)
		if !ok {
			return runtime.Optional[out.KugelAudioUsage]{}, errors.New("KugelAudio returned an invalid usage model")
		}
		v.Model = runtime.Some(model)
	}
	return runtime.Some(v), f.err
}
func updated(raw any) (out.SynthesisItem, error) {
	f := object(raw)
	v := out.SynthesisItemUpdated{}
	if _, present := f.value["cfg_scale"]; present {
		v.VoiceGuidance = runtime.Some(f.number("cfg_scale", false))
	}
	if _, present := f.value["temperature"]; present {
		v.Temperature = runtime.Some(f.number("temperature", false))
	}
	if _, present := f.value["max_new_tokens"]; present {
		v.MaxAudioTokens = runtime.Some(f.number("max_new_tokens", true))
	}
	if _, present := f.value["speed"]; present {
		v.Speed = runtime.Some(f.number("speed", false))
	}
	if raw, present := f.value["language"]; present {
		language, ok := raw.(string)
		if !ok {
			return nil, errors.New("KugelAudio returned invalid settings language")
		}
		v.Language = runtime.Some(language)
	}
	if raw, present := f.value["normalize"]; present {
		normalize, ok := raw.(bool)
		if !ok {
			return nil, errors.New("KugelAudio returned invalid settings normalize")
		}
		var value out.SynthesisItemUpdatedTextNormalization = out.SynthesisItemUpdatedTextNormalizationAsFalse{}
		if normalize {
			value = out.SynthesisItemUpdatedTextNormalizationAsTrue{}
		}
		v.TextNormalization = runtime.Some(value)
	}
	if f.err != nil {
		return nil, f.err
	}
	return out.SynthesisItemAsUpdated{Value: v}, nil
}
func alignment(raw any) ([]out.KugelAudioTimestamp, error) {
	values, ok := raw.([]any)
	if !ok {
		return nil, errors.New("KugelAudio returned invalid word timestamps")
	}
	result := make([]out.KugelAudioTimestamp, 0, len(values))
	for _, raw := range values {
		f := object(raw)
		if f.err != nil {
			return nil, f.err
		}
		word, ok := f.value["word"].(string)
		if !ok {
			return nil, errors.New("KugelAudio returned an invalid word")
		}
		start, end := f.number("start_ms", false), f.number("end_ms", false)
		first, last := f.number("char_start", true), f.number("char_end", true)
		v := out.KugelAudioTimestamp{Value: word, StartTimeMs: start, EndTimeMs: runtime.Some(end), Source: runtime.Some(out.KugelAudioTimestampSource{Start: first, End: last})}
		if _, present := f.value["score"]; present {
			v.Confidence = runtime.Some(f.number("score", false))
		}
		if f.err != nil {
			return nil, f.err
		}
		if end < start || last < first {
			return nil, errors.New("KugelAudio returned reversed alignment bounds")
		}
		result = append(result, v)
	}
	return result, nil
}

func (s *socketStream) output(packet map[string]any) (out.SynthesisItem, error) {
	kind, count := "", 0
	for _, name := range []string{"error", "audio", "word_timestamps", "generation_started", "chunk_complete", "interrupted", "settings_updated", "warning", "final", "session_closed"} {
		if _, present := packet[name]; present {
			kind = name
			count++
		}
	}
	if count != 1 {
		return nil, errors.New("KugelAudio returned an invalid event")
	}
	switch kind {
	case "generation_started", "chunk_complete", "interrupted", "settings_updated", "final", "session_closed":
		if packet[kind] != true {
			return nil, errors.New("KugelAudio returned an invalid event flag")
		}
	}
	f := object(packet)
	switch kind {
	case "error":
		message, ok := packet["error"].(string)
		code, cOK := packet["error_code"].(string)
		if !ok || !cOK {
			return nil, errors.New("KugelAudio returned an invalid error")
		}
		status := f.number("code", true)
		if f.err != nil {
			return nil, f.err
		}
		return nil, &Error{Message: message, StatusCode: runtime.Some(int(status)), Code: runtime.Some(code)}
	case "warning":
		warning, ok := packet["warning"].(string)
		if !ok {
			return nil, errors.New("KugelAudio returned an invalid warning")
		}
		s.warning(warning)
		return nil, nil
	case "settings_updated":
		if s.updates == 0 {
			return nil, errors.New("KugelAudio returned an unsolicited settings acknowledgement")
		}
		s.updates--
		return updated(packet["settings"])
	case "interrupted":
		if s.state != "clearing" {
			return nil, errors.New("KugelAudio returned an unsolicited interruption")
		}
		s.state, s.finalSeen = "idle", false
		clear(s.samples)
		s.turn++
		return out.SynthesisItemAsClear{}, nil
	}
	if s.state == "clearing" {
		return nil, nil
	}
	switch kind {
	case "final":
		if s.state == "idle" || s.finalSeen {
			return nil, errors.New("KugelAudio returned an unexpected final")
		}
		if !s.live {
			billing, err := usage(packet)
			if err != nil {
				return nil, err
			}
			s.finished = true
			s.closeResources()
			return out.SynthesisItemAsDone{Value: out.KugelAudioDoneEvent{Usage: billing}}, nil
		}
		s.finalSeen, s.state = true, "flushing"
		return nil, nil
	case "session_closed":
		if !s.live || !s.finalSeen {
			return nil, errors.New("KugelAudio ended a turn before final")
		}
		billing, err := usage(packet)
		if err != nil {
			return nil, err
		}
		ordinal := strconv.FormatUint(s.turn, 10)
		s.state, s.finalSeen = "idle", false
		clear(s.samples)
		s.turn++
		return out.SynthesisItemAsFlush{Value: out.KugelAudioTurnEvent{CorrelationId: ordinal, InputGroupId: ordinal, Usage: billing}}, nil
	}
	if s.state == "idle" || s.finalSeen {
		return nil, errors.New("KugelAudio returned output outside an active turn")
	}
	id := int64(f.number("chunk_id", true))
	if f.err != nil {
		return nil, f.err
	}
	ordinal := strconv.FormatUint(s.turn, 10)
	group := out.KugelAudioEnvelope{CorrelationId: ordinal + ":" + strconv.FormatInt(id, 10), InputGroupId: ordinal, ChunkId: float64(id), Timestamps: []out.KugelAudioTimestamp{}}
	switch kind {
	case "audio":
		encoded, ok := packet["audio"].(string)
		if !ok || packet["enc"] != s.encoding || packet["sr"] != s.rate {
			return nil, errors.New("KugelAudio returned an unexpected audio format")
		}
		f.number("idx", true)
		count := int64(f.number("samples", true))
		if f.err != nil {
			return nil, f.err
		}
		audio, err := base64.StdEncoding.DecodeString(encoded)
		if err != nil || strings.ContainsAny(encoded, "\r\n") {
			return nil, errors.New("KugelAudio returned invalid base64 audio")
		}
		width := int64(1)
		if s.encoding == "pcm_s16le" {
			width = 2
		}
		if int64(len(audio)) != count*width {
			return nil, errors.New("KugelAudio audio size disagrees with its sample count")
		}
		start, end := s.samples[id], s.samples[id]+count
		if end > 9007199254740991 {
			return nil, errors.New("KugelAudio audio sample count overflow")
		}
		s.samples[id] = end
		if !s.timed {
			return out.SynthesisItemAsBytes{Value: audio}, nil
		}
		group.Audio = runtime.Some(audio)
		group.AudioTiming = runtime.Some(out.KugelAudioEnvelopeAudioTiming{StartTimeMs: float64(start) / s.rate * 1000, EndTimeMs: float64(end) / s.rate * 1000})
		return out.SynthesisItemAsOrdered{Value: group}, nil
	case "word_timestamps":
		marks, err := alignment(packet["word_timestamps"])
		if err != nil {
			return nil, err
		}
		if !s.timed {
			return nil, errors.New("KugelAudio returned unrequested timestamps")
		}
		group.Timestamps = marks
		return out.SynthesisItemAsOrdered{Value: group}, nil
	case "generation_started":
		if _, ok := packet["text"].(string); !ok {
			return nil, errors.New("KugelAudio returned invalid generated text")
		}
	default:
		f.number("audio_seconds", false)
		f.number("gen_ms", false)
	}
	return nil, f.err
}
