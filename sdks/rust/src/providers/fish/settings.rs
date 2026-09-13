use super::protocol::failure;
use crate::{generated::fish::*, http::TransportError, msgpack::Value, runtime::StreamingInput};
use std::collections::BTreeMap;

pub(super) type Input = TtsRequestS1StreamingTextTextItem;
pub(super) enum Text {
    Whole(String),
    Streaming(StreamingInput<Input>),
}
pub(super) struct Prepared {
    pub model: &'static str,
    pub text: Text,
    pub output: TtsRequestS1TextOutput,
    pub timed: bool,
    voice: Option<String>,
    references: Option<Vec<TtsRequestS1TextReferenceSamplesItem>>,
    speakers: Option<TtsRequestTextfd2d056aSpeakers>,
    speed: f64,
    volume: f64,
    loudness: bool,
    temperature: f64,
    top_p: f64,
    chunk_length: f64,
    min_chunk_length: f64,
    max_tokens: f64,
    repetition: f64,
    condition: bool,
    early_stop: f64,
    normalize: bool,
    latency: &'static str,
    features: Vec<String>,
}

// Exhaustive projections retain model-specific absence in the generated types.
pub(super) fn prepare(request: TtsRequest) -> Prepared {
    match request {
        TtsRequest::S1Text(r) => Prepared {
            model: r.model.value(),
            text: Text::Whole(r.text),
            output: r.output,
            timed: r.timestamp_granularity.is_some(),
            voice: r.voice,
            references: Some(r.reference_samples),
            speakers: None,
            speed: r.speed.unwrap_or(1.0),
            volume: r.volume_db.unwrap_or(0.0),
            loudness: true,
            temperature: r.temperature.unwrap_or(0.7),
            top_p: r.top_p.unwrap_or(0.7),
            chunk_length: r.text_chunk_length.unwrap_or(300.0),
            min_chunk_length: r.min_text_chunk_length.unwrap_or(50.0),
            max_tokens: r.max_audio_tokens.unwrap_or(1024.0),
            repetition: r.repetition_penalty.unwrap_or(1.2),
            condition: r.condition_on_previous_chunks.map_or(true, |v| v.value()),
            early_stop: r.early_stop_threshold.unwrap_or(1.0),
            normalize: r.text_normalization.map_or(true, |v| v.value()),
            latency: match r.latency_optimization.map(|v| v.value()).unwrap_or("none") {
                "aggressive" => "low",
                "moderate" => "balanced",
                _ => "normal",
            },
            features: r.features.unwrap_or_default(),
        },
        TtsRequest::S1StreamingText(r) => Prepared {
            model: r.model.value(),
            text: Text::Streaming(r.text),
            output: r.output,
            timed: false,
            voice: r.voice,
            references: Some(r.reference_samples),
            speakers: None,
            speed: r.speed.unwrap_or(1.0),
            volume: r.volume_db.unwrap_or(0.0),
            loudness: true,
            temperature: r.temperature.unwrap_or(0.7),
            top_p: r.top_p.unwrap_or(0.7),
            chunk_length: r.text_chunk_length.unwrap_or(300.0),
            min_chunk_length: r.min_text_chunk_length.unwrap_or(50.0),
            max_tokens: r.max_audio_tokens.unwrap_or(1024.0),
            repetition: r.repetition_penalty.unwrap_or(1.2),
            condition: r.condition_on_previous_chunks.map_or(true, |v| v.value()),
            early_stop: r.early_stop_threshold.unwrap_or(1.0),
            normalize: r.text_normalization.map_or(true, |v| v.value()),
            latency: match r.latency_optimization.map(|v| v.value()).unwrap_or("none") {
                "aggressive" => "low",
                "moderate" => "balanced",
                _ => "normal",
            },
            features: r.features.unwrap_or_default(),
        },
        TtsRequest::S1TextVoice(r) => Prepared {
            model: r.model.value(),
            text: Text::Whole(r.text),
            output: r.output,
            timed: r.timestamp_granularity.is_some(),
            voice: Some(r.voice),
            references: r.reference_samples,
            speakers: None,
            speed: r.speed.unwrap_or(1.0),
            volume: r.volume_db.unwrap_or(0.0),
            loudness: true,
            temperature: r.temperature.unwrap_or(0.7),
            top_p: r.top_p.unwrap_or(0.7),
            chunk_length: r.text_chunk_length.unwrap_or(300.0),
            min_chunk_length: r.min_text_chunk_length.unwrap_or(50.0),
            max_tokens: r.max_audio_tokens.unwrap_or(1024.0),
            repetition: r.repetition_penalty.unwrap_or(1.2),
            condition: r.condition_on_previous_chunks.map_or(true, |v| v.value()),
            early_stop: r.early_stop_threshold.unwrap_or(1.0),
            normalize: r.text_normalization.map_or(true, |v| v.value()),
            latency: match r.latency_optimization.map(|v| v.value()).unwrap_or("none") {
                "aggressive" => "low",
                "moderate" => "balanced",
                _ => "normal",
            },
            features: r.features.unwrap_or_default(),
        },
        TtsRequest::S1StreamingTextVoice(r) => Prepared {
            model: r.model.value(),
            text: Text::Streaming(r.text),
            output: r.output,
            timed: false,
            voice: Some(r.voice),
            references: r.reference_samples,
            speakers: None,
            speed: r.speed.unwrap_or(1.0),
            volume: r.volume_db.unwrap_or(0.0),
            loudness: true,
            temperature: r.temperature.unwrap_or(0.7),
            top_p: r.top_p.unwrap_or(0.7),
            chunk_length: r.text_chunk_length.unwrap_or(300.0),
            min_chunk_length: r.min_text_chunk_length.unwrap_or(50.0),
            max_tokens: r.max_audio_tokens.unwrap_or(1024.0),
            repetition: r.repetition_penalty.unwrap_or(1.2),
            condition: r.condition_on_previous_chunks.map_or(true, |v| v.value()),
            early_stop: r.early_stop_threshold.unwrap_or(1.0),
            normalize: r.text_normalization.map_or(true, |v| v.value()),
            latency: match r.latency_optimization.map(|v| v.value()).unwrap_or("none") {
                "aggressive" => "low",
                "moderate" => "balanced",
                _ => "normal",
            },
            features: r.features.unwrap_or_default(),
        },
        TtsRequest::Textfd2d056a(r) => Prepared {
            model: r.model.value(),
            text: Text::Whole(r.text),
            output: r.output,
            timed: r.timestamp_granularity.is_some(),
            voice: None,
            references: None,
            speakers: Some(r.speakers),
            speed: r.speed.unwrap_or(1.0),
            volume: r.volume_db.unwrap_or(0.0),
            loudness: r.loudness_normalization.map_or(true, |v| v.value()),
            temperature: r.temperature.unwrap_or(0.7),
            top_p: r.top_p.unwrap_or(0.7),
            chunk_length: r.text_chunk_length.unwrap_or(300.0),
            min_chunk_length: r.min_text_chunk_length.unwrap_or(50.0),
            max_tokens: r.max_audio_tokens.unwrap_or(1024.0),
            repetition: r.repetition_penalty.unwrap_or(1.2),
            condition: r.condition_on_previous_chunks.map_or(true, |v| v.value()),
            early_stop: r.early_stop_threshold.unwrap_or(1.0),
            normalize: r.text_normalization.map_or(true, |v| v.value()),
            latency: match r.latency_optimization.map(|v| v.value()).unwrap_or("none") {
                "aggressive" => "low",
                "moderate" => "balanced",
                _ => "normal",
            },
            features: r.features.unwrap_or_default(),
        },
        TtsRequest::StreamingTexta6bb52c3(r) => Prepared {
            model: r.model.value(),
            text: Text::Streaming(r.text),
            output: r.output,
            timed: false,
            voice: None,
            references: None,
            speakers: Some(r.speakers),
            speed: r.speed.unwrap_or(1.0),
            volume: r.volume_db.unwrap_or(0.0),
            loudness: r.loudness_normalization.map_or(true, |v| v.value()),
            temperature: r.temperature.unwrap_or(0.7),
            top_p: r.top_p.unwrap_or(0.7),
            chunk_length: r.text_chunk_length.unwrap_or(300.0),
            min_chunk_length: r.min_text_chunk_length.unwrap_or(50.0),
            max_tokens: r.max_audio_tokens.unwrap_or(1024.0),
            repetition: r.repetition_penalty.unwrap_or(1.2),
            condition: r.condition_on_previous_chunks.map_or(true, |v| v.value()),
            early_stop: r.early_stop_threshold.unwrap_or(1.0),
            normalize: r.text_normalization.map_or(true, |v| v.value()),
            latency: match r.latency_optimization.map(|v| v.value()).unwrap_or("none") {
                "aggressive" => "low",
                "moderate" => "balanced",
                _ => "normal",
            },
            features: r.features.unwrap_or_default(),
        },
        TtsRequest::Text698033d1(r) => Prepared {
            model: r.model.value(),
            text: Text::Whole(r.text),
            output: r.output,
            timed: r.timestamp_granularity.is_some(),
            voice: r.voice,
            references: Some(r.reference_samples),
            speakers: None,
            speed: r.speed.unwrap_or(1.0),
            volume: r.volume_db.unwrap_or(0.0),
            loudness: r.loudness_normalization.map_or(true, |v| v.value()),
            temperature: r.temperature.unwrap_or(0.7),
            top_p: r.top_p.unwrap_or(0.7),
            chunk_length: r.text_chunk_length.unwrap_or(300.0),
            min_chunk_length: r.min_text_chunk_length.unwrap_or(50.0),
            max_tokens: r.max_audio_tokens.unwrap_or(1024.0),
            repetition: r.repetition_penalty.unwrap_or(1.2),
            condition: r.condition_on_previous_chunks.map_or(true, |v| v.value()),
            early_stop: r.early_stop_threshold.unwrap_or(1.0),
            normalize: r.text_normalization.map_or(true, |v| v.value()),
            latency: match r.latency_optimization.map(|v| v.value()).unwrap_or("none") {
                "aggressive" => "low",
                "moderate" => "balanced",
                _ => "normal",
            },
            features: r.features.unwrap_or_default(),
        },
        TtsRequest::StreamingText327a2fba(r) => Prepared {
            model: r.model.value(),
            text: Text::Streaming(r.text),
            output: r.output,
            timed: false,
            voice: r.voice,
            references: Some(r.reference_samples),
            speakers: None,
            speed: r.speed.unwrap_or(1.0),
            volume: r.volume_db.unwrap_or(0.0),
            loudness: r.loudness_normalization.map_or(true, |v| v.value()),
            temperature: r.temperature.unwrap_or(0.7),
            top_p: r.top_p.unwrap_or(0.7),
            chunk_length: r.text_chunk_length.unwrap_or(300.0),
            min_chunk_length: r.min_text_chunk_length.unwrap_or(50.0),
            max_tokens: r.max_audio_tokens.unwrap_or(1024.0),
            repetition: r.repetition_penalty.unwrap_or(1.2),
            condition: r.condition_on_previous_chunks.map_or(true, |v| v.value()),
            early_stop: r.early_stop_threshold.unwrap_or(1.0),
            normalize: r.text_normalization.map_or(true, |v| v.value()),
            latency: match r.latency_optimization.map(|v| v.value()).unwrap_or("none") {
                "aggressive" => "low",
                "moderate" => "balanced",
                _ => "normal",
            },
            features: r.features.unwrap_or_default(),
        },
        TtsRequest::TextVoice(r) => Prepared {
            model: r.model.value(),
            text: Text::Whole(r.text),
            output: r.output,
            timed: r.timestamp_granularity.is_some(),
            voice: Some(r.voice),
            references: r.reference_samples,
            speakers: None,
            speed: r.speed.unwrap_or(1.0),
            volume: r.volume_db.unwrap_or(0.0),
            loudness: r.loudness_normalization.map_or(true, |v| v.value()),
            temperature: r.temperature.unwrap_or(0.7),
            top_p: r.top_p.unwrap_or(0.7),
            chunk_length: r.text_chunk_length.unwrap_or(300.0),
            min_chunk_length: r.min_text_chunk_length.unwrap_or(50.0),
            max_tokens: r.max_audio_tokens.unwrap_or(1024.0),
            repetition: r.repetition_penalty.unwrap_or(1.2),
            condition: r.condition_on_previous_chunks.map_or(true, |v| v.value()),
            early_stop: r.early_stop_threshold.unwrap_or(1.0),
            normalize: r.text_normalization.map_or(true, |v| v.value()),
            latency: match r.latency_optimization.map(|v| v.value()).unwrap_or("none") {
                "aggressive" => "low",
                "moderate" => "balanced",
                _ => "normal",
            },
            features: r.features.unwrap_or_default(),
        },
        TtsRequest::StreamingTextVoice(r) => Prepared {
            model: r.model.value(),
            text: Text::Streaming(r.text),
            output: r.output,
            timed: false,
            voice: Some(r.voice),
            references: r.reference_samples,
            speakers: None,
            speed: r.speed.unwrap_or(1.0),
            volume: r.volume_db.unwrap_or(0.0),
            loudness: r.loudness_normalization.map_or(true, |v| v.value()),
            temperature: r.temperature.unwrap_or(0.7),
            top_p: r.top_p.unwrap_or(0.7),
            chunk_length: r.text_chunk_length.unwrap_or(300.0),
            min_chunk_length: r.min_text_chunk_length.unwrap_or(50.0),
            max_tokens: r.max_audio_tokens.unwrap_or(1024.0),
            repetition: r.repetition_penalty.unwrap_or(1.2),
            condition: r.condition_on_previous_chunks.map_or(true, |v| v.value()),
            early_stop: r.early_stop_threshold.unwrap_or(1.0),
            normalize: r.text_normalization.map_or(true, |v| v.value()),
            latency: match r.latency_optimization.map(|v| v.value()).unwrap_or("none") {
                "aggressive" => "low",
                "moderate" => "balanced",
                _ => "normal",
            },
            features: r.features.unwrap_or_default(),
        },
    }
}

fn references(samples: &[TtsRequestS1TextReferenceSamplesItem]) -> Result<Value, TransportError> {
    let mut values = Vec::with_capacity(samples.len());
    for sample in samples {
        // Byte-buffer lengths cannot yet be expressed with schema annotations.
        if sample.audio.is_empty() {
            return Err(failure("Fish reference audio must not be empty"));
        }
        values.push(Value::Map(BTreeMap::from([
            ("audio".into(), Value::Binary(sample.audio.clone())),
            ("text".into(), Value::String(sample.text.clone())),
        ])));
    }
    Ok(Value::Array(values))
}

pub(super) fn wire(c: &Prepared) -> Result<Value, TransportError> {
    let (format, rate, mp3, opus) = match &c.output {
        TtsRequestS1TextOutput::Mp3(v) => (
            "mp3",
            v.sample_rate_hz.unwrap_or(44100.0),
            v.bit_rate_bps
                .as_ref()
                .map_or(128.0, |v| v.value() / 1000.0),
            -1000.0,
        ),
        TtsRequestS1TextOutput::OggOpus(v) => (
            "opus",
            v.sample_rate_hz.unwrap_or(48000.0),
            128.0,
            v.bit_rate_bps.as_ref().map_or(-1000.0, |v| v.value()),
        ),
        TtsRequestS1TextOutput::Object(v) => (
            v.format.value(),
            v.sample_rate_hz.unwrap_or(44100.0),
            128.0,
            -1000.0,
        ),
    };
    let (ids, refs) = match &c.speakers {
        Some(TtsRequestTextfd2d056aSpeakers::Arraybc859dfb(speakers)) => (
            Value::Array(
                speakers
                    .iter()
                    .map(|v| Value::String(v.voice.clone()))
                    .collect(),
            ),
            Value::Nil,
        ),
        Some(TtsRequestTextfd2d056aSpeakers::Array66345558(speakers)) => {
            let mut ids = Vec::new();
            let mut groups = Vec::new();
            for (index, speaker) in speakers.iter().enumerate() {
                ids.push(Value::String(index.to_string()));
                groups.push(references(&speaker.reference_samples)?);
            }
            (Value::Array(ids), Value::Array(groups))
        }
        None => (
            c.voice
                .as_ref()
                .map_or(Value::Nil, |v| Value::String(v.clone())),
            match &c.references {
                Some(samples) => references(samples)?,
                None => Value::Nil,
            },
        ),
    };
    Ok(Value::Map(BTreeMap::from([
        (
            "text".into(),
            Value::String(match &c.text {
                Text::Whole(text) => text.clone(),
                Text::Streaming(_) => String::new(),
            }),
        ),
        ("reference_id".into(), ids),
        ("references".into(), refs),
        ("format".into(), Value::String(format.into())),
        ("sample_rate".into(), Value::Number(rate)),
        ("mp3_bitrate".into(), Value::Number(mp3)),
        ("opus_bitrate".into(), Value::Number(opus)),
        (
            "prosody".into(),
            Value::Map(BTreeMap::from([
                ("speed".into(), Value::Number(c.speed)),
                ("volume".into(), Value::Number(c.volume)),
                ("normalize_loudness".into(), Value::Bool(c.loudness)),
            ])),
        ),
        ("temperature".into(), Value::Number(c.temperature)),
        ("top_p".into(), Value::Number(c.top_p)),
        ("chunk_length".into(), Value::Number(c.chunk_length)),
        ("min_chunk_length".into(), Value::Number(c.min_chunk_length)),
        ("max_new_tokens".into(), Value::Number(c.max_tokens)),
        ("repetition_penalty".into(), Value::Number(c.repetition)),
        (
            "condition_on_previous_chunks".into(),
            Value::Bool(c.condition),
        ),
        ("early_stop_threshold".into(), Value::Number(c.early_stop)),
        ("normalize".into(), Value::Bool(c.normalize)),
        ("latency".into(), Value::String(c.latency.into())),
        (
            "features".into(),
            Value::Array(c.features.iter().cloned().map(Value::String).collect()),
        ),
    ])))
}
