use super::{failure, Mode};
use crate::{generated::vocu::*, http::TransportError, json};
use std::collections::BTreeSet;

pub(super) struct Settings {
    pub body: String,
    pub mode: Mode,
}
struct Binding<'a> {
    voice: Option<&'a str>,
    style: Option<&'a str>,
    processing: Option<&'a str>,
    delivery: Option<&'a str>,
    language: Option<&'a str>,
    emotion: Option<&'a str>,
    blend: Option<&'a TtsRequestObject42a4f93cSegmentsItemTextVoicef8490aaeEmotionBlend>,
    vivid: Option<bool>,
    long: Option<bool>,
    speed: Option<f64>,
    seed: Option<f64>,
    markup: Option<bool>,
    emphasis: Option<&'a str>,
}
impl Binding<'_> {
    fn wire(&self, defaults: bool) -> String {
        let mut wire = String::new();
        for (name, value) in [
            ("voiceId", self.voice),
            (
                "promptId",
                self.style.or(if defaults { Some("default") } else { None }),
            ),
            ("post_processing", self.processing),
            (
                "preset",
                self.delivery
                    .or(if defaults { Some("balanced") } else { None }),
            ),
            (
                "language",
                self.language.or(if defaults { Some("auto") } else { None }),
            ),
            ("reference_mode", self.emphasis),
        ] {
            if let Some(value) = value {
                wire.push_str(&format!(",\"{name}\":"));
                let value = match (name, value) {
                    ("preset", "balanced") => "balance",
                    ("language", "en-US") => "en-us",
                    ("language", "fr-FR") => "fr-fr",
                    _ => value,
                };
                json::quote(value, &mut wire);
            }
        }
        for (name, value) in [
            (
                "vivid",
                self.vivid.or(if defaults { Some(false) } else { None }),
            ),
            ("infinite_mode", self.long),
            ("instruct_mode", self.markup),
            ("break_clone", self.emotion.map(|value| value == "text")),
        ] {
            if let Some(value) = value {
                wire.push_str(&format!(",\"{name}\":{value}"));
            }
        }
        if let Some(speed) = self.speed.or(if defaults { Some(1.0) } else { None }) {
            wire.push_str(&format!(",\"speechRate\":{}", 1.0 / speed));
        }
        if let Some(seed) = self.seed.or(if defaults { Some(-1.0) } else { None }) {
            wire.push_str(&format!(",\"seed\":{seed}"));
        }
        if let Some(blend) = self.blend {
            wire.push_str(&format!(
                ",\"emo_switch\":[{},{},{},{},{}]",
                blend.anger.unwrap_or(0.0),
                blend.happiness.unwrap_or(0.0),
                blend.neutral.unwrap_or(0.0),
                blend.sadness.unwrap_or(0.0),
                blend.contextual.unwrap_or(0.0)
            ));
        }
        format!("{{{}}}", wire.strip_prefix(',').unwrap_or(&wire))
    }
}
impl<'a> From<&'a TtsRequestTextVoicee296d426> for Binding<'a> {
    fn from(r: &'a TtsRequestTextVoicee296d426) -> Self {
        Self {
            voice: Some(r.voice.as_str()),
            style: r.voice_style.as_deref(),
            processing: r.audio_processing_profile.as_deref(),
            delivery: r.delivery_mode.as_ref().map(|v| v.value()),
            language: r.language.as_ref().map(|v| v.value()),
            emotion: r.emotion_source.as_ref().map(|v| v.value()),
            blend: r.emotion_blend.as_ref(),
            vivid: r.vivid_expression.as_ref().map(|v| v.value()),
            long: r.long_text_mode.as_ref().map(|v| v.value()),
            speed: r.speed,
            seed: r.random_seed,
            markup: Some(true),
            emphasis: r.reference_emphasis.as_ref().map(|v| v.value()),
        }
    }
}
impl<'a> From<&'a TtsRequestTextVoice2a721534> for Binding<'a> {
    fn from(r: &'a TtsRequestTextVoice2a721534) -> Self {
        Self {
            voice: Some(r.voice.as_str()),
            style: r.voice_style.as_deref(),
            processing: r.audio_processing_profile.as_deref(),
            delivery: r.delivery_mode.as_ref().map(|v| v.value()),
            language: r.language.as_ref().map(|v| v.value()),
            emotion: r.emotion_source.as_ref().map(|v| v.value()),
            blend: r.emotion_blend.as_ref(),
            vivid: r.vivid_expression.as_ref().map(|v| v.value()),
            long: r.long_text_mode.as_ref().map(|v| v.value()),
            speed: r.speed,
            seed: r.random_seed,
            markup: r.input_type.as_ref().map(|_| false),
            emphasis: None,
        }
    }
}
impl<'a> From<&'a TtsRequestTextVoice9c5ed44a> for Binding<'a> {
    fn from(r: &'a TtsRequestTextVoice9c5ed44a) -> Self {
        Self {
            voice: Some(r.voice.as_str()),
            style: r.voice_style.as_deref(),
            processing: r.audio_processing_profile.as_deref(),
            delivery: r.delivery_mode.as_ref().map(|v| v.value()),
            language: r.language.as_ref().map(|v| v.value()),
            emotion: r.emotion_source.as_ref().map(|v| v.value()),
            blend: r.emotion_blend.as_ref(),
            vivid: r.vivid_expression.as_ref().map(|v| v.value()),
            long: r.long_text_mode.as_ref().map(|v| v.value()),
            speed: r.speed,
            seed: r.random_seed,
            markup: r.input_type.as_ref().map(|_| false),
            emphasis: None,
        }
    }
}
impl<'a> From<&'a TtsRequestObject42a4f93cSegmentsItemTextVoicef8490aae> for Binding<'a> {
    fn from(r: &'a TtsRequestObject42a4f93cSegmentsItemTextVoicef8490aae) -> Self {
        Self {
            voice: Some(r.voice.as_str()),
            style: r.voice_style.as_deref(),
            processing: r.audio_processing_profile.as_deref(),
            delivery: r.delivery_mode.as_ref().map(|v| v.value()),
            language: r.language.as_ref().map(|v| v.value()),
            emotion: r.emotion_source.as_ref().map(|v| v.value()),
            blend: r.emotion_blend.as_ref(),
            vivid: r.vivid_expression.as_ref().map(|v| v.value()),
            long: r.long_text_mode.as_ref().map(|v| v.value()),
            speed: r.speed,
            seed: r.random_seed,
            markup: Some(true),
            emphasis: r.reference_emphasis.as_ref().map(|v| v.value()),
        }
    }
}
impl<'a> From<&'a TtsRequestObject42a4f93cSegmentsItemTextVoicec00e1b14> for Binding<'a> {
    fn from(r: &'a TtsRequestObject42a4f93cSegmentsItemTextVoicec00e1b14) -> Self {
        Self {
            voice: Some(r.voice.as_str()),
            style: r.voice_style.as_deref(),
            processing: r.audio_processing_profile.as_deref(),
            delivery: r.delivery_mode.as_ref().map(|v| v.value()),
            language: r.language.as_ref().map(|v| v.value()),
            emotion: r.emotion_source.as_ref().map(|v| v.value()),
            blend: r.emotion_blend.as_ref(),
            vivid: r.vivid_expression.as_ref().map(|v| v.value()),
            long: r.long_text_mode.as_ref().map(|v| v.value()),
            speed: r.speed,
            seed: r.random_seed,
            markup: r.input_type.as_ref().map(|_| false),
            emphasis: None,
        }
    }
}
impl<'a> From<&'a TtsRequestText8f38e545TextSplitterObject1611dc76FallbackObject7f01c485>
    for Binding<'a>
{
    fn from(r: &'a TtsRequestText8f38e545TextSplitterObject1611dc76FallbackObject7f01c485) -> Self {
        Self {
            voice: Some(r.voice.as_str()),
            style: r.voice_style.as_deref(),
            processing: r.audio_processing_profile.as_deref(),
            delivery: r.delivery_mode.as_ref().map(|v| v.value()),
            language: r.language.as_ref().map(|v| v.value()),
            emotion: r.emotion_source.as_ref().map(|v| v.value()),
            blend: r.emotion_blend.as_ref(),
            vivid: r.vivid_expression.as_ref().map(|v| v.value()),
            long: r.long_text_mode.as_ref().map(|v| v.value()),
            speed: r.speed,
            seed: r.random_seed,
            markup: Some(true),
            emphasis: r.reference_emphasis.as_ref().map(|v| v.value()),
        }
    }
}
impl<'a> From<&'a TtsRequestText8f38e545TextSplitterObject1611dc76FallbackObject8e112a71>
    for Binding<'a>
{
    fn from(r: &'a TtsRequestText8f38e545TextSplitterObject1611dc76FallbackObject8e112a71) -> Self {
        Self {
            voice: Some(r.voice.as_str()),
            style: r.voice_style.as_deref(),
            processing: r.audio_processing_profile.as_deref(),
            delivery: r.delivery_mode.as_ref().map(|v| v.value()),
            language: r.language.as_ref().map(|v| v.value()),
            emotion: r.emotion_source.as_ref().map(|v| v.value()),
            blend: r.emotion_blend.as_ref(),
            vivid: r.vivid_expression.as_ref().map(|v| v.value()),
            long: r.long_text_mode.as_ref().map(|v| v.value()),
            speed: r.speed,
            seed: r.random_seed,
            markup: r.input_type.as_ref().map(|_| false),
            emphasis: None,
        }
    }
}
impl<'a> From<&'a TtsRequestText8f38e545TextSplitterObject1611dc76LookupItemObject943eda1d>
    for Binding<'a>
{
    fn from(
        r: &'a TtsRequestText8f38e545TextSplitterObject1611dc76LookupItemObject943eda1d,
    ) -> Self {
        Self {
            voice: r.voice.as_deref(),
            style: r.voice_style.as_deref(),
            processing: r.audio_processing_profile.as_deref(),
            delivery: r.delivery_mode.as_ref().map(|v| v.value()),
            language: r.language.as_ref().map(|v| v.value()),
            emotion: r.emotion_source.as_ref().map(|v| v.value()),
            blend: r.emotion_blend.as_ref(),
            vivid: r.vivid_expression.as_ref().map(|v| v.value()),
            long: r.long_text_mode.as_ref().map(|v| v.value()),
            speed: r.speed,
            seed: r.random_seed,
            markup: Some(true),
            emphasis: r.reference_emphasis.as_ref().map(|v| v.value()),
        }
    }
}
impl<'a> From<&'a TtsRequestText8f38e545TextSplitterObject1611dc76LookupItemObjectdbedc771>
    for Binding<'a>
{
    fn from(
        r: &'a TtsRequestText8f38e545TextSplitterObject1611dc76LookupItemObjectdbedc771,
    ) -> Self {
        Self {
            voice: r.voice.as_deref(),
            style: r.voice_style.as_deref(),
            processing: r.audio_processing_profile.as_deref(),
            delivery: r.delivery_mode.as_ref().map(|v| v.value()),
            language: r.language.as_ref().map(|v| v.value()),
            emotion: r.emotion_source.as_ref().map(|v| v.value()),
            blend: r.emotion_blend.as_ref(),
            vivid: r.vivid_expression.as_ref().map(|v| v.value()),
            long: r.long_text_mode.as_ref().map(|v| v.value()),
            speed: r.speed,
            seed: r.random_seed,
            markup: r.input_type.as_ref().map(|_| false),
            emphasis: None,
        }
    }
}
impl<'a> From<&'a TtsRequestText8f38e545TextSplitterObject1611dc76PlaceholdersItemObject50954e5c>
    for Binding<'a>
{
    fn from(
        r: &'a TtsRequestText8f38e545TextSplitterObject1611dc76PlaceholdersItemObject50954e5c,
    ) -> Self {
        Self {
            voice: r.voice.as_deref(),
            style: r.voice_style.as_deref(),
            processing: r.audio_processing_profile.as_deref(),
            delivery: r.delivery_mode.as_ref().map(|v| v.value()),
            language: r.language.as_ref().map(|v| v.value()),
            emotion: r.emotion_source.as_ref().map(|v| v.value()),
            blend: r.emotion_blend.as_ref(),
            vivid: r.vivid_expression.as_ref().map(|v| v.value()),
            long: r.long_text_mode.as_ref().map(|v| v.value()),
            speed: r.speed,
            seed: r.random_seed,
            markup: Some(true),
            emphasis: r.reference_emphasis.as_ref().map(|v| v.value()),
        }
    }
}
impl<'a> From<&'a TtsRequestText8f38e545TextSplitterObject1611dc76PlaceholdersItemObject87c9e6cd>
    for Binding<'a>
{
    fn from(
        r: &'a TtsRequestText8f38e545TextSplitterObject1611dc76PlaceholdersItemObject87c9e6cd,
    ) -> Self {
        Self {
            voice: r.voice.as_deref(),
            style: r.voice_style.as_deref(),
            processing: r.audio_processing_profile.as_deref(),
            delivery: r.delivery_mode.as_ref().map(|v| v.value()),
            language: r.language.as_ref().map(|v| v.value()),
            emotion: r.emotion_source.as_ref().map(|v| v.value()),
            blend: r.emotion_blend.as_ref(),
            vivid: r.vivid_expression.as_ref().map(|v| v.value()),
            long: r.long_text_mode.as_ref().map(|v| v.value()),
            speed: r.speed,
            seed: r.random_seed,
            markup: r.input_type.as_ref().map(|_| false),
            emphasis: None,
        }
    }
}

pub(super) fn prepare(
    request: &TtsRequest,
    mode: Option<Mode>,
) -> Result<Settings, TransportError> {
    let job = matches!(
        request,
        TtsRequest::Object42a4f93c(_)
            | TtsRequest::Object9cd7c2ee(_)
            | TtsRequest::Text8f38e545(_)
            | TtsRequest::Textb838f1b5(_)
    );
    let mode = mode.unwrap_or(if job { Mode::Async } else { Mode::Stream });
    let flash = match request {
        TtsRequest::TextVoicee296d426(r) => {
            r.latency_optimization.as_ref().map(|v| v.value()) == Some("maximum")
        }
        TtsRequest::TextVoice9c5ed44a(r) => {
            r.latency_optimization.as_ref().map(|v| v.value()) == Some("maximum")
        }
        _ => false,
    };
    if job && mode != Mode::Async {
        return Err(failure(
            "Vocu segments and text splitting require async synthesis",
        ));
    }
    if mode == Mode::Async && flash {
        return Err(failure(
            "Vocu async synthesis does not support flash latency optimization",
        ));
    }
    let subtitles = matches!(
        request,
        TtsRequest::Object9cd7c2ee(_)
            | TtsRequest::TextVoice2a721534(_)
            | TtsRequest::Textb838f1b5(_)
    );
    let body = match request {
        TtsRequest::TextVoicee296d426(r) => single(r.into(), &r.text, mode, flash, subtitles),
        TtsRequest::TextVoice2a721534(r) => single(r.into(), &r.text, mode, flash, subtitles),
        TtsRequest::TextVoice9c5ed44a(r) => single(r.into(), &r.text, mode, flash, subtitles),
        TtsRequest::Object42a4f93c(r) => {
            let contents: Vec<String> = r
                .segments
                .iter()
                .map(|s| match s {
                    TtsRequestObject42a4f93cSegmentsItem::TextVoicef8490aae(s) => {
                        speech(s.into(), &s.text)
                    }
                    TtsRequestObject42a4f93cSegmentsItem::TextVoicec00e1b14(s) => {
                        speech(s.into(), &s.text)
                    }
                })
                .collect();
            format!("{{\"contents\":[{}],\"srt\":false}}", contents.join(","))
        }
        TtsRequest::Object9cd7c2ee(r) => {
            let contents: Vec<String> = r
                .segments
                .iter()
                .map(|s| speech(s.into(), &s.text))
                .collect();
            format!("{{\"contents\":[{}],\"srt\":true}}", contents.join(","))
        }
        TtsRequest::Text8f38e545(r) => {
            use TtsRequestText8f38e545TextSplitter as Splitter;
            let splitter = match &r.text_splitter {
                Splitter::Object1611dc76(s) => splitter(
                    Some(s.brackets.as_slice()),
                    s.fallback.as_ref().map(fallback),
                    s.placeholders
                        .as_ref()
                        .map(|values| values.iter().map(placeholder).collect()),
                    s.lookup
                        .as_ref()
                        .map(|values| values.iter().map(lookup).collect()),
                )?,
                Splitter::Objectda2887fb(s) => splitter(
                    s.brackets.as_deref(),
                    Some(fallback(&s.fallback)),
                    s.placeholders
                        .as_ref()
                        .map(|values| values.iter().map(placeholder).collect()),
                    s.lookup
                        .as_ref()
                        .map(|values| values.iter().map(lookup).collect()),
                )?,
                Splitter::Object2a1f0164(s) => splitter(
                    s.brackets.as_deref(),
                    s.fallback.as_ref().map(fallback),
                    Some(s.placeholders.iter().map(placeholder).collect()),
                    s.lookup
                        .as_ref()
                        .map(|values| values.iter().map(lookup).collect()),
                )?,
                Splitter::Object0ad93c7b(s) => saved(&s.id),
            };
            splitter_request(&r.text, &splitter, false)
        }
        TtsRequest::Textb838f1b5(r) => {
            use TtsRequestTextb838f1b5TextSplitter as Splitter;
            let splitter = match &r.text_splitter {
                Splitter::Objectc0dd7752(s) => splitter(
                    Some(s.brackets.as_slice()),
                    s.fallback.as_ref().map(|v| v.into()),
                    s.placeholders.as_ref().map(|values| {
                        values
                            .iter()
                            .map(|r| Placeholder {
                                marker: &r.marker,
                                binding: r.into(),
                            })
                            .collect()
                    }),
                    s.lookup.as_ref().map(|values| {
                        values
                            .iter()
                            .map(|r| Lookup {
                                tags: &r.tags,
                                binding: r.into(),
                            })
                            .collect()
                    }),
                )?,
                Splitter::Object6b7b3424(s) => splitter(
                    s.brackets.as_deref(),
                    Some((&s.fallback).into()),
                    s.placeholders.as_ref().map(|values| {
                        values
                            .iter()
                            .map(|r| Placeholder {
                                marker: &r.marker,
                                binding: r.into(),
                            })
                            .collect()
                    }),
                    s.lookup.as_ref().map(|values| {
                        values
                            .iter()
                            .map(|r| Lookup {
                                tags: &r.tags,
                                binding: r.into(),
                            })
                            .collect()
                    }),
                )?,
                Splitter::Object94322b13(s) => splitter(
                    s.brackets.as_deref(),
                    s.fallback.as_ref().map(|v| v.into()),
                    Some(
                        s.placeholders
                            .iter()
                            .map(|r| Placeholder {
                                marker: &r.marker,
                                binding: r.into(),
                            })
                            .collect(),
                    ),
                    s.lookup.as_ref().map(|values| {
                        values
                            .iter()
                            .map(|r| Lookup {
                                tags: &r.tags,
                                binding: r.into(),
                            })
                            .collect()
                    }),
                )?,
                Splitter::Object0ad93c7b(s) => saved(&s.id),
            };
            splitter_request(&r.text, &splitter, true)
        }
    };
    Ok(Settings { body, mode })
}

fn single(binding: Binding<'_>, text: &str, mode: Mode, flash: bool, subtitles: bool) -> String {
    if mode == Mode::Async {
        return format!(
            "{{\"contents\":[{}],\"srt\":{subtitles}}}",
            speech(binding, text)
        );
    }
    let mut wire = binding.wire(true);
    wire.pop();
    wire.push_str(",\"text\":");
    json::quote(text, &mut wire);
    wire.push_str(&format!(
        ",\"flash\":{flash},\"srt\":{subtitles},\"stream\":true,\"direct_stream\":{}}}",
        mode == Mode::Stream
    ));
    wire
}
fn speech(binding: Binding<'_>, text: &str) -> String {
    let mut wire = binding.wire(true);
    wire.pop();
    wire.push_str(",\"type\":\"text\",\"text\":");
    json::quote(text, &mut wire);
    wire.push('}');
    wire
}
fn saved(id: &str) -> String {
    let mut wire = String::from("\"splitterId\":");
    json::quote(id, &mut wire);
    wire
}
fn splitter_request(text: &str, splitter: &str, subtitles: bool) -> String {
    let mut wire = String::from("{\"text\":");
    json::quote(text, &mut wire);
    wire.push_str(&format!(",{splitter},\"srt\":{subtitles}}}"));
    wire
}

struct Placeholder<'a> {
    marker: &'a str,
    binding: Binding<'a>,
}
struct Lookup<'a> {
    tags: &'a [TtsRequestText8f38e545TextSplitterObject1611dc76LookupItemObject943eda1dTagsItem],
    binding: Binding<'a>,
}
fn fallback(value: &TtsRequestText8f38e545TextSplitterObject1611dc76Fallback) -> Binding<'_> {
    match value {
        TtsRequestText8f38e545TextSplitterObject1611dc76Fallback::Object7f01c485(r) => r.into(),
        TtsRequestText8f38e545TextSplitterObject1611dc76Fallback::Object8e112a71(r) => r.into(),
    }
}
fn placeholder(
    value: &TtsRequestText8f38e545TextSplitterObject1611dc76PlaceholdersItem,
) -> Placeholder<'_> {
    match value {
        TtsRequestText8f38e545TextSplitterObject1611dc76PlaceholdersItem::Object50954e5c(r) => {
            Placeholder {
                marker: &r.marker,
                binding: r.into(),
            }
        }
        TtsRequestText8f38e545TextSplitterObject1611dc76PlaceholdersItem::Object87c9e6cd(r) => {
            Placeholder {
                marker: &r.marker,
                binding: r.into(),
            }
        }
    }
}
fn lookup(value: &TtsRequestText8f38e545TextSplitterObject1611dc76LookupItem) -> Lookup<'_> {
    match value {
        TtsRequestText8f38e545TextSplitterObject1611dc76LookupItem::Object943eda1d(r) => Lookup {
            tags: &r.tags,
            binding: r.into(),
        },
        TtsRequestText8f38e545TextSplitterObject1611dc76LookupItem::Objectdbedc771(r) => Lookup {
            tags: &r.tags,
            binding: r.into(),
        },
    }
}

fn splitter(
    brackets: Option<&[TtsRequestText8f38e545TextSplitterObject1611dc76BracketsItem]>,
    fallback: Option<Binding<'_>>,
    placeholders: Option<Vec<Placeholder<'_>>>,
    lookup: Option<Vec<Lookup<'_>>>,
) -> Result<String, TransportError> {
    // These native objects are ordered rules, not alphabetically sorted records.
    let mut fields = Vec::new();
    let mut markers = BTreeSet::new();
    for rule in placeholders.unwrap_or_default() {
        let marker = rule.marker;
        if matches!(marker, "splitterMarks" | "lookupTable" | "fallbackConfig")
            || !markers.insert(marker)
        {
            return Err(failure(
                "Vocu splitter markers must be unique and cannot use reserved protocol keys",
            ));
        }
        let mut field = String::new();
        json::quote(marker, &mut field);
        field.push(':');
        field.push_str(&rule.binding.wire(false));
        fields.push(field);
    }
    if let Some(brackets) = brackets {
        let marks: Vec<String> = brackets
            .iter()
            .map(|pair| {
                let mut value = String::new();
                json::quote(&format!("{}{}", pair.open, pair.close), &mut value);
                value
            })
            .collect();
        fields.push(format!("\"splitterMarks\":[{}]", marks.join(",")));
    }
    if let Some(fallback) = fallback {
        fields.push(format!("\"fallbackConfig\":{}", fallback.wire(false)));
    }
    if let Some(lookup) = lookup {
        let mut entries = Vec::new();
        for (index, rule) in lookup.into_iter().enumerate() {
            let mut wire = rule.binding.wire(false);
            wire.pop();
            if wire.len() > 1 {
                wire.push(',');
            }
            wire.push_str("\"tags\":[");
            for (index, tag) in rule.tags.iter().enumerate() {
                if index > 0 {
                    wire.push(',');
                }
                use TtsRequestText8f38e545TextSplitterObject1611dc76LookupItemObject943eda1dTagsItem as Tag;
                match tag {
                    Tag::String(value) => json::quote(value, &mut wire),
                    Tag::Array(values) => {
                        wire.push('[');
                        for (index, value) in values.iter().enumerate() {
                            if index > 0 {
                                wire.push(',');
                            }
                            json::quote(value, &mut wire);
                        }
                        wire.push(']');
                    }
                }
            }
            wire.push_str("]}");
            entries.push(format!("\"entry{index}\":{wire}"));
        }
        fields.push(format!("\"lookupTable\":{{{}}}", entries.join(",")));
    }
    Ok(format!("\"splitter\":{{{}}}", fields.join(",")))
}
