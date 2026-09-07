use super::Error;
use crate::{generated::google::*, http::TransportError, runtime::StreamingInput};
use std::collections::BTreeSet;

pub type Turn = TtsRequestTurnsTurnsItem;
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
    pub replacements: Option<Vec<TtsRequestChirp3HdTextVoicebb77af5cReplacementsItem>>,
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
        if turns.is_empty() {
            return Err(Error::Invalid("Google dialogue turns must not be empty").into());
        }
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
fn text(value: TtsRequestChirp3Hda92b414cText) -> Input {
    match value {
        TtsRequestChirp3Hda92b414cText::String(value) => Input::Text(value),
        TtsRequestChirp3Hda92b414cText::AsyncIterable(value) => Input::TextStream(value),
    }
}
impl From<TtsRequestChirp3HdTextVoicebb77af5cInputType> for Kind {
    fn from(value: TtsRequestChirp3HdTextVoicebb77af5cInputType) -> Self {
        match value {
            TtsRequestChirp3HdTextVoicebb77af5cInputType::Text(_) => Self::Text,
            TtsRequestChirp3HdTextVoicebb77af5cInputType::Markup(_) => Self::Markup,
            TtsRequestChirp3HdTextVoicebb77af5cInputType::Ssml(_) => Self::Ssml,
        }
    }
}
impl From<TtsRequestChirp3Hda92b414cInputType> for Kind {
    fn from(value: TtsRequestChirp3Hda92b414cInputType) -> Self {
        match value {
            TtsRequestChirp3Hda92b414cInputType::Text(_) => Self::Text,
            TtsRequestChirp3Hda92b414cInputType::Markup(_) => Self::Markup,
        }
    }
}
impl From<TtsRequestChirp3HdTextVoiceab6ef40eInputType> for Kind {
    fn from(value: TtsRequestChirp3HdTextVoiceab6ef40eInputType) -> Self {
        match value {
            TtsRequestChirp3HdTextVoiceab6ef40eInputType::Text(_) => Self::Text,
            TtsRequestChirp3HdTextVoiceab6ef40eInputType::Ssml(_) => Self::Ssml,
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
impl From<TtsRequestChirp3HdTextVoicebb77af5cOutputWav> for Output {
    fn from(value: TtsRequestChirp3HdTextVoicebb77af5cOutputWav) -> Self {
        let encoding = match value.sample_encoding {
            None
            | Some(TtsRequestChirp3HdTextVoicebb77af5cOutputWavSampleEncoding::SignedInteger16(
                _,
            )) => Encoding::Linear16,
            Some(TtsRequestChirp3HdTextVoicebb77af5cOutputWavSampleEncoding::Alaw(_)) => {
                Encoding::Alaw
            }
            Some(TtsRequestChirp3HdTextVoicebb77af5cOutputWavSampleEncoding::Mulaw(_)) => {
                Encoding::Mulaw
            }
        };
        Self::new(encoding, value.sample_rate_hz, true)
    }
}
impl From<TtsRequestChirp3HdTextVoicebb77af5cOutput> for Output {
    fn from(value: TtsRequestChirp3HdTextVoicebb77af5cOutput) -> Self {
        match value {
            TtsRequestChirp3HdTextVoicebb77af5cOutput::OggOpus(v) => {
                Self::new(Encoding::OggOpus, v.sample_rate_hz, false)
            }
            TtsRequestChirp3HdTextVoicebb77af5cOutput::Mp3(v) => {
                Self::new(Encoding::Mp3, v.sample_rate_hz, true)
            }
            TtsRequestChirp3HdTextVoicebb77af5cOutput::Pcm(v) => {
                Self::new(Encoding::Pcm, v.sample_rate_hz, false)
            }
            TtsRequestChirp3HdTextVoicebb77af5cOutput::Wav(v) => v.into(),
        }
    }
}
impl From<TtsRequestChirp3Hda92b414cOutput> for Output {
    fn from(value: TtsRequestChirp3Hda92b414cOutput) -> Self {
        match value {
            TtsRequestChirp3Hda92b414cOutput::OggOpus(v) => {
                Self::new(Encoding::OggOpus, v.sample_rate_hz, false)
            }
            TtsRequestChirp3Hda92b414cOutput::Pcm(v) => {
                Self::new(Encoding::Pcm, v.sample_rate_hz, false)
            }
            TtsRequestChirp3Hda92b414cOutput::Object(v) => Self::new(
                match v.format {
                    TtsRequestChirp3Hda92b414cOutputObjectFormat::Alaw(_) => Encoding::Alaw,
                    TtsRequestChirp3Hda92b414cOutputObjectFormat::Mulaw(_) => Encoding::Mulaw,
                },
                v.sample_rate_hz,
                false,
            ),
        }
    }
}
impl From<TtsRequestChirp3InstantCustomVoiceTextVoicedb488368Output> for Output {
    fn from(value: TtsRequestChirp3InstantCustomVoiceTextVoicedb488368Output) -> Self {
        match value {
            TtsRequestChirp3InstantCustomVoiceTextVoicedb488368Output::OggOpus(v) => {
                Self::new(Encoding::OggOpus, v.sample_rate_hz, false)
            }
            TtsRequestChirp3InstantCustomVoiceTextVoicedb488368Output::Pcm(v) => {
                Self::new(Encoding::Pcm, v.sample_rate_hz, false)
            }
            TtsRequestChirp3InstantCustomVoiceTextVoicedb488368Output::Wav(v) => v.into(),
        }
    }
}

/// Public-boundary representation conversion, after generated request validation.
pub fn prepare(request: TtsRequest) -> Result<Settings, TransportError> {
    let mut c = match request {
        TtsRequest::Chirp3HdTextVoicebb77af5c(v) => {
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
        TtsRequest::Chirp3Hda92b414c(v) => {
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
        TtsRequest::Chirp3HdTextVoicec6612bf7(v) => {
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
        TtsRequest::Chirp3Hd9b5c25a8(v) => {
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
        TtsRequest::Chirp3HdTextVoiceab6ef40e(v) => {
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
        TtsRequest::Chirp3Hd562ca724(v) => Settings::new(
            Model::Chirp,
            v.language.value().into(),
            Voice::Named(v.voice.value().into()),
            text(v.text),
            v.output.into(),
            v.speed,
        ),
        TtsRequest::Chirp3InstantCustomVoiceTextVoicedb488368(v) => {
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
        TtsRequest::Chirp3InstantCustomVoicefa2d40ff(v) => {
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
        TtsRequest::Chirp3InstantCustomVoiceTextVoice298c5192(v) => {
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
        TtsRequest::Chirp3InstantCustomVoiceaec4d903(v) => {
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
        TtsRequest::Objectd20064bc(v) => {
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
        TtsRequest::Object7d956f3d(v) => {
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
        TtsRequest::Turns(v) => {
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
        TtsRequest::Object8dbffa0c(v) => {
            let input = match v.turns {
                TtsRequestObject8dbffa0cTurns::Array(v) => Input::Turns(v),
                TtsRequestObject8dbffa0cTurns::AsyncIterable(v) => Input::TurnStream(v),
            };
            let mut c = Settings::new(
                Model::Gemini(v.model.value()),
                v.language,
                Voice::Dialogue(v.speakers),
                input,
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
