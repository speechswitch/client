use crate::{base64, generated::inworld_output::*, http::TransportError, json::Raw};
use std::collections::BTreeMap;

#[derive(Debug, PartialEq, Eq)]
pub struct Error {
    pub message: String,
    pub status: Option<u16>,
    pub code: Option<i64>,
}
impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}
impl std::error::Error for Error {}
pub(super) fn failure(message: &str) -> TransportError {
    Box::new(std::io::Error::new(
        std::io::ErrorKind::InvalidData,
        message,
    ))
}
type Fields<'a> = BTreeMap<String, Raw<'a>>;
pub(super) fn decode(data: &str) -> Result<Fields<'_>, TransportError> {
    Raw::parse_exact(data)
        .map_err(|_| failure("Inworld returned invalid JSON"))?
        .object()
        .map_err(|_| failure("Inworld returned an invalid object"))
}
pub(super) fn status(fields: &Fields<'_>) -> Result<(), TransportError> {
    let code = fields
        .get("code")
        .map(|v| {
            v.number()
                .map_err(|_| failure("Inworld returned an invalid status code"))
        })
        .transpose()?;
    if code.is_some_and(|v| !v.is_finite() || v.fract() != 0.0 || v.abs() > 9007199254740991.0) {
        return Err(failure("Inworld returned an invalid status code"));
    }
    let message = fields
        .get("message")
        .map(|v| {
            v.string()
                .map_err(|_| failure("Inworld returned an invalid status message"))
        })
        .transpose()?;
    if let Some(code) = code.filter(|v| *v != 0.0) {
        return Err(Box::new(Error {
            message: message.unwrap_or_else(|| format!("Inworld status {}", code as i64)),
            status: None,
            code: Some(code as i64),
        }));
    }
    Ok(())
}
pub(super) fn result(data: &str) -> Result<Fields<'_>, TransportError> {
    let fields = decode(data)?;
    if let Some(error) = fields.get("error") {
        let error = error
            .object()
            .map_err(|_| failure("Inworld returned an invalid object"))?;
        status(&error)?;
        return Err(Box::new(Error {
            message: error
                .get("message")
                .and_then(|v| v.string().ok())
                .unwrap_or_else(|| "Inworld synthesis failed".into()),
            status: None,
            code: None,
        }));
    }
    fields
        .get("result")
        .and_then(|v| v.object().ok())
        .ok_or_else(|| failure("Inworld returned an invalid object"))
}
fn seconds(value: Option<&Raw<'_>>) -> Result<f64, TransportError> {
    let value = value
        .and_then(|v| v.number().ok())
        .filter(|v| *v >= 0.0 && (v * 1000.0).is_finite())
        .ok_or_else(|| failure("Inworld returned an invalid timestamp"))?;
    Ok(value * 1000.0)
}
fn timestamps(raw: Raw<'_>) -> Result<Vec<InworldTimestamp>, TransportError> {
    let info = raw
        .object()
        .map_err(|_| failure("Inworld returned an invalid object"))?;
    let mut marks = Vec::new();
    for kind in ["word", "character"] {
        let Some(raw) = info.get(&format!("{kind}Alignment")) else {
            continue;
        };
        let a = raw
            .object()
            .map_err(|_| failure("Inworld returned an invalid object"))?;
        let invalid = || failure("Inworld returned mismatched timestamp arrays");
        let values = a
            .get(&format!("{kind}s"))
            .and_then(|v| v.array().ok())
            .ok_or_else(invalid)?;
        let starts = a
            .get(&format!("{kind}StartTimeSeconds"))
            .and_then(|v| v.array().ok())
            .ok_or_else(invalid)?;
        let ends = a
            .get(&format!("{kind}EndTimeSeconds"))
            .and_then(|v| v.array().ok())
            .ok_or_else(invalid)?;
        if values.len() != starts.len() || values.len() != ends.len() {
            return Err(invalid());
        }
        for (index, raw) in values.iter().enumerate() {
            let value = raw
                .string()
                .map_err(|_| failure("Inworld returned an invalid alignment token"))?;
            let start = seconds(starts.get(index))?;
            let end = seconds(ends.get(index))?;
            if end < start {
                return Err(failure("Inworld returned a reversed timestamp range"));
            }
            marks.push(InworldTimestamp {
                kind: if kind == "word" {
                    InworldTimestampKind::Word(InworldTimestampKindWord)
                } else {
                    InworldTimestampKind::Character(InworldTimestampKindCharacter)
                },
                value,
                start_time_ms: start,
                end_time_ms: Some(end),
                source: None,
                word_index: (kind == "word").then_some(index as f64),
            });
        }
        let Some(raw) = a.get("phoneticDetails").filter(|_| kind == "word") else {
            continue;
        };
        for raw in raw
            .array()
            .map_err(|_| failure("Inworld returned invalid phonetic details"))?
        {
            let detail = raw
                .object()
                .map_err(|_| failure("Inworld returned an invalid object"))?;
            let invalid = || failure("Inworld returned an invalid phonetic word index");
            let index = detail
                .get("wordIndex")
                .and_then(|v| v.number().ok())
                .filter(|v| {
                    v.is_finite() && v.fract() == 0.0 && *v >= 0.0 && *v < (values.len() as f64)
                })
                .ok_or_else(invalid)?;
            let phones = detail
                .get("phones")
                .and_then(|v| v.array().ok())
                .ok_or_else(invalid)?;
            for raw in phones {
                let phone = raw
                    .object()
                    .map_err(|_| failure("Inworld returned an invalid object"))?;
                let invalid = || failure("Inworld returned an invalid phone or viseme");
                let symbol = phone
                    .get("phoneSymbol")
                    .and_then(|v| v.string().ok())
                    .ok_or_else(invalid)?;
                let viseme = phone
                    .get("visemeSymbol")
                    .map(|v| v.string().map_err(|_| invalid()))
                    .transpose()?;
                let start = seconds(phone.get("startTimeSeconds"))?;
                let end = start + seconds(phone.get("durationSeconds"))?;
                if !end.is_finite() {
                    return Err(failure("Inworld returned an invalid timestamp"));
                }
                marks.push(InworldTimestamp {
                    kind: InworldTimestampKind::Phoneme(InworldTimestampKindPhoneme),
                    value: symbol,
                    start_time_ms: start,
                    end_time_ms: Some(end),
                    source: None,
                    word_index: Some(index),
                });
                if let Some(value) = viseme {
                    marks.push(InworldTimestamp {
                        kind: InworldTimestampKind::Viseme(InworldTimestampKindViseme),
                        value,
                        start_time_ms: start,
                        end_time_ms: Some(end),
                        source: None,
                        word_index: Some(index),
                    });
                }
            }
        }
    }
    Ok(marks)
}
pub(super) fn audio(
    fields: &Fields<'_>,
    timed: bool,
    chunk: bool,
    id: Option<String>,
    wave: Option<&mut Wave>,
) -> Result<Option<SynthesisItem>, TransportError> {
    if let Some(raw) = fields.get("status") {
        status(
            &raw.object()
                .map_err(|_| failure("Inworld returned an invalid object"))?,
        )?;
    }
    if !["audioContent", "timestampInfo", "usage"]
        .iter()
        .any(|k| fields.contains_key(*k))
    {
        return Err(failure("Inworld returned no audio or alignment"));
    }
    let mut audio = fields
        .get("audioContent")
        .map(|v| {
            let encoded = v
                .string()
                .map_err(|_| failure("Inworld returned invalid audio content"))?;
            base64::decode(&encoded).ok_or_else(|| failure("Inworld returned invalid base64 audio"))
        })
        .transpose()?;
    if let (Some(wave), Some(bytes)) = (wave, audio.as_mut()) {
        *bytes = wave.audio(std::mem::take(bytes))?;
    }
    let marks = fields
        .get("timestampInfo")
        .map(|v| timestamps(*v))
        .transpose()?
        .unwrap_or_default();
    if !timed {
        return Ok(audio.filter(|v| !v.is_empty()).map(SynthesisItem::Bytes));
    }
    if audio.is_none() && !fields.contains_key("timestampInfo") {
        return Ok(None);
    }
    if chunk {
        return Ok(Some(SynthesisItem::Chunk(InworldChunkEnvelope {
            correlation: InworldChunkEnvelopeCorrelation,
            correlation_id: id,
            audio: audio
                .ok_or_else(|| failure("Inworld omitted audio from synchronized alignment"))?,
            timestamps: marks,
        })));
    }
    Ok(Some(SynthesisItem::Timeline(InworldTimelineEnvelope {
        correlation: InworldTimelineEnvelopeCorrelation,
        correlation_id: id,
        audio,
        timestamps: marks,
    })))
}

pub(super) struct Wave {
    pending: Vec<u8>,
    format: Option<Vec<u8>>,
    header: bool,
}
impl Wave {
    pub fn new() -> Self {
        Self {
            pending: Vec::new(),
            format: None,
            header: true,
        }
    }
    pub fn boundary(&mut self) -> Result<(), TransportError> {
        if !self.pending.is_empty() {
            return Err(failure("Inworld returned an incomplete WAV header"));
        }
        self.header = true;
        Ok(())
    }
    pub fn audio(&mut self, value: Vec<u8>) -> Result<Vec<u8>, TransportError> {
        if !self.header {
            return Ok(value);
        }
        self.pending.extend(value);
        let data = &mut self.pending;
        if data.len() < 12 {
            return Ok(Vec::new());
        }
        if &data[..4] != b"RIFF" || &data[8..12] != b"WAVE" {
            return Err(failure("Inworld returned an invalid WAV header"));
        }
        let mut offset = 12;
        let mut format = None;
        while offset + 8 <= data.len() {
            let size = u32::from_le_bytes(data[offset + 4..offset + 8].try_into().unwrap()) as u64;
            if &data[offset..offset + 4] == b"data" {
                let format: Vec<u8> =
                    format.ok_or_else(|| failure("Inworld WAV omitted its format"))?;
                let first = self.format.is_none();
                if self.format.as_ref().is_some_and(|v| *v != format) {
                    return Err(failure("Inworld changed WAV format between flushes"));
                }
                self.format = Some(format);
                self.header = false;
                let mut data = std::mem::take(data);
                if !first {
                    return Ok(data.split_off(offset + 8));
                }
                data[4..8].copy_from_slice(&u32::MAX.to_le_bytes());
                data[offset + 4..offset + 8].copy_from_slice(&u32::MAX.to_le_bytes());
                return Ok(data);
            }
            if offset as u64 + 8 + size > 1048576 {
                return Err(failure("Inworld WAV header is too large"));
            }
            let size = size as usize;
            if offset + 8 + size > data.len() {
                return Ok(Vec::new());
            }
            if &data[offset..offset + 4] == b"fmt " {
                if size < 16
                    || data[offset + 8..offset + 10] != [1, 0]
                    || data[offset + 22..offset + 24] != [16, 0]
                {
                    return Err(failure("Inworld returned an invalid PCM WAV format"));
                }
                let channels =
                    u16::from_le_bytes(data[offset + 10..offset + 12].try_into().unwrap()) as u32;
                let align =
                    u16::from_le_bytes(data[offset + 20..offset + 22].try_into().unwrap()) as u32;
                if channels == 0 || align != channels * 2 {
                    return Err(failure("Inworld returned an invalid PCM WAV format"));
                }
                format = Some(data[offset + 8..offset + 8 + size].to_vec());
            }
            offset += 8 + size + size % 2;
        }
        Ok(Vec::new())
    }
}
