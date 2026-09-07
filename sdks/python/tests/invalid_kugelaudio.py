from speechswitch.generated.kugelaudio import TtsRequest, TtsRequestStreamingTextVoiceTextItem as Input
from speechswitch.generated.kugelaudio_output import SynthesisItem

format: TtsRequest = {"text":"Hi","voice":"custom","output":{"format":"mp3"}}
rate: TtsRequest = {"text":"Hi","voice":"custom","output":{"format":"mulaw","sample_rate_hz":24000}}
buffering: TtsRequest = {"text":"Hi","voice":"custom","output":{"format":"pcm"},"text_flush_delay_ms":100}
model: TtsRequest = {"text":"Hi","voice":"custom","output":{"format":"pcm"},"model":"unknown"}
voice: TtsRequest = {"text":"Hi","voice_name":"custom","output":{"format":"pcm"}}
update_voice: Input = {"command":"update","voice":"other"}
update_replacements: Input = {"command":"update","replacements":[{"pattern":"Hi","replacement":"Hello"}]}
clear_output: Input = {"command":"clear","output":{"format":"pcm"}}
correlation: SynthesisItem = {"correlation":"chunk","audio":b"","timestamps":[]}
flush: SynthesisItem = {"event":"flush","correlation_id":"0"}
