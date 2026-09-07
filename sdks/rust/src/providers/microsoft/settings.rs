use super::protocol::failure;
use crate::{
    generated::microsoft::*,
    http::TransportError,
    runtime::{JsonValue, StreamingInput},
};
use std::collections::{BTreeMap, BTreeSet};
pub(super) struct Settings {
    pub input: Option<StreamingInput<String>>,
    pub markup: String,
    pub format: String,
    pub wave: bool,
    pub timed: bool,
    pub tracks: BTreeSet<String>,
    pub native: BTreeMap<String, JsonValue>,
}
pub(super) fn settings(request: TtsRequest) -> Result<Settings, TransportError> {
    let (mut model, mut voice, mut text) = ("neural", String::new(), String::new());
    let mut input = None;
    let output;
    let (mut language, mut emotion, mut lexicon, mut languages) = (None, None, None, None);
    let (
        mut temperature,
        mut speed,
        mut pitch,
        mut volume,
        mut top_k,
        mut top_p,
        mut guidance,
        mut enhance,
    ) = (None, None, None, None, None, None, None, None);
    let (mut raw, mut timed) = (false, false);
    let mut requested = BTreeSet::new();
    match request {
        TtsRequest::DragonHdFlashTextVoice(v) => {
            model = v.model.value();
            voice = v.voice;
            text = v.text;
            output = v.output;
            emotion = v.emotion;
            language = v.language.map(|v| v.value().to_owned());
        }
        TtsRequest::DragonHdFlashStreamingTextVoice(v) => {
            model = v.model.value();
            voice = v.voice;
            input = Some(v.text);
            output = v.output.map(streaming_output);
            emotion = v.emotion;
            language = v.language.map(|v| v.value().to_owned());
            lexicon = v.lexicon_url;
            languages = v.preferred_languages;
        }
        TtsRequest::DragonHdTextVoice(v) => {
            model = v.model.value();
            voice = v.voice;
            text = v.text;
            output = v.output;
            language = v.language;
            temperature = v.temperature;
            enhance = v.named_entity_pronunciation_enhancement;
        }
        TtsRequest::DragonHdStreamingTextVoice(v) => {
            model = v.model.value();
            voice = v.voice;
            input = Some(v.text);
            output = v.output.map(streaming_output);
            language = v.language;
            temperature = v.temperature;
            lexicon = v.lexicon_url;
            languages = v.preferred_languages;
        }
        TtsRequest::TextVoicefd836b1e(v) => {
            model = v.model.value();
            voice = v.voice;
            text = v.text;
            output = v.output;
            language = v.language;
            emotion = v.emotion;
        }
        TtsRequest::StreamingTextVoicee690c86a(v) => {
            model = v.model.value();
            voice = v.voice;
            input = Some(v.text);
            output = v.output.map(streaming_output);
            language = v.language;
            emotion = v.emotion;
            lexicon = v.lexicon_url;
            languages = v.preferred_languages;
        }
        TtsRequest::TextVoice4ff226b4(v) => {
            voice = v.voice;
            text = v.text;
            output = v.output;
            language = v.language;
            emotion = v.emotion;
            speed = v.speed;
            pitch = v.pitch_semitones;
            volume = v.volume_scale;
        }
        TtsRequest::StreamingTextVoicee86a65c0(v) => {
            voice = v.voice;
            input = Some(v.text);
            output = v.output.map(streaming_output);
            language = v.language;
            emotion = v.emotion;
            speed = v.speed;
            pitch = v.pitch_semitones;
            volume = v.volume_scale;
            lexicon = v.lexicon_url;
            languages = v.preferred_languages;
            timed = v.timestamp_granularity.is_some();
            if let Some(v) = v.timestamp_granularity {
                tracks(v, &mut requested);
            }
        }
        TtsRequest::TextVoicef6245d6f(v) => {
            voice = v.voice;
            text = v.text;
            output = v.output.map(streaming_output);
            language = v.language;
            emotion = v.emotion;
            speed = v.speed;
            pitch = v.pitch_semitones;
            volume = v.volume_scale;
            timed = true;
            tracks(v.timestamp_granularity, &mut requested);
        }
        TtsRequest::DragonHdOmniTextVoicea5a77562(v) => {
            model = v.model.value();
            voice = v.voice;
            text = v.text;
            output = v.output;
            language = v.language;
            emotion = v.emotion;
            temperature = v.temperature;
            top_k = v.top_k;
            top_p = v.top_p;
            guidance = v.voice_guidance;
        }
        TtsRequest::DragonHdOmniStreamingTextVoice(v) => {
            model = v.model.value();
            voice = v.voice;
            input = Some(v.text);
            output = v.output.map(streaming_output);
            language = v.language;
            emotion = v.emotion;
            temperature = v.temperature;
            lexicon = v.lexicon_url;
            languages = v.preferred_languages;
            timed = v.timestamp_granularity.is_some();
            if timed {
                requested.insert("word".into());
            }
        }
        TtsRequest::DragonHdOmniTextVoice4088531e(v) => {
            model = v.model.value();
            voice = v.voice;
            text = v.text;
            output = v.output.map(streaming_output);
            language = v.language;
            emotion = v.emotion;
            temperature = v.temperature;
            top_k = v.top_k;
            top_p = v.top_p;
            guidance = v.voice_guidance;
            timed = true;
            requested.insert("word".into());
        }
        TtsRequest::Text404f3d9b(v) => {
            text = v.text;
            output = v.output;
            raw = true;
        }
        TtsRequest::Text686f0afb(v) => {
            text = v.text;
            output = v.output.map(streaming_output);
            raw = true;
            timed = true;
            ssml_tracks(v.timestamp_granularity, &mut requested);
        }
    }
    let (format, wave) = audio_format(output);
    let mut native = BTreeMap::new();
    if raw {
        return Ok(Settings {
            input,
            markup: text,
            format,
            wave,
            timed,
            tracks: requested,
            native,
        });
    }
    voice.push_str(match model {
        "dragon-hd" => ":DragonHDLatestNeural",
        "dragon-hd-omni" => ":DragonHDOmniLatestNeural",
        "dragon-hd-flash" => ":DragonHDFlashLatestNeural",
        "mai-voice-2" => ":MAI-Voice-2",
        "mai-voice-2-flash" => ":MAI-Voice-2-Flash",
        _ => "",
    });
    let locale = language.as_deref().unwrap_or("en-US");
    native.insert("bidirectionalStreamingMode".into(), JsonValue::Bool(true));
    native.insert("voiceName".into(), JsonValue::String(voice.clone()));
    native.insert("language".into(), JsonValue::String(locale.to_owned()));
    let temperature = temperature.or(match model {
        "dragon-hd" => Some(1.0),
        "dragon-hd-omni" => Some(0.7),
        _ => None,
    });
    let mut parameters = vec![];
    if let Some(value) = temperature {
        native.insert("temperature".into(), JsonValue::String(value.to_string()));
        parameters.push(format!("temperature={value}"));
    }
    for (name, value) in [("top_p", top_p), ("top_k", top_k), ("cfg_scale", guidance)] {
        if let Some(value) = value {
            parameters.push(format!("{name}={value}"));
        }
    }
    if let Some(value) = enhance {
        parameters.push(format!("enhancePronunciation={}", value.value()));
    }
    if let Some(value) = speed {
        native.insert("rate".into(), JsonValue::String(value.to_string()));
    }
    if let Some(value) = pitch {
        native.insert(
            "pitch".into(),
            JsonValue::String(format!("{}{value}st", if value >= 0.0 { "+" } else { "" })),
        );
    }
    if let Some(value) = volume {
        native.insert(
            "volume".into(),
            JsonValue::String((value * 100.0).to_string()),
        );
    }
    if let Some(value) = &emotion {
        native.insert("style".into(), JsonValue::String(value.clone()));
    }
    if let Some(value) = lexicon {
        native.insert("customLexiconUrl".into(), JsonValue::String(value));
    }
    if let Some(values) = languages {
        if values.iter().any(|v| v.contains([',', '\r', '\n'])) {
            return Err(failure(
                "Microsoft preferred languages cannot contain commas or line breaks",
            ));
        }
        native.insert("preferLocales".into(), JsonValue::String(values.join(",")));
    }
    let markup = if input.is_none() {
        let hd = model.starts_with("dragon-hd");
        let mut body = xml(&text);
        if hd && language.is_some() {
            body = format!("<lang xml:lang=\"{}\">{body}</lang>", xml(locale));
        }
        let mut prosody = String::new();
        for key in ["rate", "pitch", "volume"] {
            if let Some(JsonValue::String(value)) = native.get(key) {
                prosody.push_str(&format!(" {key}=\"{value}\""));
            }
        }
        if !prosody.is_empty() {
            body = format!("<prosody{prosody}>{body}</prosody>");
        }
        if let Some(value) = emotion {
            body = format!(
                "<mstts:express-as style=\"{}\">{body}</mstts:express-as>",
                xml(&value)
            );
        }
        let params = if parameters.is_empty() {
            String::new()
        } else {
            format!(" parameters=\"{}\"", xml(&parameters.join(";")))
        };
        format!("<speak version=\"1.0\" xmlns=\"http://www.w3.org/2001/10/synthesis\" xmlns:mstts=\"http://www.w3.org/2001/mstts\" xml:lang=\"{}\"><voice name=\"{}\"{params}>{body}</voice></speak>",xml(if hd {"en-US"}else{locale}),xml(&voice))
    } else {
        String::new()
    };
    Ok(Settings {
        input,
        markup,
        format,
        wave,
        timed,
        tracks: requested,
        native,
    })
}
fn xml(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

fn tracks(
    value: TtsRequestStreamingTextVoicee86a65c0TimestampGranularity,
    result: &mut BTreeSet<String>,
) {
    use TtsRequestStreamingTextVoicee86a65c0TimestampGranularity::*;
    match value {
        Sentence(v) => {
            result.insert(v.value().into());
        }
        Word(v) => {
            result.insert(v.value().into());
        }
        Array(values) => {
            result.extend(values.into_iter().map(|v| v.value().to_owned()));
        }
    }
}
fn ssml_tracks(value: TtsRequestText686f0afbTimestampGranularity, result: &mut BTreeSet<String>) {
    use TtsRequestText686f0afbTimestampGranularity::*;
    match value {
        Sentence(v) => {
            result.insert(v.value().into());
        }
        Word(v) => {
            result.insert(v.value().into());
        }
        Ssml(v) => {
            result.insert(v.value().into());
        }
        Viseme(v) => {
            result.insert(v.value().into());
        }
        Array(values) => {
            result.extend(values.into_iter().map(|v| v.value().to_owned()));
        }
    }
}
fn streaming_output(
    value: TtsRequestDragonHdFlashStreamingTextVoiceOutput,
) -> TtsRequestDragonHdFlashTextVoiceOutput {
    use TtsRequestDragonHdFlashStreamingTextVoiceOutput as S;
    use TtsRequestDragonHdFlashTextVoiceOutput as O;
    match value {
        S::AmrWb(v) => O::AmrWb(v),
        S::G722(v) => O::G722(v),
        S::Mp3c7ff7390(v) => O::Mp3c7ff7390(v),
        S::Mp3cfa54ac8(v) => O::Mp3cfa54ac8(v),
        S::Mp332730738(v) => O::Mp332730738(v),
        S::OggOpus(v) => O::OggOpus(v),
        S::Pcm(v) => O::Pcm(v),
        S::Opusacd6a00c(v) => O::Opusacd6a00c(v),
        S::Opus0a945e79(v) => O::Opus0a945e79(v),
        S::Object(v) => O::Object(v),
        S::Truesilk(v) => O::Truesilk(v),
        S::WebmOpus00bc3439(v) => O::WebmOpus00bc3439(v),
        S::WebmOpus036ccd81(v) => O::WebmOpus036ccd81(v),
    }
}
fn sample_rate(rate: f64) -> String {
    if rate == 22050.0 || rate == 44100.0 {
        format!("{rate}hz")
    } else {
        format!("{}khz", rate / 1000.0)
    }
}
pub(super) fn audio_format(
    output: Option<TtsRequestDragonHdFlashTextVoiceOutput>,
) -> (String, bool) {
    use TtsRequestDragonHdFlashTextVoiceOutput::*;
    let Some(output) = output else {
        return ("raw-24khz-16bit-mono-pcm".into(), false);
    };
    let mut wave = false;
    let format = match output {
        AmrWb(_) => "amr-wb-16000hz".into(),
        G722(_) => "g722-16khz-64kbps".into(),
        Mp3c7ff7390(v) => format!(
            "audio-16khz-{}kbitrate-mono-mp3",
            v.bit_rate_bps.value() / 1000.0
        ),
        Mp3cfa54ac8(v) => format!(
            "audio-24khz-{}kbitrate-mono-mp3",
            v.bit_rate_bps.value() / 1000.0
        ),
        Mp332730738(v) => format!(
            "audio-48khz-{}kbitrate-mono-mp3",
            v.bit_rate_bps.value() / 1000.0
        ),
        OggOpus(v) => format!(
            "ogg-{}-16bit-mono-opus",
            sample_rate(v.sample_rate_hz.value())
        ),
        Pcm(v) => format!(
            "raw-{}-16bit-mono-pcm",
            sample_rate(v.sample_rate_hz.value())
        ),
        Opusacd6a00c(_) => "audio-16khz-16bit-32kbps-mono-opus".into(),
        Opus0a945e79(v) => format!(
            "audio-24khz-16bit-{}kbps-mono-opus",
            v.bit_rate_bps.value() / 1000.0
        ),
        Object(v) => format!("raw-8khz-8bit-mono-{}", v.format.value()),
        Truesilk(v) => format!(
            "raw-{}-16bit-mono-truesilk",
            sample_rate(v.sample_rate_hz.value())
        ),
        Wavbcb4c8a6(v) => {
            wave = true;
            format!(
                "riff-{}-16bit-mono-pcm",
                sample_rate(v.sample_rate_hz.value())
            )
        }
        Wav7dc10d1f(v) => {
            wave = true;
            format!("riff-8khz-8bit-mono-{}", v.sample_encoding.value())
        }
        WebmOpus00bc3439(_) => "webm-16khz-16bit-mono-opus".into(),
        WebmOpus036ccd81(v) => format!(
            "webm-24khz-16bit-{}mono-opus",
            if v.bit_rate_bps.is_some() {
                "24kbps-"
            } else {
                ""
            }
        ),
    };
    (format, wave)
}
