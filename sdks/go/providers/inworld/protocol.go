package inworld

import (
	"bytes"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"

	out "github.com/speechswitch/client/sdks/go/generated/inworld_output"
	"github.com/speechswitch/client/sdks/go/runtime"
)

func decode(data []byte) (map[string]any, error) {
	if !runtime.ValidUTF8JSON(data) {
		return nil, errors.New("Inworld returned invalid JSON")
	}
	var value map[string]any
	if json.Unmarshal(data, &value) != nil || value == nil {
		return nil, errors.New("Inworld returned an invalid object")
	}
	return value, nil
}
func status(value map[string]any) error {
	if value == nil {
		return errors.New("Inworld returned an invalid object")
	}
	code, ok := value["code"].(float64)
	if _, present := value["code"]; present && (!ok || math.Trunc(code) != code || math.Abs(code) > 9007199254740991) {
		return errors.New("Inworld returned an invalid status code")
	}
	message, mOK := value["message"].(string)
	if _, present := value["message"]; present && !mOK {
		return errors.New("Inworld returned an invalid status message")
	}
	if ok && code != 0 {
		if !mOK {
			message = fmt.Sprintf("Inworld status %d", int64(code))
		}
		return &Error{Message: message, Code: runtime.Some(int64(code))}
	}
	return nil
}
func result(data []byte) (map[string]any, error) {
	packet, err := decode(data)
	if err != nil {
		return nil, err
	}
	if value, present := packet["error"]; present {
		fields, _ := value.(map[string]any)
		if err := status(fields); err != nil {
			return nil, err
		}
		message, ok := fields["message"].(string)
		if !ok {
			message = "Inworld synthesis failed"
		}
		return nil, &Error{Message: message}
	}
	fields, ok := packet["result"].(map[string]any)
	if !ok {
		return nil, errors.New("Inworld returned an invalid object")
	}
	return fields, nil
}
func seconds(value any) (float64, error) {
	v, ok := value.(float64)
	if !ok || v < 0 || math.IsNaN(v) || math.IsInf(v*1000, 0) {
		return 0, errors.New("Inworld returned an invalid timestamp")
	}
	return v * 1000, nil
}
func timestamps(value any) ([]out.InworldTimestamp, error) {
	info, ok := value.(map[string]any)
	if !ok {
		return nil, errors.New("Inworld returned an invalid object")
	}
	marks := []out.InworldTimestamp{}
	for _, kind := range []string{"word", "character"} {
		raw, present := info[kind+"Alignment"]
		if !present {
			continue
		}
		alignment, ok := raw.(map[string]any)
		if !ok {
			return nil, errors.New("Inworld returned an invalid object")
		}
		values, vOK := alignment[kind+"s"].([]any)
		starts, sOK := alignment[kind+"StartTimeSeconds"].([]any)
		ends, eOK := alignment[kind+"EndTimeSeconds"].([]any)
		if !vOK || !sOK || !eOK || len(values) != len(starts) || len(values) != len(ends) {
			return nil, errors.New("Inworld returned mismatched timestamp arrays")
		}
		for index, raw := range values {
			token, ok := raw.(string)
			if !ok {
				return nil, errors.New("Inworld returned an invalid alignment token")
			}
			start, err := seconds(starts[index])
			if err != nil {
				return nil, err
			}
			end, err := seconds(ends[index])
			if err != nil {
				return nil, err
			}
			if end < start {
				return nil, errors.New("Inworld returned a reversed timestamp range")
			}
			mark := out.InworldTimestamp{Value: token, StartTimeMs: start, EndTimeMs: runtime.Some(end), Kind: out.InworldTimestampKindAsCharacter{}}
			if kind == "word" {
				mark.Kind = out.InworldTimestampKindAsWord{}
				mark.WordIndex = runtime.Some(float64(index))
			}
			marks = append(marks, mark)
		}
		raw, present = alignment["phoneticDetails"]
		if kind != "word" || !present {
			continue
		}
		details, ok := raw.([]any)
		if !ok {
			return nil, errors.New("Inworld returned invalid phonetic details")
		}
		for _, raw := range details {
			detail, ok := raw.(map[string]any)
			if !ok {
				return nil, errors.New("Inworld returned an invalid object")
			}
			index, iOK := detail["wordIndex"].(float64)
			phones, pOK := detail["phones"].([]any)
			if !iOK || math.Trunc(index) != index || index < 0 || index >= float64(len(values)) || !pOK {
				return nil, errors.New("Inworld returned an invalid phonetic word index")
			}
			for _, raw := range phones {
				phone, ok := raw.(map[string]any)
				if !ok {
					return nil, errors.New("Inworld returned an invalid object")
				}
				symbol, sOK := phone["phoneSymbol"].(string)
				viseme, vOK := phone["visemeSymbol"].(string)
				_, vPresent := phone["visemeSymbol"]
				if !sOK || (vPresent && !vOK) {
					return nil, errors.New("Inworld returned an invalid phone or viseme")
				}
				start, err := seconds(phone["startTimeSeconds"])
				if err != nil {
					return nil, err
				}
				duration, err := seconds(phone["durationSeconds"])
				if err != nil {
					return nil, err
				}
				end := start + duration
				if math.IsInf(end, 0) {
					return nil, errors.New("Inworld returned an invalid timestamp")
				}
				mark := out.InworldTimestamp{Kind: out.InworldTimestampKindAsPhoneme{}, Value: symbol, StartTimeMs: start, EndTimeMs: runtime.Some(end), WordIndex: runtime.Some(index)}
				marks = append(marks, mark)
				if vOK {
					mark.Kind = out.InworldTimestampKindAsViseme{}
					mark.Value = viseme
					marks = append(marks, mark)
				}
			}
		}
	}
	return marks, nil
}

func audioOutput(packet map[string]any, timed, chunk bool, id runtime.Optional[string], wave *waveStream) (out.SynthesisItem, error) {
	if value, present := packet["status"]; present {
		fields, _ := value.(map[string]any)
		if err := status(fields); err != nil {
			return nil, err
		}
	}
	rawAudio, aPresent := packet["audioContent"]
	rawMarks, mPresent := packet["timestampInfo"]
	_, usage := packet["usage"]
	if !aPresent && !mPresent && !usage {
		return nil, errors.New("Inworld returned no audio or alignment")
	}
	var audio []byte
	var err error
	if aPresent {
		encoded, ok := rawAudio.(string)
		if !ok {
			return nil, errors.New("Inworld returned invalid audio content")
		}
		audio, err = base64.StdEncoding.DecodeString(encoded)
		if err != nil || strings.ContainsAny(encoded, "\r\n") {
			return nil, errors.New("Inworld returned invalid base64 audio")
		}
		if wave != nil {
			audio, err = wave.audio(audio)
			if err != nil {
				return nil, err
			}
		}
	}
	marks := []out.InworldTimestamp{}
	if mPresent {
		marks, err = timestamps(rawMarks)
		if err != nil {
			return nil, err
		}
	}
	if !timed {
		if len(audio) == 0 {
			return nil, nil
		}
		return out.SynthesisItemAsBytes{Value: audio}, nil
	}
	if !aPresent && !mPresent {
		return nil, nil
	}
	if chunk {
		if !aPresent {
			return nil, errors.New("Inworld omitted audio from synchronized alignment")
		}
		return out.SynthesisItemAsChunk{Value: out.InworldChunkEnvelope{Audio: audio, Timestamps: marks, CorrelationId: id}}, nil
	}
	envelope := out.InworldTimelineEnvelope{Timestamps: marks, CorrelationId: id}
	if aPresent {
		envelope.Audio = runtime.Some(audio)
	}
	return out.SynthesisItemAsTimeline{Value: envelope}, nil
}

// Only the first native flush retains an open-ended PCM WAV header.
type waveStream struct {
	pending, format []byte
	header          bool
}

func (w *waveStream) boundary() error {
	if len(w.pending) > 0 {
		return errors.New("Inworld returned an incomplete WAV header")
	}
	w.header = true
	return nil
}
func (w *waveStream) audio(value []byte) ([]byte, error) {
	if !w.header {
		return value, nil
	}
	w.pending = append(w.pending, value...)
	data := w.pending
	if len(data) < 12 {
		return nil, nil
	}
	if string(data[:4]) != "RIFF" || string(data[8:12]) != "WAVE" {
		return nil, errors.New("Inworld returned an invalid WAV header")
	}
	var format []byte
	for offset := 12; offset+8 <= len(data); {
		size := uint64(binary.LittleEndian.Uint32(data[offset+4 : offset+8]))
		if string(data[offset:offset+4]) == "data" {
			if format == nil {
				return nil, errors.New("Inworld WAV omitted its format")
			}
			first := w.format == nil
			if !first && !bytes.Equal(w.format, format) {
				return nil, errors.New("Inworld changed WAV format between flushes")
			}
			w.format, w.header, w.pending = bytes.Clone(format), false, nil
			if !first {
				return data[offset+8:], nil
			}
			binary.LittleEndian.PutUint32(data[4:8], 0xffffffff)
			binary.LittleEndian.PutUint32(data[offset+4:offset+8], 0xffffffff)
			return data, nil
		}
		if uint64(offset)+8+size > 1048576 {
			return nil, errors.New("Inworld WAV header is too large")
		}
		if offset+8+int(size) > len(data) {
			return nil, nil
		}
		if string(data[offset:offset+4]) == "fmt " {
			if size < 16 || binary.LittleEndian.Uint16(data[offset+8:offset+10]) != 1 || binary.LittleEndian.Uint16(data[offset+22:offset+24]) != 16 {
				return nil, errors.New("Inworld returned an invalid PCM WAV format")
			}
			channels := uint32(binary.LittleEndian.Uint16(data[offset+10 : offset+12]))
			if channels == 0 || uint32(binary.LittleEndian.Uint16(data[offset+20:offset+22])) != channels*2 {
				return nil, errors.New("Inworld returned an invalid PCM WAV format")
			}
			format = data[offset+8 : offset+8+int(size)]
		}
		offset += 8 + int(size) + int(size%2)
	}
	return nil, nil
}
