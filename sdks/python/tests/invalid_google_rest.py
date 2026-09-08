from speechswitch.clients.google_rest import AudioConfig, SynthesisInput, VoiceSelectionParams

bad_enum: AudioConfig = {"audioEncoding": "FLAC"}
null_text: SynthesisInput = {"text": None}
fractional_rate: AudioConfig = {"sampleRateHertz": 1.5}
bad_voice: VoiceSelectionParams = {"voiceClone": {"voiceCloningKey": 42}}
text: SynthesisInput = {"text": "hello"}
text["text"] = "mutated"
