use super::*;
use crate::{
    generated::{auth::AuthCartesia, hume::*, hume_output::*},
    http::HttpResponse,
    msgpack::{tests::fixture, Value},
    runtime::{InputStream, StreamingInput},
    websocket::{Message, WebSocketLike},
};
use std::{
    collections::{BTreeMap, VecDeque},
    future::Future,
    pin::Pin,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex,
    },
    task::{Context, Poll, Wake, Waker},
};
mod boundary;
mod http_tests;
mod socket_tests;

#[derive(Default)]
struct Counts {
    reads: AtomicUsize,
    drops: AtomicUsize,
    wakes: AtomicUsize,
}
impl Wake for Counts {
    fn wake(self: Arc<Self>) {
        self.wake_by_ref()
    }
    fn wake_by_ref(self: &Arc<Self>) {
        self.wakes.fetch_add(1, Ordering::SeqCst);
    }
}
struct Source<T> {
    values: VecDeque<Result<T, TransportError>>,
    counts: Arc<Counts>,
    stall: bool,
    trace: Arc<Mutex<Vec<&'static str>>>,
}
impl<T: Send + Unpin> InputStream<T> for Source<T> {
    fn poll_next(
        self: Pin<&mut Self>,
        _: &mut Context<'_>,
    ) -> Poll<Option<Result<T, TransportError>>> {
        let s = self.get_mut();
        s.counts.reads.fetch_add(1, Ordering::SeqCst);
        match s.values.pop_front() {
            Some(v) => Poll::Ready(Some(v)),
            None if s.stall => Poll::Pending,
            None => Poll::Ready(None),
        }
    }
}
impl<T> Drop for Source<T> {
    fn drop(&mut self) {
        self.counts.drops.fetch_add(1, Ordering::SeqCst);
        self.trace.lock().unwrap().push("input");
    }
}
fn source<T: Send + Unpin + 'static>(values: Vec<T>) -> StreamingInput<T> {
    Box::pin(Source {
        values: values.into_iter().map(Ok).collect(),
        counts: Arc::default(),
        stall: false,
        trace: Arc::default(),
    })
}
fn ready<T>(future: impl Future<Output = T>) -> T {
    let mut future = std::pin::pin!(future);
    let counts = Arc::new(Counts::default());
    let waker = Waker::from(counts.clone());
    let mut cx = Context::from_waker(&waker);
    for _ in 0..10000 {
        let before = counts.wakes.load(Ordering::SeqCst);
        match future.as_mut().poll(&mut cx) {
            Poll::Ready(v) => return v,
            Poll::Pending => assert!(
                counts.wakes.load(Ordering::SeqCst) > before,
                "pending without wake"
            ),
        }
    }
    panic!("did not complete")
}
fn next(stream: &mut Stream) -> Option<Result<SynthesisItem, TransportError>> {
    ready(poll_fn(|cx| Pin::new(&mut *stream).poll_next(cx)))
}
fn collect(stream: &mut Stream) -> Result<Vec<Value>, TransportError> {
    let mut result = vec![];
    while let Some(v) = next(stream) {
        result.push(normalized(v?));
    }
    Ok(result)
}
fn normalized(item: SynthesisItem) -> Value {
    match item {
        SynthesisItem::Bytes(v) => Value::Binary(v),
        SynthesisItem::Timeline(v) => {
            let marks = v
                .timestamps
                .into_iter()
                .map(|v| {
                    let mut mark = BTreeMap::from([
                        ("kind".into(), Value::String(v.kind.value().into())),
                        ("value".into(), Value::String(v.value)),
                        ("startTimeMs".into(), Value::Number(v.start_time_ms)),
                    ]);
                    if let Some(end) = v.end_time_ms {
                        mark.insert("endTimeMs".into(), Value::Number(end));
                    }
                    Value::Map(mark)
                })
                .collect();
            let mut fields = BTreeMap::from([
                (
                    "correlation".into(),
                    Value::String(v.correlation.value().into()),
                ),
                ("correlationId".into(), Value::String(v.correlation_id)),
                ("generationId".into(), Value::String(v.generation_id)),
                ("requestId".into(), Value::String(v.request_id)),
                ("timestamps".into(), Value::Array(marks)),
            ]);
            if let Some(audio) = v.audio {
                fields.insert("audio".into(), Value::Binary(audio));
            }
            if let Some(index) = v.chunk_index {
                fields.insert("chunkIndex".into(), Value::Number(index));
            }
            if let Some(last) = v.is_last_chunk {
                fields.insert("isLastChunk".into(), Value::Bool(last.value()));
            }
            if let Some(id) = v.input_group_id {
                fields.insert("inputGroupId".into(), Value::String(id));
            }
            Value::Map(fields)
        }
    }
}
fn fixtures() -> BTreeMap<String, Raw<'static>> {
    Raw::parse_exact(include_str!("../../../../fixtures/hume.json"))
        .unwrap()
        .object()
        .unwrap()
}
fn request() -> TtsRequestOctave2TextVoice {
    TtsRequestOctave2TextVoice {
        model: Default::default(),
        text: "Hello".into(),
        voice: "saved".into(),
        voice_source: None,
        output: TtsRequestOctave1TextOutput {
            format: TtsRequestOctave1TextOutputFormat::Pcm(Default::default()),
        },
        context_before: None,
        latency_optimization: None,
        speed: None,
        split_turns: None,
        temperature: None,
        timestamp_granularity: None,
        trailing_silence_ms: None,
    }
}
fn streaming(input: StreamingInput<TextInput>) -> TtsRequest {
    TtsRequest::Octave2StreamingTextVoice(TtsRequestOctave2StreamingTextVoice {
        model: Default::default(),
        text: input,
        voice: "saved".into(),
        voice_source: None,
        output: TtsRequestOctave1TextOutput {
            format: TtsRequestOctave1TextOutputFormat::Pcm(Default::default()),
        },
        context_before: None,
        latency_optimization: None,
        speed: None,
        temperature: None,
        timestamp_granularity: None,
        trailing_silence_ms: None,
    })
}
fn fixture_request(index: usize, live: bool) -> TtsRequest {
    match (index, live) {
        (0, false) => TtsRequest::Octave1TextVoice(TtsRequestOctave1TextVoice {
            model: Default::default(),
            output: TtsRequestOctave1TextOutput {
                format: TtsRequestOctave1TextOutputFormat::Pcm(Default::default()),
            },
            speed: None,
            temperature: None,
            trailing_silence_ms: None,
            context_before: None,
            latency_optimization: None,
            split_turns: None,
            text: "Hi".into(),
            voice: "saved".into(),
            voice_source: None,
            instructions: None,
        }),
        (0, true) => TtsRequest::Octave1StreamingTextVoice(TtsRequestOctave1StreamingTextVoice {
            model: Default::default(),
            output: TtsRequestOctave1TextOutput {
                format: TtsRequestOctave1TextOutputFormat::Pcm(Default::default()),
            },
            speed: None,
            temperature: None,
            trailing_silence_ms: None,
            context_before: None,
            latency_optimization: None,
            text: source(vec![TextInput::String("Hi".into())]),
            voice: "saved".into(),
            voice_source: None,
            instructions: None,
        }),
        (1, false) => TtsRequest::Octave2TextVoiceName(TtsRequestOctave2TextVoiceName {
            model: Default::default(),
            output: TtsRequestOctave1TextOutput {
                format: TtsRequestOctave1TextOutputFormat::Mp3(Default::default()),
            },
            speed: None,
            temperature: None,
            trailing_silence_ms: None,
            context_before: None,
            latency_optimization: None,
            split_turns: None,
            timestamp_granularity: None,
            text: "Hi".into(),
            voice_name: "Ava".into(),
            voice_source: Some(
                TtsRequestOctave1TurnsSpeakersItemObject9c8ccfabVoiceSource::Catalog(
                    Default::default(),
                ),
            ),
        }),
        (1, true) => {
            TtsRequest::Octave2StreamingTextVoiceName(TtsRequestOctave2StreamingTextVoiceName {
                model: Default::default(),
                output: TtsRequestOctave1TextOutput {
                    format: TtsRequestOctave1TextOutputFormat::Mp3(Default::default()),
                },
                speed: None,
                temperature: None,
                trailing_silence_ms: None,
                context_before: None,
                latency_optimization: None,
                timestamp_granularity: None,
                text: source(vec![TextInput::String("Hi".into())]),
                voice_name: "Ava".into(),
                voice_source: Some(
                    TtsRequestOctave1TurnsSpeakersItemObject9c8ccfabVoiceSource::Catalog(
                        Default::default(),
                    ),
                ),
            })
        }
        (2, false) => TtsRequest::Octave2Turns(TtsRequestOctave2Turns {
            model: Default::default(),
            output: TtsRequestOctave1TextOutput {
                format: TtsRequestOctave1TextOutputFormat::Wav(Default::default()),
            },
            speed: None,
            temperature: None,
            trailing_silence_ms: None,
            context_before: None,
            latency_optimization: None,
            split_turns: None,
            timestamp_granularity: None,
            speakers: vec![TtsRequestOctave1TurnsSpeakersItem::Object9c8ccfab(
                TtsRequestOctave1TurnsSpeakersItemObject9c8ccfab {
                    alias: "a".into(),
                    voice: "saved".into(),
                    voice_source: None,
                },
            )],
            turns: vec![TtsRequestOctave2TurnsContextBeforeTurnsTurnsItem {
                speaker: "a".into(),
                text: "Hi".into(),
                speed: None,
                trailing_silence_ms: None,
            }],
        }),
        (2, true) => TtsRequest::Octave2StreamingTurns(TtsRequestOctave2StreamingTurns {
            model: Default::default(),
            output: TtsRequestOctave1TextOutput {
                format: TtsRequestOctave1TextOutputFormat::Wav(Default::default()),
            },
            speed: None,
            temperature: None,
            trailing_silence_ms: None,
            context_before: None,
            latency_optimization: None,
            timestamp_granularity: None,
            speakers: vec![TtsRequestOctave1TurnsSpeakersItem::Object9c8ccfab(
                TtsRequestOctave1TurnsSpeakersItemObject9c8ccfab {
                    alias: "a".into(),
                    voice: "saved".into(),
                    voice_source: None,
                },
            )],
            turns: source(vec![TurnInput::Text(
                TtsRequestOctave2TurnsContextBeforeTurnsTurnsItem {
                    speaker: "a".into(),
                    text: "Hi".into(),
                    speed: None,
                    trailing_silence_ms: None,
                },
            )]),
        }),
        (3, false) => TtsRequest::Octave2TextVoice(TtsRequestOctave2TextVoice {
            model: Default::default(),
            output: TtsRequestOctave1TextOutput {
                format: TtsRequestOctave1TextOutputFormat::Pcm(Default::default()),
            },
            speed: None,
            temperature: None,
            trailing_silence_ms: None,
            context_before: None,
            latency_optimization: None,
            split_turns: None,
            timestamp_granularity: None,
            text: "Hello".into(),
            voice: "saved".into(),
            voice_source: None,
        }),
        (3, true) => TtsRequest::Octave2StreamingTextVoice(TtsRequestOctave2StreamingTextVoice {
            model: Default::default(),
            output: TtsRequestOctave1TextOutput {
                format: TtsRequestOctave1TextOutputFormat::Pcm(Default::default()),
            },
            speed: None,
            temperature: None,
            trailing_silence_ms: None,
            context_before: None,
            latency_optimization: None,
            timestamp_granularity: None,
            text: source(vec![TextInput::String("Hello".into())]),
            voice: "saved".into(),
            voice_source: None,
        }),
        (4, false) => TtsRequest::Octave1Text(TtsRequestOctave1Text {
            model: Default::default(),
            output: TtsRequestOctave1TextOutput {
                format: TtsRequestOctave1TextOutputFormat::Wav(Default::default()),
            },
            speed: None,
            temperature: None,
            trailing_silence_ms: None,
            context_before: Some(TtsRequestOctave1TextContextBefore::Text(
                TtsRequestOctave1TextContextBeforeText {
                    text: "Before".into(),
                },
            )),
            latency_optimization: None,
            split_turns: None,
            text: "Hi".into(),
            voice_description: Some("A warm narrator".into()),
        }),
        (4, true) => TtsRequest::Octave1StreamingText(TtsRequestOctave1StreamingText {
            model: Default::default(),
            output: TtsRequestOctave1TextOutput {
                format: TtsRequestOctave1TextOutputFormat::Wav(Default::default()),
            },
            speed: None,
            temperature: None,
            trailing_silence_ms: None,
            context_before: None,
            latency_optimization: None,
            text: source(vec![TextInput::String("Hi".into())]),
            voice_description: Some("A warm narrator".into()),
        }),
        (5, false) => TtsRequest::Octave1TextVoiceName(TtsRequestOctave1TextVoiceName {
            model: Default::default(),
            output: TtsRequestOctave1TextOutput {
                format: TtsRequestOctave1TextOutputFormat::Mp3(Default::default()),
            },
            speed: Some(0.25),
            temperature: Some(0.1),
            trailing_silence_ms: Some(5000.0),
            context_before: Some(TtsRequestOctave1TextContextBefore::Object(
                TtsRequestOctave1TextContextBeforeObject {
                    request_ids: vec!["prior".into()],
                },
            )),
            latency_optimization: Some(TtsRequestOctave1TurnsLatencyOptimization::None(
                Default::default(),
            )),
            split_turns: Some(TtsRequestOctave1TextSplitTurns::False(Default::default())),
            text: "Hi".into(),
            voice_name: "Ava".into(),
            voice_source: Some(
                TtsRequestOctave1TurnsSpeakersItemObject9c8ccfabVoiceSource::Catalog(
                    Default::default(),
                ),
            ),
            instructions: Some("Whisper".into()),
        }),
        (5, true) => {
            TtsRequest::Octave1StreamingTextVoiceName(TtsRequestOctave1StreamingTextVoiceName {
                model: Default::default(),
                output: TtsRequestOctave1TextOutput {
                    format: TtsRequestOctave1TextOutputFormat::Mp3(Default::default()),
                },
                speed: Some(0.25),
                temperature: Some(0.1),
                trailing_silence_ms: Some(5000.0),
                context_before: None,
                latency_optimization: Some(TtsRequestOctave1TurnsLatencyOptimization::None(
                    Default::default(),
                )),
                text: source(vec![TextInput::String("Hi".into())]),
                voice_name: "Ava".into(),
                voice_source: Some(
                    TtsRequestOctave1TurnsSpeakersItemObject9c8ccfabVoiceSource::Catalog(
                        Default::default(),
                    ),
                ),
                instructions: Some("Whisper".into()),
            })
        }
        (6, false) => TtsRequest::Octave1Turns(TtsRequestOctave1Turns {
            model: Default::default(),
            output: TtsRequestOctave1TextOutput {
                format: TtsRequestOctave1TextOutputFormat::Mp3(Default::default()),
            },
            speed: Some(1.2),
            temperature: None,
            trailing_silence_ms: None,
            context_before: Some(TtsRequestOctave1TurnsContextBefore::Turns(
                TtsRequestOctave1TurnsContextBeforeTurns {
                    turns: vec![TtsRequestOctave1TurnsContextBeforeTurnsTurnsItem {
                        speaker: "b".into(),
                        text: "Before".into(),
                        instructions: Some("Calm".into()),
                        speed: None,
                        trailing_silence_ms: None,
                    }],
                },
            )),
            latency_optimization: None,
            split_turns: None,
            speakers: vec![
                TtsRequestOctave1TurnsSpeakersItem::Object9c8ccfab(
                    TtsRequestOctave1TurnsSpeakersItemObject9c8ccfab {
                        alias: "a".into(),
                        voice: "private".into(),
                        voice_source: None,
                    },
                ),
                TtsRequestOctave1TurnsSpeakersItem::Objected4f427b(
                    TtsRequestOctave1TurnsSpeakersItemObjected4f427b {
                        alias: "b".into(),
                        voice_name: "Ava".into(),
                        voice_source: Some(
                            TtsRequestOctave1TurnsSpeakersItemObject9c8ccfabVoiceSource::Catalog(
                                Default::default(),
                            ),
                        ),
                    },
                ),
            ],
            turns: vec![
                TtsRequestOctave1TurnsContextBeforeTurnsTurnsItem {
                    speaker: "a".into(),
                    text: "Hello".into(),
                    instructions: Some("Happy".into()),
                    speed: None,
                    trailing_silence_ms: Some(250.0),
                },
                TtsRequestOctave1TurnsContextBeforeTurnsTurnsItem {
                    speaker: "b".into(),
                    text: "Hi".into(),
                    instructions: None,
                    speed: Some(0.9),
                    trailing_silence_ms: None,
                },
            ],
        }),
        (6, true) => TtsRequest::Octave1StreamingTurns(TtsRequestOctave1StreamingTurns {
            model: Default::default(),
            output: TtsRequestOctave1TextOutput {
                format: TtsRequestOctave1TextOutputFormat::Mp3(Default::default()),
            },
            speed: Some(1.2),
            temperature: None,
            trailing_silence_ms: None,
            context_before: None,
            latency_optimization: None,
            speakers: vec![
                TtsRequestOctave1TurnsSpeakersItem::Object9c8ccfab(
                    TtsRequestOctave1TurnsSpeakersItemObject9c8ccfab {
                        alias: "a".into(),
                        voice: "private".into(),
                        voice_source: None,
                    },
                ),
                TtsRequestOctave1TurnsSpeakersItem::Objected4f427b(
                    TtsRequestOctave1TurnsSpeakersItemObjected4f427b {
                        alias: "b".into(),
                        voice_name: "Ava".into(),
                        voice_source: Some(
                            TtsRequestOctave1TurnsSpeakersItemObject9c8ccfabVoiceSource::Catalog(
                                Default::default(),
                            ),
                        ),
                    },
                ),
            ],
            turns: source(vec![
                DirectedTurnInput::Text(TtsRequestOctave1TurnsContextBeforeTurnsTurnsItem {
                    speaker: "a".into(),
                    text: "Hello".into(),
                    instructions: Some("Happy".into()),
                    speed: None,
                    trailing_silence_ms: Some(250.0),
                }),
                DirectedTurnInput::Text(TtsRequestOctave1TurnsContextBeforeTurnsTurnsItem {
                    speaker: "b".into(),
                    text: "Hi".into(),
                    instructions: None,
                    speed: Some(0.9),
                    trailing_silence_ms: None,
                }),
            ]),
        }),
        _ => panic!("unknown fixture"),
    }
}
fn auth() -> Auth {
    Auth {
        hume: Some(AuthCartesia {
            api_key: Some("test-key".into()),
            access_token: None,
        }),
        vocu: None,
        voice_ai: None,
        async_: None,
        aws: None,
        camb: None,
        cartesia: None,
        deepdub: None,
        deepgram: None,
        elevenlabs: None,
        fish: None,
        google: None,
        gradium: None,
        inworld: None,
        kugelaudio: None,
        lovo: None,
        microsoft: None,
        minimax: None,
        mistral: None,
        murf: None,
        openai: None,
        resemble: None,
        respeecher: None,
        rime: None,
        smallest_ai: None,
        typecast: None,
        xai: None,
    }
}
struct Http {
    requests: Mutex<Vec<HttpRequest>>,
    response: Mutex<Option<HttpResponse>>,
}
impl Http {
    fn new(status: u16, chunks: Vec<Vec<u8>>) -> Self {
        Self {
            requests: Mutex::new(vec![]),
            response: Mutex::new(Some(HttpResponse {
                status,
                headers: vec![],
                body: source(chunks),
            })),
        }
    }
}
impl HttpTransport for Http {
    fn send(
        &self,
        request: HttpRequest,
    ) -> Pin<Box<dyn Future<Output = Result<HttpResponse, TransportError>> + Send + '_>> {
        self.requests.lock().unwrap().push(request);
        Box::pin(async { Ok(self.response.lock().unwrap().take().unwrap()) })
    }
}
#[derive(Default)]
struct Wire {
    sent: Vec<String>,
    incoming: VecDeque<Option<Result<Message, TransportError>>>,
    writing: bool,
    automatic: bool,
    closed: usize,
    trace: Arc<Mutex<Vec<&'static str>>>,
}
struct TestSocket(Arc<Mutex<Wire>>);
impl Drop for TestSocket {
    fn drop(&mut self) {
        let mut w = self.0.lock().unwrap();
        w.closed += 1;
        w.trace.lock().unwrap().push("socket");
    }
}
impl WebSocketLike for TestSocket {
    fn start_send(self: Pin<&mut Self>, message: Message) -> Result<(), TransportError> {
        let Message::Text(text) = message else {
            panic!("expected text")
        };
        let fields = Raw::parse_exact(&text).unwrap().object().unwrap();
        let mut w = self.0.lock().unwrap();
        if w.automatic {
            if fields.contains_key("close") {
                w.incoming.push_back(None);
            } else if fields.contains_key("text") {
                w.incoming
                    .push_back(Some(Ok(Message::Binary(vec![0, 255]))));
            }
        }
        w.sent.push(text);
        Ok(())
    }
    fn poll_flush(self: Pin<&mut Self>, _: &mut Context<'_>) -> Poll<Result<(), TransportError>> {
        if self.0.lock().unwrap().writing {
            Poll::Pending
        } else {
            Poll::Ready(Ok(()))
        }
    }
    fn poll_receive(
        self: Pin<&mut Self>,
        _: &mut Context<'_>,
    ) -> Poll<Option<Result<Message, TransportError>>> {
        match self.0.lock().unwrap().incoming.pop_front() {
            Some(v) => Poll::Ready(v),
            None => Poll::Pending,
        }
    }
}
fn socket(automatic: bool) -> (Socket, Arc<Mutex<Wire>>) {
    let wire = Arc::new(Mutex::new(Wire {
        automatic,
        ..Default::default()
    }));
    (Box::pin(TestSocket(wire.clone())), wire)
}
