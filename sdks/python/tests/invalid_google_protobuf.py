from speechswitch.clients.google_grpc import StreamingSynthesizeRequest, StreamingSynthesisInput, VoiceSelectionParams, StreamingAudioConfig

both: StreamingSynthesizeRequest = {"streaming_config": {"voice": {"language_code": "en-US"}}, "input": {"text": "hi"}}
text_and_markup: StreamingSynthesisInput = {"text": "hi", "markup": "pause"}
missing: VoiceSelectionParams = {}
encoding: StreamingAudioConfig = {"audio_encoding": "made-up"}
nullable: StreamingSynthesisInput = {"prompt": None}
