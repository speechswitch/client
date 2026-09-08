use super::*;

#[test]
fn all_models_pipeline_before_ack_and_preserve_native_flush_groups() {
    for model in 0..4 {
        let input = source(vec![
            Input::String("Hel".into()),
            Input::String("".into()),
            Input::Flush(TtsRequestStreamingTextVoiceTextItemFlush {
                command: Default::default(),
            }),
            Input::String("lo".into()),
        ]);
        let mut r = streaming(input);
        r.timestamp_granularity = Some(TtsRequestTextVoiceTimestampGranularity::Word(
            Default::default(),
        ));
        r.text_buffer_threshold = Some(0.0);
        let request = if model == 0 {
            TtsRequest::InworldTts2StreamingTextVoice(r)
        } else {
            TtsRequest::StreamingTextVoice(TtsRequestStreamingTextVoice {
                model: match model {
                    1 => TtsRequestTextVoiceModel::InworldTts2Flash(Default::default()),
                    2 => TtsRequestTextVoiceModel::InworldTts15Max(Default::default()),
                    _ => TtsRequestTextVoiceModel::InworldTts15Mini(Default::default()),
                },
                text: r.text,
                voice: r.voice,
                output: r.output,
                temperature: Some(0.0),
                automatic_text_flushing: r.automatic_text_flushing,
                language: r.language,
                speed: r.speed,
                text_buffer_threshold: r.text_buffer_threshold,
                text_flush_delay_ms: r.text_flush_delay_ms,
                text_normalization: r.text_normalization,
                timestamp_delivery: r.timestamp_delivery,
                timestamp_granularity: r.timestamp_granularity,
            })
        };
        let (socket, wire) = socket(true);
        wire.lock().unwrap().defer_created = true;
        let mut stream = ready(synthesize(
            request,
            Options {
                web_socket: Some(socket),
                context_id: Some("ctx"),
                ..Default::default()
            },
        ))
        .unwrap();
        let expected=[r#"{"correlation":"timeline","correlationId":"ctx:0","audio":{"$bytes":[0,255]},"timestamps":[]}"#,r#"{"event":"flush","correlationId":"ctx:0","inputGroupId":"0"}"#,r#"{"correlation":"timeline","correlationId":"ctx:1","audio":{"$bytes":[0,255]},"timestamps":[]}"#].into_iter().map(|v|fixture(Raw::parse_exact(v).unwrap())).collect::<Vec<_>>();
        assert_eq!(collect(&mut stream).unwrap(), expected);
        let w = wire.lock().unwrap();
        assert_eq!(w.closed, 1);
        assert_eq!(w.sent.len(), 5);
        let create = Raw::parse_exact(&w.sent[0]).unwrap().object().unwrap()["create"]
            .object()
            .unwrap();
        assert_eq!(
            create["modelId"].string().unwrap(),
            [
                "inworld-tts-2",
                "inworld-tts-2-flash",
                "inworld-tts-1.5-max",
                "inworld-tts-1.5-mini"
            ][model]
        );
        assert_eq!(create["bufferCharThreshold"].number().unwrap(), 1000.0);
        assert!(!create.contains_key("language"));
        if model == 0 {
            assert_eq!(create["deliveryMode"].string().unwrap(), "BALANCED")
        } else {
            assert_eq!(create["temperature"].number().unwrap(), 1.0)
        }
        for (index, expected) in [
            (1, r#"{"contextId":"ctx","send_text":{"text":"Hel"}}"#),
            (2, r#"{"contextId":"ctx","flush_context":{}}"#),
            (3, r#"{"contextId":"ctx","send_text":{"text":"lo"}}"#),
            (4, r#"{"contextId":"ctx","close_context":{}}"#),
        ] {
            assert_eq!(
                fixture(Raw::parse_exact(&w.sent[index]).unwrap()),
                fixture(Raw::parse_exact(expected).unwrap())
            );
        }
    }
}

#[test]
fn pending_input_text_and_close_writes_do_not_block_output() {
    for lane in ["input", "send_text", "close_context"] {
        let counts = Arc::new(Counts::default());
        let trace = Arc::new(Mutex::new(vec![]));
        let input = Box::pin(Source {
            values: VecDeque::from([Ok(Input::String("Hi".into()))]),
            counts: counts.clone(),
            stall: lane == "input",
            trace: trace.clone(),
        });
        let (socket, wire) = socket(true);
        {
            let mut w = wire.lock().unwrap();
            w.stall_on = (lane != "input").then_some(lane);
            w.trace = trace.clone();
        }
        let mut stream = ready(synthesize(
            TtsRequest::InworldTts2StreamingTextVoice(streaming(input)),
            Options {
                web_socket: Some(socket),
                context_id: Some("ctx"),
                ..Default::default()
            },
        ))
        .unwrap();
        assert_eq!(
            normalized(next(&mut stream).unwrap().unwrap()),
            Value::Binary(vec![0, 255])
        );
        if lane == "close_context" {
            assert!(next(&mut stream).is_none());
        }
        drop(stream);
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
        assert_eq!(*trace.lock().unwrap(), vec!["socket", "input"]);
    }
}

#[test]
fn unread_drop_releases_socket_before_input_without_polling() {
    let counts = Arc::new(Counts::default());
    let trace = Arc::new(Mutex::new(vec![]));
    let input = Box::pin(Source {
        values: VecDeque::new(),
        counts: counts.clone(),
        stall: true,
        trace: trace.clone(),
    });
    let (socket, wire) = socket(true);
    wire.lock().unwrap().trace = trace.clone();
    let stream = ready(synthesize(
        TtsRequest::InworldTts2StreamingTextVoice(streaming(input)),
        Options {
            web_socket: Some(socket),
            context_id: Some("ctx"),
            ..Default::default()
        },
    ))
    .unwrap();
    drop(stream);
    assert_eq!(counts.reads.load(Ordering::SeqCst), 0);
    assert_eq!(*trace.lock().unwrap(), vec!["socket", "input"]);
}

#[test]
fn protocol_state_errors_are_exact_and_terminal() {
    let cases = vec![
        (
            vec![Some(Ok(event(
                "ctx",
                "audioChunk",
                r#"{"audioContent":"AP8="}"#,
            )))],
            "Inworld returned output before contextCreated",
        ),
        (
            vec![
                Some(Ok(event("ctx", "contextCreated", "{}"))),
                Some(Ok(event("ctx", "contextCreated", "{}"))),
            ],
            "Inworld returned duplicate contextCreated",
        ),
        (
            vec![Some(Ok(event("wrong", "contextCreated", "{}")))],
            "Inworld returned an unexpected context ID",
        ),
        (
            vec![Some(Ok(Message::Text(
                r#"{"result":{"contextId":"ctx","contextCreated":{},"audioChunk":{}}}"#.into(),
            )))],
            "Inworld returned an invalid context event",
        ),
        (
            vec![Some(Ok(event("ctx", "contextCreated", "[]")))],
            "Inworld returned an invalid object",
        ),
        (
            vec![
                Some(Ok(event("ctx", "contextCreated", "{}"))),
                Some(Ok(event("ctx", "contextClosed", "{}"))),
            ],
            "Inworld completed before the input stream ended",
        ),
        (vec![None], "Inworld WebSocket closed before contextClosed"),
        (
            vec![Some(Ok(Message::Binary(vec![1])))],
            "Inworld returned a non-text WebSocket frame",
        ),
    ];
    for (frames, expected) in cases {
        let (socket, wire) = socket(false);
        wire.lock().unwrap().incoming = frames.into();
        let counts = Arc::new(Counts::default());
        let input = Box::pin(Source {
            values: VecDeque::new(),
            counts: counts.clone(),
            stall: true,
            trace: Arc::default(),
        });
        let mut stream = ready(synthesize(
            TtsRequest::InworldTts2StreamingTextVoice(streaming(input)),
            Options {
                web_socket: Some(socket),
                context_id: Some("ctx"),
                ..Default::default()
            },
        ))
        .unwrap();
        assert_eq!(
            next(&mut stream).unwrap().err().unwrap().to_string(),
            expected
        );
        assert!(next(&mut stream).is_none());
        assert_eq!(wire.lock().unwrap().closed, 1);
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    }
}

fn wave(rate: u32, extra: &[u8]) -> Vec<u8> {
    let mut data = b"RIFF\0\0\0\0WAVEfmt \x10\0\0\0\x01\0\x01\0".to_vec();
    data.extend(rate.to_le_bytes());
    data.extend((rate * 2).to_le_bytes());
    data.extend([2, 0, 16, 0]);
    data.extend(extra);
    data.extend(b"data\x02\0\0\0\0\xff");
    let len = data.len() as u32 - 8;
    data[4..8].copy_from_slice(&len.to_le_bytes());
    data
}
#[test]
fn wav_headers_at_every_split_and_automatic_flush() {
    let data = wave(48000, b"JUNK\x01\0\0\0x\0");
    let mut expected = data.clone();
    expected[4..8].copy_from_slice(&u32::MAX.to_le_bytes());
    expected[data.len() - 6..data.len() - 2].copy_from_slice(&u32::MAX.to_le_bytes());
    expected.extend([0, 255]);
    for split in 0..=data.len() {
        let (socket, wire) = socket(true);
        let mut extra = Vec::new();
        for bytes in [&data[..split], &data[split..]] {
            extra.push(event(
                "ctx",
                "audioChunk",
                &format!(r#"{{"audioContent":"{}"}}"#, crate::base64::encode(bytes)),
            ));
        }
        extra.push(event("ctx", "flushCompleted", "{}"));
        extra.push(event(
            "ctx",
            "audioChunk",
            &format!(r#"{{"audioContent":"{}"}}"#, crate::base64::encode(&data)),
        ));
        wire.lock().unwrap().extra_create = extra;
        let mut r = streaming(source(vec![]));
        r.output = TtsRequestStreamingTextVoiceOutput::Wav(TtsRequestTextVoiceOutputWav {
            format: Default::default(),
            sample_rate_hz: None,
            sample_encoding: None,
            byte_order: None,
        });
        let mut stream = ready(synthesize(
            TtsRequest::InworldTts2StreamingTextVoice(r),
            Options {
                web_socket: Some(socket),
                context_id: Some("ctx"),
                ..Default::default()
            },
        ))
        .unwrap();
        let mut bytes = vec![];
        let mut events = vec![];
        for item in collect(&mut stream).unwrap() {
            match item {
                Value::Binary(v) => bytes.extend(v),
                v => events.push(v),
            }
        }
        assert_eq!(bytes, expected, "split {split}");
        assert_eq!(
            events,
            vec![fixture(
                Raw::parse_exact(r#"{"event":"flush","correlationId":"ctx:0","inputGroupId":"0"}"#)
                    .unwrap()
            )]
        );
    }
}
#[test]
fn wav_truncation_format_change_and_bounds_fail() {
    for (parts, expected) in [
        (
            vec![wave(48000, &[]), wave(24000, &[])],
            "Inworld changed WAV format between flushes",
        ),
        (
            vec![b"RIFF".to_vec()],
            "Inworld returned an incomplete WAV header",
        ),
        (
            vec![b"RIFF\0\0\0\0WAVEJUNK\xff\xff\xff\xff".to_vec()],
            "Inworld WAV header is too large",
        ),
        (
            vec![b"RIFF\0\0\0\0WAVEdata\0\0\0\0".to_vec()],
            "Inworld WAV omitted its format",
        ),
    ] {
        let (socket, wire) = socket(true);
        let mut extra = vec![];
        for data in parts {
            extra.push(event(
                "ctx",
                "audioChunk",
                &format!(r#"{{"audioContent":"{}"}}"#, crate::base64::encode(&data)),
            ));
            extra.push(event("ctx", "flushCompleted", "{}"));
        }
        wire.lock().unwrap().extra_create = extra;
        let mut r = streaming(source(vec![]));
        r.output = TtsRequestStreamingTextVoiceOutput::Wav(TtsRequestTextVoiceOutputWav {
            format: Default::default(),
            sample_rate_hz: None,
            sample_encoding: None,
            byte_order: None,
        });
        let mut stream = ready(synthesize(
            TtsRequest::InworldTts2StreamingTextVoice(r),
            Options {
                web_socket: Some(socket),
                context_id: Some("ctx"),
                ..Default::default()
            },
        ))
        .unwrap();
        assert_eq!(collect(&mut stream).err().unwrap().to_string(), expected);
        assert_eq!(wire.lock().unwrap().closed, 1);
    }
}
