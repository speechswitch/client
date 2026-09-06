#[path = "../../src/runtime.rs"] mod runtime;
#[path = "../../src/json.rs"] mod json;
#[path = "../../src/http.rs"] mod http;
#[path = "../../src/endpoint.rs"] mod endpoint;
#[path = "../../src/clients/google_rest.rs"] mod wire;
#[path = "../../src/clients/google_rest_beta.rs"] mod beta;
fn wrong_encoding() -> wire::AudioConfigAudioEncoding { "PCM" }
fn fractional_rate(value: &mut wire::AudioConfig) { value.sample_rate_hertz = Some(24000.5); }
fn null_object() -> Option<wire::SynthesisInput> { Some(None) }
fn beta_field() -> wire::SynthesizeSpeechRequest { wire::SynthesizeSpeechRequest { enable_time_pointing: None, ..Default::default() } }
fn distinct_contracts() -> wire::AudioConfigAudioEncoding { beta::AudioConfigAudioEncoding::Pcm }
fn beta_encoding() -> wire::AudioConfigAudioEncoding { wire::AudioConfigAudioEncoding::Mp364Kbps }
