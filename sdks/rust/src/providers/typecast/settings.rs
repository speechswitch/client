use super::{failure, Protocol};
use crate::{generated::typecast::*, http::TransportError, json};

pub(super) struct Settings {
    pub body: String,
    pub format: &'static str,
    pub operation: &'static str,
    pub words: bool,
    pub characters: bool,
}
struct Speech<'a> {
    model: &'static str,
    text: &'a str,
    voice: &'a str,
    language: &'static str,
    emotion: &'static str,
    before: &'a str,
    after: &'a str,
    intensity: f64,
    speed: f64,
    pitch: f64,
    seed: Option<f64>,
    volume: Option<f64>,
    loudness: Option<f64>,
}
impl Speech<'_> {
    fn wire(&self, format: &str) -> Result<String, TransportError> {
        let mut wire = String::from("{");
        for (index, (key, value)) in [
            ("model", self.model),
            ("text", self.text),
            ("voice_id", self.voice),
        ]
        .into_iter()
        .enumerate()
        {
            if index > 0 {
                wire.push(',');
            }
            json::quote(key, &mut wire);
            wire.push(':');
            json::quote(value, &mut wire);
        }
        if self.language != "auto" {
            let native = match self.language {
                "ar" => "ara",
                "bg" => "bul",
                "cs" => "ces",
                "da" => "dan",
                "de" => "deu",
                "el" => "ell",
                "en" => "eng",
                "fi" => "fin",
                "fr" => "fra",
                "hr" => "hrv",
                "id" => "ind",
                "it" => "ita",
                "ja" => "jpn",
                "ko" => "kor",
                "ms" => "msa",
                "nl" => "nld",
                "pl" => "pol",
                "pt" => "por",
                "ro" => "ron",
                "ru" => "rus",
                "sk" => "slk",
                "es" => "spa",
                "sv" => "swe",
                "ta" => "tam",
                "tl" => "tgl",
                "uk" => "ukr",
                "zh" => "zho",
                "bn" => "ben",
                "hi" => "hin",
                "hu" => "hun",
                "nan" => "nan",
                "no" => "nor",
                "pa" => "pan",
                "th" => "tha",
                "tr" => "tur",
                "vi" => "vie",
                "yue" => "yue",
                _ => return Err(failure("Unsupported Typecast wire language")),
            };
            wire.push_str(",\"language\":");
            json::quote(native, &mut wire);
        }
        if let Some(seed) = self.seed {
            wire.push_str(&format!(",\"seed\":{seed}"));
        }
        wire.push_str(",\"prompt\":{");
        if self.emotion == "auto" {
            wire.push_str("\"emotion_type\":\"smart\",\"previous_text\":");
            json::quote(self.before, &mut wire);
            wire.push_str(",\"next_text\":");
            json::quote(self.after, &mut wire);
        } else {
            if self.model == "ssfm-v30" {
                wire.push_str("\"emotion_type\":\"preset\",");
            }
            wire.push_str("\"emotion_preset\":");
            json::quote(self.emotion, &mut wire);
            wire.push_str(&format!(",\"emotion_intensity\":{}", self.intensity));
        }
        wire.push_str("},\"output\":{\"audio_format\":");
        json::quote(format, &mut wire);
        wire.push_str(&format!(
            ",\"audio_pitch\":{},\"audio_tempo\":{}",
            self.pitch, self.speed
        ));
        if let Some(volume) = self.volume {
            wire.push_str(&format!(",\"volume\":{}", (volume * 100.0).round()));
        }
        if let Some(loudness) = self.loudness {
            wire.push_str(&format!(",\"target_lufs\":{loudness}"));
        }
        wire.push_str("}}");
        Ok(wire)
    }
}

// Generated validation owns request variants and bounds; this only converts them.
pub(super) fn prepare(
    request: &TtsRequest,
    protocol: Option<Protocol>,
) -> Result<Settings, TransportError> {
    if let TtsRequest::Object(r) = request {
        if protocol == Some(Protocol::Stream) {
            return Err(failure("Typecast composition, timestamps, volume scaling and 44.1 kHz WAV require ordinary synthesis"));
        }
        let (format, _) = full_output(&r.output);
        let mut body = String::from("{\"segments\":[");
        let (mut text_count, mut pause_ms, mut speech_present) = (0usize, 0.0, false);
        for (index, segment) in r.segments.iter().enumerate() {
            if index > 0 {
                body.push(',');
            }
            match segment {
                TtsRequestObjectSegmentsItem::Object(pause) => {
                    pause_ms += pause.pause_ms;
                    let seconds = pause.pause_ms / 1000.0;
                    if seconds == 0.0 {
                        return Err(failure(
                            "Typecast pause cannot be represented as positive seconds",
                        ));
                    }
                    body.push_str(&format!(
                        "{{\"type\":\"pause\",\"duration_seconds\":{seconds}}}"
                    ));
                }
                _ => {
                    let s = match segment {
                        TtsRequestObjectSegmentsItem::SsfmV21TextVoiceb3babbe2(r) => Speech {
                            model: r.model.value(),
                            text: &r.text,
                            voice: &r.voice,
                            language: r.language.as_ref().map_or("auto", |v| v.value()),
                            emotion: r.emotion.as_ref().map_or("normal", |v| v.value()),
                            intensity: r.emotion_intensity.unwrap_or(1.0),
                            before: "",
                            after: "",
                            speed: r.speed.unwrap_or(1.0),
                            pitch: r.pitch_semitones.unwrap_or(0.0),
                            seed: r.random_seed,
                            volume: None,
                            loudness: Some(r.target_loudness_lufs),
                        },
                        TtsRequestObjectSegmentsItem::SsfmV21TextVoice4e8a729e(r) => Speech {
                            model: r.model.value(),
                            text: &r.text,
                            voice: &r.voice,
                            language: r.language.as_ref().map_or("auto", |v| v.value()),
                            emotion: r.emotion.as_ref().map_or("normal", |v| v.value()),
                            intensity: r.emotion_intensity.unwrap_or(1.0),
                            before: "",
                            after: "",
                            speed: r.speed.unwrap_or(1.0),
                            pitch: r.pitch_semitones.unwrap_or(0.0),
                            seed: r.random_seed,
                            volume: r.volume_scale,
                            loudness: None,
                        },
                        TtsRequestObjectSegmentsItem::SsfmV30TextVoiceaa70b792(r) => Speech {
                            model: r.model.value(),
                            text: &r.text,
                            voice: &r.voice,
                            language: r.language.as_ref().map_or("auto", |v| v.value()),
                            emotion: r.emotion.as_ref().map_or("normal", |v| v.value()),
                            intensity: r.emotion_intensity.unwrap_or(1.0),
                            before: "",
                            after: "",
                            speed: r.speed.unwrap_or(1.0),
                            pitch: r.pitch_semitones.unwrap_or(0.0),
                            seed: r.random_seed,
                            volume: None,
                            loudness: Some(r.target_loudness_lufs),
                        },
                        TtsRequestObjectSegmentsItem::SsfmV30TextVoice0a18e1a3(r) => Speech {
                            model: r.model.value(),
                            text: &r.text,
                            voice: &r.voice,
                            language: r.language.as_ref().map_or("auto", |v| v.value()),
                            emotion: r.emotion.as_ref().map_or("normal", |v| v.value()),
                            intensity: r.emotion_intensity.unwrap_or(1.0),
                            before: "",
                            after: "",
                            speed: r.speed.unwrap_or(1.0),
                            pitch: r.pitch_semitones.unwrap_or(0.0),
                            seed: r.random_seed,
                            volume: r.volume_scale,
                            loudness: None,
                        },
                        TtsRequestObjectSegmentsItem::SsfmV30TextVoice0e2e956c(r) => Speech {
                            model: r.model.value(),
                            text: &r.text,
                            voice: &r.voice,
                            language: r.language.as_ref().map_or("auto", |v| v.value()),
                            emotion: "auto",
                            intensity: 1.0,
                            before: r.context_before.as_ref().map_or("", |v| v.text.as_str()),
                            after: r.context_after.as_ref().map_or("", |v| v.text.as_str()),
                            speed: r.speed.unwrap_or(1.0),
                            pitch: r.pitch_semitones.unwrap_or(0.0),
                            seed: r.random_seed,
                            volume: None,
                            loudness: Some(r.target_loudness_lufs),
                        },
                        TtsRequestObjectSegmentsItem::SsfmV30TextVoice9cf1a777(r) => Speech {
                            model: r.model.value(),
                            text: &r.text,
                            voice: &r.voice,
                            language: r.language.as_ref().map_or("auto", |v| v.value()),
                            emotion: "auto",
                            intensity: 1.0,
                            before: r.context_before.as_ref().map_or("", |v| v.text.as_str()),
                            after: r.context_after.as_ref().map_or("", |v| v.text.as_str()),
                            speed: r.speed.unwrap_or(1.0),
                            pitch: r.pitch_semitones.unwrap_or(0.0),
                            seed: r.random_seed,
                            volume: r.volume_scale,
                            loudness: None,
                        },
                        TtsRequestObjectSegmentsItem::Object(_) => {
                            unreachable!("pause handled above")
                        }
                    };
                    text_count += s.text.chars().count();
                    speech_present = true;
                    let native = s.wire(format)?;
                    body.push_str("{\"type\":\"tts\",");
                    body.push_str(&native[1..]);
                }
            }
        }
        if !speech_present || text_count > 2000 || pause_ms > 60000.0 {
            return Err(failure("Typecast composition requires speech, at most 2000 total text code points and at most 60000 ms total pauses"));
        }
        body.push_str("]}");
        return Ok(Settings {
            body,
            format,
            operation: "/compose",
            words: false,
            characters: false,
        });
    }
    let (s, (format, rate), granularity) = match request {
        TtsRequest::SsfmV21TextVoicec8409957(r) => (
            Speech {
                model: r.model.value(),
                text: &r.text,
                voice: &r.voice,
                language: r.language.as_ref().map_or("auto", |v| v.value()),
                emotion: r.emotion.as_ref().map_or("normal", |v| v.value()),
                intensity: r.emotion_intensity.unwrap_or(1.0),
                before: "",
                after: "",
                speed: r.speed.unwrap_or(1.0),
                pitch: r.pitch_semitones.unwrap_or(0.0),
                seed: r.random_seed,
                volume: None,
                loudness: r.target_loudness_lufs,
            },
            full_output(&r.output),
            Some(&r.timestamp_granularity),
        ),
        TtsRequest::SsfmV21TextVoicef82be0f4(r) => (
            Speech {
                model: r.model.value(),
                text: &r.text,
                voice: &r.voice,
                language: r.language.as_ref().map_or("auto", |v| v.value()),
                emotion: r.emotion.as_ref().map_or("normal", |v| v.value()),
                intensity: r.emotion_intensity.unwrap_or(1.0),
                before: "",
                after: "",
                speed: r.speed.unwrap_or(1.0),
                pitch: r.pitch_semitones.unwrap_or(0.0),
                seed: r.random_seed,
                volume: None,
                loudness: r.target_loudness_lufs,
            },
            stream_output(&r.output),
            None,
        ),
        TtsRequest::SsfmV21TextVoiceb54b9734(r) => (
            Speech {
                model: r.model.value(),
                text: &r.text,
                voice: &r.voice,
                language: r.language.as_ref().map_or("auto", |v| v.value()),
                emotion: r.emotion.as_ref().map_or("normal", |v| v.value()),
                intensity: r.emotion_intensity.unwrap_or(1.0),
                before: "",
                after: "",
                speed: r.speed.unwrap_or(1.0),
                pitch: r.pitch_semitones.unwrap_or(0.0),
                seed: r.random_seed,
                volume: Some(r.volume_scale),
                loudness: None,
            },
            full_output(&r.output),
            r.timestamp_granularity.as_ref(),
        ),
        TtsRequest::SsfmV30TextVoiceda7d6fa9(r) => (
            Speech {
                model: r.model.value(),
                text: &r.text,
                voice: &r.voice,
                language: r.language.as_ref().map_or("auto", |v| v.value()),
                emotion: r.emotion.as_ref().map_or("normal", |v| v.value()),
                intensity: r.emotion_intensity.unwrap_or(1.0),
                before: "",
                after: "",
                speed: r.speed.unwrap_or(1.0),
                pitch: r.pitch_semitones.unwrap_or(0.0),
                seed: r.random_seed,
                volume: None,
                loudness: r.target_loudness_lufs,
            },
            full_output(&r.output),
            Some(&r.timestamp_granularity),
        ),
        TtsRequest::SsfmV30TextVoicec9d5257e(r) => (
            Speech {
                model: r.model.value(),
                text: &r.text,
                voice: &r.voice,
                language: r.language.as_ref().map_or("auto", |v| v.value()),
                emotion: r.emotion.as_ref().map_or("normal", |v| v.value()),
                intensity: r.emotion_intensity.unwrap_or(1.0),
                before: "",
                after: "",
                speed: r.speed.unwrap_or(1.0),
                pitch: r.pitch_semitones.unwrap_or(0.0),
                seed: r.random_seed,
                volume: None,
                loudness: r.target_loudness_lufs,
            },
            stream_output(&r.output),
            None,
        ),
        TtsRequest::SsfmV30TextVoice2e7e5231(r) => (
            Speech {
                model: r.model.value(),
                text: &r.text,
                voice: &r.voice,
                language: r.language.as_ref().map_or("auto", |v| v.value()),
                emotion: r.emotion.as_ref().map_or("normal", |v| v.value()),
                intensity: r.emotion_intensity.unwrap_or(1.0),
                before: "",
                after: "",
                speed: r.speed.unwrap_or(1.0),
                pitch: r.pitch_semitones.unwrap_or(0.0),
                seed: r.random_seed,
                volume: Some(r.volume_scale),
                loudness: None,
            },
            full_output(&r.output),
            r.timestamp_granularity.as_ref(),
        ),
        TtsRequest::SsfmV30TextVoice862867af(r) => (
            Speech {
                model: r.model.value(),
                text: &r.text,
                voice: &r.voice,
                language: r.language.as_ref().map_or("auto", |v| v.value()),
                emotion: "auto",
                intensity: 1.0,
                before: r.context_before.as_ref().map_or("", |v| v.text.as_str()),
                after: r.context_after.as_ref().map_or("", |v| v.text.as_str()),
                speed: r.speed.unwrap_or(1.0),
                pitch: r.pitch_semitones.unwrap_or(0.0),
                seed: r.random_seed,
                volume: None,
                loudness: r.target_loudness_lufs,
            },
            full_output(&r.output),
            Some(&r.timestamp_granularity),
        ),
        TtsRequest::SsfmV30TextVoicebb79df90(r) => (
            Speech {
                model: r.model.value(),
                text: &r.text,
                voice: &r.voice,
                language: r.language.as_ref().map_or("auto", |v| v.value()),
                emotion: "auto",
                intensity: 1.0,
                before: r.context_before.as_ref().map_or("", |v| v.text.as_str()),
                after: r.context_after.as_ref().map_or("", |v| v.text.as_str()),
                speed: r.speed.unwrap_or(1.0),
                pitch: r.pitch_semitones.unwrap_or(0.0),
                seed: r.random_seed,
                volume: None,
                loudness: r.target_loudness_lufs,
            },
            stream_output(&r.output),
            None,
        ),
        TtsRequest::SsfmV30TextVoicec3047c31(r) => (
            Speech {
                model: r.model.value(),
                text: &r.text,
                voice: &r.voice,
                language: r.language.as_ref().map_or("auto", |v| v.value()),
                emotion: "auto",
                intensity: 1.0,
                before: r.context_before.as_ref().map_or("", |v| v.text.as_str()),
                after: r.context_after.as_ref().map_or("", |v| v.text.as_str()),
                speed: r.speed.unwrap_or(1.0),
                pitch: r.pitch_semitones.unwrap_or(0.0),
                seed: r.random_seed,
                volume: Some(r.volume_scale),
                loudness: None,
            },
            full_output(&r.output),
            r.timestamp_granularity.as_ref(),
        ),
        TtsRequest::Object(_) => unreachable!("composition handled above"),
    };
    let mut words = false;
    let mut characters = false;
    if let Some(value) = granularity {
        match value {
            TtsRequestSsfmV21TextVoicec8409957TimestampGranularity::Word(_) => words = true,
            TtsRequestSsfmV21TextVoicec8409957TimestampGranularity::Character(_) => {
                characters = true
            }
            TtsRequestSsfmV21TextVoicec8409957TimestampGranularity::Array(items) => {
                for kind in items {
                    match kind {
     TtsRequestSsfmV21TextVoicec8409957TimestampGranularityArrayItem::Word(_)=>words=true,
     TtsRequestSsfmV21TextVoicec8409957TimestampGranularityArrayItem::Character(_)=>characters=true,
    }
                }
            }
        }
    }
    let full =
        granularity.is_some() || s.volume.is_some() || format == "wav" && rate == Some(44100.0);
    let mode = protocol.unwrap_or(if full {
        Protocol::Http
    } else {
        Protocol::Stream
    });
    if full && mode == Protocol::Stream {
        return Err(failure("Typecast composition, timestamps, volume scaling and 44.1 kHz WAV require ordinary synthesis"));
    }
    if mode == Protocol::Http && format == "wav" && rate == Some(32000.0) {
        return Err(failure("Typecast ordinary WAV uses 44100 Hz, not 32000 Hz"));
    }
    Ok(Settings {
        body: s.wire(format)?,
        format,
        words,
        characters,
        operation: if words || characters {
            "/with-timestamps"
        } else if mode == Protocol::Stream {
            "/stream"
        } else {
            ""
        },
    })
}
fn full_output(value: &Option<TtsRequestObjectOutput>) -> (&'static str, Option<f64>) {
    match value {
        None => ("wav", None),
        Some(TtsRequestObjectOutput::Wav(v)) => {
            ("wav", v.sample_rate_hz.as_ref().map(|v| v.value()))
        }
        Some(TtsRequestObjectOutput::Mp3(_)) => ("mp3", Some(44100.0)),
    }
}
fn stream_output(
    value: &Option<TtsRequestSsfmV21TextVoicef82be0f4Output>,
) -> (&'static str, Option<f64>) {
    match value {
        None => ("wav", None),
        Some(TtsRequestSsfmV21TextVoicef82be0f4Output::Wav(v)) => {
            ("wav", v.sample_rate_hz.as_ref().map(|v| v.value()))
        }
        Some(TtsRequestSsfmV21TextVoicef82be0f4Output::Mp3(_)) => ("mp3", Some(44100.0)),
    }
}
