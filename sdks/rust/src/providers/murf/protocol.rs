use crate::{generated::murf_output::*, http::TransportError, json::Raw};
use std::{collections::BTreeMap, fmt};

#[derive(Debug, PartialEq, Eq)]
pub struct Error {
    pub status: Option<u16>,
    pub body: String,
    pub retry_after: Option<String>,
}
impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self.status {
            Some(status) => write!(f, "Murf synthesis failed ({status})"),
            None => f.write_str("Murf WebSocket synthesis failed"),
        }
    }
}
impl std::error::Error for Error {}
pub(super) fn failure(message: &str) -> TransportError {
    std::io::Error::other(message).into()
}
fn object(value: Raw<'_>) -> Result<BTreeMap<String, Raw<'_>>, TransportError> {
    value
        .object()
        .map_err(|_| failure("Murf returned an invalid response object"))
}
fn audio(value: Option<&Raw<'_>>) -> Result<Vec<u8>, TransportError> {
    value
        .and_then(|v| v.string().ok())
        .and_then(|v| crate::base64::decode(&v))
        .ok_or_else(|| failure("Murf returned invalid base64 audio"))
}
pub(super) struct Packet {
    pub context: String,
    pub audio: Vec<u8>,
    pub final_: bool,
}
pub(super) fn packet(text: &str) -> Result<Packet, TransportError> {
    let fields = object(Raw::parse(text).map_err(|_| failure("Murf returned invalid JSON"))?)?;
    if fields.contains_key("error") {
        return Err(Box::new(Error {
            status: None,
            body: text.into(),
            retry_after: None,
        }));
    }
    let context = fields
        .get("context_id")
        .and_then(|v| v.string().ok())
        .filter(|v| !v.is_empty())
        .ok_or_else(|| {
            failure("Murf returned audio or completion without the requested context ID")
        })?;
    let final_ = fields
        .get("final")
        .map(|v| {
            v.boolean()
                .map_err(|_| failure("Murf returned an invalid final flag"))
        })
        .transpose()?
        .unwrap_or(false);
    if !fields.contains_key("final") && !fields.contains_key("audio") {
        return Err(failure("Murf returned an unsupported WebSocket message"));
    }
    let audio = if fields.contains_key("audio") {
        audio(fields.get("audio"))?
    } else {
        vec![]
    };
    Ok(Packet {
        context,
        audio,
        final_,
    })
}
pub(super) enum Audio {
    Bytes(Vec<u8>),
    Url(String),
}
pub(super) struct Generation {
    pub audio: Audio,
    pub duration: f64,
    pub remaining: f64,
    pub warning: Option<String>,
    pub timestamps: Vec<MurfTimestamp>,
}
pub(super) fn generation(
    text: &str,
    timed: bool,
    inline: bool,
) -> Result<Generation, TransportError> {
    let fields = object(Raw::parse(text).map_err(|_| failure("Murf returned invalid JSON"))?)?;
    let duration = fields
        .get("audioLengthInSeconds")
        .and_then(|v| v.number().ok())
        .filter(|v| *v >= 0.0 && (v * 1000.0).is_finite())
        .ok_or_else(|| failure("Murf returned an invalid audio duration"))?
        * 1000.0;
    let remaining = fields
        .get("remainingCharacterCount")
        .and_then(|v| v.number().ok())
        .filter(|v| v.is_finite() && v.fract() == 0.0 && v.abs() <= 9007199254740991.0)
        .ok_or_else(|| failure("Murf returned an invalid remaining character count"))?;
    let warning = fields
        .get("warning")
        .map(|v| {
            v.string()
                .map_err(|_| failure("Murf returned an invalid warning"))
        })
        .transpose()?;
    let mut timestamps = vec![];
    if timed {
        let words = fields
            .get("wordDurations")
            .and_then(|v| v.array().ok())
            .ok_or_else(|| failure("Murf returned no word durations"))?;
        for word in words {
            let mark = object(word)?;
            let value = mark
                .get("word")
                .and_then(|v| v.string().ok())
                .ok_or_else(|| failure("Murf returned an invalid word duration"))?;
            let start = mark
                .get("startMs")
                .and_then(|v| v.number().ok())
                .ok_or_else(|| failure("Murf returned an invalid word duration"))?;
            let end = mark
                .get("endMs")
                .and_then(|v| v.number().ok())
                .ok_or_else(|| failure("Murf returned an invalid word duration"))?;
            if !start.is_finite()
                || !end.is_finite()
                || start < 0.0
                || end < start
                || end > 9007199254740991.0
                || start.fract() != 0.0
                || end.fract() != 0.0
            {
                return Err(failure("Murf returned an invalid word duration"));
            }
            timestamps.push(MurfTimestamp {
                kind: Default::default(),
                value,
                start_time_ms: start,
                end_time_ms: end,
            });
        }
    }
    let audio = if inline {
        Audio::Bytes(audio(fields.get("encodedAudio"))?)
    } else {
        Audio::Url(
            fields
                .get("audioFile")
                .and_then(|v| v.string().ok())
                .filter(|v| !v.is_empty())
                .ok_or_else(|| failure("Murf returned no audio file URL"))?,
        )
    };
    Ok(Generation {
        audio,
        duration,
        remaining,
        warning,
        timestamps,
    })
}
pub(super) fn envelope(timeline: bool) -> MurfEnvelope {
    MurfEnvelope {
        audio: None,
        correlation: if timeline {
            MurfEnvelopeCorrelation::Timeline(Default::default())
        } else {
            MurfEnvelopeCorrelation::Ordered(Default::default())
        },
        correlation_id: None,
        duration_ms: None,
        timestamps: vec![],
    }
}
