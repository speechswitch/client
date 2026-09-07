use super::*;

#[test]
fn write_and_producer_errors_release_io_before_return() {
    for (send_error, flush_error, input_error, expected) in [
        (true, false, false, "send failed"),
        (false, true, false, "flush failed"),
        (false, false, true, "producer failed"),
    ] {
        let (socket, wire) = socket(false);
        {
            let mut w = wire.lock().unwrap();
            w.send_error = send_error;
            w.flush_error = flush_error;
        }
        let trace = wire.lock().unwrap().trace.clone();
        let source = Box::pin(Source {
            values: if input_error {
                VecDeque::from([Err(failure("producer failed"))])
            } else {
                VecDeque::new()
            },
            counts: Arc::default(),
            stall: true,
            trace: trace.clone(),
        });
        let mut stream = ready(synthesize(
            TtsRequest::StreamingTextVoice(streaming(source)),
            Options {
                web_socket: Some(socket),
                ..Default::default()
            },
        ))
        .unwrap();
        assert_eq!(
            next(&mut stream).unwrap().err().unwrap().to_string(),
            expected
        );
        assert_eq!(*trace.lock().unwrap(), vec!["socket", "input"]);
        assert!(next(&mut stream).is_none());
    }
}

#[test]
fn native_chunk_ids_control_alignment_and_sample_offsets() {
    let (socket, wire) = socket(false);
    for packet in [
        r#"{"generation_started":true,"chunk_id":9,"text":"Hi"}"#,
        r#"{"audio":"AQI=","enc":"pcm_s16le","sr":24000,"samples":1,"idx":0,"chunk_id":9}"#,
        r#"{"audio":"AQI=","enc":"pcm_s16le","sr":24000,"samples":1,"idx":1,"chunk_id":9}"#,
        fixtures()["audio"].text(),
        fixtures()["word"].text(),
        r#"{"chunk_complete":true,"chunk_id":9,"audio_seconds":1,"gen_ms":3}"#,
        r#"{"final":true}"#,
    ] {
        put(&wire, packet);
    }
    let mut r = request();
    r.timestamp_granularity = Some(Default::default());
    let mut stream = ready(synthesize(
        TtsRequest::TextVoice(r),
        Options {
            web_socket: Some(socket),
            ..Default::default()
        },
    ))
    .unwrap();
    for (id, start, end) in [
        (9, 0.0, 1.0 / 24000.0 * 1000.0),
        (9, 1.0 / 24000.0 * 1000.0, 2.0 / 24000.0 * 1000.0),
        (0, 0.0, 1.0 / 24000.0 * 1000.0),
    ] {
        let SynthesisItem::Ordered(v) = next(&mut stream).unwrap().unwrap() else {
            panic!("expected ordered");
        };
        assert_eq!(v.correlation_id, format!("0:{id}"));
        assert_eq!(v.input_group_id, "0");
        assert_eq!(v.chunk_id, id as f64);
        assert_eq!(v.audio, Some(vec![1, 2]));
        let t = v.audio_timing.unwrap();
        assert_eq!((t.start_time_ms, t.end_time_ms), (start, end));
        assert_eq!(v.timestamps.len(), 0);
    }
    let Value::Map(v) = normalized(next(&mut stream).unwrap().unwrap()) else {
        unreachable!()
    };
    assert_eq!(v["correlationId"], Value::String("0:0".into()));
    assert_eq!(v["timestamps"], fixture(fixtures()["timestamps"]));
    assert_eq!(
        collect(&mut stream).unwrap(),
        vec![value(r#"{"event":"done"}"#)]
    );
}

#[test]
fn alignment_and_acknowledgement_fields_have_exact_failures() {
    for (packet, expected) in [
        (
            r#"[{"word":"Hi","start_ms":20,"end_ms":10,"char_start":0,"char_end":2}]"#,
            "KugelAudio returned reversed alignment bounds",
        ),
        (
            r#"[{"word":"Hi","start_ms":0,"end_ms":10,"char_start":3,"char_end":2}]"#,
            "KugelAudio returned reversed alignment bounds",
        ),
        (
            r#"[{"word":false,"start_ms":0,"end_ms":10,"char_start":0,"char_end":2}]"#,
            "KugelAudio returned an invalid word",
        ),
        (
            r#"[{"word":"Hi","start_ms":0,"end_ms":10,"char_start":0.5,"char_end":2}]"#,
            "KugelAudio returned invalid char_start",
        ),
    ] {
        assert_eq!(
            protocol::alignment(Raw::parse_exact(packet).unwrap())
                .err()
                .unwrap()
                .to_string(),
            expected
        );
    }
    for (packet, expected) in [
        (
            r#"{"normalize":0}"#,
            "KugelAudio returned invalid settings normalize",
        ),
        (
            r#"{"language":false}"#,
            "KugelAudio returned invalid settings language",
        ),
        (
            r#"{"max_new_tokens":1.5}"#,
            "KugelAudio returned invalid max_new_tokens",
        ),
    ] {
        assert_eq!(
            protocol::updated(Some(&Raw::parse_exact(packet).unwrap()))
                .err()
                .unwrap()
                .to_string(),
            expected
        );
    }
}

#[test]
fn shared_socket_fixture_alignment_billing_and_terminal_drop() {
    let (socket, wire) = socket(true);
    let mut r = request();
    r.timestamp_granularity = Some(Default::default());
    let mut stream = ready(synthesize(
        TtsRequest::TextVoice(r),
        Options {
            web_socket: Some(socket),
            ..Default::default()
        },
    ))
    .unwrap();
    let audio = normalized(next(&mut stream).unwrap().unwrap());
    assert_eq!(
        audio,
        value(
            r#"{"correlation":"ordered","correlationId":"0:0","inputGroupId":"0","chunkId":0,"audio":{"$bytes":[1,2]},"audioTiming":{"startTimeMs":0,"endTimeMs":0.041666666666666664},"timestamps":[]}"#
        )
    );
    let Value::Map(m) = normalized(next(&mut stream).unwrap().unwrap()) else {
        unreachable!()
    };
    assert_eq!(m["timestamps"], fixture(fixtures()["timestamps"]));
    assert_eq!(m["correlationId"], Value::String("0:0".into()));
    let Value::Map(done) = normalized(next(&mut stream).unwrap().unwrap()) else {
        unreachable!()
    };
    assert_eq!(
        done,
        BTreeMap::from([
            ("event".into(), Value::String("done".into())),
            ("usage".into(), fixture(fixtures()["billing"]))
        ])
    );
    assert_eq!(wire.lock().unwrap().closed, 1);
    assert!(next(&mut stream).is_none());
    let Value::Map(mut config) = fixture(fixtures()["settings"]) else {
        unreachable!()
    };
    config.extend([
        ("text".into(), Value::String("Hi".into())),
        ("temperature".into(), Value::Number(0.4)),
        ("word_timestamps".into(), Value::Bool(true)),
        ("speaker_prefix".into(), Value::Bool(true)),
    ]);
    assert_eq!(sent(&wire), vec![Value::Map(config)]);
}

#[test]
fn live_turns_auto_flush_and_unset_temperature() {
    let (socket, wire) = socket(true);
    let mut stream = ready(synthesize(
        TtsRequest::StreamingTextVoice(streaming(source(vec![
            Input::String("Hel".into()),
            Input::String("".into()),
            Input::String("lo".into()),
            flush(),
            Input::String("!".into()),
        ]))),
        Options {
            web_socket: Some(socket),
            ..Default::default()
        },
    ))
    .unwrap();
    assert_eq!(
        collect(&mut stream).unwrap(),
        vec![
            Value::Binary(vec![1, 2]),
            Value::Binary(vec![1, 2]),
            value(r#"{"event":"flush","correlationId":"0","inputGroupId":"0"}"#),
            Value::Binary(vec![1, 2]),
            value(r#"{"event":"flush","correlationId":"1","inputGroupId":"1"}"#),
        ]
    );
    assert_eq!(
        sent(&wire),
        vec![
            live_settings(),
            value(r#"{"text":"Hel"}"#),
            value(r#"{"text":"lo"}"#),
            value(r#"{"flush":true}"#),
            value(r#"{"text":"!"}"#),
            value(r#"{"flush":true}"#),
            value(r#"{"close_socket":true}"#)
        ]
    );
    assert_eq!(wire.lock().unwrap().closed, 1);
}

fn drain_pending(stream: &mut Stream) {
    let counts = Arc::new(Counts::default());
    let waker = Waker::from(counts.clone());
    let mut cx = Context::from_waker(&waker);
    for _ in 0..100 {
        let before = counts.wakes.load(Ordering::SeqCst);
        assert!(Pin::new(&mut *stream).poll_next(&mut cx).is_pending());
        if counts.wakes.load(Ordering::SeqCst) == before {
            return;
        }
    }
    panic!("never quiesced");
}
fn put(wire: &Arc<Mutex<Wire>>, text: &str) {
    wire.lock()
        .unwrap()
        .incoming
        .push_back(Some(Ok(Message::Text(text.into()))));
}

#[test]
fn final_does_not_release_next_turn_before_session_closed() {
    let (socket, wire) = socket(false);
    let counts = Arc::new(Counts::default());
    let input = Box::pin(Source {
        values: vec![
            Input::String("First".into()),
            flush(),
            Input::String("Next".into()),
            Input::String("Held".into()),
        ]
        .into_iter()
        .map(Ok)
        .collect(),
        counts: counts.clone(),
        stall: false,
        trace: Arc::default(),
    });
    let mut stream = ready(synthesize(
        TtsRequest::StreamingTextVoice(streaming(input)),
        Options {
            web_socket: Some(socket),
            ..Default::default()
        },
    ))
    .unwrap();
    drain_pending(&mut stream);
    assert_eq!(counts.reads.load(Ordering::SeqCst), 3);
    assert_eq!(
        sent(&wire),
        vec![
            live_settings(),
            value(r#"{"text":"First"}"#),
            value(r#"{"flush":true}"#)
        ]
    );
    put(&wire, r#"{"final":true}"#);
    drain_pending(&mut stream);
    assert_eq!(sent(&wire).len(), 3);
    assert_eq!(counts.reads.load(Ordering::SeqCst), 3);
    put(&wire, r#"{"session_closed":true}"#);
    assert_eq!(
        normalized(next(&mut stream).unwrap().unwrap()),
        value(r#"{"event":"flush","correlationId":"0","inputGroupId":"0"}"#)
    );
    wire.lock().unwrap().automatic = true;
    assert_eq!(
        collect(&mut stream).unwrap(),
        vec![
            Value::Binary(vec![1, 2]),
            Value::Binary(vec![1, 2]),
            value(r#"{"event":"flush","correlationId":"1","inputGroupId":"1"}"#)
        ]
    );
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
}

#[test]
fn clear_during_flush_discards_stale_frames_until_interrupted() {
    let (socket, wire) = socket(false);
    let mut r = streaming(source(vec![
        Input::String("Old".into()),
        flush(),
        clear(),
        Input::String("New".into()),
    ]));
    r.timestamp_granularity = Some(Default::default());
    let mut stream = ready(synthesize(
        TtsRequest::StreamingTextVoice(r),
        Options {
            web_socket: Some(socket),
            ..Default::default()
        },
    ))
    .unwrap();
    drain_pending(&mut stream);
    let Value::Map(mut config) = live_settings() else {
        unreachable!()
    };
    config.insert("word_timestamps".into(), Value::Bool(true));
    assert_eq!(
        sent(&wire),
        vec![
            Value::Map(config),
            value(r#"{"text":"Old"}"#),
            value(r#"{"flush":true}"#),
            value(r#"{"cancel":true}"#)
        ]
    );
    for raw in [
        fixtures()["audio"].text(),
        fixtures()["word"].text(),
        r#"{"final":true}"#,
        r#"{"session_closed":true}"#,
    ] {
        put(&wire, raw);
    }
    drain_pending(&mut stream);
    assert_eq!(sent(&wire).len(), 4);
    put(&wire, r#"{"interrupted":true}"#);
    assert_eq!(
        normalized(next(&mut stream).unwrap().unwrap()),
        value(r#"{"event":"clear"}"#)
    );
    wire.lock().unwrap().automatic = true;
    assert_eq!(
        collect(&mut stream).unwrap(),
        vec![
            value(
                r#"{"correlation":"ordered","correlationId":"1:0","inputGroupId":"1","chunkId":0,"audio":{"$bytes":[1,2]},"audioTiming":{"startTimeMs":0,"endTimeMs":0.041666666666666664},"timestamps":[]}"#
            ),
            value(r#"{"event":"flush","correlationId":"1","inputGroupId":"1"}"#),
        ]
    );
}

#[test]
fn updates_wait_for_ack_and_preserve_false_zero_and_omission() {
    let (socket, wire) = socket(true);
    wire.lock().unwrap().defer_update = true;
    let mut u = update();
    u.voice_guidance = Some(1.5);
    u.temperature = Some(0.0);
    u.max_audio_tokens = Some(3.0);
    u.speed = Some(1.1);
    u.language = Some(TtsRequestTextVoiceLanguage::De(Default::default()));
    u.text_normalization = Some(TtsRequestTextVoiceTextNormalization::False(
        Default::default(),
    ));
    let mut stream = ready(synthesize(
        TtsRequest::StreamingTextVoice(streaming(source(vec![Input::Update(u)]))),
        Options {
            web_socket: Some(socket),
            ..Default::default()
        },
    ))
    .unwrap();
    drain_pending(&mut stream);
    assert_eq!(
        sent(&wire),
        vec![
            live_settings(),
            value(
                r#"{"update_settings":{"cfg_scale":1.5,"temperature":0,"max_new_tokens":3,"speed":1.1,"language":"de","normalize":false}}"#
            )
        ]
    );
    put(
        &wire,
        r#"{"settings_updated":true,"settings":{"cfg_scale":1.5,"temperature":0,"max_new_tokens":3,"speed":1.1,"language":"de","normalize":false}}"#,
    );
    assert_eq!(
        collect(&mut stream).unwrap(),
        vec![value(
            r#"{"event":"updated","voiceGuidance":1.5,"temperature":0,"maxAudioTokens":3,"speed":1.1,"language":"de","textNormalization":false}"#
        )]
    );
    assert_eq!(sent(&wire).last(), Some(&value(r#"{"close_socket":true}"#)));
}

#[test]
fn pending_write_does_not_block_receive_and_drop_releases_socket_first() {
    for stalled in [false, true] {
        let (socket, wire) = socket(false);
        if stalled {
            wire.lock().unwrap().stall_on = Some("voice_id");
        }
        let trace = wire.lock().unwrap().trace.clone();
        let counts = Arc::new(Counts::default());
        let input = Box::pin(Source {
            values: VecDeque::new(),
            counts: counts.clone(),
            stall: true,
            trace: trace.clone(),
        });
        let mut stream = ready(synthesize(
            TtsRequest::StreamingTextVoice(streaming(input)),
            Options {
                web_socket: Some(socket),
                ..Default::default()
            },
        ))
        .unwrap();
        drain_pending(&mut stream);
        if stalled {
            put(
                &wire,
                r#"{"error":"bad voice","code":404,"error_code":"VOICE_NOT_FOUND"}"#,
            );
            let e = next(&mut stream).unwrap().err().unwrap();
            assert_eq!(
                e.downcast_ref::<Error>(),
                Some(&Error {
                    message: "bad voice".into(),
                    status: Some(404),
                    code: Some("VOICE_NOT_FOUND".into()),
                    retry_after: None
                })
            );
            assert_eq!(wire.lock().unwrap().closed, 1);
        }
        drop(stream);
        assert_eq!(*trace.lock().unwrap(), vec!["socket", "input"]);
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    }
}

#[test]
fn malformed_packets_are_exact_errors_and_fuse_the_stream() {
    for (packet, expected) in [
        ("{", "KugelAudio returned invalid JSON"),
        ("[]", "KugelAudio returned an invalid object"),
        ("{}", "KugelAudio returned an invalid event"),
        (
            r#"{"final":false}"#,
            "KugelAudio returned an invalid event flag",
        ),
        (
            r#"{"final":true,"audio":"AQI="}"#,
            "KugelAudio returned an invalid event",
        ),
        (
            r#"{"session_closed":true}"#,
            "KugelAudio ended a turn before final",
        ),
        (
            r#"{"interrupted":true}"#,
            "KugelAudio returned an unsolicited interruption",
        ),
        (
            r#"{"settings_updated":true,"settings":{}}"#,
            "KugelAudio returned an unsolicited settings acknowledgement",
        ),
        (
            r#"{"generation_started":true,"chunk_id":0}"#,
            "KugelAudio returned invalid generated text",
        ),
        (
            r#"{"audio":"AQI=","enc":"pcm_s16le","sr":24000,"samples":2,"idx":0,"chunk_id":0}"#,
            "KugelAudio audio size disagrees with its sample count",
        ),
        (
            r#"{"audio":"?","enc":"pcm_s16le","sr":24000,"samples":1,"idx":0,"chunk_id":0}"#,
            "KugelAudio returned invalid base64 audio",
        ),
        (
            r#"{"audio":"AQI=","enc":"pcm_s16le","sr":true,"samples":1,"idx":0,"chunk_id":0}"#,
            "KugelAudio returned an unexpected audio format",
        ),
        (
            r#"{"word_timestamps":[],"chunk_id":0}"#,
            "KugelAudio returned unrequested timestamps",
        ),
        (
            r#"{"final":true,"usage":{"audio_seconds":1,"characters":2,"cost_cents":null}}"#,
            "KugelAudio omitted its cost-unavailable indicator",
        ),
        (
            r#"{"final":true,"usage":{"audio_seconds":1,"characters":2,"cost_cents":0,"currency":"usd"}}"#,
            "KugelAudio returned an invalid usage currency",
        ),
        (
            r#"{"final":true,"usage":{"audio_seconds":1,"characters":2,"cost_cents":0,"model_id":false}}"#,
            "KugelAudio returned an invalid usage model",
        ),
    ] {
        let (socket, wire) = socket(false);
        put(&wire, packet);
        let mut stream = ready(synthesize(
            TtsRequest::TextVoice(request()),
            Options {
                web_socket: Some(socket),
                ..Default::default()
            },
        ))
        .unwrap();
        assert_eq!(
            next(&mut stream).unwrap().err().unwrap().to_string(),
            expected,
            "{packet}"
        );
        assert_eq!(wire.lock().unwrap().closed, 1);
        assert!(next(&mut stream).is_none());
    }
}

#[test]
fn input_validation_and_fragment_length_fail_before_send() {
    let mut invalid = update();
    invalid.max_audio_tokens = Some(1.5);
    for (input, expected) in [
        (Input::Update(invalid), "Invalid kugelaudio TTS input item"),
        (
            Input::String("😀".repeat(5001)),
            "KugelAudio text fragments must not exceed 10000 characters",
        ),
    ] {
        let (socket, wire) = socket(true);
        let mut stream = ready(synthesize(
            TtsRequest::StreamingTextVoice(streaming(source(vec![input]))),
            Options {
                web_socket: Some(socket),
                ..Default::default()
            },
        ))
        .unwrap();
        assert_eq!(collect(&mut stream).err().unwrap().to_string(), expected);
        assert_eq!(sent(&wire), vec![live_settings()]);
        assert_eq!(wire.lock().unwrap().closed, 1);
    }
}
