use super::*;

#[test]
fn updates_flush_and_existing_voice_preserve_contexts_and_zero() {
    let (socket, state) = socket(true);
    let update = Input::Update(TtsRequestStreamingTextVoiceTextItemUpdate {
        command: Default::default(),
        voice: Some("custom".into()),
        voice_style: Some("".into()),
        language: Some("en-US".into()),
        speed_bias: Some(0.0),
        pitch_bias: Some(-5.0),
        text_buffer_threshold: None,
        max_buffer_delay_ms: Some(0.0),
    });
    let mut stream = ready(synthesize(
        streaming(source(vec![
            Input::String("Hello".into()),
            update,
            flush(),
            Input::String("Again".into()),
        ])),
        Options {
            web_socket: Some(socket),
            entropy: Some(&entropy),
            ..Default::default()
        },
    ))
    .unwrap();
    let mut kinds = vec![];
    let mut ids = vec![];
    while let Some(item) = next(&mut stream) {
        match item.unwrap() {
            SynthesisItem::OrderedOrTimeline(e) => {
                kinds.push("audio");
                assert_eq!(e.audio, Some(vec![0, 255, 128]));
                assert_eq!(e.correlation.value(), "ordered");
                ids.push(e.correlation_id.unwrap());
            }
            SynthesisItem::Flush(f) => {
                kinds.push("flush");
                assert_eq!(f.correlation_id, ids[0]);
                assert_eq!(f.input_group_id, ids[0]);
            }
            SynthesisItem::Done(_) => kinds.push("done"),
            _ => panic!("unexpected event"),
        }
    }
    assert_eq!(kinds, vec!["audio", "flush", "audio", "done"]);
    assert_ne!(ids[0], ids[1]);
    let s = state.lock().unwrap();
    assert_eq!(s.drops, 1);
    assert_eq!(s.sent.len(), 7);
    assert_eq!(
        value(&s.sent[0]),
        value(r#"{"min_buffer_size":40,"max_buffer_delay_in_ms":300}"#)
    );
    assert_eq!(
        fixture(Raw::parse(&s.sent[2]).unwrap().object().unwrap()["voice_config"]),
        value(r#"{"voice_id":"custom","style":"","locale":"en-US","rate":0,"pitch":-5}"#)
    );
    assert_eq!(value(&s.sent[3]), value(r#"{"max_buffer_delay_in_ms":0}"#));
}
#[test]
fn clear_escapes_unacknowledged_flush_and_discards_late_frames() {
    let (socket, state) = socket(false);
    let mut stream = ready(synthesize(
        streaming(source(vec![
            Input::String("old".into()),
            flush(),
            clear(),
            Input::String("new".into()),
        ])),
        Options {
            web_socket: Some(socket),
            entropy: Some(&entropy),
            ..Default::default()
        },
    ))
    .unwrap();
    assert!(matches!(
        next(&mut stream).unwrap().unwrap(),
        SynthesisItem::Clear(_)
    ));
    let old = Raw::parse(&state.lock().unwrap().sent[1])
        .unwrap()
        .object()
        .unwrap()["context_id"]
        .string()
        .unwrap();
    {
        let mut s = state.lock().unwrap();
        s.auto = true;
        s.incoming.push_back(Ok(Message::Text(format!(
            "{{\"context_id\":{},\"audio\":\"3q0=\",\"final\":true}}",
            encoded(&JsonValue::String(old.clone()))
        ))));
    }
    let SynthesisItem::OrderedOrTimeline(e) = next(&mut stream).unwrap().unwrap() else {
        panic!("replacement")
    };
    assert_eq!(e.audio, Some(vec![0, 255, 128]));
    assert_ne!(e.correlation_id, Some(old));
    assert!(matches!(
        next(&mut stream).unwrap().unwrap(),
        SynthesisItem::Done(_)
    ));
    assert!(next(&mut stream).is_none());
}
#[test]
fn producer_errors_escape_a_pending_final() {
    let (socket, state) = socket(false);
    let counts = Arc::new(Counts::default());
    let input = Box::pin(Source {
        values: VecDeque::from([
            Ok(Input::String("Hi".into())),
            Ok(flush()),
            Err(failure("producer failed")),
        ]),
        counts: counts.clone(),
        stall: false,
        trace: Arc::default(),
    });
    let mut stream = ready(synthesize(
        streaming(input),
        Options {
            web_socket: Some(socket),
            entropy: Some(&entropy),
            ..Default::default()
        },
    ))
    .unwrap();
    assert_eq!(
        next(&mut stream).unwrap().err().unwrap().to_string(),
        "producer failed"
    );
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    assert_eq!(state.lock().unwrap().drops, 1);
}
#[test]
fn final_never_hides_failed_end_write() {
    let (socket, state) = socket(true);
    state.lock().unwrap().flush_error = Some("end");
    let mut stream = ready(synthesize(
        streaming(source(vec![Input::String("Hi".into()), flush()])),
        Options {
            web_socket: Some(socket),
            entropy: Some(&entropy),
            ..Default::default()
        },
    ))
    .unwrap();
    assert!(matches!(
        next(&mut stream).unwrap().unwrap(),
        SynthesisItem::OrderedOrTimeline(_)
    ));
    assert_eq!(
        next(&mut stream).unwrap().err().unwrap().to_string(),
        "write failure"
    );
    assert_eq!(state.lock().unwrap().drops, 1);
}
#[test]
fn pending_writes_input_and_receive_drop_network_before_producer() {
    for phase in ["config", "text", "end", "clear", "input", "receive"] {
        let (socket, state) = socket(true);
        let trace = Arc::new(Mutex::new(vec![]));
        {
            let mut s = state.lock().unwrap();
            s.trace = trace.clone();
            s.stall = if matches!(phase, "input" | "receive") {
                None
            } else {
                Some(phase)
            };
            s.auto = phase != "receive";
        }
        let counts = Arc::new(Counts::default());
        let mut values = VecDeque::from([Ok(Input::String("Hi".into()))]);
        if phase == "clear" {
            values.push_back(Ok(clear()));
        }
        let input = Box::pin(Source {
            values,
            counts: counts.clone(),
            stall: phase == "input",
            trace: trace.clone(),
        });
        let mut stream = ready(synthesize(
            streaming(input),
            Options {
                web_socket: Some(socket),
                entropy: Some(&entropy),
                ..Default::default()
            },
        ))
        .unwrap();
        let waker = Waker::from(Arc::new(Counts::default()));
        let mut cx = Context::from_waker(&waker);
        let mut cleared = false;
        for _ in 0..10 {
            match Pin::new(&mut stream).poll_next(&mut cx) {
                Poll::Pending => {}
                Poll::Ready(Some(Ok(SynthesisItem::OrderedOrTimeline(_)))) => {}
                Poll::Ready(Some(Ok(SynthesisItem::Clear(_)))) => cleared = true,
                _ => panic!("completed while blocked: {phase}"),
            }
        }
        if phase == "config" {
            assert_eq!(counts.reads.load(Ordering::SeqCst), 0);
        }
        assert_eq!(cleared, phase == "clear");
        drop(stream);
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
        assert_eq!(state.lock().unwrap().drops, 1);
        assert_eq!(*trace.lock().unwrap(), vec!["socket", "input"]);
    }
}
#[test]
fn unread_owned_stream_does_not_advance_input() {
    let (socket, state) = socket(true);
    let counts = Arc::new(Counts::default());
    let input = Box::pin(Source::<Input> {
        values: VecDeque::new(),
        counts: counts.clone(),
        stall: false,
        trace: Arc::default(),
    });
    let stream = ready(synthesize(
        streaming(input),
        Options {
            web_socket: Some(socket),
            entropy: Some(&entropy),
            ..Default::default()
        },
    ))
    .unwrap();
    drop(stream);
    assert_eq!(counts.reads.load(Ordering::SeqCst), 0);
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    assert_eq!(state.lock().unwrap().sent.len(), 0);
}
#[test]
fn native_packets_and_limits_fail_exactly() {
    for (message, error) in [
        (
            Message::Binary(vec![]),
            "Murf returned a non-text WebSocket message",
        ),
        (Message::Text("{".into()), "Murf returned invalid JSON"),
        (
            Message::Text("[]".into()),
            "Murf returned an invalid response object",
        ),
        (
            Message::Text(r#"{"context_id":""}"#.into()),
            "Murf returned audio or completion without the requested context ID",
        ),
        (
            Message::Text(r#"{"context_id":"x","final":1}"#.into()),
            "Murf returned an invalid final flag",
        ),
        (
            Message::Text(r#"{"context_id":"x"}"#.into()),
            "Murf returned an unsupported WebSocket message",
        ),
        (
            Message::Text(r#"{"context_id":"x","audio":"!!!"}"#.into()),
            "Murf returned invalid base64 audio",
        ),
        (
            Message::Text(r#"{"context_id":"x","audio":"AQ=="}"#.into()),
            "Murf returned an unknown context ID",
        ),
    ] {
        let (socket, state) = socket(false);
        state.lock().unwrap().incoming.push_back(Ok(message));
        let mut stream = ready(synthesize(
            streaming(source(vec![Input::String("Hi".into())])),
            Options {
                web_socket: Some(socket),
                entropy: Some(&entropy),
                ..Default::default()
            },
        ))
        .unwrap();
        assert_eq!(next(&mut stream).unwrap().err().unwrap().to_string(), error);
        assert_eq!(state.lock().unwrap().drops, 1);
    }
    for limit in [4, 60] {
        let (socket, _) = socket(false);
        let mut stream = ready(synthesize(
            streaming(source(vec![Input::String("Hi".into())])),
            Options {
                web_socket: Some(socket),
                entropy: Some(&entropy),
                max_message_bytes: limit,
                ..Default::default()
            },
        ))
        .unwrap();
        assert_eq!(
            next(&mut stream).unwrap().err().unwrap().to_string(),
            "Murf message exceeds max_message_bytes"
        );
    }
}

#[test]
fn out_of_order_contexts_keep_native_association() {
    let (socket, state) = socket(false);
    let mut stream = ready(synthesize(
        streaming(source(vec![
            Input::String("one".into()),
            flush(),
            Input::String("two".into()),
            flush(),
            Input::String("three".into()),
        ])),
        Options {
            web_socket: Some(socket),
            entropy: Some(&entropy),
            ..Default::default()
        },
    ))
    .unwrap();
    let waker = Waker::from(Arc::new(Counts::default()));
    let mut cx = Context::from_waker(&waker);
    assert!(Pin::new(&mut stream).poll_next(&mut cx).is_pending());
    let ids: Vec<String> = state
        .lock()
        .unwrap()
        .sent
        .iter()
        .filter_map(|text| {
            let f = Raw::parse(text).unwrap().object().unwrap();
            f.get("text")
                .filter(|v| v.string().unwrap() != "")
                .map(|_| f["context_id"].string().unwrap())
        })
        .collect();
    assert_eq!(ids.len(), 3);
    for index in [2, 0, 1] {
        state
            .lock()
            .unwrap()
            .incoming
            .push_back(Ok(Message::Text(format!(
                "{{\"context_id\":{},\"audio\":\"AQ==\",\"final\":true}}",
                encoded(&JsonValue::String(ids[index].clone()))
            ))));
    }
    let mut audio_ids = vec![];
    let mut flush_ids = vec![];
    while let Some(item) = next(&mut stream) {
        match item.unwrap() {
            SynthesisItem::OrderedOrTimeline(e) => {
                audio_ids.push(e.correlation_id.unwrap());
                assert_eq!(e.audio, Some(vec![1]));
            }
            SynthesisItem::Flush(f) => {
                assert_eq!(f.correlation_id, f.input_group_id);
                flush_ids.push(f.correlation_id);
            }
            SynthesisItem::Done(_) => {}
            _ => panic!("unexpected item"),
        }
    }
    assert_eq!(
        audio_ids,
        vec![ids[2].clone(), ids[0].clone(), ids[1].clone()]
    );
    assert_eq!(flush_ids, ids[..2]);
}

#[test]
fn final_requires_both_ended_text_and_audio() {
    for premature in [false, true] {
        let (socket, state) = socket(false);
        let input = Box::pin(Source {
            values: VecDeque::from([Ok(Input::String("Hi".into()))]),
            counts: Arc::default(),
            stall: premature,
            trace: Arc::default(),
        });
        let mut stream = ready(synthesize(
            streaming(input),
            Options {
                web_socket: Some(socket),
                entropy: Some(&entropy),
                ..Default::default()
            },
        ))
        .unwrap();
        let waker = Waker::from(Arc::new(Counts::default()));
        let mut cx = Context::from_waker(&waker);
        assert!(Pin::new(&mut stream).poll_next(&mut cx).is_pending());
        let id = Raw::parse(&state.lock().unwrap().sent[1])
            .unwrap()
            .object()
            .unwrap()["context_id"]
            .string()
            .unwrap();
        state
            .lock()
            .unwrap()
            .incoming
            .push_back(Ok(Message::Text(format!(
                "{{\"context_id\":{},\"final\":true}}",
                encoded(&JsonValue::String(id))
            ))));
        assert_eq!(
            next(&mut stream).unwrap().err().unwrap().to_string(),
            if premature {
                "Murf completed a context before its text ended"
            } else {
                "Murf completed a context without audio"
            }
        );
    }
}

#[test]
fn immediately_ready_inputs_yield_to_the_executor() {
    let (socket, _) = socket(true);
    let values = (0..1000).map(|_| Input::String(String::new())).collect();
    let mut stream = ready(synthesize(
        streaming(source(values)),
        Options {
            web_socket: Some(socket),
            entropy: Some(&entropy),
            ..Default::default()
        },
    ))
    .unwrap();
    let counts = Arc::new(Counts::default());
    let waker = Waker::from(counts.clone());
    let mut cx = Context::from_waker(&waker);
    assert!(Pin::new(&mut stream).poll_next(&mut cx).is_pending());
    assert!(counts.wakes.load(Ordering::SeqCst) > 0);
    assert!(matches!(
        next(&mut stream).unwrap().unwrap(),
        SynthesisItem::Done(_)
    ));
}
