// Generated from https://texttospeech.googleapis.com/$discovery/rest?version=v1beta1. Do not edit.
#![allow(dead_code)]
use crate::{endpoint, http::{HttpRequest, HttpResponse, HttpTransport, TransportError}, json::{self, Error, Raw}};

pub const DEFAULT_BASE_URL: &str = "https://texttospeech.googleapis.com/";
pub struct ClientOptions<'a> { pub base_url: &'a str, pub headers: &'a [(String, String)], pub transport: &'a dyn HttpTransport }

#[derive(Debug, Clone, PartialEq, Default)]
pub struct SynthesizeSpeechRequest {
pub advanced_voice_options: Option<AdvancedVoiceOptions>,
pub audio_config: Option<AudioConfig>,
pub enable_time_pointing: Option<SynthesizeSpeechRequestEnableTimePointing>,
pub input: Option<SynthesisInput>,
pub voice: Option<VoiceSelectionParams>,
}
fn write_synthesize_speech_request(value: &SynthesizeSpeechRequest, output: &mut String) -> Result<(), Error> {
output.push('{');
if let Some(item) = &value.advanced_voice_options {
if !output.ends_with('{') { output.push(','); } json::quote("advancedVoiceOptions", output); output.push(':'); write_advanced_voice_options(item, output)?;
}
if let Some(item) = &value.audio_config {
if !output.ends_with('{') { output.push(','); } json::quote("audioConfig", output); output.push(':'); write_audio_config(item, output)?;
}
if let Some(item) = &value.enable_time_pointing {
if !output.ends_with('{') { output.push(','); } json::quote("enableTimePointing", output); output.push(':'); write_synthesize_speech_request_enable_time_pointing(item, output)?;
}
if let Some(item) = &value.input {
if !output.ends_with('{') { output.push(','); } json::quote("input", output); output.push(':'); write_synthesis_input(item, output)?;
}
if let Some(item) = &value.voice {
if !output.ends_with('{') { output.push(','); } json::quote("voice", output); output.push(':'); write_voice_selection_params(item, output)?;
}
output.push('}'); Ok(())
}
fn read_synthesize_speech_request(value: Raw<'_>) -> Result<SynthesizeSpeechRequest, Error> {
let mut fields = value.object()?;
Ok(SynthesizeSpeechRequest {
advanced_voice_options: fields.remove("advancedVoiceOptions").map(read_advanced_voice_options).transpose()?,
audio_config: fields.remove("audioConfig").map(read_audio_config).transpose()?,
enable_time_pointing: fields.remove("enableTimePointing").map(read_synthesize_speech_request_enable_time_pointing).transpose()?,
input: fields.remove("input").map(read_synthesis_input).transpose()?,
voice: fields.remove("voice").map(read_voice_selection_params).transpose()?,
})
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct AdvancedVoiceOptions {
pub enable_textnorm: Option<AdvancedVoiceOptionsEnableTextnorm>,
pub low_latency_journey_synthesis: Option<AdvancedVoiceOptionsLowLatencyJourneySynthesis>,
pub relax_safety_filters: Option<AdvancedVoiceOptionsRelaxSafetyFilters>,
pub safety_settings: Option<SafetySettings>,
}
fn write_advanced_voice_options(value: &AdvancedVoiceOptions, output: &mut String) -> Result<(), Error> {
output.push('{');
if let Some(item) = &value.enable_textnorm {
if !output.ends_with('{') { output.push(','); } json::quote("enableTextnorm", output); output.push(':'); write_advanced_voice_options_enable_textnorm(item, output)?;
}
if let Some(item) = &value.low_latency_journey_synthesis {
if !output.ends_with('{') { output.push(','); } json::quote("lowLatencyJourneySynthesis", output); output.push(':'); write_advanced_voice_options_low_latency_journey_synthesis(item, output)?;
}
if let Some(item) = &value.relax_safety_filters {
if !output.ends_with('{') { output.push(','); } json::quote("relaxSafetyFilters", output); output.push(':'); write_advanced_voice_options_relax_safety_filters(item, output)?;
}
if let Some(item) = &value.safety_settings {
if !output.ends_with('{') { output.push(','); } json::quote("safetySettings", output); output.push(':'); write_safety_settings(item, output)?;
}
output.push('}'); Ok(())
}
fn read_advanced_voice_options(value: Raw<'_>) -> Result<AdvancedVoiceOptions, Error> {
let mut fields = value.object()?;
Ok(AdvancedVoiceOptions {
enable_textnorm: fields.remove("enableTextnorm").map(read_advanced_voice_options_enable_textnorm).transpose()?,
low_latency_journey_synthesis: fields.remove("lowLatencyJourneySynthesis").map(read_advanced_voice_options_low_latency_journey_synthesis).transpose()?,
relax_safety_filters: fields.remove("relaxSafetyFilters").map(read_advanced_voice_options_relax_safety_filters).transpose()?,
safety_settings: fields.remove("safetySettings").map(read_safety_settings).transpose()?,
})
}

pub type AdvancedVoiceOptionsEnableTextnorm = bool;
fn write_advanced_voice_options_enable_textnorm(value: &AdvancedVoiceOptionsEnableTextnorm, output: &mut String) -> Result<(), Error> {
output.push_str(&value.to_string()); Ok(())
}
fn read_advanced_voice_options_enable_textnorm(value: Raw<'_>) -> Result<AdvancedVoiceOptionsEnableTextnorm, Error> {
value.boolean()
}

pub type AdvancedVoiceOptionsLowLatencyJourneySynthesis = bool;
fn write_advanced_voice_options_low_latency_journey_synthesis(value: &AdvancedVoiceOptionsLowLatencyJourneySynthesis, output: &mut String) -> Result<(), Error> {
output.push_str(&value.to_string()); Ok(())
}
fn read_advanced_voice_options_low_latency_journey_synthesis(value: Raw<'_>) -> Result<AdvancedVoiceOptionsLowLatencyJourneySynthesis, Error> {
value.boolean()
}

pub type AdvancedVoiceOptionsRelaxSafetyFilters = bool;
fn write_advanced_voice_options_relax_safety_filters(value: &AdvancedVoiceOptionsRelaxSafetyFilters, output: &mut String) -> Result<(), Error> {
output.push_str(&value.to_string()); Ok(())
}
fn read_advanced_voice_options_relax_safety_filters(value: Raw<'_>) -> Result<AdvancedVoiceOptionsRelaxSafetyFilters, Error> {
value.boolean()
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct SafetySettings {
pub settings: Option<SafetySettingsSettings>,
}
fn write_safety_settings(value: &SafetySettings, output: &mut String) -> Result<(), Error> {
output.push('{');
if let Some(item) = &value.settings {
if !output.ends_with('{') { output.push(','); } json::quote("settings", output); output.push(':'); write_safety_settings_settings(item, output)?;
}
output.push('}'); Ok(())
}
fn read_safety_settings(value: Raw<'_>) -> Result<SafetySettings, Error> {
let mut fields = value.object()?;
Ok(SafetySettings {
settings: fields.remove("settings").map(read_safety_settings_settings).transpose()?,
})
}

pub type SafetySettingsSettings = Vec<SafetySetting>;
fn write_safety_settings_settings(value: &SafetySettingsSettings, output: &mut String) -> Result<(), Error> {
output.push('['); for (index, item) in value.iter().enumerate() { if index != 0 { output.push(','); } write_safety_setting(item, output)?; } output.push(']'); Ok(())
}
fn read_safety_settings_settings(value: Raw<'_>) -> Result<SafetySettingsSettings, Error> {
value.array()?.into_iter().map(read_safety_setting).collect()
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct SafetySetting {
pub category: Option<SafetySettingCategory>,
pub threshold: Option<SafetySettingThreshold>,
}
fn write_safety_setting(value: &SafetySetting, output: &mut String) -> Result<(), Error> {
output.push('{');
if let Some(item) = &value.category {
if !output.ends_with('{') { output.push(','); } json::quote("category", output); output.push(':'); write_safety_setting_category(item, output)?;
}
if let Some(item) = &value.threshold {
if !output.ends_with('{') { output.push(','); } json::quote("threshold", output); output.push(':'); write_safety_setting_threshold(item, output)?;
}
output.push('}'); Ok(())
}
fn read_safety_setting(value: Raw<'_>) -> Result<SafetySetting, Error> {
let mut fields = value.object()?;
Ok(SafetySetting {
category: fields.remove("category").map(read_safety_setting_category).transpose()?,
threshold: fields.remove("threshold").map(read_safety_setting_threshold).transpose()?,
})
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SafetySettingCategory { HarmCategoryUnspecified, HarmCategoryHateSpeech, HarmCategoryDangerousContent, HarmCategoryHarassment, HarmCategorySexuallyExplicit, }
impl SafetySettingCategory { fn as_str(&self) -> &'static str { match self { Self::HarmCategoryUnspecified => "HARM_CATEGORY_UNSPECIFIED", Self::HarmCategoryHateSpeech => "HARM_CATEGORY_HATE_SPEECH", Self::HarmCategoryDangerousContent => "HARM_CATEGORY_DANGEROUS_CONTENT", Self::HarmCategoryHarassment => "HARM_CATEGORY_HARASSMENT", Self::HarmCategorySexuallyExplicit => "HARM_CATEGORY_SEXUALLY_EXPLICIT", } } }
fn write_safety_setting_category(value: &SafetySettingCategory, output: &mut String) -> Result<(), Error> {
json::quote(value.as_str(), output); Ok(())
}
fn read_safety_setting_category(value: Raw<'_>) -> Result<SafetySettingCategory, Error> {
match value.string()?.as_str() { "HARM_CATEGORY_UNSPECIFIED" => Ok(SafetySettingCategory::HarmCategoryUnspecified), "HARM_CATEGORY_HATE_SPEECH" => Ok(SafetySettingCategory::HarmCategoryHateSpeech), "HARM_CATEGORY_DANGEROUS_CONTENT" => Ok(SafetySettingCategory::HarmCategoryDangerousContent), "HARM_CATEGORY_HARASSMENT" => Ok(SafetySettingCategory::HarmCategoryHarassment), "HARM_CATEGORY_SEXUALLY_EXPLICIT" => Ok(SafetySettingCategory::HarmCategorySexuallyExplicit), _ => Err(Error) }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SafetySettingThreshold { HarmBlockThresholdUnspecified, BlockLowAndAbove, BlockMediumAndAbove, BlockOnlyHigh, BlockNone, Off, }
impl SafetySettingThreshold { fn as_str(&self) -> &'static str { match self { Self::HarmBlockThresholdUnspecified => "HARM_BLOCK_THRESHOLD_UNSPECIFIED", Self::BlockLowAndAbove => "BLOCK_LOW_AND_ABOVE", Self::BlockMediumAndAbove => "BLOCK_MEDIUM_AND_ABOVE", Self::BlockOnlyHigh => "BLOCK_ONLY_HIGH", Self::BlockNone => "BLOCK_NONE", Self::Off => "OFF", } } }
fn write_safety_setting_threshold(value: &SafetySettingThreshold, output: &mut String) -> Result<(), Error> {
json::quote(value.as_str(), output); Ok(())
}
fn read_safety_setting_threshold(value: Raw<'_>) -> Result<SafetySettingThreshold, Error> {
match value.string()?.as_str() { "HARM_BLOCK_THRESHOLD_UNSPECIFIED" => Ok(SafetySettingThreshold::HarmBlockThresholdUnspecified), "BLOCK_LOW_AND_ABOVE" => Ok(SafetySettingThreshold::BlockLowAndAbove), "BLOCK_MEDIUM_AND_ABOVE" => Ok(SafetySettingThreshold::BlockMediumAndAbove), "BLOCK_ONLY_HIGH" => Ok(SafetySettingThreshold::BlockOnlyHigh), "BLOCK_NONE" => Ok(SafetySettingThreshold::BlockNone), "OFF" => Ok(SafetySettingThreshold::Off), _ => Err(Error) }
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct AudioConfig {
pub audio_encoding: Option<AudioConfigAudioEncoding>,
pub effects_profile_id: Option<AudioConfigEffectsProfileId>,
pub pitch: Option<AudioConfigPitch>,
pub sample_rate_hertz: Option<AudioConfigSampleRateHertz>,
pub speaking_rate: Option<AudioConfigSpeakingRate>,
pub volume_gain_db: Option<AudioConfigVolumeGainDb>,
}
fn write_audio_config(value: &AudioConfig, output: &mut String) -> Result<(), Error> {
output.push('{');
if let Some(item) = &value.audio_encoding {
if !output.ends_with('{') { output.push(','); } json::quote("audioEncoding", output); output.push(':'); write_audio_config_audio_encoding(item, output)?;
}
if let Some(item) = &value.effects_profile_id {
if !output.ends_with('{') { output.push(','); } json::quote("effectsProfileId", output); output.push(':'); write_audio_config_effects_profile_id(item, output)?;
}
if let Some(item) = &value.pitch {
if !output.ends_with('{') { output.push(','); } json::quote("pitch", output); output.push(':'); write_audio_config_pitch(item, output)?;
}
if let Some(item) = &value.sample_rate_hertz {
if !output.ends_with('{') { output.push(','); } json::quote("sampleRateHertz", output); output.push(':'); write_audio_config_sample_rate_hertz(item, output)?;
}
if let Some(item) = &value.speaking_rate {
if !output.ends_with('{') { output.push(','); } json::quote("speakingRate", output); output.push(':'); write_audio_config_speaking_rate(item, output)?;
}
if let Some(item) = &value.volume_gain_db {
if !output.ends_with('{') { output.push(','); } json::quote("volumeGainDb", output); output.push(':'); write_audio_config_volume_gain_db(item, output)?;
}
output.push('}'); Ok(())
}
fn read_audio_config(value: Raw<'_>) -> Result<AudioConfig, Error> {
let mut fields = value.object()?;
Ok(AudioConfig {
audio_encoding: fields.remove("audioEncoding").map(read_audio_config_audio_encoding).transpose()?,
effects_profile_id: fields.remove("effectsProfileId").map(read_audio_config_effects_profile_id).transpose()?,
pitch: fields.remove("pitch").map(read_audio_config_pitch).transpose()?,
sample_rate_hertz: fields.remove("sampleRateHertz").map(read_audio_config_sample_rate_hertz).transpose()?,
speaking_rate: fields.remove("speakingRate").map(read_audio_config_speaking_rate).transpose()?,
volume_gain_db: fields.remove("volumeGainDb").map(read_audio_config_volume_gain_db).transpose()?,
})
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AudioConfigAudioEncoding { AudioEncodingUnspecified, Linear16, Mp3, Mp364Kbps, OggOpus, Mulaw, Alaw, Pcm, M4A, }
impl AudioConfigAudioEncoding { fn as_str(&self) -> &'static str { match self { Self::AudioEncodingUnspecified => "AUDIO_ENCODING_UNSPECIFIED", Self::Linear16 => "LINEAR16", Self::Mp3 => "MP3", Self::Mp364Kbps => "MP3_64_KBPS", Self::OggOpus => "OGG_OPUS", Self::Mulaw => "MULAW", Self::Alaw => "ALAW", Self::Pcm => "PCM", Self::M4A => "M4A", } } }
fn write_audio_config_audio_encoding(value: &AudioConfigAudioEncoding, output: &mut String) -> Result<(), Error> {
json::quote(value.as_str(), output); Ok(())
}
fn read_audio_config_audio_encoding(value: Raw<'_>) -> Result<AudioConfigAudioEncoding, Error> {
match value.string()?.as_str() { "AUDIO_ENCODING_UNSPECIFIED" => Ok(AudioConfigAudioEncoding::AudioEncodingUnspecified), "LINEAR16" => Ok(AudioConfigAudioEncoding::Linear16), "MP3" => Ok(AudioConfigAudioEncoding::Mp3), "MP3_64_KBPS" => Ok(AudioConfigAudioEncoding::Mp364Kbps), "OGG_OPUS" => Ok(AudioConfigAudioEncoding::OggOpus), "MULAW" => Ok(AudioConfigAudioEncoding::Mulaw), "ALAW" => Ok(AudioConfigAudioEncoding::Alaw), "PCM" => Ok(AudioConfigAudioEncoding::Pcm), "M4A" => Ok(AudioConfigAudioEncoding::M4A), _ => Err(Error) }
}

pub type AudioConfigEffectsProfileId = Vec<AudioConfigEffectsProfileIdItem>;
fn write_audio_config_effects_profile_id(value: &AudioConfigEffectsProfileId, output: &mut String) -> Result<(), Error> {
output.push('['); for (index, item) in value.iter().enumerate() { if index != 0 { output.push(','); } write_audio_config_effects_profile_id_item(item, output)?; } output.push(']'); Ok(())
}
fn read_audio_config_effects_profile_id(value: Raw<'_>) -> Result<AudioConfigEffectsProfileId, Error> {
value.array()?.into_iter().map(read_audio_config_effects_profile_id_item).collect()
}

pub type AudioConfigEffectsProfileIdItem = String;
fn write_audio_config_effects_profile_id_item(value: &AudioConfigEffectsProfileIdItem, output: &mut String) -> Result<(), Error> {
json::quote(value, output); Ok(())
}
fn read_audio_config_effects_profile_id_item(value: Raw<'_>) -> Result<AudioConfigEffectsProfileIdItem, Error> {
value.string()
}

pub type AudioConfigPitch = f64;
fn write_audio_config_pitch(value: &AudioConfigPitch, output: &mut String) -> Result<(), Error> {
if !value.is_finite() { return Err(Error); } output.push_str(&value.to_string()); Ok(())
}
fn read_audio_config_pitch(value: Raw<'_>) -> Result<AudioConfigPitch, Error> {
let number = value.number()?; if number.is_finite() { Ok(number) } else { Err(Error) }
}

pub type AudioConfigSampleRateHertz = i32;
fn write_audio_config_sample_rate_hertz(value: &AudioConfigSampleRateHertz, output: &mut String) -> Result<(), Error> {
output.push_str(&value.to_string()); Ok(())
}
fn read_audio_config_sample_rate_hertz(value: Raw<'_>) -> Result<AudioConfigSampleRateHertz, Error> {
value.text().parse().map_err(|_| Error)
}

pub type AudioConfigSpeakingRate = f64;
fn write_audio_config_speaking_rate(value: &AudioConfigSpeakingRate, output: &mut String) -> Result<(), Error> {
if !value.is_finite() { return Err(Error); } output.push_str(&value.to_string()); Ok(())
}
fn read_audio_config_speaking_rate(value: Raw<'_>) -> Result<AudioConfigSpeakingRate, Error> {
let number = value.number()?; if number.is_finite() { Ok(number) } else { Err(Error) }
}

pub type AudioConfigVolumeGainDb = f64;
fn write_audio_config_volume_gain_db(value: &AudioConfigVolumeGainDb, output: &mut String) -> Result<(), Error> {
if !value.is_finite() { return Err(Error); } output.push_str(&value.to_string()); Ok(())
}
fn read_audio_config_volume_gain_db(value: Raw<'_>) -> Result<AudioConfigVolumeGainDb, Error> {
let number = value.number()?; if number.is_finite() { Ok(number) } else { Err(Error) }
}

pub type SynthesizeSpeechRequestEnableTimePointing = Vec<SynthesizeSpeechRequestEnableTimePointingItem>;
fn write_synthesize_speech_request_enable_time_pointing(value: &SynthesizeSpeechRequestEnableTimePointing, output: &mut String) -> Result<(), Error> {
output.push('['); for (index, item) in value.iter().enumerate() { if index != 0 { output.push(','); } write_synthesize_speech_request_enable_time_pointing_item(item, output)?; } output.push(']'); Ok(())
}
fn read_synthesize_speech_request_enable_time_pointing(value: Raw<'_>) -> Result<SynthesizeSpeechRequestEnableTimePointing, Error> {
value.array()?.into_iter().map(read_synthesize_speech_request_enable_time_pointing_item).collect()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SynthesizeSpeechRequestEnableTimePointingItem { TimepointTypeUnspecified, SsmlMark, }
impl SynthesizeSpeechRequestEnableTimePointingItem { fn as_str(&self) -> &'static str { match self { Self::TimepointTypeUnspecified => "TIMEPOINT_TYPE_UNSPECIFIED", Self::SsmlMark => "SSML_MARK", } } }
fn write_synthesize_speech_request_enable_time_pointing_item(value: &SynthesizeSpeechRequestEnableTimePointingItem, output: &mut String) -> Result<(), Error> {
json::quote(value.as_str(), output); Ok(())
}
fn read_synthesize_speech_request_enable_time_pointing_item(value: Raw<'_>) -> Result<SynthesizeSpeechRequestEnableTimePointingItem, Error> {
match value.string()?.as_str() { "TIMEPOINT_TYPE_UNSPECIFIED" => Ok(SynthesizeSpeechRequestEnableTimePointingItem::TimepointTypeUnspecified), "SSML_MARK" => Ok(SynthesizeSpeechRequestEnableTimePointingItem::SsmlMark), _ => Err(Error) }
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct SynthesisInput {
pub custom_pronunciations: Option<CustomPronunciations>,
pub markup: Option<SynthesisInputMarkup>,
pub multi_speaker_markup: Option<MultiSpeakerMarkup>,
pub prompt: Option<SynthesisInputPrompt>,
pub ssml: Option<SynthesisInputSsml>,
pub text: Option<SynthesisInputText>,
}
fn write_synthesis_input(value: &SynthesisInput, output: &mut String) -> Result<(), Error> {
output.push('{');
if let Some(item) = &value.custom_pronunciations {
if !output.ends_with('{') { output.push(','); } json::quote("customPronunciations", output); output.push(':'); write_custom_pronunciations(item, output)?;
}
if let Some(item) = &value.markup {
if !output.ends_with('{') { output.push(','); } json::quote("markup", output); output.push(':'); write_synthesis_input_markup(item, output)?;
}
if let Some(item) = &value.multi_speaker_markup {
if !output.ends_with('{') { output.push(','); } json::quote("multiSpeakerMarkup", output); output.push(':'); write_multi_speaker_markup(item, output)?;
}
if let Some(item) = &value.prompt {
if !output.ends_with('{') { output.push(','); } json::quote("prompt", output); output.push(':'); write_synthesis_input_prompt(item, output)?;
}
if let Some(item) = &value.ssml {
if !output.ends_with('{') { output.push(','); } json::quote("ssml", output); output.push(':'); write_synthesis_input_ssml(item, output)?;
}
if let Some(item) = &value.text {
if !output.ends_with('{') { output.push(','); } json::quote("text", output); output.push(':'); write_synthesis_input_text(item, output)?;
}
output.push('}'); Ok(())
}
fn read_synthesis_input(value: Raw<'_>) -> Result<SynthesisInput, Error> {
let mut fields = value.object()?;
Ok(SynthesisInput {
custom_pronunciations: fields.remove("customPronunciations").map(read_custom_pronunciations).transpose()?,
markup: fields.remove("markup").map(read_synthesis_input_markup).transpose()?,
multi_speaker_markup: fields.remove("multiSpeakerMarkup").map(read_multi_speaker_markup).transpose()?,
prompt: fields.remove("prompt").map(read_synthesis_input_prompt).transpose()?,
ssml: fields.remove("ssml").map(read_synthesis_input_ssml).transpose()?,
text: fields.remove("text").map(read_synthesis_input_text).transpose()?,
})
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct CustomPronunciations {
pub pronunciations: Option<CustomPronunciationsPronunciations>,
}
fn write_custom_pronunciations(value: &CustomPronunciations, output: &mut String) -> Result<(), Error> {
output.push('{');
if let Some(item) = &value.pronunciations {
if !output.ends_with('{') { output.push(','); } json::quote("pronunciations", output); output.push(':'); write_custom_pronunciations_pronunciations(item, output)?;
}
output.push('}'); Ok(())
}
fn read_custom_pronunciations(value: Raw<'_>) -> Result<CustomPronunciations, Error> {
let mut fields = value.object()?;
Ok(CustomPronunciations {
pronunciations: fields.remove("pronunciations").map(read_custom_pronunciations_pronunciations).transpose()?,
})
}

pub type CustomPronunciationsPronunciations = Vec<CustomPronunciationParams>;
fn write_custom_pronunciations_pronunciations(value: &CustomPronunciationsPronunciations, output: &mut String) -> Result<(), Error> {
output.push('['); for (index, item) in value.iter().enumerate() { if index != 0 { output.push(','); } write_custom_pronunciation_params(item, output)?; } output.push(']'); Ok(())
}
fn read_custom_pronunciations_pronunciations(value: Raw<'_>) -> Result<CustomPronunciationsPronunciations, Error> {
value.array()?.into_iter().map(read_custom_pronunciation_params).collect()
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct CustomPronunciationParams {
pub phonetic_encoding: Option<CustomPronunciationParamsPhoneticEncoding>,
pub phrase: Option<CustomPronunciationParamsPhrase>,
pub pronunciation: Option<CustomPronunciationParamsPronunciation>,
}
fn write_custom_pronunciation_params(value: &CustomPronunciationParams, output: &mut String) -> Result<(), Error> {
output.push('{');
if let Some(item) = &value.phonetic_encoding {
if !output.ends_with('{') { output.push(','); } json::quote("phoneticEncoding", output); output.push(':'); write_custom_pronunciation_params_phonetic_encoding(item, output)?;
}
if let Some(item) = &value.phrase {
if !output.ends_with('{') { output.push(','); } json::quote("phrase", output); output.push(':'); write_custom_pronunciation_params_phrase(item, output)?;
}
if let Some(item) = &value.pronunciation {
if !output.ends_with('{') { output.push(','); } json::quote("pronunciation", output); output.push(':'); write_custom_pronunciation_params_pronunciation(item, output)?;
}
output.push('}'); Ok(())
}
fn read_custom_pronunciation_params(value: Raw<'_>) -> Result<CustomPronunciationParams, Error> {
let mut fields = value.object()?;
Ok(CustomPronunciationParams {
phonetic_encoding: fields.remove("phoneticEncoding").map(read_custom_pronunciation_params_phonetic_encoding).transpose()?,
phrase: fields.remove("phrase").map(read_custom_pronunciation_params_phrase).transpose()?,
pronunciation: fields.remove("pronunciation").map(read_custom_pronunciation_params_pronunciation).transpose()?,
})
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CustomPronunciationParamsPhoneticEncoding { PhoneticEncodingUnspecified, PhoneticEncodingIpa, PhoneticEncodingXSampa, PhoneticEncodingJapaneseYomigana, PhoneticEncodingPinyin, }
impl CustomPronunciationParamsPhoneticEncoding { fn as_str(&self) -> &'static str { match self { Self::PhoneticEncodingUnspecified => "PHONETIC_ENCODING_UNSPECIFIED", Self::PhoneticEncodingIpa => "PHONETIC_ENCODING_IPA", Self::PhoneticEncodingXSampa => "PHONETIC_ENCODING_X_SAMPA", Self::PhoneticEncodingJapaneseYomigana => "PHONETIC_ENCODING_JAPANESE_YOMIGANA", Self::PhoneticEncodingPinyin => "PHONETIC_ENCODING_PINYIN", } } }
fn write_custom_pronunciation_params_phonetic_encoding(value: &CustomPronunciationParamsPhoneticEncoding, output: &mut String) -> Result<(), Error> {
json::quote(value.as_str(), output); Ok(())
}
fn read_custom_pronunciation_params_phonetic_encoding(value: Raw<'_>) -> Result<CustomPronunciationParamsPhoneticEncoding, Error> {
match value.string()?.as_str() { "PHONETIC_ENCODING_UNSPECIFIED" => Ok(CustomPronunciationParamsPhoneticEncoding::PhoneticEncodingUnspecified), "PHONETIC_ENCODING_IPA" => Ok(CustomPronunciationParamsPhoneticEncoding::PhoneticEncodingIpa), "PHONETIC_ENCODING_X_SAMPA" => Ok(CustomPronunciationParamsPhoneticEncoding::PhoneticEncodingXSampa), "PHONETIC_ENCODING_JAPANESE_YOMIGANA" => Ok(CustomPronunciationParamsPhoneticEncoding::PhoneticEncodingJapaneseYomigana), "PHONETIC_ENCODING_PINYIN" => Ok(CustomPronunciationParamsPhoneticEncoding::PhoneticEncodingPinyin), _ => Err(Error) }
}

pub type CustomPronunciationParamsPhrase = String;
fn write_custom_pronunciation_params_phrase(value: &CustomPronunciationParamsPhrase, output: &mut String) -> Result<(), Error> {
json::quote(value, output); Ok(())
}
fn read_custom_pronunciation_params_phrase(value: Raw<'_>) -> Result<CustomPronunciationParamsPhrase, Error> {
value.string()
}

pub type CustomPronunciationParamsPronunciation = String;
fn write_custom_pronunciation_params_pronunciation(value: &CustomPronunciationParamsPronunciation, output: &mut String) -> Result<(), Error> {
json::quote(value, output); Ok(())
}
fn read_custom_pronunciation_params_pronunciation(value: Raw<'_>) -> Result<CustomPronunciationParamsPronunciation, Error> {
value.string()
}

pub type SynthesisInputMarkup = String;
fn write_synthesis_input_markup(value: &SynthesisInputMarkup, output: &mut String) -> Result<(), Error> {
json::quote(value, output); Ok(())
}
fn read_synthesis_input_markup(value: Raw<'_>) -> Result<SynthesisInputMarkup, Error> {
value.string()
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct MultiSpeakerMarkup {
pub turns: Option<MultiSpeakerMarkupTurns>,
}
fn write_multi_speaker_markup(value: &MultiSpeakerMarkup, output: &mut String) -> Result<(), Error> {
output.push('{');
if let Some(item) = &value.turns {
if !output.ends_with('{') { output.push(','); } json::quote("turns", output); output.push(':'); write_multi_speaker_markup_turns(item, output)?;
}
output.push('}'); Ok(())
}
fn read_multi_speaker_markup(value: Raw<'_>) -> Result<MultiSpeakerMarkup, Error> {
let mut fields = value.object()?;
Ok(MultiSpeakerMarkup {
turns: fields.remove("turns").map(read_multi_speaker_markup_turns).transpose()?,
})
}

pub type MultiSpeakerMarkupTurns = Vec<Turn>;
fn write_multi_speaker_markup_turns(value: &MultiSpeakerMarkupTurns, output: &mut String) -> Result<(), Error> {
output.push('['); for (index, item) in value.iter().enumerate() { if index != 0 { output.push(','); } write_turn(item, output)?; } output.push(']'); Ok(())
}
fn read_multi_speaker_markup_turns(value: Raw<'_>) -> Result<MultiSpeakerMarkupTurns, Error> {
value.array()?.into_iter().map(read_turn).collect()
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct Turn {
pub speaker: Option<TurnSpeaker>,
pub text: Option<TurnText>,
}
fn write_turn(value: &Turn, output: &mut String) -> Result<(), Error> {
output.push('{');
if let Some(item) = &value.speaker {
if !output.ends_with('{') { output.push(','); } json::quote("speaker", output); output.push(':'); write_turn_speaker(item, output)?;
}
if let Some(item) = &value.text {
if !output.ends_with('{') { output.push(','); } json::quote("text", output); output.push(':'); write_turn_text(item, output)?;
}
output.push('}'); Ok(())
}
fn read_turn(value: Raw<'_>) -> Result<Turn, Error> {
let mut fields = value.object()?;
Ok(Turn {
speaker: fields.remove("speaker").map(read_turn_speaker).transpose()?,
text: fields.remove("text").map(read_turn_text).transpose()?,
})
}

pub type TurnSpeaker = String;
fn write_turn_speaker(value: &TurnSpeaker, output: &mut String) -> Result<(), Error> {
json::quote(value, output); Ok(())
}
fn read_turn_speaker(value: Raw<'_>) -> Result<TurnSpeaker, Error> {
value.string()
}

pub type TurnText = String;
fn write_turn_text(value: &TurnText, output: &mut String) -> Result<(), Error> {
json::quote(value, output); Ok(())
}
fn read_turn_text(value: Raw<'_>) -> Result<TurnText, Error> {
value.string()
}

pub type SynthesisInputPrompt = String;
fn write_synthesis_input_prompt(value: &SynthesisInputPrompt, output: &mut String) -> Result<(), Error> {
json::quote(value, output); Ok(())
}
fn read_synthesis_input_prompt(value: Raw<'_>) -> Result<SynthesisInputPrompt, Error> {
value.string()
}

pub type SynthesisInputSsml = String;
fn write_synthesis_input_ssml(value: &SynthesisInputSsml, output: &mut String) -> Result<(), Error> {
json::quote(value, output); Ok(())
}
fn read_synthesis_input_ssml(value: Raw<'_>) -> Result<SynthesisInputSsml, Error> {
value.string()
}

pub type SynthesisInputText = String;
fn write_synthesis_input_text(value: &SynthesisInputText, output: &mut String) -> Result<(), Error> {
json::quote(value, output); Ok(())
}
fn read_synthesis_input_text(value: Raw<'_>) -> Result<SynthesisInputText, Error> {
value.string()
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct VoiceSelectionParams {
pub custom_voice: Option<CustomVoiceParams>,
pub language_code: Option<VoiceSelectionParamsLanguageCode>,
pub model_name: Option<VoiceSelectionParamsModelName>,
pub multi_speaker_voice_config: Option<MultiSpeakerVoiceConfig>,
pub name: Option<VoiceSelectionParamsName>,
pub ssml_gender: Option<VoiceSelectionParamsSsmlGender>,
pub voice_clone: Option<VoiceCloneParams>,
}
fn write_voice_selection_params(value: &VoiceSelectionParams, output: &mut String) -> Result<(), Error> {
output.push('{');
if let Some(item) = &value.custom_voice {
if !output.ends_with('{') { output.push(','); } json::quote("customVoice", output); output.push(':'); write_custom_voice_params(item, output)?;
}
if let Some(item) = &value.language_code {
if !output.ends_with('{') { output.push(','); } json::quote("languageCode", output); output.push(':'); write_voice_selection_params_language_code(item, output)?;
}
if let Some(item) = &value.model_name {
if !output.ends_with('{') { output.push(','); } json::quote("modelName", output); output.push(':'); write_voice_selection_params_model_name(item, output)?;
}
if let Some(item) = &value.multi_speaker_voice_config {
if !output.ends_with('{') { output.push(','); } json::quote("multiSpeakerVoiceConfig", output); output.push(':'); write_multi_speaker_voice_config(item, output)?;
}
if let Some(item) = &value.name {
if !output.ends_with('{') { output.push(','); } json::quote("name", output); output.push(':'); write_voice_selection_params_name(item, output)?;
}
if let Some(item) = &value.ssml_gender {
if !output.ends_with('{') { output.push(','); } json::quote("ssmlGender", output); output.push(':'); write_voice_selection_params_ssml_gender(item, output)?;
}
if let Some(item) = &value.voice_clone {
if !output.ends_with('{') { output.push(','); } json::quote("voiceClone", output); output.push(':'); write_voice_clone_params(item, output)?;
}
output.push('}'); Ok(())
}
fn read_voice_selection_params(value: Raw<'_>) -> Result<VoiceSelectionParams, Error> {
let mut fields = value.object()?;
Ok(VoiceSelectionParams {
custom_voice: fields.remove("customVoice").map(read_custom_voice_params).transpose()?,
language_code: fields.remove("languageCode").map(read_voice_selection_params_language_code).transpose()?,
model_name: fields.remove("modelName").map(read_voice_selection_params_model_name).transpose()?,
multi_speaker_voice_config: fields.remove("multiSpeakerVoiceConfig").map(read_multi_speaker_voice_config).transpose()?,
name: fields.remove("name").map(read_voice_selection_params_name).transpose()?,
ssml_gender: fields.remove("ssmlGender").map(read_voice_selection_params_ssml_gender).transpose()?,
voice_clone: fields.remove("voiceClone").map(read_voice_clone_params).transpose()?,
})
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct CustomVoiceParams {
pub model: Option<CustomVoiceParamsModel>,
pub reported_usage: Option<CustomVoiceParamsReportedUsage>,
}
fn write_custom_voice_params(value: &CustomVoiceParams, output: &mut String) -> Result<(), Error> {
output.push('{');
if let Some(item) = &value.model {
if !output.ends_with('{') { output.push(','); } json::quote("model", output); output.push(':'); write_custom_voice_params_model(item, output)?;
}
if let Some(item) = &value.reported_usage {
if !output.ends_with('{') { output.push(','); } json::quote("reportedUsage", output); output.push(':'); write_custom_voice_params_reported_usage(item, output)?;
}
output.push('}'); Ok(())
}
fn read_custom_voice_params(value: Raw<'_>) -> Result<CustomVoiceParams, Error> {
let mut fields = value.object()?;
Ok(CustomVoiceParams {
model: fields.remove("model").map(read_custom_voice_params_model).transpose()?,
reported_usage: fields.remove("reportedUsage").map(read_custom_voice_params_reported_usage).transpose()?,
})
}

pub type CustomVoiceParamsModel = String;
fn write_custom_voice_params_model(value: &CustomVoiceParamsModel, output: &mut String) -> Result<(), Error> {
json::quote(value, output); Ok(())
}
fn read_custom_voice_params_model(value: Raw<'_>) -> Result<CustomVoiceParamsModel, Error> {
value.string()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CustomVoiceParamsReportedUsage { ReportedUsageUnspecified, Realtime, Offline, }
impl CustomVoiceParamsReportedUsage { fn as_str(&self) -> &'static str { match self { Self::ReportedUsageUnspecified => "REPORTED_USAGE_UNSPECIFIED", Self::Realtime => "REALTIME", Self::Offline => "OFFLINE", } } }
fn write_custom_voice_params_reported_usage(value: &CustomVoiceParamsReportedUsage, output: &mut String) -> Result<(), Error> {
json::quote(value.as_str(), output); Ok(())
}
fn read_custom_voice_params_reported_usage(value: Raw<'_>) -> Result<CustomVoiceParamsReportedUsage, Error> {
match value.string()?.as_str() { "REPORTED_USAGE_UNSPECIFIED" => Ok(CustomVoiceParamsReportedUsage::ReportedUsageUnspecified), "REALTIME" => Ok(CustomVoiceParamsReportedUsage::Realtime), "OFFLINE" => Ok(CustomVoiceParamsReportedUsage::Offline), _ => Err(Error) }
}

pub type VoiceSelectionParamsLanguageCode = String;
fn write_voice_selection_params_language_code(value: &VoiceSelectionParamsLanguageCode, output: &mut String) -> Result<(), Error> {
json::quote(value, output); Ok(())
}
fn read_voice_selection_params_language_code(value: Raw<'_>) -> Result<VoiceSelectionParamsLanguageCode, Error> {
value.string()
}

pub type VoiceSelectionParamsModelName = String;
fn write_voice_selection_params_model_name(value: &VoiceSelectionParamsModelName, output: &mut String) -> Result<(), Error> {
json::quote(value, output); Ok(())
}
fn read_voice_selection_params_model_name(value: Raw<'_>) -> Result<VoiceSelectionParamsModelName, Error> {
value.string()
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct MultiSpeakerVoiceConfig {
pub speaker_voice_configs: Option<MultiSpeakerVoiceConfigSpeakerVoiceConfigs>,
}
fn write_multi_speaker_voice_config(value: &MultiSpeakerVoiceConfig, output: &mut String) -> Result<(), Error> {
output.push('{');
if let Some(item) = &value.speaker_voice_configs {
if !output.ends_with('{') { output.push(','); } json::quote("speakerVoiceConfigs", output); output.push(':'); write_multi_speaker_voice_config_speaker_voice_configs(item, output)?;
}
output.push('}'); Ok(())
}
fn read_multi_speaker_voice_config(value: Raw<'_>) -> Result<MultiSpeakerVoiceConfig, Error> {
let mut fields = value.object()?;
Ok(MultiSpeakerVoiceConfig {
speaker_voice_configs: fields.remove("speakerVoiceConfigs").map(read_multi_speaker_voice_config_speaker_voice_configs).transpose()?,
})
}

pub type MultiSpeakerVoiceConfigSpeakerVoiceConfigs = Vec<MultispeakerPrebuiltVoice>;
fn write_multi_speaker_voice_config_speaker_voice_configs(value: &MultiSpeakerVoiceConfigSpeakerVoiceConfigs, output: &mut String) -> Result<(), Error> {
output.push('['); for (index, item) in value.iter().enumerate() { if index != 0 { output.push(','); } write_multispeaker_prebuilt_voice(item, output)?; } output.push(']'); Ok(())
}
fn read_multi_speaker_voice_config_speaker_voice_configs(value: Raw<'_>) -> Result<MultiSpeakerVoiceConfigSpeakerVoiceConfigs, Error> {
value.array()?.into_iter().map(read_multispeaker_prebuilt_voice).collect()
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct MultispeakerPrebuiltVoice {
pub speaker_alias: Option<MultispeakerPrebuiltVoiceSpeakerAlias>,
pub speaker_id: Option<MultispeakerPrebuiltVoiceSpeakerId>,
}
fn write_multispeaker_prebuilt_voice(value: &MultispeakerPrebuiltVoice, output: &mut String) -> Result<(), Error> {
output.push('{');
if let Some(item) = &value.speaker_alias {
if !output.ends_with('{') { output.push(','); } json::quote("speakerAlias", output); output.push(':'); write_multispeaker_prebuilt_voice_speaker_alias(item, output)?;
}
if let Some(item) = &value.speaker_id {
if !output.ends_with('{') { output.push(','); } json::quote("speakerId", output); output.push(':'); write_multispeaker_prebuilt_voice_speaker_id(item, output)?;
}
output.push('}'); Ok(())
}
fn read_multispeaker_prebuilt_voice(value: Raw<'_>) -> Result<MultispeakerPrebuiltVoice, Error> {
let mut fields = value.object()?;
Ok(MultispeakerPrebuiltVoice {
speaker_alias: fields.remove("speakerAlias").map(read_multispeaker_prebuilt_voice_speaker_alias).transpose()?,
speaker_id: fields.remove("speakerId").map(read_multispeaker_prebuilt_voice_speaker_id).transpose()?,
})
}

pub type MultispeakerPrebuiltVoiceSpeakerAlias = String;
fn write_multispeaker_prebuilt_voice_speaker_alias(value: &MultispeakerPrebuiltVoiceSpeakerAlias, output: &mut String) -> Result<(), Error> {
json::quote(value, output); Ok(())
}
fn read_multispeaker_prebuilt_voice_speaker_alias(value: Raw<'_>) -> Result<MultispeakerPrebuiltVoiceSpeakerAlias, Error> {
value.string()
}

pub type MultispeakerPrebuiltVoiceSpeakerId = String;
fn write_multispeaker_prebuilt_voice_speaker_id(value: &MultispeakerPrebuiltVoiceSpeakerId, output: &mut String) -> Result<(), Error> {
json::quote(value, output); Ok(())
}
fn read_multispeaker_prebuilt_voice_speaker_id(value: Raw<'_>) -> Result<MultispeakerPrebuiltVoiceSpeakerId, Error> {
value.string()
}

pub type VoiceSelectionParamsName = String;
fn write_voice_selection_params_name(value: &VoiceSelectionParamsName, output: &mut String) -> Result<(), Error> {
json::quote(value, output); Ok(())
}
fn read_voice_selection_params_name(value: Raw<'_>) -> Result<VoiceSelectionParamsName, Error> {
value.string()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VoiceSelectionParamsSsmlGender { SsmlVoiceGenderUnspecified, Male, Female, Neutral, }
impl VoiceSelectionParamsSsmlGender { fn as_str(&self) -> &'static str { match self { Self::SsmlVoiceGenderUnspecified => "SSML_VOICE_GENDER_UNSPECIFIED", Self::Male => "MALE", Self::Female => "FEMALE", Self::Neutral => "NEUTRAL", } } }
fn write_voice_selection_params_ssml_gender(value: &VoiceSelectionParamsSsmlGender, output: &mut String) -> Result<(), Error> {
json::quote(value.as_str(), output); Ok(())
}
fn read_voice_selection_params_ssml_gender(value: Raw<'_>) -> Result<VoiceSelectionParamsSsmlGender, Error> {
match value.string()?.as_str() { "SSML_VOICE_GENDER_UNSPECIFIED" => Ok(VoiceSelectionParamsSsmlGender::SsmlVoiceGenderUnspecified), "MALE" => Ok(VoiceSelectionParamsSsmlGender::Male), "FEMALE" => Ok(VoiceSelectionParamsSsmlGender::Female), "NEUTRAL" => Ok(VoiceSelectionParamsSsmlGender::Neutral), _ => Err(Error) }
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct VoiceCloneParams {
pub voice_cloning_key: Option<VoiceCloneParamsVoiceCloningKey>,
}
fn write_voice_clone_params(value: &VoiceCloneParams, output: &mut String) -> Result<(), Error> {
output.push('{');
if let Some(item) = &value.voice_cloning_key {
if !output.ends_with('{') { output.push(','); } json::quote("voiceCloningKey", output); output.push(':'); write_voice_clone_params_voice_cloning_key(item, output)?;
}
output.push('}'); Ok(())
}
fn read_voice_clone_params(value: Raw<'_>) -> Result<VoiceCloneParams, Error> {
let mut fields = value.object()?;
Ok(VoiceCloneParams {
voice_cloning_key: fields.remove("voiceCloningKey").map(read_voice_clone_params_voice_cloning_key).transpose()?,
})
}

pub type VoiceCloneParamsVoiceCloningKey = String;
fn write_voice_clone_params_voice_cloning_key(value: &VoiceCloneParamsVoiceCloningKey, output: &mut String) -> Result<(), Error> {
json::quote(value, output); Ok(())
}
fn read_voice_clone_params_voice_cloning_key(value: Raw<'_>) -> Result<VoiceCloneParamsVoiceCloningKey, Error> {
value.string()
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct SynthesizeSpeechResponse {
pub audio_config: Option<AudioConfig>,
pub audio_content: Option<SynthesizeSpeechResponseAudioContent>,
pub timepoints: Option<SynthesizeSpeechResponseTimepoints>,
}
fn write_synthesize_speech_response(value: &SynthesizeSpeechResponse, output: &mut String) -> Result<(), Error> {
output.push('{');
if let Some(item) = &value.audio_config {
if !output.ends_with('{') { output.push(','); } json::quote("audioConfig", output); output.push(':'); write_audio_config(item, output)?;
}
if let Some(item) = &value.audio_content {
if !output.ends_with('{') { output.push(','); } json::quote("audioContent", output); output.push(':'); write_synthesize_speech_response_audio_content(item, output)?;
}
if let Some(item) = &value.timepoints {
if !output.ends_with('{') { output.push(','); } json::quote("timepoints", output); output.push(':'); write_synthesize_speech_response_timepoints(item, output)?;
}
output.push('}'); Ok(())
}
fn read_synthesize_speech_response(value: Raw<'_>) -> Result<SynthesizeSpeechResponse, Error> {
let mut fields = value.object()?;
Ok(SynthesizeSpeechResponse {
audio_config: fields.remove("audioConfig").map(read_audio_config).transpose()?,
audio_content: fields.remove("audioContent").map(read_synthesize_speech_response_audio_content).transpose()?,
timepoints: fields.remove("timepoints").map(read_synthesize_speech_response_timepoints).transpose()?,
})
}

pub type SynthesizeSpeechResponseAudioContent = String;
fn write_synthesize_speech_response_audio_content(value: &SynthesizeSpeechResponseAudioContent, output: &mut String) -> Result<(), Error> {
json::quote(value, output); Ok(())
}
fn read_synthesize_speech_response_audio_content(value: Raw<'_>) -> Result<SynthesizeSpeechResponseAudioContent, Error> {
value.string()
}

pub type SynthesizeSpeechResponseTimepoints = Vec<Timepoint>;
fn write_synthesize_speech_response_timepoints(value: &SynthesizeSpeechResponseTimepoints, output: &mut String) -> Result<(), Error> {
output.push('['); for (index, item) in value.iter().enumerate() { if index != 0 { output.push(','); } write_timepoint(item, output)?; } output.push(']'); Ok(())
}
fn read_synthesize_speech_response_timepoints(value: Raw<'_>) -> Result<SynthesizeSpeechResponseTimepoints, Error> {
value.array()?.into_iter().map(read_timepoint).collect()
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct Timepoint {
pub mark_name: Option<TimepointMarkName>,
pub time_seconds: Option<TimepointTimeSeconds>,
}
fn write_timepoint(value: &Timepoint, output: &mut String) -> Result<(), Error> {
output.push('{');
if let Some(item) = &value.mark_name {
if !output.ends_with('{') { output.push(','); } json::quote("markName", output); output.push(':'); write_timepoint_mark_name(item, output)?;
}
if let Some(item) = &value.time_seconds {
if !output.ends_with('{') { output.push(','); } json::quote("timeSeconds", output); output.push(':'); write_timepoint_time_seconds(item, output)?;
}
output.push('}'); Ok(())
}
fn read_timepoint(value: Raw<'_>) -> Result<Timepoint, Error> {
let mut fields = value.object()?;
Ok(Timepoint {
mark_name: fields.remove("markName").map(read_timepoint_mark_name).transpose()?,
time_seconds: fields.remove("timeSeconds").map(read_timepoint_time_seconds).transpose()?,
})
}

pub type TimepointMarkName = String;
fn write_timepoint_mark_name(value: &TimepointMarkName, output: &mut String) -> Result<(), Error> {
json::quote(value, output); Ok(())
}
fn read_timepoint_mark_name(value: Raw<'_>) -> Result<TimepointMarkName, Error> {
value.string()
}

pub type TimepointTimeSeconds = f64;
fn write_timepoint_time_seconds(value: &TimepointTimeSeconds, output: &mut String) -> Result<(), Error> {
if !value.is_finite() { return Err(Error); } output.push_str(&value.to_string()); Ok(())
}
fn read_timepoint_time_seconds(value: Raw<'_>) -> Result<TimepointTimeSeconds, Error> {
let number = value.number()?; if number.is_finite() { Ok(number) } else { Err(Error) }
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct ListVoicesInput {
pub language_code: Option<ListVoicesInputLanguageCode>,
}
fn write_list_voices_input(value: &ListVoicesInput, output: &mut String) -> Result<(), Error> {
output.push('{');
if let Some(item) = &value.language_code {
if !output.ends_with('{') { output.push(','); } json::quote("languageCode", output); output.push(':'); write_list_voices_input_language_code(item, output)?;
}
output.push('}'); Ok(())
}
fn read_list_voices_input(value: Raw<'_>) -> Result<ListVoicesInput, Error> {
let mut fields = value.object()?;
Ok(ListVoicesInput {
language_code: fields.remove("languageCode").map(read_list_voices_input_language_code).transpose()?,
})
}

pub type ListVoicesInputLanguageCode = String;
fn write_list_voices_input_language_code(value: &ListVoicesInputLanguageCode, output: &mut String) -> Result<(), Error> {
json::quote(value, output); Ok(())
}
fn read_list_voices_input_language_code(value: Raw<'_>) -> Result<ListVoicesInputLanguageCode, Error> {
value.string()
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct ListVoicesResponse {
pub voices: Option<ListVoicesResponseVoices>,
}
fn write_list_voices_response(value: &ListVoicesResponse, output: &mut String) -> Result<(), Error> {
output.push('{');
if let Some(item) = &value.voices {
if !output.ends_with('{') { output.push(','); } json::quote("voices", output); output.push(':'); write_list_voices_response_voices(item, output)?;
}
output.push('}'); Ok(())
}
fn read_list_voices_response(value: Raw<'_>) -> Result<ListVoicesResponse, Error> {
let mut fields = value.object()?;
Ok(ListVoicesResponse {
voices: fields.remove("voices").map(read_list_voices_response_voices).transpose()?,
})
}

pub type ListVoicesResponseVoices = Vec<Voice>;
fn write_list_voices_response_voices(value: &ListVoicesResponseVoices, output: &mut String) -> Result<(), Error> {
output.push('['); for (index, item) in value.iter().enumerate() { if index != 0 { output.push(','); } write_voice(item, output)?; } output.push(']'); Ok(())
}
fn read_list_voices_response_voices(value: Raw<'_>) -> Result<ListVoicesResponseVoices, Error> {
value.array()?.into_iter().map(read_voice).collect()
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct Voice {
pub language_codes: Option<VoiceLanguageCodes>,
pub name: Option<VoiceName>,
pub natural_sample_rate_hertz: Option<VoiceNaturalSampleRateHertz>,
pub ssml_gender: Option<VoiceSsmlGender>,
}
fn write_voice(value: &Voice, output: &mut String) -> Result<(), Error> {
output.push('{');
if let Some(item) = &value.language_codes {
if !output.ends_with('{') { output.push(','); } json::quote("languageCodes", output); output.push(':'); write_voice_language_codes(item, output)?;
}
if let Some(item) = &value.name {
if !output.ends_with('{') { output.push(','); } json::quote("name", output); output.push(':'); write_voice_name(item, output)?;
}
if let Some(item) = &value.natural_sample_rate_hertz {
if !output.ends_with('{') { output.push(','); } json::quote("naturalSampleRateHertz", output); output.push(':'); write_voice_natural_sample_rate_hertz(item, output)?;
}
if let Some(item) = &value.ssml_gender {
if !output.ends_with('{') { output.push(','); } json::quote("ssmlGender", output); output.push(':'); write_voice_ssml_gender(item, output)?;
}
output.push('}'); Ok(())
}
fn read_voice(value: Raw<'_>) -> Result<Voice, Error> {
let mut fields = value.object()?;
Ok(Voice {
language_codes: fields.remove("languageCodes").map(read_voice_language_codes).transpose()?,
name: fields.remove("name").map(read_voice_name).transpose()?,
natural_sample_rate_hertz: fields.remove("naturalSampleRateHertz").map(read_voice_natural_sample_rate_hertz).transpose()?,
ssml_gender: fields.remove("ssmlGender").map(read_voice_ssml_gender).transpose()?,
})
}

pub type VoiceLanguageCodes = Vec<VoiceLanguageCodesItem>;
fn write_voice_language_codes(value: &VoiceLanguageCodes, output: &mut String) -> Result<(), Error> {
output.push('['); for (index, item) in value.iter().enumerate() { if index != 0 { output.push(','); } write_voice_language_codes_item(item, output)?; } output.push(']'); Ok(())
}
fn read_voice_language_codes(value: Raw<'_>) -> Result<VoiceLanguageCodes, Error> {
value.array()?.into_iter().map(read_voice_language_codes_item).collect()
}

pub type VoiceLanguageCodesItem = String;
fn write_voice_language_codes_item(value: &VoiceLanguageCodesItem, output: &mut String) -> Result<(), Error> {
json::quote(value, output); Ok(())
}
fn read_voice_language_codes_item(value: Raw<'_>) -> Result<VoiceLanguageCodesItem, Error> {
value.string()
}

pub type VoiceName = String;
fn write_voice_name(value: &VoiceName, output: &mut String) -> Result<(), Error> {
json::quote(value, output); Ok(())
}
fn read_voice_name(value: Raw<'_>) -> Result<VoiceName, Error> {
value.string()
}

pub type VoiceNaturalSampleRateHertz = i32;
fn write_voice_natural_sample_rate_hertz(value: &VoiceNaturalSampleRateHertz, output: &mut String) -> Result<(), Error> {
output.push_str(&value.to_string()); Ok(())
}
fn read_voice_natural_sample_rate_hertz(value: Raw<'_>) -> Result<VoiceNaturalSampleRateHertz, Error> {
value.text().parse().map_err(|_| Error)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VoiceSsmlGender { SsmlVoiceGenderUnspecified, Male, Female, Neutral, }
impl VoiceSsmlGender { fn as_str(&self) -> &'static str { match self { Self::SsmlVoiceGenderUnspecified => "SSML_VOICE_GENDER_UNSPECIFIED", Self::Male => "MALE", Self::Female => "FEMALE", Self::Neutral => "NEUTRAL", } } }
fn write_voice_ssml_gender(value: &VoiceSsmlGender, output: &mut String) -> Result<(), Error> {
json::quote(value.as_str(), output); Ok(())
}
fn read_voice_ssml_gender(value: Raw<'_>) -> Result<VoiceSsmlGender, Error> {
match value.string()?.as_str() { "SSML_VOICE_GENDER_UNSPECIFIED" => Ok(VoiceSsmlGender::SsmlVoiceGenderUnspecified), "MALE" => Ok(VoiceSsmlGender::Male), "FEMALE" => Ok(VoiceSsmlGender::Female), "NEUTRAL" => Ok(VoiceSsmlGender::Neutral), _ => Err(Error) }
}

pub async fn synthesize_speech(value: &SynthesizeSpeechRequest, options: ClientOptions<'_>) -> Result<HttpResponse, TransportError> {
let mut body = String::new();
write_synthesize_speech_request(value, &mut body).map_err(|_| std::io::Error::new(std::io::ErrorKind::InvalidInput, "Invalid Google synthesizeSpeech input"))?;
let url = endpoint::append(options.base_url, "/v1beta1/text:synthesize").ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidInput, "Invalid Google HTTP endpoint URL"))?;
let mut headers = options.headers.to_vec();
headers.retain(|(key, _)| !key.eq_ignore_ascii_case("content-type"));
headers.push(("content-type".into(), "application/json".into()));
options.transport.send(HttpRequest { method: "POST".into(), url, headers, body: body.into_bytes() }).await
}
pub fn decode_synthesize_speech_response(data: &[u8]) -> Result<SynthesizeSpeechResponse, TransportError> {
let decode = || -> Result<SynthesizeSpeechResponse, Error> { let text = std::str::from_utf8(data).map_err(|_| Error)?; read_synthesize_speech_response(Raw::parse_exact(text)?) };
decode().map_err(|_| std::io::Error::new(std::io::ErrorKind::InvalidData, "Invalid Google synthesizeSpeech response").into())
}

pub async fn list_voices(value: &ListVoicesInput, options: ClientOptions<'_>) -> Result<HttpResponse, TransportError> {
let mut url = endpoint::append(options.base_url, "/v1beta1/voices").ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidInput, "Invalid Google HTTP endpoint URL"))?;
if let Some(item) = &value.language_code {
endpoint::set_query(&mut url, "languageCode", (item).as_str()).ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidInput, "Invalid Google query string"))?;
}
let headers = options.headers.to_vec();
options.transport.send(HttpRequest { method: "GET".into(), url, headers, body: Vec::new() }).await
}
pub fn decode_list_voices_response(data: &[u8]) -> Result<ListVoicesResponse, TransportError> {
let decode = || -> Result<ListVoicesResponse, Error> { let text = std::str::from_utf8(data).map_err(|_| Error)?; read_list_voices_response(Raw::parse_exact(text)?) };
decode().map_err(|_| std::io::Error::new(std::io::ErrorKind::InvalidData, "Invalid Google listVoices response").into())
}
