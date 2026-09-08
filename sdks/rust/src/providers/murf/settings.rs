use super::{Input, TtsRequest};
use crate::{
    generated::murf::*,
    runtime::{JsonValue, StreamingInput},
};
use std::collections::BTreeMap;
pub(super) type Map = BTreeMap<String, JsonValue>;

pub(super) struct Settings {
    pub wire: Map,
    pub voice: Map,
    pub input: Option<StreamingInput<Input>>,
    pub gen2: bool,
    pub timed: bool,
    pub inline: bool,
    pub format: String,
    pub rate: f64,
    pub channel: &'static str,
    pub threshold: f64,
    pub delay: f64,
}
pub(super) fn settings(request: TtsRequest) -> Settings {
    let (mut input, mut output, mut gen_output) = (None, None, None);
    let (mut gen2, mut timed, mut original) = (false, false, false);
    let (mut retention, mut variance, mut duration) = (None, None, None);
    let (mut threshold, mut delay) = (40.0, 300.0);
    let (text, voice, language, style, speed, pitch) = match request {
        TtsRequest::TextVoice(v) => {
            output = v.output;
            (
                v.text,
                v.voice,
                v.language,
                v.voice_style,
                v.speed_bias,
                v.pitch_bias,
            )
        }
        TtsRequest::StreamingTextVoice(v) => {
            input = Some(v.text);
            output = v.output;
            threshold = v.text_buffer_threshold.unwrap_or(40.0);
            delay = v.max_buffer_delay_ms.unwrap_or(300.0);
            (
                String::new(),
                v.voice,
                v.language,
                v.voice_style,
                v.speed_bias,
                v.pitch_bias,
            )
        }
        TtsRequest::Gen2TextVoiceca621e19(v) => {
            gen2 = true;
            timed = v.timestamp_granularity.is_some();
            gen_output = v.output;
            retention = v.audio_retention;
            variance = v.delivery_variance;
            duration = v.target_duration_ms;
            (
                v.text,
                v.voice,
                v.language,
                v.voice_style,
                v.speed_bias,
                v.pitch_bias,
            )
        }
        TtsRequest::Gen2TextVoice13ad89db(v) => {
            gen2 = true;
            timed = true;
            original = true;
            gen_output = v.output;
            retention = v.audio_retention;
            variance = v.delivery_variance;
            duration = v.target_duration_ms;
            (
                v.text,
                v.voice,
                Some(v.language),
                v.voice_style,
                v.speed_bias,
                v.pitch_bias,
            )
        }
    };
    let mut format = "PCM".to_owned();
    let mut rate = if gen2 { 44100.0 } else { 24000.0 };
    let mut channel = "MONO";
    if let Some(v) = output {
        format = v.format.value().to_ascii_uppercase();
        if let Some(v) = v.sample_rate_hz {
            rate = v.value();
        }
        if v.channel_count.is_some_and(|v| v.value() == 2.0) {
            channel = "STEREO";
        }
    }
    if let Some(v) = gen_output {
        format = v.format.value().to_ascii_uppercase();
        if let Some(v) = v.sample_rate_hz {
            rate = v.value();
        }
        if v.channel_count.is_some_and(|v| v.value() == 2.0) {
            channel = "STEREO";
        }
    }
    if format == "MULAW" {
        format = "ULAW".into();
    }
    let mut wire = Map::from([
        ("text".into(), JsonValue::String(text)),
        ("voiceId".into(), JsonValue::String(voice.clone())),
        ("rate".into(), JsonValue::Number(speed.unwrap_or(0.0))),
        ("pitch".into(), JsonValue::Number(pitch.unwrap_or(0.0))),
        ("format".into(), JsonValue::String(format.clone())),
        ("sampleRate".into(), JsonValue::Number(rate)),
        ("channelType".into(), JsonValue::String(channel.into())),
    ]);
    let mut voice = Map::from([
        ("voice_id".into(), JsonValue::String(voice)),
        ("rate".into(), JsonValue::Number(speed.unwrap_or(0.0))),
        ("pitch".into(), JsonValue::Number(pitch.unwrap_or(0.0))),
    ]);
    if let Some(v) = language {
        wire.insert("locale".into(), JsonValue::String(v.clone()));
        voice.insert("locale".into(), JsonValue::String(v));
    }
    if let Some(v) = style {
        wire.insert("style".into(), JsonValue::String(v.clone()));
        voice.insert("style".into(), JsonValue::String(v));
    }
    let inline = retention.is_some_and(|v| !v.value());
    if gen2 {
        wire.insert("modelVersion".into(), JsonValue::String("GEN2".into()));
        wire.insert(
            "variation".into(),
            JsonValue::Number(variance.map_or(1.0, |v| v.value() * 5.0)),
        );
        wire.insert("encodeAsBase64".into(), JsonValue::Bool(inline));
        wire.insert(
            "wordDurationsAsOriginalText".into(),
            JsonValue::Bool(original),
        );
        if let Some(v) = duration {
            wire.insert("audioDuration".into(), JsonValue::Number(v / 1000.0));
        }
    } else {
        wire.insert("model".into(), JsonValue::String("falcon-2".into()));
    }
    Settings {
        wire,
        voice,
        input,
        gen2,
        timed,
        inline,
        format,
        rate,
        channel,
        threshold,
        delay,
    }
}

pub(super) fn update(v: TtsRequestStreamingTextVoiceTextItemUpdate) -> (Map, Map) {
    let mut voice = Map::new();
    let mut buffering = Map::new();
    for (name, value) in [
        ("voice_id", v.voice),
        ("style", v.voice_style),
        ("locale", v.language),
    ] {
        if let Some(v) = value {
            voice.insert(name.into(), JsonValue::String(v));
        }
    }
    for (name, value) in [("rate", v.speed_bias), ("pitch", v.pitch_bias)] {
        if let Some(v) = value {
            voice.insert(name.into(), JsonValue::Number(v));
        }
    }
    for (name, value) in [
        ("min_buffer_size", v.text_buffer_threshold),
        ("max_buffer_delay_in_ms", v.max_buffer_delay_ms),
    ] {
        if let Some(v) = value {
            buffering.insert(name.into(), JsonValue::Number(v));
        }
    }
    (voice, buffering)
}
