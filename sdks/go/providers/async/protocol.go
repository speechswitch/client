package async

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"

	out "github.com/speechswitch/client/sdks/go/generated/async_output"
)

// Match TypeScript trim/trimEnd, including FEFF but excluding NEL.
const ecmaWhitespace = " \t\n\r\v\f\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"

func audioData(text string) ([]byte, error) {
	if strings.ContainsAny(text, "\r\n") {
		return nil, errors.New("Async returned invalid base64 audio")
	}
	data, err := base64.StdEncoding.DecodeString(text)
	if err != nil {
		return nil, errors.New("Async returned invalid base64 audio")
	}
	return data, nil
}

func timestamped(data []byte) (out.TimestampedAudio, error) {
	var value map[string]json.RawMessage
	result := out.TimestampedAudio{}
	if err := json.Unmarshal(data, &value); err != nil || value == nil {
		return result, errors.New("Async returned an invalid timestamp response")
	}
	var rawAudio any
	var alignment map[string]json.RawMessage
	if err := json.Unmarshal(value["audio_base64"], &rawAudio); err != nil {
		return result, errors.New("Async returned incomplete timestamped audio")
	}
	audio, ok := rawAudio.(string)
	if err := json.Unmarshal(value["alignment"], &alignment); err != nil || !ok || alignment == nil {
		return result, errors.New("Async returned incomplete timestamped audio")
	}
	var words, starts, ends []json.RawMessage
	wordsErr := json.Unmarshal(alignment["words"], &words)
	startsErr := json.Unmarshal(alignment["word_start_times_milliseconds"], &starts)
	endsErr := json.Unmarshal(alignment["word_end_times_milliseconds"], &ends)
	if wordsErr != nil || startsErr != nil || endsErr != nil || words == nil || starts == nil || ends == nil || len(words) != len(starts) || len(words) != len(ends) {
		return result, errors.New("Async returned mismatched word timestamp arrays")
	}
	result.Timestamps = make([]out.WordTimestamp, 0, len(words))
	for index, raw := range words {
		var wordValue, startValue, endValue any
		wordErr := json.Unmarshal(raw, &wordValue)
		startErr := json.Unmarshal(starts[index], &startValue)
		endErr := json.Unmarshal(ends[index], &endValue)
		word, wordOK := wordValue.(string)
		start, startOK := startValue.(float64)
		end, endOK := endValue.(float64)
		if wordErr != nil || startErr != nil || endErr != nil || !wordOK || !startOK || !endOK || math.IsNaN(start) || math.IsInf(start, 0) || start < 0 || math.IsNaN(end) || math.IsInf(end, 0) || end < start {
			return result, errors.New("Async returned an invalid word timestamp")
		}
		result.Timestamps = append(result.Timestamps, out.WordTimestamp{Value: word, StartTimeMs: start, EndTimeMs: end})
	}
	var err error
	result.Audio, err = audioData(audio)
	return result, err
}

func socketAudio(text, contextID string, inputDone bool) ([]byte, bool, error) {
	var value map[string]any
	if err := json.Unmarshal([]byte(text), &value); err != nil || value == nil {
		return nil, false, errors.New("Async returned an invalid WebSocket message")
	}
	code, codeOK := value["error_code"].(string)
	message, messageOK := value["message"].(string)
	if codeOK && messageOK {
		return nil, false, fmt.Errorf("Async synthesis failed (%s): %s", code, message)
	}
	id, idOK := value["context_id"].(string)
	audio, audioOK := value["audio"].(string)
	final, finalOK := value["final"].(bool)
	if !idOK || !audioOK || !finalOK {
		return nil, false, errors.New("Async returned an unknown WebSocket message")
	}
	if id != contextID {
		return nil, false, errors.New("Async returned output for an unexpected context")
	}
	if final && !inputDone {
		return nil, false, errors.New("Async finalized the context before input completed")
	}
	data, err := audioData(audio)
	return data, final, err
}
