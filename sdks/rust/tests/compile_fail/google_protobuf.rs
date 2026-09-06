#[path = "../../src/protobuf.rs"] mod protobuf;
#[path = "../../src/clients/google_grpc.rs"] mod wire;
#[path = "../../src/clients/google_grpc_beta.rs"] mod beta;
fn wrong_encoding() -> wire::AudioEncoding { "PCM" }
fn wrong_oneof() -> wire::StreamingSynthesisInputInputSource { wire::StreamingSynthesizeRequestStreamingRequest::Input(wire::StreamingSynthesisInput::default()) }
fn fractional_rate(value: &mut wire::StreamingAudioConfig) { value.sample_rate_hertz = Some(24000.5); }
fn required_voice() -> wire::VoiceSelectionParams { wire::VoiceSelectionParams { name: None, ssml_gender: None, custom_voice: None, voice_clone: None, model_name: None, multi_speaker_voice_config: None } }
fn beta_encoding() -> wire::AudioEncoding { wire::AudioEncoding::Mp364Kbps }
fn distinct_contracts() -> wire::AudioEncoding { beta::AudioEncoding::Pcm }
