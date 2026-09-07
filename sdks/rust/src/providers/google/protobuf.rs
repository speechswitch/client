use super::settings::{Encoding, Kind, Model, Settings, Turn, Voice};
use crate::{
    clients::{google_grpc as wire, google_grpc_beta as beta},
    generated::google::{
        TtsRequestChirp3HdTextVoicebb77af5cReplacementsItemAlphabet as Alphabet,
        TtsRequestTextSafetySettingsItemCategory as Category,
        TtsRequestTextSafetySettingsItemThreshold as Threshold,
    },
    http::TransportError,
};

impl Settings {
    pub fn opening(&self) -> Result<Vec<u8>, TransportError> {
        if matches!(self.model, Model::Clone) {
            use beta::CustomPronunciationParamsPhoneticEncoding as Phonetic;
            let Voice::Named(key) = &self.voice else {
                unreachable!("validated clone voice")
            };
            let custom_pronunciations =
                self.replacements
                    .as_ref()
                    .map(|items| beta::CustomPronunciations {
                        pronunciations: items
                            .iter()
                            .map(|item| beta::CustomPronunciationParams {
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
                    });
            let config = beta::StreamingSynthesizeConfig {
                voice: beta::VoiceSelectionParams {
                    language_code: self.language.clone(),
                    voice_clone: Some(beta::VoiceCloneParams {
                        voice_cloning_key: key.clone(),
                    }),
                    name: None,
                    ssml_gender: None,
                    custom_voice: None,
                    model_name: None,
                    multi_speaker_voice_config: None,
                },
                streaming_audio_config: Some(beta::StreamingAudioConfig {
                    audio_encoding: match self.output.encoding {
                        Encoding::Linear16 => beta::AudioEncoding::Linear16,
                        Encoding::Mp3 => beta::AudioEncoding::Mp3,
                        Encoding::OggOpus => beta::AudioEncoding::OggOpus,
                        Encoding::Pcm => beta::AudioEncoding::Pcm,
                        Encoding::Mulaw => beta::AudioEncoding::Mulaw,
                        Encoding::Alaw => beta::AudioEncoding::Alaw,
                    },
                    sample_rate_hertz: self.output.rate,
                    speaking_rate: Some(self.speed),
                }),
                custom_pronunciations,
                advanced_voice_options: None,
            };
            return Ok(beta::encode_streaming_request(
                &beta::StreamingSynthesizeRequest {
                    streaming_request: Some(
                        beta::StreamingSynthesizeRequestStreamingRequest::StreamingConfig(config),
                    ),
                },
            )?);
        }
        use wire::{
            AdvancedVoiceOptionsHarmBlockThreshold as Block,
            AdvancedVoiceOptionsHarmCategory as Harm,
            CustomPronunciationParamsPhoneticEncoding as Phonetic,
        };
        let (name, speakers) = match &self.voice {
            Voice::Named(name) => (
                Some(if matches!(self.model, Model::Chirp) {
                    format!("{}-Chirp3-HD-{name}", self.language)
                } else {
                    name.clone()
                }),
                None,
            ),
            Voice::Dialogue(items) => (
                None,
                Some(wire::MultiSpeakerVoiceConfig {
                    speaker_voice_configs: items
                        .iter()
                        .map(|item| wire::MultispeakerPrebuiltVoice {
                            speaker_alias: item.alias.clone(),
                            speaker_id: item.voice.value().into(),
                        })
                        .collect(),
                }),
            ),
        };
        let custom_pronunciations =
            self.replacements
                .as_ref()
                .map(|items| wire::CustomPronunciations {
                    pronunciations: items
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
                });
        let advanced_voice_options =
            matches!(self.model, Model::Gemini(_)).then(|| wire::AdvancedVoiceOptions {
                enable_textnorm: Some(self.normalize),
                safety_settings: self.safety.as_ref().map(|items| {
                    wire::AdvancedVoiceOptionsSafetySettings {
                        settings: items
                            .iter()
                            .map(|item| wire::AdvancedVoiceOptionsSafetySetting {
                                category: Some(match item.category {
                                    Category::DangerousContent(_) => {
                                        Harm::HarmCategoryDangerousContent
                                    }
                                    Category::Harassment(_) => Harm::HarmCategoryHarassment,
                                    Category::HateSpeech(_) => Harm::HarmCategoryHateSpeech,
                                    Category::SexuallyExplicit(_) => {
                                        Harm::HarmCategorySexuallyExplicit
                                    }
                                }),
                                threshold: Some(match item.threshold {
                                    Threshold::High(_) => Block::BlockOnlyHigh,
                                    Threshold::Medium(_) => Block::BlockMediumAndAbove,
                                    Threshold::Low(_) => Block::BlockLowAndAbove,
                                    Threshold::None(_) => Block::BlockNone,
                                    Threshold::Off(_) => Block::Off,
                                }),
                            })
                            .collect(),
                    }
                }),
                ..Default::default()
            });
        let config = wire::StreamingSynthesizeConfig {
            voice: wire::VoiceSelectionParams {
                language_code: self.language.clone(),
                name,
                multi_speaker_voice_config: speakers,
                model_name: match self.model {
                    Model::Gemini(name) => Some(name.into()),
                    _ => None,
                },
                ssml_gender: None,
                custom_voice: None,
                voice_clone: None,
            },
            streaming_audio_config: Some(wire::StreamingAudioConfig {
                audio_encoding: match self.output.encoding {
                    Encoding::Linear16 => wire::AudioEncoding::Linear16,
                    Encoding::Mp3 => wire::AudioEncoding::Mp3,
                    Encoding::OggOpus => wire::AudioEncoding::OggOpus,
                    Encoding::Pcm => wire::AudioEncoding::Pcm,
                    Encoding::Mulaw => wire::AudioEncoding::Mulaw,
                    Encoding::Alaw => wire::AudioEncoding::Alaw,
                },
                sample_rate_hertz: self.output.rate,
                speaking_rate: Some(self.speed),
            }),
            custom_pronunciations,
            advanced_voice_options,
        };
        Ok(wire::encode_streaming_request(
            &wire::StreamingSynthesizeRequest {
                streaming_request: Some(
                    wire::StreamingSynthesizeRequestStreamingRequest::StreamingConfig(config),
                ),
            },
        )?)
    }

    pub fn encode_input(
        &self,
        text: String,
        turns: Option<Vec<Turn>>,
        first: bool,
    ) -> Result<Vec<u8>, TransportError> {
        let prompt = if first {
            self.instructions.clone()
        } else {
            None
        };
        if matches!(self.model, Model::Clone) {
            let source = match self.kind {
                Kind::Markup => beta::StreamingSynthesisInputInputSource::Markup(text),
                _ => beta::StreamingSynthesisInputInputSource::Text(text),
            };
            return Ok(beta::encode_streaming_request(
                &beta::StreamingSynthesizeRequest {
                    streaming_request: Some(
                        beta::StreamingSynthesizeRequestStreamingRequest::Input(
                            beta::StreamingSynthesisInput {
                                prompt,
                                input_source: Some(source),
                            },
                        ),
                    ),
                },
            )?);
        }
        let source = match turns {
            Some(turns) => wire::StreamingSynthesisInputInputSource::MultiSpeakerMarkup(
                wire::MultiSpeakerMarkup {
                    turns: turns
                        .into_iter()
                        .map(|turn| wire::MultiSpeakerMarkupTurn {
                            speaker: turn.speaker,
                            text: turn.text,
                        })
                        .collect(),
                },
            ),
            None => match self.kind {
                Kind::Markup => wire::StreamingSynthesisInputInputSource::Markup(text),
                _ => wire::StreamingSynthesisInputInputSource::Text(text),
            },
        };
        Ok(wire::encode_streaming_request(
            &wire::StreamingSynthesizeRequest {
                streaming_request: Some(wire::StreamingSynthesizeRequestStreamingRequest::Input(
                    wire::StreamingSynthesisInput {
                        prompt,
                        input_source: Some(source),
                    },
                )),
            },
        )?)
    }
    pub fn decode_audio(&self, bytes: &[u8]) -> Result<Option<Vec<u8>>, TransportError> {
        Ok(if matches!(self.model, Model::Clone) {
            beta::decode_streaming_response(bytes)?.audio_content
        } else {
            wire::decode_streaming_response(bytes)?.audio_content
        })
    }
}
