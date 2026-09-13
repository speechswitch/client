use super::Error;
use crate::{generated::google::*, http::TransportError, runtime::StreamingInput};
use std::collections::BTreeSet;

pub type Turn = TtsRequestTurns5ba0ad7aTurnsItem;
pub enum Input {
    Text(String),
    TextStream(StreamingInput<String>),
    Turns(Vec<Turn>),
    TurnStream(StreamingInput<Turn>),
    Done,
}
#[derive(Clone, Copy)]
pub enum Model {
    Chirp,
    Clone,
    Gemini(&'static str),
}
pub enum Voice {
    Named(String),
    Dialogue(Vec<TtsRequestTextSpeakersItem>),
}
#[derive(Clone, Copy)]
pub enum Kind {
    Text,
    Markup,
    Ssml,
}
#[derive(Clone, Copy)]
pub enum Encoding {
    Linear16,
    Mp3,
    OggOpus,
    Pcm,
    Mulaw,
    Alaw,
}
pub struct Output {
    pub encoding: Encoding,
    pub rate: Option<i32>,
    pub http: bool,
}
pub struct Settings {
    pub model: Model,
    pub language: String,
    pub voice: Voice,
    pub kind: Kind,
    pub input: Input,
    pub output: Output,
    pub speed: f64,
    pub normalize: bool,
    pub instructions: Option<String>,
    pub replacements: Option<Vec<TtsRequestChirp3HdTextVoiceffbf1cc1ReplacementsItem>>,
    pub safety: Option<Vec<TtsRequestTextSafetySettingsItem>>,
    pub volume: Option<f64>,
    pub pitch: Option<f64>,
    pub effects: Option<Vec<String>>,
    pub aliases: BTreeSet<String>,
    pub byte_limit: usize,
}
impl Settings {
    fn new(
        model: Model,
        language: String,
        voice: Voice,
        input: Input,
        output: Output,
        speed: Option<f64>,
    ) -> Self {
        Self {
            model,
            language,
            voice,
            input,
            output,
            speed: speed.unwrap_or(1.0),
            normalize: true,
            kind: Kind::Text,
            instructions: None,
            replacements: None,
            safety: None,
            volume: None,
            pitch: None,
            effects: None,
            aliases: BTreeSet::new(),
            byte_limit: if matches!(model, Model::Gemini(_)) {
                4000
            } else {
                5000
            },
        }
    }
    pub fn check_turns(&self, turns: &[Turn]) -> Result<(), TransportError> {
        let mut size = 0;
        for turn in turns {
            if !self.aliases.contains(&turn.speaker) {
                return Err(Error::UnknownSpeaker(turn.speaker.clone()).into());
            }
            if turn.text.len() > self.byte_limit - size {
                return Err(Error::InputBytes(self.byte_limit).into());
            }
            size += turn.text.len();
        }
        Ok(())
    }
}
pub fn check_text(text: &str, limit: usize) -> Result<(), TransportError> {
    if text.len() > limit {
        return Err(Error::InputBytes(limit).into());
    }
    Ok(())
}
fn text(value: TtsRequestChirp3Hd174648a4Text) -> Input {
    match value {
        TtsRequestChirp3Hd174648a4Text::String(value) => Input::Text(value),
        TtsRequestChirp3Hd174648a4Text::AsyncIterable(value) => Input::TextStream(value),
    }
}
impl From<TtsRequestChirp3HdTextVoiceffbf1cc1InputType> for Kind {
    fn from(value: TtsRequestChirp3HdTextVoiceffbf1cc1InputType) -> Self {
        match value {
            TtsRequestChirp3HdTextVoiceffbf1cc1InputType::Text(_) => Self::Text,
            TtsRequestChirp3HdTextVoiceffbf1cc1InputType::Markup(_) => Self::Markup,
            TtsRequestChirp3HdTextVoiceffbf1cc1InputType::Ssml(_) => Self::Ssml,
        }
    }
}
impl From<TtsRequestChirp3Hd174648a4InputType> for Kind {
    fn from(value: TtsRequestChirp3Hd174648a4InputType) -> Self {
        match value {
            TtsRequestChirp3Hd174648a4InputType::Text(_) => Self::Text,
            TtsRequestChirp3Hd174648a4InputType::Markup(_) => Self::Markup,
        }
    }
}
impl From<TtsRequestChirp3HdTextVoice0df9de22InputType> for Kind {
    fn from(value: TtsRequestChirp3HdTextVoice0df9de22InputType) -> Self {
        match value {
            TtsRequestChirp3HdTextVoice0df9de22InputType::Text(_) => Self::Text,
            TtsRequestChirp3HdTextVoice0df9de22InputType::Ssml(_) => Self::Ssml,
        }
    }
}
impl Output {
    // Generated validation already enforces integral int32 sample rates.
    fn new(encoding: Encoding, rate: Option<f64>, http: bool) -> Self {
        Self {
            encoding,
            rate: rate.map(|value| value as i32),
            http,
        }
    }
}
impl From<TtsRequestChirp3HdTextVoiceffbf1cc1OutputWav> for Output {
    fn from(value: TtsRequestChirp3HdTextVoiceffbf1cc1OutputWav) -> Self {
        let encoding = match value.sample_encoding {
            None
            | Some(TtsRequestChirp3HdTextVoiceffbf1cc1OutputWavSampleEncoding::SignedInteger16(
                _,
            )) => Encoding::Linear16,
            Some(TtsRequestChirp3HdTextVoiceffbf1cc1OutputWavSampleEncoding::Alaw(_)) => {
                Encoding::Alaw
            }
            Some(TtsRequestChirp3HdTextVoiceffbf1cc1OutputWavSampleEncoding::Mulaw(_)) => {
                Encoding::Mulaw
            }
        };
        Self::new(encoding, value.sample_rate_hz, true)
    }
}
impl From<TtsRequestChirp3HdTextVoiceffbf1cc1Output> for Output {
    fn from(value: TtsRequestChirp3HdTextVoiceffbf1cc1Output) -> Self {
        match value {
            TtsRequestChirp3HdTextVoiceffbf1cc1Output::OggOpus(v) => {
                Self::new(Encoding::OggOpus, v.sample_rate_hz, false)
            }
            TtsRequestChirp3HdTextVoiceffbf1cc1Output::Mp3(v) => {
                Self::new(Encoding::Mp3, v.sample_rate_hz, true)
            }
            TtsRequestChirp3HdTextVoiceffbf1cc1Output::Pcm(v) => {
                Self::new(Encoding::Pcm, v.sample_rate_hz, false)
            }
            TtsRequestChirp3HdTextVoiceffbf1cc1Output::Wav(v) => v.into(),
        }
    }
}
impl From<TtsRequestChirp3Hd174648a4Output> for Output {
    fn from(value: TtsRequestChirp3Hd174648a4Output) -> Self {
        match value {
            TtsRequestChirp3Hd174648a4Output::OggOpus(v) => {
                Self::new(Encoding::OggOpus, v.sample_rate_hz, false)
            }
            TtsRequestChirp3Hd174648a4Output::Pcm(v) => {
                Self::new(Encoding::Pcm, v.sample_rate_hz, false)
            }
            TtsRequestChirp3Hd174648a4Output::Object(v) => Self::new(
                match v.format {
                    TtsRequestChirp3Hd174648a4OutputObjectFormat::Alaw(_) => Encoding::Alaw,
                    TtsRequestChirp3Hd174648a4OutputObjectFormat::Mulaw(_) => Encoding::Mulaw,
                },
                v.sample_rate_hz,
                false,
            ),
        }
    }
}
impl From<TtsRequestChirp3InstantCustomVoiceTextVoiced9d056deOutput> for Output {
    fn from(value: TtsRequestChirp3InstantCustomVoiceTextVoiced9d056deOutput) -> Self {
        match value {
            TtsRequestChirp3InstantCustomVoiceTextVoiced9d056deOutput::OggOpus(v) => {
                Self::new(Encoding::OggOpus, v.sample_rate_hz, false)
            }
            TtsRequestChirp3InstantCustomVoiceTextVoiced9d056deOutput::Pcm(v) => {
                Self::new(Encoding::Pcm, v.sample_rate_hz, false)
            }
            TtsRequestChirp3InstantCustomVoiceTextVoiced9d056deOutput::Wav(v) => v.into(),
        }
    }
}

/// Public-boundary representation conversion, after generated request validation.
pub fn prepare(request: TtsRequest) -> Result<Settings, TransportError> {
    let mut c = match request {
        TtsRequest::Chirp3HdTextVoiceffbf1cc1(v) => {
            let mut c = Settings::new(
                Model::Chirp,
                v.language.value().into(),
                Voice::Named(v.voice.value().into()),
                Input::Text(v.text),
                v.output.into(),
                v.speed,
            );
            c.kind = v.input_type.map(Into::into).unwrap_or(Kind::Text);
            c.replacements = v.replacements;
            c.volume = v.volume_db;
            c.effects = v.effects_profiles;
            c
        }
        TtsRequest::Chirp3Hd174648a4(v) => {
            let mut c = Settings::new(
                Model::Chirp,
                v.language.value().into(),
                Voice::Named(v.voice.value().into()),
                text(v.text),
                v.output.into(),
                v.speed,
            );
            c.kind = v.input_type.map(Into::into).unwrap_or(Kind::Text);
            c.replacements = v.replacements;
            c
        }
        TtsRequest::Chirp3HdTextVoice3fb16684(v) => {
            let mut c = Settings::new(
                Model::Chirp,
                v.language.value().into(),
                Voice::Named(v.voice.value().into()),
                Input::Text(v.text),
                v.output.into(),
                v.speed,
            );
            c.kind = v.input_type.map(Into::into).unwrap_or(Kind::Text);
            c.volume = v.volume_db;
            c.effects = v.effects_profiles;
            c
        }
        TtsRequest::Chirp3Hd140fecab(v) => {
            let mut c = Settings::new(
                Model::Chirp,
                v.language.value().into(),
                Voice::Named(v.voice.value().into()),
                text(v.text),
                v.output.into(),
                v.speed,
            );
            c.kind = v.input_type.map(Into::into).unwrap_or(Kind::Text);
            c
        }
        TtsRequest::Chirp3HdTextVoice0df9de22(v) => {
            let mut c = Settings::new(
                Model::Chirp,
                v.language.value().into(),
                Voice::Named(v.voice.value().into()),
                Input::Text(v.text),
                v.output.into(),
                v.speed,
            );
            c.kind = v.input_type.map(Into::into).unwrap_or(Kind::Text);
            c.volume = v.volume_db;
            c.effects = v.effects_profiles;
            c
        }
        TtsRequest::Chirp3Hd69e36cb2(v) => Settings::new(
            Model::Chirp,
            v.language.value().into(),
            Voice::Named(v.voice.value().into()),
            text(v.text),
            v.output.into(),
            v.speed,
        ),
        TtsRequest::Chirp3InstantCustomVoiceTextVoiced9d056de(v) => {
            let mut c = Settings::new(
                Model::Clone,
                v.language.value().into(),
                Voice::Named(v.voice),
                Input::Text(v.text),
                v.output.into(),
                v.speed,
            );
            c.kind = v.input_type.map(Into::into).unwrap_or(Kind::Text);
            c.replacements = v.replacements;
            c
        }
        TtsRequest::Chirp3InstantCustomVoice093d5f29(v) => {
            let mut c = Settings::new(
                Model::Clone,
                v.language.value().into(),
                Voice::Named(v.voice),
                text(v.text),
                v.output.into(),
                v.speed,
            );
            c.kind = v.input_type.map(Into::into).unwrap_or(Kind::Text);
            c.replacements = v.replacements;
            c
        }
        TtsRequest::Chirp3InstantCustomVoiceTextVoice16ed8d8a(v) => {
            let mut c = Settings::new(
                Model::Clone,
                v.language.value().into(),
                Voice::Named(v.voice),
                Input::Text(v.text),
                v.output.into(),
                v.speed,
            );
            c.kind = v.input_type.map(Into::into).unwrap_or(Kind::Text);
            c
        }
        TtsRequest::Chirp3InstantCustomVoicebd483c3d(v) => {
            let mut c = Settings::new(
                Model::Clone,
                v.language.value().into(),
                Voice::Named(v.voice),
                text(v.text),
                v.output.into(),
                v.speed,
            );
            c.kind = v.input_type.map(Into::into).unwrap_or(Kind::Text);
            c
        }
        TtsRequest::Text(v) => {
            let mut c = Settings::new(
                Model::Gemini(v.model.value()),
                v.language,
                Voice::Dialogue(v.speakers),
                Input::Text(v.text),
                v.output.into(),
                v.speed,
            );
            c.instructions = v.instructions;
            c.safety = v.safety_settings;
            c.normalize = v.text_normalization.map(|v| v.value()).unwrap_or(true);
            c.volume = v.volume_db;
            c.pitch = v.pitch_semitones;
            c.effects = v.effects_profiles;
            c
        }
        TtsRequest::Object551db176(v) => {
            let mut c = Settings::new(
                Model::Gemini(v.model.value()),
                v.language,
                Voice::Dialogue(v.speakers),
                text(v.text),
                v.output.into(),
                v.speed,
            );
            c.instructions = v.instructions;
            c.safety = v.safety_settings;
            c.normalize = v.text_normalization.map(|v| v.value()).unwrap_or(true);
            c
        }
        TtsRequest::TextVoice(v) => {
            let mut c = Settings::new(
                Model::Gemini(v.model.value()),
                v.language,
                Voice::Named(v.voice.value().into()),
                Input::Text(v.text),
                v.output.into(),
                v.speed,
            );
            c.instructions = v.instructions;
            c.safety = v.safety_settings;
            c.normalize = v.text_normalization.map(|v| v.value()).unwrap_or(true);
            c.volume = v.volume_db;
            c.pitch = v.pitch_semitones;
            c.effects = v.effects_profiles;
            c
        }
        TtsRequest::Objecta65cbd8a(v) => {
            let mut c = Settings::new(
                Model::Gemini(v.model.value()),
                v.language,
                Voice::Named(v.voice.value().into()),
                text(v.text),
                v.output.into(),
                v.speed,
            );
            c.instructions = v.instructions;
            c.safety = v.safety_settings;
            c.normalize = v.text_normalization.map(|v| v.value()).unwrap_or(true);
            c
        }
        TtsRequest::Turns5ba0ad7a(v) => {
            let mut c = Settings::new(
                Model::Gemini(v.model.value()),
                v.language,
                Voice::Dialogue(v.speakers),
                Input::Turns(v.turns),
                v.output.into(),
                v.speed,
            );
            c.instructions = v.instructions;
            c.safety = v.safety_settings;
            c.normalize = v.text_normalization.map(|v| v.value()).unwrap_or(true);
            c.volume = v.volume_db;
            c.pitch = v.pitch_semitones;
            c.effects = v.effects_profiles;
            c
        }
        TtsRequest::Turns9a76562f(v) => {
            let mut c = Settings::new(
                Model::Gemini(v.model.value()),
                v.language,
                Voice::Dialogue(v.speakers),
                Input::Turns(v.turns),
                v.output.into(),
                v.speed,
            );
            c.instructions = v.instructions;
            c.safety = v.safety_settings;
            c.normalize = v.text_normalization.map(|v| v.value()).unwrap_or(true);
            c
        }
        TtsRequest::StreamingTurns(v) => {
            let mut c = Settings::new(
                Model::Gemini(v.model.value()),
                v.language,
                Voice::Dialogue(v.speakers),
                Input::TurnStream(v.turns),
                v.output.into(),
                v.speed,
            );
            c.instructions = v.instructions;
            c.safety = v.safety_settings;
            c.normalize = v.text_normalization.map(|v| v.value()).unwrap_or(true);
            c
        }
    };
    c.output.http |= matches!(c.kind, Kind::Ssml)
        || c.volume.is_some()
        || c.pitch.is_some()
        || c.effects.is_some();
    if let Voice::Dialogue(speakers) = &c.voice {
        for speaker in speakers {
            if !c.aliases.insert(speaker.alias.clone()) {
                return Err(Error::Invalid(
                    "Google dialogue requires exactly two distinct speaker aliases",
                )
                .into());
            }
        }
    }
    let mut categories = BTreeSet::new();
    if let Some(settings) = &c.safety {
        for setting in settings {
            if !categories.insert(setting.category.value()) {
                return Err(Error::Invalid("Google safety categories must be unique").into());
            }
        }
    }
    if let Some(prompt) = &c.instructions {
        check_text(prompt, 4000)?;
    }
    match &c.input {
        Input::Text(text) => check_text(text, c.byte_limit)?,
        Input::Turns(turns) => c.check_turns(turns)?,
        _ => {}
    }
    Ok(c)
}
