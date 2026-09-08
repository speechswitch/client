// Generated from cataloged Google protobuf definitions. Do not edit.
#![allow(dead_code)]
use crate::protobuf::{Error, Reader, Writer};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SsmlVoiceGender {
    SsmlVoiceGenderUnspecified,
    Male,
    Female,
    Neutral,
}
impl SsmlVoiceGender {
    fn number(&self) -> i32 { match self {
        Self::SsmlVoiceGenderUnspecified => 0,
        Self::Male => 1,
        Self::Female => 2,
        Self::Neutral => 3,
    } }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CustomVoiceParamsReportedUsage {
    ReportedUsageUnspecified,
    Realtime,
    Offline,
}
impl CustomVoiceParamsReportedUsage {
    fn number(&self) -> i32 { match self {
        Self::ReportedUsageUnspecified => 0,
        Self::Realtime => 1,
        Self::Offline => 2,
    } }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AudioEncoding {
    AudioEncodingUnspecified,
    Linear16,
    Mp3,
    OggOpus,
    Mulaw,
    Alaw,
    Pcm,
    M4A,
}
impl AudioEncoding {
    fn number(&self) -> i32 { match self {
        Self::AudioEncodingUnspecified => 0,
        Self::Linear16 => 1,
        Self::Mp3 => 2,
        Self::OggOpus => 3,
        Self::Mulaw => 5,
        Self::Alaw => 6,
        Self::Pcm => 7,
        Self::M4A => 8,
    } }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CustomPronunciationParamsPhoneticEncoding {
    PhoneticEncodingUnspecified,
    PhoneticEncodingIpa,
    PhoneticEncodingXSampa,
    PhoneticEncodingJapaneseYomigana,
    PhoneticEncodingPinyin,
}
impl CustomPronunciationParamsPhoneticEncoding {
    fn number(&self) -> i32 { match self {
        Self::PhoneticEncodingUnspecified => 0,
        Self::PhoneticEncodingIpa => 1,
        Self::PhoneticEncodingXSampa => 2,
        Self::PhoneticEncodingJapaneseYomigana => 3,
        Self::PhoneticEncodingPinyin => 4,
    } }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AdvancedVoiceOptionsHarmCategory {
    HarmCategoryUnspecified,
    HarmCategoryHateSpeech,
    HarmCategoryDangerousContent,
    HarmCategoryHarassment,
    HarmCategorySexuallyExplicit,
}
impl AdvancedVoiceOptionsHarmCategory {
    fn number(&self) -> i32 { match self {
        Self::HarmCategoryUnspecified => 0,
        Self::HarmCategoryHateSpeech => 1,
        Self::HarmCategoryDangerousContent => 2,
        Self::HarmCategoryHarassment => 3,
        Self::HarmCategorySexuallyExplicit => 4,
    } }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AdvancedVoiceOptionsHarmBlockThreshold {
    HarmBlockThresholdUnspecified,
    BlockLowAndAbove,
    BlockMediumAndAbove,
    BlockOnlyHigh,
    BlockNone,
    Off,
}
impl AdvancedVoiceOptionsHarmBlockThreshold {
    fn number(&self) -> i32 { match self {
        Self::HarmBlockThresholdUnspecified => 0,
        Self::BlockLowAndAbove => 1,
        Self::BlockMediumAndAbove => 2,
        Self::BlockOnlyHigh => 3,
        Self::BlockNone => 4,
        Self::Off => 5,
    } }
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct StreamingSynthesizeRequest {
    pub streaming_request: Option<StreamingSynthesizeRequestStreamingRequest>,
}
#[derive(Debug, Clone, PartialEq)]
pub enum StreamingSynthesizeRequestStreamingRequest {
    StreamingConfig(StreamingSynthesizeConfig),
    Input(StreamingSynthesisInput),
}
pub fn encode_streaming_synthesize_request(value: &StreamingSynthesizeRequest) -> Result<Vec<u8>, Error> {
    let mut writer = Writer::default();
    if let Some(item) = &value.streaming_request { match item {
    StreamingSynthesizeRequestStreamingRequest::StreamingConfig(item) => {
    writer.uint32(10).bytes(&encode_streaming_synthesize_config(item)?);
    }
    StreamingSynthesizeRequestStreamingRequest::Input(item) => {
    writer.uint32(18).bytes(&encode_streaming_synthesis_input(item)?);
    }
    } }
    writer.finish()
}

#[derive(Debug, Clone, PartialEq)]
pub struct StreamingSynthesizeConfig {
    pub voice: VoiceSelectionParams,
    pub streaming_audio_config: Option<StreamingAudioConfig>,
    pub custom_pronunciations: Option<CustomPronunciations>,
    pub advanced_voice_options: Option<AdvancedVoiceOptions>,
}
pub fn encode_streaming_synthesize_config(value: &StreamingSynthesizeConfig) -> Result<Vec<u8>, Error> {
    let mut writer = Writer::default();
    writer.uint32(10).bytes(&encode_voice_selection_params(&value.voice)?);
    if let Some(item) = &value.streaming_audio_config {
    writer.uint32(34).bytes(&encode_streaming_audio_config(item)?);
    }
    if let Some(item) = &value.custom_pronunciations {
    writer.uint32(42).bytes(&encode_custom_pronunciations(item)?);
    }
    if let Some(item) = &value.advanced_voice_options {
    writer.uint32(58).bytes(&encode_advanced_voice_options(item)?);
    }
    writer.finish()
}

#[derive(Debug, Clone, PartialEq)]
pub struct VoiceSelectionParams {
    pub language_code: String,
    pub name: Option<String>,
    pub ssml_gender: Option<SsmlVoiceGender>,
    pub custom_voice: Option<CustomVoiceParams>,
    pub voice_clone: Option<VoiceCloneParams>,
    pub model_name: Option<String>,
    pub multi_speaker_voice_config: Option<MultiSpeakerVoiceConfig>,
}
pub fn encode_voice_selection_params(value: &VoiceSelectionParams) -> Result<Vec<u8>, Error> {
    let mut writer = Writer::default();
    writer.uint32(10).string(&value.language_code);
    if let Some(item) = &value.name {
    writer.uint32(18).string(item);
    }
    if let Some(item) = &value.ssml_gender {
    writer.uint32(24).int32((item).number());
    }
    if let Some(item) = &value.custom_voice {
    writer.uint32(34).bytes(&encode_custom_voice_params(item)?);
    }
    if let Some(item) = &value.voice_clone {
    writer.uint32(42).bytes(&encode_voice_clone_params(item)?);
    }
    if let Some(item) = &value.model_name {
    writer.uint32(50).string(item);
    }
    if let Some(item) = &value.multi_speaker_voice_config {
    writer.uint32(58).bytes(&encode_multi_speaker_voice_config(item)?);
    }
    writer.finish()
}

#[derive(Debug, Clone, PartialEq)]
pub struct CustomVoiceParams {
    pub model: String,
    pub reported_usage: Option<CustomVoiceParamsReportedUsage>,
}
pub fn encode_custom_voice_params(value: &CustomVoiceParams) -> Result<Vec<u8>, Error> {
    let mut writer = Writer::default();
    writer.uint32(10).string(&value.model);
    if let Some(item) = &value.reported_usage {
    writer.uint32(24).int32((item).number());
    }
    writer.finish()
}

#[derive(Debug, Clone, PartialEq)]
pub struct VoiceCloneParams {
    pub voice_cloning_key: String,
}
pub fn encode_voice_clone_params(value: &VoiceCloneParams) -> Result<Vec<u8>, Error> {
    let mut writer = Writer::default();
    writer.uint32(10).string(&value.voice_cloning_key);
    writer.finish()
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct MultiSpeakerVoiceConfig {
    pub speaker_voice_configs: Vec<MultispeakerPrebuiltVoice>,
}
pub fn encode_multi_speaker_voice_config(value: &MultiSpeakerVoiceConfig) -> Result<Vec<u8>, Error> {
    let mut writer = Writer::default();
    for item in &value.speaker_voice_configs {
    writer.uint32(18).bytes(&encode_multispeaker_prebuilt_voice(item)?);
    }
    writer.finish()
}

#[derive(Debug, Clone, PartialEq)]
pub struct MultispeakerPrebuiltVoice {
    pub speaker_alias: String,
    pub speaker_id: String,
}
pub fn encode_multispeaker_prebuilt_voice(value: &MultispeakerPrebuiltVoice) -> Result<Vec<u8>, Error> {
    let mut writer = Writer::default();
    writer.uint32(10).string(&value.speaker_alias);
    writer.uint32(18).string(&value.speaker_id);
    writer.finish()
}

#[derive(Debug, Clone, PartialEq)]
pub struct StreamingAudioConfig {
    pub audio_encoding: AudioEncoding,
    pub sample_rate_hertz: Option<i32>,
    pub speaking_rate: Option<f64>,
}
pub fn encode_streaming_audio_config(value: &StreamingAudioConfig) -> Result<Vec<u8>, Error> {
    let mut writer = Writer::default();
    writer.uint32(8).int32((&value.audio_encoding).number());
    if let Some(item) = &value.sample_rate_hertz {
    writer.uint32(16).int32(*(item));
    }
    if let Some(item) = &value.speaking_rate {
    writer.uint32(25).double(*(item));
    }
    writer.finish()
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct CustomPronunciations {
    pub pronunciations: Vec<CustomPronunciationParams>,
}
pub fn encode_custom_pronunciations(value: &CustomPronunciations) -> Result<Vec<u8>, Error> {
    let mut writer = Writer::default();
    for item in &value.pronunciations {
    writer.uint32(10).bytes(&encode_custom_pronunciation_params(item)?);
    }
    writer.finish()
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct CustomPronunciationParams {
    pub phrase: Option<String>,
    pub phonetic_encoding: Option<CustomPronunciationParamsPhoneticEncoding>,
    pub pronunciation: Option<String>,
}
pub fn encode_custom_pronunciation_params(value: &CustomPronunciationParams) -> Result<Vec<u8>, Error> {
    let mut writer = Writer::default();
    if let Some(item) = &value.phrase {
    writer.uint32(10).string(item);
    }
    if let Some(item) = &value.phonetic_encoding {
    writer.uint32(16).int32((item).number());
    }
    if let Some(item) = &value.pronunciation {
    writer.uint32(26).string(item);
    }
    writer.finish()
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct AdvancedVoiceOptions {
    pub low_latency_journey_synthesis: Option<bool>,
    pub relax_safety_filters: Option<bool>,
    pub safety_settings: Option<AdvancedVoiceOptionsSafetySettings>,
    pub enable_textnorm: Option<bool>,
}
pub fn encode_advanced_voice_options(value: &AdvancedVoiceOptions) -> Result<Vec<u8>, Error> {
    let mut writer = Writer::default();
    if let Some(item) = &value.low_latency_journey_synthesis {
    writer.uint32(8).bool(*(item));
    }
    if let Some(item) = &value.relax_safety_filters {
    writer.uint32(64).bool(*(item));
    }
    if let Some(item) = &value.safety_settings {
    writer.uint32(74).bytes(&encode_advanced_voice_options_safety_settings(item)?);
    }
    if let Some(item) = &value.enable_textnorm {
    writer.uint32(16).bool(*(item));
    }
    writer.finish()
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct AdvancedVoiceOptionsSafetySettings {
    pub settings: Vec<AdvancedVoiceOptionsSafetySetting>,
}
pub fn encode_advanced_voice_options_safety_settings(value: &AdvancedVoiceOptionsSafetySettings) -> Result<Vec<u8>, Error> {
    let mut writer = Writer::default();
    for item in &value.settings {
    writer.uint32(10).bytes(&encode_advanced_voice_options_safety_setting(item)?);
    }
    writer.finish()
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct AdvancedVoiceOptionsSafetySetting {
    pub category: Option<AdvancedVoiceOptionsHarmCategory>,
    pub threshold: Option<AdvancedVoiceOptionsHarmBlockThreshold>,
}
pub fn encode_advanced_voice_options_safety_setting(value: &AdvancedVoiceOptionsSafetySetting) -> Result<Vec<u8>, Error> {
    let mut writer = Writer::default();
    if let Some(item) = &value.category {
    writer.uint32(8).int32((item).number());
    }
    if let Some(item) = &value.threshold {
    writer.uint32(16).int32((item).number());
    }
    writer.finish()
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct StreamingSynthesisInput {
    pub prompt: Option<String>,
    pub input_source: Option<StreamingSynthesisInputInputSource>,
}
#[derive(Debug, Clone, PartialEq)]
pub enum StreamingSynthesisInputInputSource {
    Text(String),
    Markup(String),
    MultiSpeakerMarkup(MultiSpeakerMarkup),
}
pub fn encode_streaming_synthesis_input(value: &StreamingSynthesisInput) -> Result<Vec<u8>, Error> {
    let mut writer = Writer::default();
    if let Some(item) = &value.input_source { match item {
    StreamingSynthesisInputInputSource::Text(item) => {
    writer.uint32(10).string(item);
    }
    StreamingSynthesisInputInputSource::Markup(item) => {
    writer.uint32(42).string(item);
    }
    StreamingSynthesisInputInputSource::MultiSpeakerMarkup(item) => {
    writer.uint32(58).bytes(&encode_multi_speaker_markup(item)?);
    }
    } }
    if let Some(item) = &value.prompt {
    writer.uint32(50).string(item);
    }
    writer.finish()
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct MultiSpeakerMarkup {
    pub turns: Vec<MultiSpeakerMarkupTurn>,
}
pub fn encode_multi_speaker_markup(value: &MultiSpeakerMarkup) -> Result<Vec<u8>, Error> {
    let mut writer = Writer::default();
    for item in &value.turns {
    writer.uint32(10).bytes(&encode_multi_speaker_markup_turn(item)?);
    }
    writer.finish()
}

#[derive(Debug, Clone, PartialEq)]
pub struct MultiSpeakerMarkupTurn {
    pub speaker: String,
    pub text: String,
}
pub fn encode_multi_speaker_markup_turn(value: &MultiSpeakerMarkupTurn) -> Result<Vec<u8>, Error> {
    let mut writer = Writer::default();
    writer.uint32(10).string(&value.speaker);
    writer.uint32(18).string(&value.text);
    writer.finish()
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct StreamingSynthesizeResponse {
    pub audio_content: Option<Vec<u8>>,
}
pub fn encode_streaming_synthesize_response(value: &StreamingSynthesizeResponse) -> Result<Vec<u8>, Error> {
    let mut writer = Writer::default();
    if let Some(item) = &value.audio_content {
    writer.uint32(10).bytes(item);
    }
    writer.finish()
}

fn merge_streaming_synthesize_response(data: &[u8], value: &mut StreamingSynthesizeResponse) -> Result<(), Error> {
    let mut reader = Reader::new(data);
    while !reader.done() {
        let tag = reader.uint32()?;
        if tag >> 3 == 0 { return Err(Error("Invalid protobuf field number".into())); }
        match tag >> 3 {
            1 => {
                if tag & 7 != 2 { return Err(Error("Invalid protobuf wire type for StreamingSynthesizeResponse.audioContent".into())); }
                value.audio_content = Some(reader.bytes()?.to_vec());
            }
            _ => reader.skip(tag & 7)?,
        }
    }
    Ok(())
}
pub fn decode_streaming_synthesize_response(data: &[u8]) -> Result<StreamingSynthesizeResponse, Error> {
    let mut value = StreamingSynthesizeResponse::default();
    merge_streaming_synthesize_response(data, &mut value)?;
    Ok(value)
}

pub const STREAMING_SYNTHESIZE_PATH: &str = "/google.cloud.texttospeech.v1.TextToSpeech/StreamingSynthesize";
#[allow(unused_imports)]
pub use encode_streaming_synthesize_request as encode_streaming_request;
#[allow(unused_imports)]
pub use decode_streaming_synthesize_response as decode_streaming_response;
