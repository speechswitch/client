package minimax

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	out "github.com/speechswitch/client/sdks/go/generated/minimax_output"
	"github.com/speechswitch/client/sdks/go/runtime"
	"math"
)

type packet struct {
	code                                        int
	message                                     string
	event, trace, session, connection, subtitle runtime.Optional[string]
	audio                                       []byte
	audioPresent                                bool
	status                                      int
	final                                       runtime.Optional[bool]
	usage                                       runtime.Optional[out.Usage]
}

func object(data []byte) (map[string]json.RawMessage, error) {
	var result map[string]json.RawMessage
	if json.Unmarshal(data, &result) != nil || result == nil {
		return nil, errors.New("MiniMax returned an invalid response object")
	}
	return result, nil
}
func stringValue(data json.RawMessage, field string) (string, error) {
	var value string
	if bytes.Equal(bytes.TrimSpace(data), []byte("null")) || json.Unmarshal(data, &value) != nil {
		return "", fmt.Errorf("MiniMax returned invalid %s", field)
	}
	return value, nil
}
func number(data json.RawMessage, field string, integer bool) (float64, error) {
	var value float64
	if bytes.Equal(bytes.TrimSpace(data), []byte("null")) || json.Unmarshal(data, &value) != nil || math.IsNaN(value) || math.IsInf(value, 0) || value < 0 || (integer && (math.Trunc(value) != value || value > 9007199254740991)) {
		return 0, fmt.Errorf("MiniMax returned invalid %s", field)
	}
	return value, nil
}
func decodePacket(data []byte) (packet, error) {
	p := packet{}
	value, err := object(data)
	if err != nil {
		return p, err
	}
	if base, ok := value["base_resp"]; ok {
		fields, err := object(base)
		if err != nil {
			return p, err
		}
		code, err := number(fields["status_code"], "base_resp.status_code", true)
		if err != nil {
			return p, err
		}
		p.code = int(code)
		if raw, ok := fields["status_msg"]; ok {
			p.message, err = stringValue(raw, "base_resp.status_msg")
			if err != nil {
				return p, err
			}
		}
	}
	for name, target := range map[string]*runtime.Optional[string]{"event": &p.event, "trace_id": &p.trace} {
		if raw, ok := value[name]; ok {
			s, err := stringValue(raw, name)
			if err != nil {
				return p, err
			}
			*target = runtime.Some(s)
		}
	}
	// Native errors take precedence over unavailable success metadata.
	if p.code != 0 {
		return p, nil
	}
	for name, target := range map[string]*runtime.Optional[string]{"session_id": &p.session, "connect_id": &p.connection} {
		if raw, ok := value[name]; ok {
			s, err := stringValue(raw, name)
			if err != nil {
				return p, err
			}
			*target = runtime.Some(s)
		}
	}
	if raw, ok := value["is_final"]; ok {
		var final bool
		if bytes.Equal(bytes.TrimSpace(raw), []byte("null")) || json.Unmarshal(raw, &final) != nil {
			return p, errors.New("MiniMax returned invalid is_final")
		}
		p.final = runtime.Some(final)
	}
	if raw, ok := value["data"]; ok && !bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		fields, err := object(raw)
		if err != nil {
			return p, err
		}
		if raw, ok = fields["status"]; ok {
			status, err := number(raw, "data.status", true)
			if err != nil {
				return p, err
			}
			if status != 1 && status != 2 {
				return p, errors.New("MiniMax returned invalid data.status")
			}
			p.status = int(status)
		}
		if raw, ok = fields["audio"]; ok {
			audio, err := stringValue(raw, "data.audio")
			if err != nil {
				return p, err
			}
			p.audio, err = hex.DecodeString(audio)
			if err != nil {
				return p, errors.New("MiniMax returned invalid hex audio")
			}
			p.audioPresent = true
		}
		if raw, ok = fields["subtitle_file"]; ok {
			v, err := stringValue(raw, "data.subtitle_file")
			if err != nil {
				return p, err
			}
			p.subtitle = runtime.Some(v)
		}
	}
	if raw, ok := value["extra_info"]; ok && !bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		fields, err := object(raw)
		if err != nil {
			return p, err
		}
		usage := out.Usage{}
		for name, target := range map[string]*runtime.Optional[float64]{
			"audio_length": &usage.DurationMs, "audio_sample_rate": &usage.SampleRateHz, "audio_size": &usage.ByteLength,
			"bitrate": &usage.BitRateBps, "audio_channel": &usage.ChannelCount, "usage_characters": &usage.BilledCharacters, "word_count": &usage.WordCount,
		} {
			if raw, ok := fields[name]; ok {
				n, err := number(raw, name, true)
				if err != nil {
					return p, err
				}
				*target = runtime.Some(n)
			}
		}
		if raw, ok := fields["invisible_character_ratio"]; ok {
			ratio, err := number(raw, "invisible_character_ratio", false)
			if err != nil {
				return p, err
			}
			if ratio > 1 {
				return p, errors.New("MiniMax returned invalid invisible_character_ratio")
			}
			usage.InvalidCharacterRatio = runtime.Some(ratio)
		}
		if raw, ok := fields["audio_format"]; ok {
			format, err := stringValue(raw, "audio_format")
			if err != nil {
				return p, err
			}
			usage.Format = runtime.Some(format)
		}
		p.usage = runtime.Some(usage)
	}
	return p, nil
}

func decodeSubtitles(data []byte, kind string) ([]out.MiniMaxTimestamp, error) {
	var rows []json.RawMessage
	if bytes.Equal(bytes.TrimSpace(data), []byte("null")) || json.Unmarshal(data, &rows) != nil {
		return nil, errors.New("MiniMax subtitles must be a JSON array")
	}
	result := make([]out.MiniMaxTimestamp, 0, len(rows))
	var markKind out.MiniMaxTimestampKind = out.MiniMaxTimestampKindAsWord{}
	if kind == "sentence" {
		markKind = out.MiniMaxTimestampKindAsSentence{}
	}
	for _, raw := range rows {
		row, err := object(raw)
		if err != nil {
			return nil, err
		}
		start, err := number(row["time_begin"], "subtitle time_begin", false)
		if err != nil {
			return nil, err
		}
		end, err := number(row["time_end"], "subtitle time_end", false)
		if err != nil {
			return nil, err
		}
		if end < start {
			return nil, errors.New("MiniMax returned reversed subtitle timestamps")
		}
		text, err := stringValue(row["text"], "subtitle text")
		if err != nil {
			return nil, err
		}
		result = append(result, out.MiniMaxTimestamp{Kind: markKind, Value: text, StartTimeMs: start, EndTimeMs: runtime.Some(end)})
	}
	return result, nil
}
