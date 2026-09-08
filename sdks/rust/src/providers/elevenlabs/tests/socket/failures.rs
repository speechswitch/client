use super::*;

#[test]
fn premature_dialogue_final_preserves_audio_then_reports_error() {
    let inputs = Arc::new(Counts::default());
    let counts = Arc::new(Counts::default());
    let (socket, state) = socket(&counts);
    state.lock().unwrap().handler = Some(Box::new(|state, text| {
        if Raw::parse_exact(text)
            .unwrap()
            .object()
            .unwrap()
            .contains_key("inputs")
        {
            frame(state, r#"{"audio":"AQ==","is_final":true}"#.into());
        }
        Ok(())
    }));
    let a = auth();
    let mut stream = ready(synthesize(
        TtsRequest::ElevenV3StreamingTextVoice145c0c5a(fixtures::dialogue(source(
            vec![dialogue_text("hi")],
            &inputs,
            true,
        ))),
        Options {
            auth: Some(&a),
            web_socket: Some(socket),
            ..Default::default()
        },
    ))
    .unwrap();
    assert_eq!(item(next(&mut stream).unwrap().unwrap()), parse("[1]"));
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    assert_eq!(inputs.drops.load(Ordering::SeqCst), 1);
    assert_eq!(
        next(&mut stream).unwrap().err().unwrap().to_string(),
        "ElevenLabs dialogue ended before input completed"
    );
    assert!(next(&mut stream).is_none());
}

#[test]
fn malformed_packets_release_socket_and_input() {
    for (message, expected) in [
        (
            Message::Text("{".into()),
            "ElevenLabs returned invalid JSON",
        ),
        (
            Message::Text("[]".into()),
            "Invalid ElevenLabs WebSocket frame",
        ),
        (
            Message::Text(r#"{"audio":"AQ=="}"#.into()),
            "ElevenLabs multi-context output lacks its context identifier",
        ),
        (
            Message::Text(r#"{"context_id":"a","contextId":null,"audio":"AQ=="}"#.into()),
            "Conflicting ElevenLabs context identifiers",
        ),
        (
            Message::Text(r#"{"context_id":"a","is_final":true,"isFinal":false}"#.into()),
            "Conflicting ElevenLabs final flags",
        ),
        (
            Message::Text(r#"{"context_id":"a","audio":"AQ=="}"#.into()),
            "ElevenLabs returned an unexpected context identifier",
        ),
        (
            Message::Text(r#"{"is_final":0}"#.into()),
            "Invalid ElevenLabs final flag",
        ),
        (
            Message::Text("{}".into()),
            "Unknown ElevenLabs WebSocket message",
        ),
        (
            Message::Binary(vec![1]),
            "ElevenLabs returned a non-text WebSocket frame",
        ),
        (
            Message::Text("x".repeat(1025)),
            "ElevenLabs message exceeds max_message_bytes",
        ),
    ] {
        let inputs = Arc::new(Counts::default());
        let counts = Arc::new(Counts::default());
        let (socket, state) = socket(&counts);
        state.lock().unwrap().incoming.push_back(Ok(message));
        let a = auth();
        let mut stream = ready(synthesize(
            TtsRequest::StreamingTextVoice5024de38(fixtures::tts(source(vec![], &inputs, true))),
            Options {
                auth: Some(&a),
                web_socket: Some(socket),
                entropy: Some(&entropy),
                max_message_bytes: 1024,
                ..Default::default()
            },
        ))
        .unwrap();
        assert_eq!(
            next(&mut stream).unwrap().err().unwrap().to_string(),
            expected
        );
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
        assert_eq!(inputs.drops.load(Ordering::SeqCst), 1);
        assert!(next(&mut stream).is_none());
    }
}

#[derive(Debug)]
struct Sentinel(&'static str);
impl std::fmt::Display for Sentinel {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.0)
    }
}
impl std::error::Error for Sentinel {}

#[test]
fn original_input_read_and_write_errors_are_retained() {
    for origin in ["input", "read", "write"] {
        let inputs = Arc::new(Counts::default());
        let counts = Arc::new(Counts::default());
        let (socket, state) = socket(&counts);
        let values = match origin {
            "input" => vec![Err(Box::new(Sentinel(origin)) as TransportError)],
            "read" => {
                state
                    .lock()
                    .unwrap()
                    .incoming
                    .push_back(Err(Box::new(Sentinel(origin))));
                vec![]
            }
            _ => {
                state.lock().unwrap().handler =
                    Some(Box::new(move |_, _| Err(Box::new(Sentinel(origin)))));
                vec![]
            }
        };
        let a = auth();
        let mut stream = ready(synthesize(
            TtsRequest::StreamingTextVoice5024de38(fixtures::tts(source(values, &inputs, true))),
            Options {
                auth: Some(&a),
                web_socket: Some(socket),
                entropy: Some(&entropy),
                ..Default::default()
            },
        ))
        .unwrap();
        let error = next(&mut stream)
            .unwrap()
            .err()
            .unwrap()
            .downcast::<Sentinel>()
            .unwrap();
        assert_eq!(error.0, origin);
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
        assert_eq!(inputs.drops.load(Ordering::SeqCst), 1);
    }
}

#[test]
fn empty_input_completes_without_generating_audio() {
    for dialogue in [false, true] {
        let inputs = Arc::new(Counts::default());
        let counts = Arc::new(Counts::default());
        let (socket, state) = socket(&counts);
        let request = if dialogue {
            TtsRequest::ElevenV3StreamingTextVoice145c0c5a(fixtures::dialogue(source(
                vec![],
                &inputs,
                false,
            )))
        } else {
            TtsRequest::StreamingTextVoice5024de38(fixtures::tts(source(vec![], &inputs, false)))
        };
        let a = auth();
        let mut stream = ready(synthesize(
            request,
            Options {
                auth: Some(&a),
                web_socket: Some(socket),
                entropy: Some(&entropy),
                ..Default::default()
            },
        ))
        .unwrap();
        assert!(next(&mut stream).is_none());
        assert_eq!(state.lock().unwrap().sent.len(), 1);
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
        assert_eq!(inputs.drops.load(Ordering::SeqCst), 1);
    }
}
