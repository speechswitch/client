package invalidopenai
import "github.com/speechswitch/client/sdks/go/generated/openai"
func legacy(request *openai.TtsRequestTextVoice15a214fc) {
    request.Instructions = "Whisper"
}
