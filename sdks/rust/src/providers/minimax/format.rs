use super::settings::Map;
use crate::{generated::minimax::*, runtime::JsonValue};

#[derive(Default)]
pub(super) struct Audio {
    format: &'static str,
    rate: Option<f64>,
    channels: Option<f64>,
    bitrate: Option<f64>,
    cbr: Option<bool>,
}
pub(super) trait IntoAudio {
    fn into_audio(self) -> Audio;
}

impl IntoAudio for TtsRequestText77d171beOutput {
    fn into_audio(self) -> Audio {
        match self {
            Self::Flac(v) => v.into_audio(),
            Self::Mp3(v) => v.into_audio(),
            Self::Wav(v) => v.into_audio(),
        }
    }
}

impl IntoAudio for TtsRequestTextf2dcc77eOutput {
    fn into_audio(self) -> Audio {
        match self {
            Self::Object(v) => v.into_audio(),
            Self::Mp3(v) => v.into_audio(),
            Self::Mulaw(v) => v.into_audio(),
            Self::Wav6dd8e06a(v) => v.into_audio(),
            Self::OggOpus(v) => v.into_audio(),
            Self::Wava066cb88(v) => v.into_audio(),
        }
    }
}

impl IntoAudio for TtsRequestStreamingText12421ea0Output {
    fn into_audio(self) -> Audio {
        Audio {
            format: self.format.value(),
            rate: self.sample_rate_hz.map(|v| v.value()),
            channels: self.channel_count.map(|v| v.value()),
            bitrate: self.bit_rate_bps.map(|v| v.value()),
            cbr: None,
        }
    }
}

impl IntoAudio for TtsRequestStreamingTextaa771f19Output {
    fn into_audio(self) -> Audio {
        match self {
            Self::Object(v) => v.into_audio(),
            Self::Mulaw(v) => v.into_audio(),
            Self::Wav(v) => v.into_audio(),
            Self::OggOpus(v) => v.into_audio(),
            Self::Mp3(v) => v.into_audio(),
        }
    }
}

impl IntoAudio for TtsRequestText77d171beOutputFlac {
    fn into_audio(self) -> Audio {
        Audio {
            format: self.format.value(),
            rate: self.sample_rate_hz.map(|v| v.value()),
            channels: self.channel_count.map(|v| v.value()),
            bitrate: None,
            cbr: None,
        }
    }
}

impl IntoAudio for TtsRequestText77d171beOutputMp3 {
    fn into_audio(self) -> Audio {
        Audio {
            format: self.format.value(),
            rate: self.sample_rate_hz.map(|v| v.value()),
            channels: self.channel_count.map(|v| v.value()),
            bitrate: self.bit_rate_bps.map(|v| v.value()),
            cbr: self.constant_bit_rate.map(|v| v.value()),
        }
    }
}

impl IntoAudio for TtsRequestText77d171beOutputWav {
    fn into_audio(self) -> Audio {
        Audio {
            format: self.format.value(),
            rate: self.sample_rate_hz.map(|v| v.value()),
            channels: self.channel_count.map(|v| v.value()),
            bitrate: None,
            cbr: None,
        }
    }
}

impl IntoAudio for TtsRequestTextf2dcc77eOutputObject {
    fn into_audio(self) -> Audio {
        Audio {
            format: self.format.value(),
            rate: self.sample_rate_hz.map(|v| v.value()),
            channels: self.channel_count.map(|v| v.value()),
            bitrate: None,
            cbr: None,
        }
    }
}

impl IntoAudio for TtsRequestTextf2dcc77eOutputMulaw {
    fn into_audio(self) -> Audio {
        Audio {
            format: self.format.value(),
            rate: self.sample_rate_hz.map(|v| v.value()),
            channels: self.channel_count.map(|v| v.value()),
            bitrate: None,
            cbr: None,
        }
    }
}

impl IntoAudio for TtsRequestTextf2dcc77eOutputWav6dd8e06a {
    fn into_audio(self) -> Audio {
        Audio {
            format: "pcmu_wav",
            rate: self.sample_rate_hz.map(|v| v.value()),
            channels: self.channel_count.map(|v| v.value()),
            bitrate: None,
            cbr: None,
        }
    }
}

impl IntoAudio for TtsRequestTextf2dcc77eOutputOggOpus {
    fn into_audio(self) -> Audio {
        Audio {
            format: self.format.value(),
            rate: self.sample_rate_hz.map(|v| v.value()),
            channels: self.channel_count.map(|v| v.value()),
            bitrate: None,
            cbr: None,
        }
    }
}

impl Audio {
    pub fn wire(self, socket: bool) -> (Map, &'static str) {
        let format = match self.format {
            "" => "mp3",
            "ogg_opus" => "opus",
            "mulaw" => "pcmu_raw",
            v => v,
        };
        let rate = self.rate.unwrap_or(match format {
            "pcmu_raw" | "pcmu_wav" => 8000.0,
            "opus" => 24000.0,
            _ => 32000.0,
        });
        let mut fields = Map::from([
            ("format".into(), JsonValue::String(format.into())),
            ("sample_rate".into(), JsonValue::Number(rate)),
            (
                "channel".into(),
                JsonValue::Number(self.channels.unwrap_or(1.0)),
            ),
        ]);
        if format == "mp3" {
            fields.insert(
                "bitrate".into(),
                JsonValue::Number(self.bitrate.unwrap_or(128000.0)),
            );
            if !socket {
                fields.insert(
                    "force_cbr".into(),
                    JsonValue::Bool(self.cbr.unwrap_or(false)),
                );
            }
        }
        (fields, format)
    }
}
