use super::{
    settings::{Encoding, Input, Kind, Model, Settings, Voice},
    Error,
};
use crate::{
    clients::{google_rest as wire, google_rest_beta as beta},
    generated::google::{
        TtsRequestChirp3HdTextVoicebb77af5cReplacementsItemAlphabet as Alphabet,
        TtsRequestTextSafetySettingsItemCategory as Category,
        TtsRequestTextSafetySettingsItemThreshold as Threshold,
    },
    http::TransportError,
};

use beta::CustomPronunciationParamsPhoneticEncoding as BetaPhonetic;
use wire::CustomPronunciationParamsPhoneticEncoding as Phonetic;

impl Settings {
    pub fn rest_request(&self) -> Result<wire::SynthesizeSpeechRequest, TransportError> {
        let mut input = wire::SynthesisInput {
            prompt: self.instructions.clone(),
            custom_pronunciations: self.replacements.as_ref().map(|items| {
                wire::CustomPronunciations {
                    pronunciations: Some(
                        items
                            .iter()
                            .map(|item| wire::CustomPronunciationParams {
                                phrase: Some(item.pattern.clone()),
                                pronunciation: Some(item.replacement.clone()),
                                phonetic_encoding: Some(match item.alphabet {
                                    Alphabet::Ipa(_) => Phonetic::PhoneticEncodingIpa,
                                    Alphabet::XSampa(_) => Phonetic::PhoneticEncodingXSampa,
                                    Alphabet::JapaneseYomigana(_) => {
                                        Phonetic::PhoneticEncodingJapaneseYomigana
                                    }
                                    Alphabet::Pinyin(_) => Phonetic::PhoneticEncodingPinyin,
                                }),
                            })
                            .collect(),
                    ),
                }
            }),
            ..Default::default()
        };
        match &self.input {
            Input::Text(text) => match self.kind {
                Kind::Text => input.text = Some(text.clone()),
                Kind::Markup => input.markup = Some(text.clone()),
                Kind::Ssml => input.ssml = Some(text.clone()),
            },
            Input::Turns(turns) => {
                input.multi_speaker_markup = Some(wire::MultiSpeakerMarkup {
                    turns: Some(
                        turns
                            .iter()
                            .map(|turn| wire::Turn {
                                speaker: Some(turn.speaker.clone()),
                                text: Some(turn.text.clone()),
                            })
                            .collect(),
                    ),
                })
            }
            _ => return Err(Error::Invalid("Google REST requires complete input").into()),
        }
        let mut voice = wire::VoiceSelectionParams {
            language_code: Some(self.language.clone()),
            model_name: match self.model {
                Model::Gemini(name) => Some(name.into()),
                _ => None,
            },
            ..Default::default()
        };
        match &self.voice {
            Voice::Named(name) => {
                voice.name = Some(if matches!(self.model, Model::Chirp) {
                    format!("{}-Chirp3-HD-{name}", self.language)
                } else {
                    name.clone()
                })
            }
            Voice::Dialogue(items) => {
                voice.multi_speaker_voice_config = Some(wire::MultiSpeakerVoiceConfig {
                    speaker_voice_configs: Some(
                        items
                            .iter()
                            .map(|item| wire::MultispeakerPrebuiltVoice {
                                speaker_alias: Some(item.alias.clone()),
                                speaker_id: Some(item.voice.value().into()),
                            })
                            .collect(),
                    ),
                })
            }
        }
        let audio_config = wire::AudioConfig {
            audio_encoding: Some(match self.output.encoding {
                Encoding::Linear16 => wire::AudioConfigAudioEncoding::Linear16,
                Encoding::Mp3 => wire::AudioConfigAudioEncoding::Mp3,
                Encoding::OggOpus => wire::AudioConfigAudioEncoding::OggOpus,
                Encoding::Pcm => wire::AudioConfigAudioEncoding::Pcm,
                Encoding::Mulaw => wire::AudioConfigAudioEncoding::Mulaw,
                Encoding::Alaw => wire::AudioConfigAudioEncoding::Alaw,
            }),
            sample_rate_hertz: self.output.rate,
            speaking_rate: Some(self.speed),
            pitch: self.pitch,
            volume_gain_db: self.volume,
            effects_profile_id: self.effects.clone(),
        };
        let advanced_voice_options =
            matches!(self.model, Model::Gemini(_)).then(|| wire::AdvancedVoiceOptions {
                enable_textnorm: Some(self.normalize),
                safety_settings: self.safety.as_ref().map(|items| wire::SafetySettings {
                    settings: Some(
                        items
                            .iter()
                            .map(|item| wire::SafetySetting {
                                category: Some(match item.category {
                                    Category::DangerousContent(_) => {
                                        wire::SafetySettingCategory::HarmCategoryDangerousContent
                                    }
                                    Category::Harassment(_) => {
                                        wire::SafetySettingCategory::HarmCategoryHarassment
                                    }
                                    Category::HateSpeech(_) => {
                                        wire::SafetySettingCategory::HarmCategoryHateSpeech
                                    }
                                    Category::SexuallyExplicit(_) => {
                                        wire::SafetySettingCategory::HarmCategorySexuallyExplicit
                                    }
                                }),
                                threshold: Some(match item.threshold {
                                    Threshold::High(_) => {
                                        wire::SafetySettingThreshold::BlockOnlyHigh
                                    }
                                    Threshold::Medium(_) => {
                                        wire::SafetySettingThreshold::BlockMediumAndAbove
                                    }
                                    Threshold::Low(_) => {
                                        wire::SafetySettingThreshold::BlockLowAndAbove
                                    }
                                    Threshold::None(_) => wire::SafetySettingThreshold::BlockNone,
                                    Threshold::Off(_) => wire::SafetySettingThreshold::Off,
                                }),
                            })
                            .collect(),
                    ),
                }),
                ..Default::default()
            });
        Ok(wire::SynthesizeSpeechRequest {
            input: Some(input),
            voice: Some(voice),
            audio_config: Some(audio_config),
            advanced_voice_options,
        })
    }

    pub fn beta_rest_request(&self) -> Result<beta::SynthesizeSpeechRequest, TransportError> {
        let Voice::Named(key) = &self.voice else {
            unreachable!("validated clone voice")
        };
        let Input::Text(text) = &self.input else {
            return Err(Error::Invalid("Google REST requires complete input").into());
        };
        let mut input = beta::SynthesisInput {
            custom_pronunciations: self.replacements.as_ref().map(|items| {
                beta::CustomPronunciations {
                    pronunciations: Some(
                        items
                            .iter()
                            .map(|item| beta::CustomPronunciationParams {
                                phrase: Some(item.pattern.clone()),
                                pronunciation: Some(item.replacement.clone()),
                                phonetic_encoding: Some(match item.alphabet {
                                    Alphabet::Ipa(_) => BetaPhonetic::PhoneticEncodingIpa,
                                    Alphabet::XSampa(_) => BetaPhonetic::PhoneticEncodingXSampa,
                                    Alphabet::JapaneseYomigana(_) => {
                                        BetaPhonetic::PhoneticEncodingJapaneseYomigana
                                    }
                                    Alphabet::Pinyin(_) => BetaPhonetic::PhoneticEncodingPinyin,
                                }),
                            })
                            .collect(),
                    ),
                }
            }),
            ..Default::default()
        };
        match self.kind {
            Kind::Markup => input.markup = Some(text.clone()),
            _ => input.text = Some(text.clone()),
        }
        Ok(beta::SynthesizeSpeechRequest {
            input: Some(input),
            voice: Some(beta::VoiceSelectionParams {
                language_code: Some(self.language.clone()),
                voice_clone: Some(beta::VoiceCloneParams {
                    voice_cloning_key: Some(key.clone()),
                }),
                ..Default::default()
            }),
            audio_config: Some(beta::AudioConfig {
                audio_encoding: Some(match self.output.encoding {
                    Encoding::Linear16 => beta::AudioConfigAudioEncoding::Linear16,
                    Encoding::Mp3 => beta::AudioConfigAudioEncoding::Mp3,
                    Encoding::OggOpus => beta::AudioConfigAudioEncoding::OggOpus,
                    Encoding::Pcm => beta::AudioConfigAudioEncoding::Pcm,
                    Encoding::Mulaw => beta::AudioConfigAudioEncoding::Mulaw,
                    Encoding::Alaw => beta::AudioConfigAudioEncoding::Alaw,
                }),
                sample_rate_hertz: self.output.rate,
                speaking_rate: Some(self.speed),
                ..Default::default()
            }),
            ..Default::default()
        })
    }
}
