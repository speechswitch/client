package hume

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"math"
	"strconv"
	"strings"

	out "github.com/speechswitch/client/sdks/go/generated/hume_output"
	"github.com/speechswitch/client/sdks/go/runtime"
)

func packet(data []byte, metadata bool) (out.SynthesisItem, error) {
	if !runtime.ValidUTF8JSON(data) {
		return nil, errors.New("Hume returned invalid JSON")
	}
	var value map[string]any
	if json.Unmarshal(data, &value) != nil || value == nil {
		return nil, errors.New("Hume returned an invalid event")
	}
	nativeError, isError := value["error"].(string)
	if isError || value["type"] == "error" {
		message := "Hume synthesis failed"
		if isError {
			message = nativeError
		}
		if v, ok := value["message"].(string); ok {
			message = v
		}
		code := runtime.Optional[string]{}
		if v, ok := value["code"].(string); ok {
			code = runtime.Some(v)
		}
		return nil, &Error{Message: message, Code: code}
	}
	generation, gOK := value["generation_id"].(string)
	request, rOK := value["request_id"].(string)
	snippet, sOK := value["snippet_id"].(string)
	if !gOK || !rOK || !sOK {
		return nil, errors.New("Hume returned invalid correlation identifiers")
	}
	envelope := out.HumeEnvelope{GenerationId: generation, RequestId: request, CorrelationId: snippet, Timestamps: []out.Timestamp{}}
	switch value["type"] {
	case "audio":
		audio, aOK := value["audio"].(string)
		_, aPresent := value["audio"]
		index, iOK := value["chunk_index"].(float64)
		last, lOK := value["is_last_chunk"].(bool)
		utterance, uOK := value["utterance_index"].(float64)
		if (metadata && !aOK) || (aPresent && !aOK) || !iOK || index < 0 || index > 9007199254740991 || math.Trunc(index) != index || !lOK || (value["utterance_index"] != nil && (!uOK || utterance < 0 || utterance > 9007199254740991 || math.Trunc(utterance) != utterance)) {
			return nil, errors.New("Hume returned an invalid audio event")
		}
		// JSON metadata in binary mode is not another copy of the audio.
		if !metadata {
			return nil, nil
		}
		decoded, err := base64.StdEncoding.Strict().DecodeString(audio)
		if err != nil || strings.ContainsAny(audio, "\r\n") {
			return nil, errors.New("Hume returned invalid base64 audio")
		}
		envelope.Audio = runtime.Some(decoded)
		envelope.ChunkIndex = runtime.Some(index)
		var flag out.HumeEnvelopeIsLastChunk = out.HumeEnvelopeIsLastChunkAsFalse{}
		if last {
			flag = out.HumeEnvelopeIsLastChunkAsTrue{}
		}
		envelope.IsLastChunk = runtime.Some(flag)
		if uOK {
			envelope.InputGroupId = runtime.Some(strconv.FormatInt(int64(utterance), 10))
		}
	case "timestamp":
		mark, _ := value["timestamp"].(map[string]any)
		time, _ := mark["time"].(map[string]any)
		text, tOK := mark["text"].(string)
		kind, _ := mark["type"].(string)
		start, sOK := time["begin"].(float64)
		end, eOK := time["end"].(float64)
		if !tOK || (kind != "word" && kind != "phoneme") || !sOK || !eOK || start < 0 || end < start || end > 9007199254740991 || math.Trunc(start) != start || math.Trunc(end) != end {
			return nil, errors.New("Hume returned an invalid timestamp")
		}
		if !metadata {
			return nil, nil
		}
		var literal out.TimestampKind = out.TimestampKindAsWord{}
		if kind == "phoneme" {
			literal = out.TimestampKindAsPhoneme{}
		}
		envelope.Timestamps = []out.Timestamp{{Kind: literal, Value: text, StartTimeMs: start, EndTimeMs: runtime.Some(end)}}
	default:
		return nil, errors.New("Hume returned an invalid event")
	}
	return out.SynthesisItemAsTimeline{Value: envelope}, nil
}
