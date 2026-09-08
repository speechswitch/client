package invalidopenai
import "github.com/speechswitch/client/sdks/go/generated/openai"
func legacy(request *openai.TtsRequestTextVoice15a214fc) {
    request.Instructions = "Whisper"
}
func usage(request *openai.TtsRequestTextVoice15a214fc) { request.IncludeUsage = true }
func voice(request *openai.TtsRequestTextVoice15a214fc) { request.Voice = openai.TtsRequestTextVoicef51a0f7eVoiceAsCedar{} }
func custom(request *openai.TtsRequestTextVoicef3ee42bf) { request.Model = openai.TtsRequestTextVoice15a214fcModelAsTts1{} }
func output(request *openai.TtsRequestTextVoice15a214fcOutputObject) { request.SampleRateHz = 24000 }
func streaming(request *openai.TtsRequestTextVoicef51a0f7e, text <-chan string) { request.Text = text }
