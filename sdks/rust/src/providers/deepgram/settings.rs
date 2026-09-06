use crate::{generated::deepgram::*, runtime::StreamingInput};

pub(super) type Input = TtsRequestAura1StreamingTextVoiceTextItem;
pub(super) enum Text {
    Whole(String),
    Streaming(StreamingInput<Input>),
}
pub(super) struct Prepared {
    pub text: Text,
    pub query: Vec<(&'static str, String)>,
}
pub(super) fn prepare(request: TtsRequest) -> Prepared {
    let (model, voice, language, output, speed, mip, tags, text) = match request {
        TtsRequest::Aura1TextVoice(r) => (
            r.model.value(),
            r.voice.value(),
            r.language.value(),
            r.output,
            r.speed,
            r.model_improvement_opt_out,
            r.tags,
            Text::Whole(r.text),
        ),
        TtsRequest::Aura1StreamingTextVoice(r) => (
            r.model.value(),
            r.voice.value(),
            r.language.value(),
            raw_output(r.output),
            r.speed,
            r.model_improvement_opt_out,
            None,
            Text::Streaming(r.text),
        ),
        TtsRequest::Aura2TextVoice977d4f43(r) => (
            r.model.value(),
            r.voice.value(),
            r.language.value(),
            r.output,
            r.speed,
            r.model_improvement_opt_out,
            r.tags,
            Text::Whole(r.text),
        ),
        TtsRequest::Aura2StreamingTextVoicec96c6915(r) => (
            r.model.value(),
            r.voice.value(),
            r.language.value(),
            raw_output(r.output),
            r.speed,
            r.model_improvement_opt_out,
            None,
            Text::Streaming(r.text),
        ),
        TtsRequest::Aura2TextVoicecfca101c(r) => (
            r.model.value(),
            r.voice.value(),
            r.language.value(),
            r.output,
            r.speed,
            r.model_improvement_opt_out,
            r.tags,
            Text::Whole(r.text),
        ),
        TtsRequest::Aura2StreamingTextVoice9a9ab9cb(r) => (
            r.model.value(),
            r.voice.value(),
            r.language.value(),
            raw_output(r.output),
            r.speed,
            r.model_improvement_opt_out,
            None,
            Text::Streaming(r.text),
        ),
        TtsRequest::Aura2TextVoice2ee322ad(r) => (
            r.model.value(),
            r.voice.value(),
            r.language.value(),
            r.output,
            r.speed,
            r.model_improvement_opt_out,
            r.tags,
            Text::Whole(r.text),
        ),
        TtsRequest::Aura2StreamingTextVoiceb9577a7c(r) => (
            r.model.value(),
            r.voice.value(),
            r.language.value(),
            raw_output(r.output),
            r.speed,
            r.model_improvement_opt_out,
            None,
            Text::Streaming(r.text),
        ),
        TtsRequest::Aura2TextVoice0e5dc20c(r) => (
            r.model.value(),
            r.voice.value(),
            r.language.value(),
            r.output,
            r.speed,
            r.model_improvement_opt_out,
            r.tags,
            Text::Whole(r.text),
        ),
        TtsRequest::Aura2StreamingTextVoice3b7bc554(r) => (
            r.model.value(),
            r.voice.value(),
            r.language.value(),
            raw_output(r.output),
            r.speed,
            r.model_improvement_opt_out,
            None,
            Text::Streaming(r.text),
        ),
        TtsRequest::Aura2TextVoice76db964c(r) => (
            r.model.value(),
            r.voice.value(),
            r.language.value(),
            r.output,
            r.speed,
            r.model_improvement_opt_out,
            r.tags,
            Text::Whole(r.text),
        ),
        TtsRequest::Aura2StreamingTextVoice141a5c9a(r) => (
            r.model.value(),
            r.voice.value(),
            r.language.value(),
            raw_output(r.output),
            r.speed,
            r.model_improvement_opt_out,
            None,
            Text::Streaming(r.text),
        ),
        TtsRequest::Aura2TextVoicefa928059(r) => (
            r.model.value(),
            r.voice.value(),
            r.language.value(),
            r.output,
            r.speed,
            r.model_improvement_opt_out,
            r.tags,
            Text::Whole(r.text),
        ),
        TtsRequest::Aura2StreamingTextVoicec5cb87b8(r) => (
            r.model.value(),
            r.voice.value(),
            r.language.value(),
            raw_output(r.output),
            r.speed,
            r.model_improvement_opt_out,
            None,
            Text::Streaming(r.text),
        ),
        TtsRequest::Aura2TextVoiceaf63b261(r) => (
            r.model.value(),
            r.voice.value(),
            r.language.value(),
            r.output,
            r.speed,
            r.model_improvement_opt_out,
            r.tags,
            Text::Whole(r.text),
        ),
        TtsRequest::Aura2StreamingTextVoice8f696e76(r) => (
            r.model.value(),
            r.voice.value(),
            r.language.value(),
            raw_output(r.output),
            r.speed,
            r.model_improvement_opt_out,
            None,
            Text::Streaming(r.text),
        ),
    };
    let streaming = matches!(&text, Text::Streaming(_));
    let (encoding, container, rate, bitrate) = match output {
        TtsRequestAura1TextVoiceOutput::Pcm(v) => (
            "linear16",
            "none",
            v.sample_rate_hz.map(|v| v.value()),
            None,
        ),
        TtsRequestAura1TextVoiceOutput::Object(v) => (
            v.format.value(),
            "none",
            v.sample_rate_hz.map(|v| v.value()),
            None,
        ),
        TtsRequestAura1TextVoiceOutput::Wavb8f00cbb(v) => {
            ("linear16", "wav", v.sample_rate_hz.map(|v| v.value()), None)
        }
        TtsRequestAura1TextVoiceOutput::Wav669a6d8a(v) => (
            v.sample_encoding.value(),
            "wav",
            v.sample_rate_hz.map(|v| v.value()),
            None,
        ),
        TtsRequestAura1TextVoiceOutput::Mp3(v) => {
            ("mp3", "", None, v.bit_rate_bps.map(|v| v.value()))
        }
        TtsRequestAura1TextVoiceOutput::OggOpus(v) => ("opus", "ogg", None, v.bit_rate_bps),
        TtsRequestAura1TextVoiceOutput::Flac(v) => {
            ("flac", "", v.sample_rate_hz.map(|v| v.value()), None)
        }
        TtsRequestAura1TextVoiceOutput::Aac(v) => ("aac", "", None, v.bit_rate_bps),
    };
    let model = if model == "aura-1" { "aura" } else { model };
    let mut query = vec![
        ("model", format!("{model}-{voice}-{language}")),
        ("encoding", encoding.into()),
    ];
    if !streaming && !container.is_empty() {
        query.push(("container", container.into()));
    }
    // Fixed codec rates are schema literals, not configurable wire parameters.
    for (key, value) in [
        ("sample_rate", rate),
        ("bit_rate", bitrate),
        ("speed", speed),
    ] {
        if let Some(value) = value {
            query.push((key, value.to_string()));
        }
    }
    if let Some(mip) = mip {
        query.push(("mip_opt_out", mip.value().to_string()));
    }
    for tag in tags.unwrap_or_default() {
        query.push(("tag", tag));
    }
    Prepared { text, query }
}
fn raw_output(value: TtsRequestAura1StreamingTextVoiceOutput) -> TtsRequestAura1TextVoiceOutput {
    match value {
        TtsRequestAura1StreamingTextVoiceOutput::Pcm(v) => TtsRequestAura1TextVoiceOutput::Pcm(v),
        TtsRequestAura1StreamingTextVoiceOutput::Object(v) => {
            TtsRequestAura1TextVoiceOutput::Object(v)
        }
    }
}
