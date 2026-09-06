use crate::{generated::cartesia::*, json, runtime::StreamingInput};

pub(super) type Input = TtsRequestStreamingTextVoice0bf53a99TextItem;
pub(super) enum Text {
    Whole(String),
    Streaming(StreamingInput<Input>),
}
pub(super) struct Prepared {
    pub settings: String,
    pub text: Text,
    pub timed: bool,
}

// Exhaustive conversions from generated types, after generated validation.
// No request constraints or runtime schema descriptors live here.
pub(super) fn prepare(request: TtsRequest) -> Prepared {
    let (
        model,
        voice,
        output,
        language,
        accent,
        lexicon,
        emotion,
        speed,
        volume,
        normalization,
        buffer,
        granularity,
        timestamp_text,
        text,
    ) = match request {
        TtsRequest::TextVoicef0bb1766(r) => (
            r.model.value(),
            r.voice,
            whole_output(r.output),
            r.language.map(|v| v.value().to_owned()),
            r.accent,
            r.lexicon,
            r.emotion,
            r.speed,
            r.volume_scale,
            r.text_normalization,
            None,
            None,
            None,
            Text::Whole(r.text),
        ),
        TtsRequest::StreamingTextVoice0bf53a99(r) => (
            r.model.value(),
            r.voice,
            raw_output(r.output),
            r.language.map(|v| v.value().to_owned()),
            r.accent,
            r.lexicon,
            r.emotion,
            r.speed,
            r.volume_scale,
            r.text_normalization,
            r.max_buffer_delay_ms,
            None,
            None,
            Text::Streaming(r.text),
        ),
        TtsRequest::StreamingTextVoice12b0fd0c(r) => (
            r.model.value(),
            r.voice,
            raw_output(r.output),
            r.language.map(|v| v.value().to_owned()),
            r.accent,
            r.lexicon,
            r.emotion,
            r.speed,
            r.volume_scale,
            r.text_normalization,
            r.max_buffer_delay_ms,
            Some(r.timestamp_granularity),
            r.timestamp_text,
            Text::Streaming(r.text),
        ),
        TtsRequest::TextVoicec75c718e(r) => (
            r.model.value(),
            r.voice,
            raw_output(r.output),
            r.language.map(|v| v.value().to_owned()),
            r.accent,
            r.lexicon,
            r.emotion,
            r.speed,
            r.volume_scale,
            r.text_normalization,
            None,
            Some(r.timestamp_granularity),
            r.timestamp_text,
            Text::Whole(r.text),
        ),
        TtsRequest::Sonic36TextVoice35faf3f2(r) => (
            r.model.value(),
            r.voice,
            whole_output(r.output),
            r.language,
            r.accent,
            r.lexicon,
            r.emotion,
            r.speed,
            r.volume_scale,
            r.text_normalization,
            None,
            None,
            None,
            Text::Whole(r.text),
        ),
        TtsRequest::Sonic36StreamingTextVoice15b369c8(r) => (
            r.model.value(),
            r.voice,
            raw_output(r.output),
            r.language,
            r.accent,
            r.lexicon,
            r.emotion,
            r.speed,
            r.volume_scale,
            r.text_normalization,
            r.max_buffer_delay_ms,
            None,
            None,
            Text::Streaming(r.text),
        ),
        TtsRequest::Sonic36StreamingTextVoice9ed3706f(r) => (
            r.model.value(),
            r.voice,
            raw_output(r.output),
            r.language,
            r.accent,
            r.lexicon,
            r.emotion,
            r.speed,
            r.volume_scale,
            r.text_normalization,
            r.max_buffer_delay_ms,
            Some(r.timestamp_granularity),
            r.timestamp_text,
            Text::Streaming(r.text),
        ),
        TtsRequest::Sonic36TextVoice448a171b(r) => (
            r.model.value(),
            r.voice,
            raw_output(r.output),
            r.language,
            r.accent,
            r.lexicon,
            r.emotion,
            r.speed,
            r.volume_scale,
            r.text_normalization,
            None,
            Some(r.timestamp_granularity),
            r.timestamp_text,
            Text::Whole(r.text),
        ),
    };
    let timed = granularity.is_some();
    let mut settings = String::from("{\"model_id\":");
    json::quote(model, &mut settings);
    settings.push_str(",\"voice\":");
    json::quote(&voice, &mut settings);
    settings.push_str(",\"output_format\":");
    settings.push_str(&output);
    for (name, value) in [
        (
            if model == "sonic-3.6" {
                "locale"
            } else {
                "language"
            },
            language,
        ),
        ("accent", accent),
        ("pronunciation_dict_id", lexicon),
    ] {
        if let Some(value) = value {
            settings.push_str(&format!(",\"{name}\":"));
            json::quote(&value, &mut settings);
        }
    }
    if let Some(value) = normalization {
        let value = match value {
            TtsRequestTextVoicef0bb1766TextNormalization::False(_) => "off".into(),
            TtsRequestTextVoicef0bb1766TextNormalization::True(_) => "auto".into(),
            TtsRequestTextVoicef0bb1766TextNormalization::Object(value) => value.locale,
        };
        settings.push_str(",\"normalization\":");
        json::quote(&value, &mut settings);
    }
    let mut generation = Vec::new();
    if let Some(speed) = speed {
        generation.push(format!("\"speed\":{speed}"));
    }
    if let Some(volume) = volume {
        generation.push(format!("\"volume\":{volume}"));
    }
    if let Some(emotion) = emotion {
        generation.push(format!("\"emotion\":\"{}\"", emotion.value()));
    }
    settings.push_str(&format!(
        ",\"generation_config\":{{{}}}",
        generation.join(",")
    ));
    if timed || matches!(&text, Text::Streaming(_)) {
        let (word, phoneme) = match granularity {
            None => (false, false),
            Some(TtsRequestStreamingTextVoice12b0fd0cTimestampGranularity::Word(_)) => {
                (true, false)
            }
            Some(TtsRequestStreamingTextVoice12b0fd0cTimestampGranularity::Phoneme(_)) => {
                (false, true)
            }
            Some(TtsRequestStreamingTextVoice12b0fd0cTimestampGranularity::Array(values)) => (
                values.iter().any(|v| v.value() == "word"),
                values.iter().any(|v| v.value() == "phoneme"),
            ),
        };
        let normalized = timestamp_text.is_some_and(|v| v.value() == "normalized");
        settings.push_str(&format!(",\"add_timestamps\":{word},\"add_phoneme_timestamps\":{phoneme},\"use_normalized_timestamps\":{normalized}"));
    }
    if matches!(&text, Text::Streaming(_)) {
        settings.push_str(&format!(
            ",\"max_buffer_delay_ms\":{}",
            buffer.unwrap_or(3000.0)
        ));
    }
    settings.push('}');
    Prepared {
        settings,
        text,
        timed,
    }
}

fn raw_output(value: TtsRequestStreamingTextVoice0bf53a99Output) -> String {
    match value {
        TtsRequestStreamingTextVoice0bf53a99Output::Pcm(v) => pcm(v),
        TtsRequestStreamingTextVoice0bf53a99Output::Object(v) => companded(v),
    }
}
fn whole_output(value: TtsRequestTextVoicef0bb1766Output) -> String {
    match value {
        TtsRequestTextVoicef0bb1766Output::Pcm(v) => pcm(v),
        TtsRequestTextVoicef0bb1766Output::Object(v) => companded(v),
        TtsRequestTextVoicef0bb1766Output::Mp3(v) => format!(
            "{{\"container\":\"mp3\",\"sample_rate\":{},\"bit_rate\":{}}}",
            v.sample_rate_hz.value(),
            v.bit_rate_bps.value()
        ),
        TtsRequestTextVoicef0bb1766Output::Wav(v) => {
            let native = match v.sample_encoding {
                Some(TtsRequestTextVoicef0bb1766OutputWavSampleEncoding::Float32(_)) => "pcm_f32le",
                Some(TtsRequestTextVoicef0bb1766OutputWavSampleEncoding::Mulaw(_)) => "pcm_mulaw",
                Some(TtsRequestTextVoicef0bb1766OutputWavSampleEncoding::Alaw(_)) => "pcm_alaw",
                Some(TtsRequestTextVoicef0bb1766OutputWavSampleEncoding::SignedInteger16(_))
                | None => "pcm_s16le",
            };
            format!(
                "{{\"container\":\"wav\",\"sample_rate\":{},\"encoding\":\"{native}\"}}",
                v.sample_rate_hz.value()
            )
        }
    }
}
fn pcm(value: TtsRequestTextVoicef0bb1766OutputPcm) -> String {
    let encoding = match value.sample_encoding {
        TtsRequestTextVoicef0bb1766OutputPcmSampleEncoding::Float32(_) => "pcm_f32le",
        TtsRequestTextVoicef0bb1766OutputPcmSampleEncoding::SignedInteger16(_) => "pcm_s16le",
    };
    format!(
        "{{\"container\":\"raw\",\"sample_rate\":{},\"encoding\":\"{encoding}\"}}",
        value.sample_rate_hz.value()
    )
}
fn companded(value: TtsRequestTextVoicef0bb1766OutputObject) -> String {
    format!(
        "{{\"container\":\"raw\",\"sample_rate\":{},\"encoding\":\"pcm_{}\"}}",
        value.sample_rate_hz.value(),
        value.format.value()
    )
}
