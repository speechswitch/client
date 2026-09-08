package mistral

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"regexp"

	out "github.com/speechswitch/client/sdks/go/generated/mistral_output"
	"github.com/speechswitch/client/sdks/go/generated/transport"
	"github.com/speechswitch/client/sdks/go/runtime"
)

type Error struct {
	StatusCode int
	Body       string
	RetryAfter runtime.Optional[string]
}

func (e *Error) Error() string { return fmt.Sprintf("Mistral synthesis failed (%d)", e.StatusCode) }

func object(data []byte) (map[string]json.RawMessage, error) {
	var value map[string]json.RawMessage
	if err := json.Unmarshal(data, &value); err != nil || value == nil {
		return nil, errors.New("Mistral returned an invalid response object")
	}
	return value, nil
}

var base64Audio = regexp.MustCompile(`^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$`)

func audioData(raw json.RawMessage) ([]byte, error) {
	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		return nil, errors.New("Mistral returned invalid base64 audio")
	}
	text, ok := value.(string)
	if !ok || !base64Audio.MatchString(text) {
		return nil, errors.New("Mistral returned invalid base64 audio")
	}
	return base64.StdEncoding.DecodeString(text)
}

func count(raw json.RawMessage, field string) (float64, error) {
	var value any
	if err := json.Unmarshal(raw, &value); err == nil {
		if number, ok := value.(float64); ok && !math.IsNaN(number) && !math.IsInf(number, 0) && number >= 0 && number <= 9007199254740991 && math.Trunc(number) == number {
			return number, nil
		}
	}
	return 0, fmt.Errorf("Mistral returned invalid %s", field)
}

func optionalCount(value map[string]json.RawMessage, field string) (runtime.Optional[float64], error) {
	raw, present := value[field]
	if !present {
		return runtime.Optional[float64]{}, nil
	}
	number, err := count(raw, field)
	return runtime.Some(number), err
}

func nullableCount(value map[string]json.RawMessage, field string) (runtime.Optional[out.PromptTokensDetailsMessagesItemTotalTokens], error) {
	raw, present := value[field]
	if !present {
		return runtime.Optional[out.PromptTokensDetailsMessagesItemTotalTokens]{}, nil
	}
	var number out.PromptTokensDetailsMessagesItemTotalTokens = out.PromptTokensDetailsMessagesItemTotalTokensAsNull{}
	if string(bytes.TrimSpace(raw)) != "null" {
		value, err := count(raw, field)
		if err != nil {
			return runtime.Optional[out.PromptTokensDetailsMessagesItemTotalTokens]{}, err
		}
		number = out.PromptTokensDetailsMessagesItemTotalTokensAsNumber{Value: value}
	}
	return runtime.Some(number), nil
}

func promptDetails(raw json.RawMessage) (out.PromptTokensDetails, error) {
	result := out.PromptTokensDetails{}
	value, err := object(raw)
	if err != nil {
		return result, err
	}
	result.CachedTokens, err = optionalCount(value, "cached_tokens")
	if err != nil {
		return result, err
	}
	result.AudioTokens, err = optionalCount(value, "audio_tokens")
	if err != nil {
		return result, err
	}
	if raw, present := value["messages"]; present {
		var messages []json.RawMessage
		if err := json.Unmarshal(raw, &messages); err != nil || messages == nil {
			return result, errors.New("Mistral returned invalid usage messages")
		}
		items := make([]out.PromptTokensDetailsMessagesItem, 0, len(messages))
		for _, raw := range messages {
			value, err := object(raw)
			if err != nil {
				return result, err
			}
			item := out.PromptTokensDetailsMessagesItem{}
			var role string
			if err := json.Unmarshal(value["role"], &role); err != nil {
				return result, errors.New("Mistral returned invalid usage message role")
			}
			switch role {
			case "system":
				item.Role = out.PromptTokensDetailsMessagesItemRoleAsSystem{}
			case "user":
				item.Role = out.PromptTokensDetailsMessagesItemRoleAsUser{}
			case "assistant":
				item.Role = out.PromptTokensDetailsMessagesItemRoleAsAssistant{}
			case "tool":
				item.Role = out.PromptTokensDetailsMessagesItemRoleAsTool{}
			default:
				return result, errors.New("Mistral returned invalid usage message role")
			}
			item.TotalTokens, err = nullableCount(value, "total_tokens")
			if err != nil {
				return result, err
			}
			item.UsageCount, err = optionalCount(value, "usage_count")
			if err != nil {
				return result, err
			}
			if raw, present := value["truncated"]; present {
				var flag any
				if err := json.Unmarshal(raw, &flag); err != nil {
					return result, errors.New("Mistral returned invalid usage truncated flag")
				}
				boolean, ok := flag.(bool)
				if !ok {
					return result, errors.New("Mistral returned invalid usage truncated flag")
				}
				var truncated out.PromptTokensDetailsMessagesItemTruncated = out.PromptTokensDetailsMessagesItemTruncatedAsFalse{}
				if boolean {
					truncated = out.PromptTokensDetailsMessagesItemTruncatedAsTrue{}
				}
				item.Truncated = runtime.Some(truncated)
			}
			items = append(items, item)
		}
		result.Messages = runtime.Some(items)
	}
	return result, nil
}

func optionalPromptDetails(value map[string]json.RawMessage, field string) (runtime.Optional[out.UsagePromptTokenDetails], error) {
	raw, present := value[field]
	if !present {
		return runtime.Optional[out.UsagePromptTokenDetails]{}, nil
	}
	var details out.UsagePromptTokenDetails = out.UsagePromptTokenDetailsAsNull{}
	if string(bytes.TrimSpace(raw)) != "null" {
		value, err := promptDetails(raw)
		if err != nil {
			return runtime.Optional[out.UsagePromptTokenDetails]{}, err
		}
		details = out.UsagePromptTokenDetailsAsObject{Value: value}
	}
	return runtime.Some(details), nil
}

func usage(raw json.RawMessage) (out.Usage, error) {
	result := out.Usage{}
	value, err := object(raw)
	if err != nil {
		return result, err
	}
	result.PromptTokens, err = optionalCount(value, "prompt_tokens")
	if err != nil {
		return result, err
	}
	result.CompletionTokens, err = nullableCount(value, "completion_tokens")
	if err != nil {
		return result, err
	}
	result.TotalTokens, err = optionalCount(value, "total_tokens")
	if err != nil {
		return result, err
	}
	result.PromptAudioSeconds, err = nullableCount(value, "prompt_audio_seconds")
	if err != nil {
		return result, err
	}
	result.RequestCount, err = nullableCount(value, "request_count")
	if err != nil {
		return result, err
	}
	result.CachedTokens, err = nullableCount(value, "num_cached_tokens")
	if err != nil {
		return result, err
	}
	result.PromptTokensDetails, err = optionalPromptDetails(value, "prompt_tokens_details")
	if err != nil {
		return result, err
	}
	result.PromptTokenDetails, err = optionalPromptDetails(value, "prompt_token_details")
	if err != nil {
		return result, err
	}
	if raw, present := value["completion_tokens_details"]; present {
		var details out.UsageCompletionTokensDetails = out.UsageCompletionTokensDetailsAsNull{}
		if string(bytes.TrimSpace(raw)) != "null" {
			value, err := object(raw)
			if err != nil {
				return result, err
			}
			reasoning, err := optionalCount(value, "reasoning_tokens")
			if err != nil {
				return result, err
			}
			details = out.UsageCompletionTokensDetailsAsObject{Value: out.UsageCompletionTokensDetailsObject{ReasoningTokens: reasoning}}
		}
		result.CompletionTokensDetails = runtime.Some(details)
	}
	return result, nil
}

func decodeEvent(message transport.SseMessage) (out.SynthesisItem, error) {
	data, err := object([]byte(message.Data))
	if err != nil {
		return nil, err
	}
	var kind any = message.Event
	if raw, present := data["type"]; present && string(bytes.TrimSpace(raw)) != "null" {
		if err := json.Unmarshal(raw, &kind); err != nil {
			return nil, errors.New("Mistral returned an unsupported speech event")
		}
	}
	if message.Event != "message" && message.Event != kind {
		return nil, errors.New("Mistral returned conflicting SSE event types")
	}
	switch kind {
	case "speech.audio.delta":
		audio, err := audioData(data["audio_data"])
		if err != nil {
			return nil, err
		}
		return out.SynthesisItemAsBytes{Value: audio}, nil
	case "speech.audio.done":
		value, err := usage(data["usage"])
		if err != nil {
			return nil, err
		}
		return out.SynthesisItemAsDone{Value: out.DoneEvent{Usage: runtime.Some(value)}}, nil
	default:
		return nil, errors.New("Mistral returned an unsupported speech event")
	}
}
