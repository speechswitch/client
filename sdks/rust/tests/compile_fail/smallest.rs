use speechswitch_types::generated::smallest_ai;
pub fn invalid() { let _ = smallest_ai::TtsRequestLightningV31StreamingTextVoicebf9ab904Language::Ja(Default::default()); }
pub fn retired() { let _ = smallest_ai::TtsRequest::LightningV2; }
pub fn timed_voice(v: &mut smallest_ai::TtsRequestLightningV31ProTextVoice3c7c5185) { v.voice = String::from("custom-voice"); }
pub fn timed_language() { let _ = smallest_ai::TtsRequestLightningV31ProStreamingTextVoice4f8c2395Language::Ja(Default::default()); }
pub fn continuation(v: &mut smallest_ai::TtsRequestLightningV31StreamingTextVoicebf9ab904) { v.completion_delay_ms = Some(1.0); }
pub fn dictionaries(v: &mut smallest_ai::TtsRequestLightningV31StreamingTextVoiced272850b) { v.pronunciation_dictionaries = None; }
pub fn encoded_pcm(v: &mut smallest_ai::TtsRequestLightningV31ProStreamingTextVoice8f1b36fbOutputObject1e4e72b8) { v.sample_encoding = None; }
pub fn commands(v: &mut smallest_ai::TtsRequestLightningV31StreamingTextVoiced272850b, text: speechswitch_types::runtime::StreamingInput<smallest_ai::TtsRequestLightningV31ProStreamingTextVoice8f1b36fbTextItem>) { v.text = text; }
pub fn audio(v: &mut speechswitch_types::generated::smallest_ai_output::SmallestEnvelope) { v.audio = Vec::new(); }
