use crate::{generated::async_::*, json, runtime::StreamingInput};

pub(super) enum Text {
    Whole(String),
    Streaming(StreamingInput<String>),
}
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Mode {
    Plain,
    Streaming,
    Timestamped,
}
pub(super) struct WireRequest {
    pub settings: String,
    pub text: Text,
    pub mode: Mode,
    pub force: bool,
}

// Authored conversions only: schema constraints were already checked by the
// generated validator. Exhaustive matches retain every provider/model branch.
pub(super) fn settings(request: TtsRequest) -> WireRequest {
    let (model, voice, (output, mode), language, text, speed, stability, segmentation) =
        match request {
            TtsRequest::FlashV15StreamingTextVoice(r) => (
                "async_flash_v1.5",
                r.voice,
                streaming_output(r.output),
                r.language.map(flash_language),
                Text::Streaming(r.text),
                None,
                None,
                r.segmentation,
            ),
            TtsRequest::FlashV15TextVoicee827622b(r) => (
                "async_flash_v1.5",
                r.voice,
                whole_output(r.output),
                r.language.map(flash_language),
                Text::Whole(r.text),
                None,
                None,
                None,
            ),
            TtsRequest::FlashV15TextVoice7c30ce7a(r) => (
                "async_flash_v1.5",
                r.voice,
                timed_output(r.output),
                r.language.map(flash_language),
                Text::Whole(r.text),
                None,
                None,
                None,
            ),
            TtsRequest::Castleflow10StreamingTextVoice(r) => (
                "async_flash_v1.0",
                r.voice,
                streaming_output(r.output),
                r.language.map(legacy_language),
                Text::Streaming(r.text),
                r.speed,
                r.stability,
                r.segmentation,
            ),
            TtsRequest::Castleflow10TextVoice8e858d00(r) => (
                "async_flash_v1.0",
                r.voice,
                whole_output(r.output),
                r.language.map(legacy_language),
                Text::Whole(r.text),
                r.speed,
                r.stability,
                None,
            ),
            TtsRequest::Castleflow10TextVoice09f4eeb0(r) => (
                "async_flash_v1.0",
                r.voice,
                timed_output(r.output),
                r.language.map(legacy_language),
                Text::Whole(r.text),
                r.speed,
                r.stability,
                None,
            ),
            TtsRequest::ProV10StreamingTextVoice(r) => (
                "async_pro_v1.0",
                r.voice,
                streaming_output(r.output),
                r.language.map(|v| v.value()),
                Text::Streaming(r.text),
                None,
                None,
                r.segmentation,
            ),
            TtsRequest::ProV10TextVoice54fc4ea5(r) => (
                "async_pro_v1.0",
                r.voice,
                whole_output(r.output),
                r.language.map(|v| v.value()),
                Text::Whole(r.text),
                None,
                None,
                None,
            ),
            TtsRequest::ProV10TextVoice96f74303(r) => (
                "async_pro_v1.0",
                r.voice,
                timed_output(r.output),
                r.language.map(|v| v.value()),
                Text::Whole(r.text),
                None,
                None,
                None,
            ),
        };
    let mut settings = String::from("{\"model_id\":");
    json::quote(model, &mut settings);
    settings.push_str(",\"voice\":{\"mode\":\"id\",\"id\":");
    json::quote(&voice, &mut settings);
    settings.push_str("},\"output_format\":");
    settings.push_str(&output);
    if let Some(language) = language {
        settings.push_str(",\"language\":");
        json::quote(language, &mut settings);
    }
    if let Some(speed) = speed {
        settings.push_str(&format!(",\"speed_control\":{speed}"));
    }
    if let Some(stability) = stability {
        settings.push_str(&format!(
            ",\"stability\":{}",
            (stability * 100.0 + 0.5).floor()
        ));
    }
    settings.push('}');
    WireRequest {
        settings,
        mode,
        text,
        force: matches!(
            segmentation,
            Some(TtsRequestFlashV15StreamingTextVoiceSegmentation::Immediate(
                _
            ))
        ),
    }
}

fn streaming_output(output: TtsRequestFlashV15StreamingTextVoiceOutput) -> (String, Mode) {
    (
        match output {
            TtsRequestFlashV15StreamingTextVoiceOutput::Mp3(v) => mp3(v),
            TtsRequestFlashV15StreamingTextVoiceOutput::Mulaw(v) => mulaw(v),
            TtsRequestFlashV15StreamingTextVoiceOutput::Pcm(v) => {
                pcm("raw", v.sample_rate_hz, v.sample_encoding)
            }
        },
        Mode::Streaming,
    )
}
fn whole_output(output: TtsRequestFlashV15TextVoicee827622bOutput) -> (String, Mode) {
    match output {
        TtsRequestFlashV15TextVoicee827622bOutput::Mp3(v) => (mp3(v), Mode::Streaming),
        TtsRequestFlashV15TextVoicee827622bOutput::Mulaw(v) => (mulaw(v), Mode::Streaming),
        TtsRequestFlashV15TextVoicee827622bOutput::Pcm(v) => (
            pcm("raw", v.sample_rate_hz, v.sample_encoding),
            Mode::Streaming,
        ),
        TtsRequestFlashV15TextVoicee827622bOutput::Wav(v) => {
            (pcm("wav", v.sample_rate_hz, v.sample_encoding), Mode::Plain)
        }
    }
}
fn timed_output(output: TtsRequestFlashV15TextVoice7c30ce7aOutput) -> (String, Mode) {
    (
        match output {
            TtsRequestFlashV15TextVoice7c30ce7aOutput::Mp3(v) => mp3(v),
            TtsRequestFlashV15TextVoice7c30ce7aOutput::Pcm(v) => {
                pcm("raw", v.sample_rate_hz, v.sample_encoding)
            }
            TtsRequestFlashV15TextVoice7c30ce7aOutput::Wav(v) => {
                pcm("wav", v.sample_rate_hz, v.sample_encoding)
            }
        },
        Mode::Timestamped,
    )
}
fn mp3(value: TtsRequestFlashV15StreamingTextVoiceOutputMp3) -> String {
    format!(
        "{{\"container\":\"mp3\",\"sample_rate\":{},\"bit_rate\":{}}}",
        value.sample_rate_hz,
        value.bit_rate_bps.unwrap_or(192000.0)
    )
}
fn mulaw(value: TtsRequestFlashV15StreamingTextVoiceOutputMulaw) -> String {
    format!(
        "{{\"container\":\"raw\",\"encoding\":\"pcm_mulaw\",\"sample_rate\":{}}}",
        value.sample_rate_hz
    )
}
fn pcm(
    container: &str,
    rate: f64,
    encoding: Option<TtsRequestFlashV15StreamingTextVoiceOutputPcmSampleEncoding>,
) -> String {
    let encoding = if matches!(
        encoding,
        Some(TtsRequestFlashV15StreamingTextVoiceOutputPcmSampleEncoding::Float32(_))
    ) {
        "pcm_f32le"
    } else {
        "pcm_s16le"
    };
    format!("{{\"container\":\"{container}\",\"encoding\":\"{encoding}\",\"sample_rate\":{rate}}}")
}
fn flash_language(language: TtsRequestFlashV15StreamingTextVoiceLanguage) -> &'static str {
    use TtsRequestFlashV15StreamingTextVoiceLanguage::*;
    match language {
        De(v) => v.value(),
        En(v) => v.value(),
        Es(v) => v.value(),
        Fr(v) => v.value(),
        It(v) => v.value(),
        Pt(v) => v.value(),
    }
}
fn legacy_language(language: TtsRequestCastleflow10StreamingTextVoiceLanguage) -> &'static str {
    use TtsRequestCastleflow10StreamingTextVoiceLanguage::*;
    match language {
        Ar(v) => v.value(),
        De(v) => v.value(),
        En(v) => v.value(),
        Es(v) => v.value(),
        Fr(v) => v.value(),
        He(v) => v.value(),
        Hi(v) => v.value(),
        Hy(v) => v.value(),
        It(v) => v.value(),
        Ja(v) => v.value(),
        Pt(v) => v.value(),
        Ro(v) => v.value(),
        Ru(v) => v.value(),
        Tr(v) => v.value(),
        Zh(v) => v.value(),
    }
}
