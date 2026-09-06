package invalidcamb

import schema "github.com/speechswitch/client/sdks/go/generated/camb"

var wrongModel = schema.TtsRequestMars81FlashBetaStreamingTextVoice{Model: schema.TtsRequestTextVoiceModelMars8Pro{}}
var wrongPCM = schema.TtsRequestMars81FlashBetaStreamingTextVoice{Output: schema.TtsRequestTextVoiceOutputPcm{}}
var wrongControls = schema.TtsRequestTextVoice{InferenceSteps: 10}
