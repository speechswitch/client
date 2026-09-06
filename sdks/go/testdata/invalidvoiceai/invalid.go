package invalidvoiceai

import "github.com/speechswitch/client/sdks/go/generated/voice_ai"

func invalid(request *voice_ai.TtsRequestObjectdd71553d) {
	request.Language.Value = voice_ai.TtsRequestObject1ec54d36LanguageEs{}
}
