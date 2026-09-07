package murf

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	out "github.com/speechswitch/client/sdks/go/generated/murf_output"
	"github.com/speechswitch/client/sdks/go/runtime"
	"math"
	"regexp"
)

type Error struct {
	StatusCode runtime.Optional[int]
	Body       string
	RetryAfter runtime.Optional[string]
}

func (e *Error) Error() string {
	if !e.StatusCode.Present {
		return "Murf WebSocket synthesis failed"
	}
	return fmt.Sprintf("Murf synthesis failed (%d)", e.StatusCode.Value)
}

func object(data []byte) (map[string]any, error) {
	var value any
	if err := json.Unmarshal(data, &value); err != nil {
		return nil, errors.New("Murf returned invalid JSON")
	}
	fields, ok := value.(map[string]any)
	if !ok {
		return nil, errors.New("Murf returned an invalid response object")
	}
	return fields, nil
}

var base64Pattern = regexp.MustCompile(`^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$`)

func audioBytes(value any) ([]byte, error) {
	text, ok := value.(string)
	if !ok || !base64Pattern.MatchString(text) {
		return nil, errors.New("Murf returned invalid base64 audio")
	}
	data, err := base64.StdEncoding.DecodeString(text)
	if err != nil {
		return nil, errors.New("Murf returned invalid base64 audio")
	}
	return data, nil
}

type packet struct {
	context string
	audio   []byte
	final   bool
}

func decodePacket(data []byte) (packet, error) {
	p := packet{}
	value, err := object(data)
	if err != nil {
		return p, err
	}
	if _, present := value["error"]; present {
		return p, &Error{Body: string(data)}
	}
	p.context, _ = value["context_id"].(string)
	if p.context == "" {
		return p, errors.New("Murf returned audio or completion without the requested context ID")
	}
	final, finalPresent := value["final"]
	if finalPresent {
		var ok bool
		p.final, ok = final.(bool)
		if !ok {
			return p, errors.New("Murf returned an invalid final flag")
		}
	}
	audio, audioPresent := value["audio"]
	if !audioPresent && !finalPresent {
		return p, errors.New("Murf returned an unsupported WebSocket message")
	}
	if audioPresent {
		p.audio, err = audioBytes(audio)
	}
	return p, err
}

type generation struct {
	audio               []byte
	url                 string
	duration, remaining float64
	warning             runtime.Optional[string]
	timestamps          []out.MurfTimestamp
}

func decodeGeneration(data []byte, timed, inline bool) (generation, error) {
	g := generation{timestamps: []out.MurfTimestamp{}}
	value, err := object(data)
	if err != nil {
		return g, err
	}
	duration, ok := value["audioLengthInSeconds"].(float64)
	if !ok || duration < 0 || math.IsInf(duration*1000, 0) {
		return g, errors.New("Murf returned an invalid audio duration")
	}
	g.duration = duration * 1000
	g.remaining, ok = value["remainingCharacterCount"].(float64)
	if !ok || math.Trunc(g.remaining) != g.remaining || math.Abs(g.remaining) > 9007199254740991 {
		return g, errors.New("Murf returned an invalid remaining character count")
	}
	if warning, present := value["warning"]; present {
		text, ok := warning.(string)
		if !ok {
			return g, errors.New("Murf returned an invalid warning")
		}
		g.warning = runtime.Some(text)
	}
	if timed {
		words, ok := value["wordDurations"].([]any)
		if !ok {
			return g, errors.New("Murf returned no word durations")
		}
		for _, raw := range words {
			v, ok := raw.(map[string]any)
			if !ok {
				return g, errors.New("Murf returned an invalid response object")
			}
			word, wordOK := v["word"].(string)
			start, startOK := v["startMs"].(float64)
			end, endOK := v["endMs"].(float64)
			if !wordOK || !startOK || !endOK || start < 0 || end < start || end > 9007199254740991 || math.Trunc(start) != start || math.Trunc(end) != end {
				return g, errors.New("Murf returned an invalid word duration")
			}
			g.timestamps = append(g.timestamps, out.MurfTimestamp{Value: word, StartTimeMs: start, EndTimeMs: end})
		}
	}
	if inline {
		g.audio, err = audioBytes(value["encodedAudio"])
	} else {
		g.url, _ = value["audioFile"].(string)
		if g.url == "" {
			return g, errors.New("Murf returned no audio file URL")
		}
	}
	return g, err
}
