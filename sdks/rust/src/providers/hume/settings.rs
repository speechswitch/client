use super::protocol::failure;
use crate::{
    generated::hume::*,
    http::TransportError,
    runtime::{InputStream, JsonValue, StreamingInput, ValidationError},
};
use std::{
    any::Any,
    collections::BTreeMap,
    pin::Pin,
    task::{Context, Poll},
};

pub(super) type Map = BTreeMap<String, JsonValue>;
pub(super) type Validator =
    Box<dyn Fn(&dyn Any, Option<&str>) -> Result<(), ValidationError> + Send>;
pub(super) struct Settings {
    pub body: Map,
    pub input: Option<StreamingInput<Map>>,
    pub version: &'static str,
    pub format: &'static str,
    pub instant: bool,
    pub metadata: bool,
    pub kinds: Vec<&'static str>,
    pub prior_id: Option<String>,
    pub temperature: Option<f64>,
}
enum Content {
    Text(String),
    Directed(Vec<TtsRequestOctave1TurnsContextBeforeTurnsTurnsItem>),
    Turns(Vec<TtsRequestOctave2TurnsContextBeforeTurnsTurnsItem>),
    LiveText(StreamingInput<TtsRequestOctave1StreamingTextTextItem>),
    LiveDirected(StreamingInput<TtsRequestOctave1StreamingTurnsTurnsItem>),
    LiveTurns(StreamingInput<TtsRequestOctave2StreamingTurnsTurnsItem>),
}
enum Before {
    Prior(TtsRequestOctave1TextContextBeforeObject),
    Text(TtsRequestOctave1TextContextBefore),
    Directed(TtsRequestOctave1TurnsContextBefore),
    Turns(TtsRequestOctave2TurnsContextBefore),
}
struct Parts {
    version: &'static str,
    output: TtsRequestOctave1TextOutput,
    speed: Option<f64>,
    silence: Option<f64>,
    temperature: Option<f64>,
    split: Option<TtsRequestOctave1TextSplitTurns>,
    latency: Option<TtsRequestOctave1TurnsLatencyOptimization>,
    voice: Option<Map>,
    description: Option<String>,
    speakers: Vec<TtsRequestOctave1TurnsSpeakersItem>,
    timestamps: Option<TtsRequestOctave2TurnsTimestampGranularity>,
    input: Content,
    before: Option<Before>,
}
struct Delivery {
    speed: f64,
    silence: f64,
    voice: Option<Map>,
    description: Option<String>,
    speakers: BTreeMap<String, Map>,
}

pub(super) fn settings(
    request: TtsRequest,
    validate: Validator,
) -> Result<Settings, TransportError> {
    // Explicit representation conversion; generated validation owns all schema restrictions.
    let p = match request {
        TtsRequest::Octave1Text(v) => Parts {
            version: "1",
            output: v.output,
            speed: v.speed,
            silence: v.trailing_silence_ms,
            temperature: v.temperature,
            split: v.split_turns,
            latency: None,
            voice: None,
            description: v.voice_description,
            speakers: Vec::new(),
            timestamps: None,
            input: Content::Text(v.text),
            before: v.context_before.map(Before::Text),
        },
        TtsRequest::Octave1StreamingText(v) => Parts {
            version: "1",
            output: v.output,
            speed: v.speed,
            silence: v.trailing_silence_ms,
            temperature: v.temperature,
            split: None,
            latency: None,
            voice: None,
            description: v.voice_description,
            speakers: Vec::new(),
            timestamps: None,
            input: Content::LiveText(v.text),
            before: v.context_before.map(Before::Prior),
        },
        TtsRequest::Octave1Turns(v) => Parts {
            version: "1",
            output: v.output,
            speed: v.speed,
            silence: v.trailing_silence_ms,
            temperature: v.temperature,
            split: v.split_turns,
            latency: v.latency_optimization,
            voice: None,
            description: None,
            speakers: v.speakers,
            timestamps: None,
            input: Content::Directed(v.turns),
            before: v.context_before.map(Before::Directed),
        },
        TtsRequest::Octave1StreamingTurns(v) => Parts {
            version: "1",
            output: v.output,
            speed: v.speed,
            silence: v.trailing_silence_ms,
            temperature: v.temperature,
            split: None,
            latency: v.latency_optimization,
            voice: None,
            description: None,
            speakers: v.speakers,
            timestamps: None,
            input: Content::LiveDirected(v.turns),
            before: v.context_before.map(Before::Prior),
        },
        TtsRequest::Octave1TextVoice(v) => Parts {
            version: "1",
            output: v.output,
            speed: v.speed,
            silence: v.trailing_silence_ms,
            temperature: v.temperature,
            split: v.split_turns,
            latency: v.latency_optimization,
            voice: Some(voice("id", v.voice, v.voice_source)),
            description: v.instructions,
            speakers: Vec::new(),
            timestamps: None,
            input: Content::Text(v.text),
            before: v.context_before.map(Before::Text),
        },
        TtsRequest::Octave1StreamingTextVoice(v) => Parts {
            version: "1",
            output: v.output,
            speed: v.speed,
            silence: v.trailing_silence_ms,
            temperature: v.temperature,
            split: None,
            latency: v.latency_optimization,
            voice: Some(voice("id", v.voice, v.voice_source)),
            description: v.instructions,
            speakers: Vec::new(),
            timestamps: None,
            input: Content::LiveText(v.text),
            before: v.context_before.map(Before::Prior),
        },
        TtsRequest::Octave1TextVoiceName(v) => Parts {
            version: "1",
            output: v.output,
            speed: v.speed,
            silence: v.trailing_silence_ms,
            temperature: v.temperature,
            split: v.split_turns,
            latency: v.latency_optimization,
            voice: Some(voice("name", v.voice_name, v.voice_source)),
            description: v.instructions,
            speakers: Vec::new(),
            timestamps: None,
            input: Content::Text(v.text),
            before: v.context_before.map(Before::Text),
        },
        TtsRequest::Octave1StreamingTextVoiceName(v) => Parts {
            version: "1",
            output: v.output,
            speed: v.speed,
            silence: v.trailing_silence_ms,
            temperature: v.temperature,
            split: None,
            latency: v.latency_optimization,
            voice: Some(voice("name", v.voice_name, v.voice_source)),
            description: v.instructions,
            speakers: Vec::new(),
            timestamps: None,
            input: Content::LiveText(v.text),
            before: v.context_before.map(Before::Prior),
        },
        TtsRequest::Octave2Turns(v) => Parts {
            version: "2",
            output: v.output,
            speed: v.speed,
            silence: v.trailing_silence_ms,
            temperature: v.temperature,
            split: v.split_turns,
            latency: v.latency_optimization,
            voice: None,
            description: None,
            speakers: v.speakers,
            timestamps: v.timestamp_granularity,
            input: Content::Turns(v.turns),
            before: v.context_before.map(Before::Turns),
        },
        TtsRequest::Octave2StreamingTurns(v) => Parts {
            version: "2",
            output: v.output,
            speed: v.speed,
            silence: v.trailing_silence_ms,
            temperature: v.temperature,
            split: None,
            latency: v.latency_optimization,
            voice: None,
            description: None,
            speakers: v.speakers,
            timestamps: v.timestamp_granularity,
            input: Content::LiveTurns(v.turns),
            before: v.context_before.map(Before::Prior),
        },
        TtsRequest::Octave2TextVoice(v) => Parts {
            version: "2",
            output: v.output,
            speed: v.speed,
            silence: v.trailing_silence_ms,
            temperature: v.temperature,
            split: v.split_turns,
            latency: v.latency_optimization,
            voice: Some(voice("id", v.voice, v.voice_source)),
            description: None,
            speakers: Vec::new(),
            timestamps: v.timestamp_granularity,
            input: Content::Text(v.text),
            before: v.context_before.map(Before::Text),
        },
        TtsRequest::Octave2StreamingTextVoice(v) => Parts {
            version: "2",
            output: v.output,
            speed: v.speed,
            silence: v.trailing_silence_ms,
            temperature: v.temperature,
            split: None,
            latency: v.latency_optimization,
            voice: Some(voice("id", v.voice, v.voice_source)),
            description: None,
            speakers: Vec::new(),
            timestamps: v.timestamp_granularity,
            input: Content::LiveText(v.text),
            before: v.context_before.map(Before::Prior),
        },
        TtsRequest::Octave2TextVoiceName(v) => Parts {
            version: "2",
            output: v.output,
            speed: v.speed,
            silence: v.trailing_silence_ms,
            temperature: v.temperature,
            split: v.split_turns,
            latency: v.latency_optimization,
            voice: Some(voice("name", v.voice_name, v.voice_source)),
            description: None,
            speakers: Vec::new(),
            timestamps: v.timestamp_granularity,
            input: Content::Text(v.text),
            before: v.context_before.map(Before::Text),
        },
        TtsRequest::Octave2StreamingTextVoiceName(v) => Parts {
            version: "2",
            output: v.output,
            speed: v.speed,
            silence: v.trailing_silence_ms,
            temperature: v.temperature,
            split: None,
            latency: v.latency_optimization,
            voice: Some(voice("name", v.voice_name, v.voice_source)),
            description: None,
            speakers: Vec::new(),
            timestamps: v.timestamp_granularity,
            input: Content::LiveText(v.text),
            before: v.context_before.map(Before::Prior),
        },
    };
    let mut d = Delivery {
        speed: p.speed.unwrap_or(1.0),
        silence: p.silence.unwrap_or(0.0) / 1000.0,
        voice: p.voice,
        description: p.description,
        speakers: BTreeMap::new(),
    };
    for speaker in p.speakers {
        let (alias, selected) = match speaker {
            TtsRequestOctave1TurnsSpeakersItem::Object9c8ccfab(v) => {
                (v.alias, voice("id", v.voice, v.voice_source))
            }
            TtsRequestOctave1TurnsSpeakersItem::Objected4f427b(v) => {
                (v.alias, voice("name", v.voice_name, v.voice_source))
            }
        };
        if d.speakers.insert(alias, selected).is_some() {
            return Err(failure("Hume speaker aliases must be unique"));
        }
    }
    let instant = (d.voice.is_some() || !d.speakers.is_empty())
        && !p.latency.is_some_and(|v| v.value() == "none");
    let metadata = p.timestamps.is_some();
    let kinds = match p.timestamps {
        None => vec![],
        Some(TtsRequestOctave2TurnsTimestampGranularity::Word(_)) => vec!["word"],
        Some(TtsRequestOctave2TurnsTimestampGranularity::Phoneme(_)) => vec!["phoneme"],
        Some(TtsRequestOctave2TurnsTimestampGranularity::Array(v)) => {
            v.iter().map(|v| v.value()).collect()
        }
    };
    let format = p.output.format.value();
    let mut body = Map::from([
        ("version".into(), JsonValue::String(p.version.into())),
        (
            "format".into(),
            JsonValue::Object(Map::from([(
                "type".into(),
                JsonValue::String(format.into()),
            )])),
        ),
        (
            "include_timestamp_types".into(),
            JsonValue::Array(
                kinds
                    .iter()
                    .map(|v| JsonValue::String((*v).into()))
                    .collect(),
            ),
        ),
        ("num_generations".into(), JsonValue::Number(1.0)),
        (
            "split_utterances".into(),
            JsonValue::Bool(p.split.map_or(true, |v| v.value())),
        ),
        ("strip_headers".into(), JsonValue::Bool(true)),
        ("instant_mode".into(), JsonValue::Bool(instant)),
    ]);
    if let Some(v) = p.temperature {
        body.insert("temperature".into(), JsonValue::Number(v));
    }
    let mut prior_id = None;
    if let Some(before) = p.before {
        let before = match before {
            Before::Text(TtsRequestOctave1TextContextBefore::Object(v))
            | Before::Directed(TtsRequestOctave1TurnsContextBefore::Object(v))
            | Before::Turns(TtsRequestOctave2TurnsContextBefore::Object(v)) => Before::Prior(v),
            v => v,
        };
        let context = match before {
            Before::Prior(v) => {
                let id = v.request_ids.into_iter().next().unwrap();
                if id.is_empty() {
                    return Err(failure(
                        "Hume continuation requires a non-empty generation ID",
                    ));
                }
                prior_id = Some(id.clone());
                Map::from([("generation_id".into(), JsonValue::String(id))])
            }
            Before::Text(TtsRequestOctave1TextContextBefore::Text(v)) => Map::from([(
                "utterances".into(),
                JsonValue::Array(vec![JsonValue::Object(d.utterance(
                    v.text,
                    d.voice.clone(),
                    d.description.clone(),
                    None,
                    None,
                ))]),
            )]),
            Before::Directed(TtsRequestOctave1TurnsContextBefore::Turns(v)) => Map::from([(
                "utterances".into(),
                JsonValue::Array(
                    v.turns
                        .into_iter()
                        .map(|v| d.directed(v).map(JsonValue::Object))
                        .collect::<Result<_, _>>()?,
                ),
            )]),
            Before::Turns(TtsRequestOctave2TurnsContextBefore::Turns(v)) => Map::from([(
                "utterances".into(),
                JsonValue::Array(
                    v.turns
                        .into_iter()
                        .map(|v| d.turn(v).map(JsonValue::Object))
                        .collect::<Result<_, _>>()?,
                ),
            )]),
            _ => unreachable!(),
        };
        body.insert("context".into(), JsonValue::Object(context));
    }
    let input: Option<StreamingInput<Map>> = match p.input {
        Content::LiveText(source) => Some(Box::pin(Mapped {
            source,
            validate,
            delivery: d,
            field: "text",
            convert: Delivery::text,
        })),
        Content::LiveDirected(source) => Some(Box::pin(Mapped {
            source,
            validate,
            delivery: d,
            field: "turns",
            convert: Delivery::directed_message,
        })),
        Content::LiveTurns(source) => Some(Box::pin(Mapped {
            source,
            validate,
            delivery: d,
            field: "turns",
            convert: Delivery::turn_message,
        })),
        v => {
            let utterances = match v {
                Content::Text(v) => vec![JsonValue::Object(d.utterance(
                    v,
                    d.voice.clone(),
                    d.description.clone(),
                    None,
                    None,
                ))],
                Content::Directed(v) => v
                    .into_iter()
                    .map(|v| d.directed(v).map(JsonValue::Object))
                    .collect::<Result<_, _>>()?,
                Content::Turns(v) => v
                    .into_iter()
                    .map(|v| d.turn(v).map(JsonValue::Object))
                    .collect::<Result<_, _>>()?,
                _ => unreachable!(),
            };
            body.insert("utterances".into(), JsonValue::Array(utterances));
            None
        }
    };
    Ok(Settings {
        body,
        input,
        version: p.version,
        format,
        instant,
        metadata,
        kinds,
        prior_id,
        temperature: p.temperature,
    })
}
fn voice(
    key: &str,
    value: String,
    source: Option<TtsRequestOctave1TurnsSpeakersItemObject9c8ccfabVoiceSource>,
) -> Map {
    Map::from([
        (key.into(), JsonValue::String(value)),
        (
            "provider".into(),
            JsonValue::String(
                if source.is_some_and(|v| v.value() == "catalog") {
                    "HUME_AI"
                } else {
                    "CUSTOM_VOICE"
                }
                .into(),
            ),
        ),
    ])
}
impl Delivery {
    fn utterance(
        &self,
        text: String,
        voice: Option<Map>,
        description: Option<String>,
        speed: Option<f64>,
        silence: Option<f64>,
    ) -> Map {
        let mut fields = Map::from([
            ("text".into(), JsonValue::String(text)),
            (
                "speed".into(),
                JsonValue::Number(speed.unwrap_or(self.speed)),
            ),
            (
                "trailing_silence".into(),
                JsonValue::Number(silence.map_or(self.silence, |v| v / 1000.0)),
            ),
        ]);
        if let Some(v) = voice {
            fields.insert("voice".into(), JsonValue::Object(v));
        }
        if let Some(v) = description {
            fields.insert("description".into(), JsonValue::String(v));
        }
        fields
    }
    fn directed(
        &self,
        v: TtsRequestOctave1TurnsContextBeforeTurnsTurnsItem,
    ) -> Result<Map, TransportError> {
        let voice = self
            .speakers
            .get(&v.speaker)
            .ok_or_else(|| failure(&format!("Unknown Hume speaker: {}", v.speaker)))?
            .clone();
        Ok(self.utterance(
            v.text,
            Some(voice),
            v.instructions,
            v.speed,
            v.trailing_silence_ms,
        ))
    }
    fn turn(
        &self,
        v: TtsRequestOctave2TurnsContextBeforeTurnsTurnsItem,
    ) -> Result<Map, TransportError> {
        let voice = self
            .speakers
            .get(&v.speaker)
            .ok_or_else(|| failure(&format!("Unknown Hume speaker: {}", v.speaker)))?
            .clone();
        Ok(self.utterance(v.text, Some(voice), None, v.speed, v.trailing_silence_ms))
    }
    fn text(&self, v: TtsRequestOctave1StreamingTextTextItem) -> Result<Map, TransportError> {
        match v {
            TtsRequestOctave1StreamingTextTextItem::String(v) => {
                // Bare async strings cannot yet carry schema annotations; match TS UTF-16 length.
                if v.encode_utf16().count() > 5000 {
                    return Err(failure(
                        "Hume text must not exceed 5000 characters per utterance",
                    ));
                }
                Ok(self.utterance(v, self.voice.clone(), self.description.clone(), None, None))
            }
            TtsRequestOctave1StreamingTextTextItem::Flush(_) => {
                Ok(Map::from([("flush".into(), JsonValue::Bool(true))]))
            }
        }
    }
    fn directed_message(
        &self,
        v: TtsRequestOctave1StreamingTurnsTurnsItem,
    ) -> Result<Map, TransportError> {
        match v {
            TtsRequestOctave1StreamingTurnsTurnsItem::Text(v) => self.directed(v),
            TtsRequestOctave1StreamingTurnsTurnsItem::Flush(_) => {
                Ok(Map::from([("flush".into(), JsonValue::Bool(true))]))
            }
        }
    }
    fn turn_message(
        &self,
        v: TtsRequestOctave2StreamingTurnsTurnsItem,
    ) -> Result<Map, TransportError> {
        match v {
            TtsRequestOctave2StreamingTurnsTurnsItem::Text(v) => self.turn(v),
            TtsRequestOctave2StreamingTurnsTurnsItem::Flush(_) => {
                Ok(Map::from([("flush".into(), JsonValue::Bool(true))]))
            }
        }
    }
}
struct Mapped<T> {
    source: StreamingInput<T>,
    validate: Validator,
    delivery: Delivery,
    field: &'static str,
    convert: fn(&Delivery, T) -> Result<Map, TransportError>,
}
impl<T: 'static> InputStream<Map> for Mapped<T> {
    fn poll_next(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
    ) -> Poll<Option<Result<Map, TransportError>>> {
        let s = self.get_mut();
        match s.source.as_mut().poll_next(cx) {
            Poll::Ready(Some(Ok(value))) => {
                if let Err(e) = (s.validate)(&value, Some(s.field)) {
                    return Poll::Ready(Some(Err(Box::new(e))));
                }
                Poll::Ready(Some((s.convert)(&s.delivery, value)))
            }
            Poll::Ready(Some(Err(e))) => Poll::Ready(Some(Err(e))),
            Poll::Ready(None) => Poll::Ready(None),
            Poll::Pending => Poll::Pending,
        }
    }
}
