use super::*;

fn fixture_request(index: usize) -> TtsRequest {
    let mut v = request();
    match index {
        0 => TtsRequest::InworldTts2TextVoice(v),
        4 => {
            v.output = TtsRequestTextVoiceOutput::Flac(TtsRequestTextVoiceOutputFlac {
                format: Default::default(),
                sample_rate_hz: None,
            });
            v.delivery_mode = Some(TtsRequestInworldTts2TextVoiceDeliveryMode::Creative(
                Default::default(),
            ));
            v.instructions = Some("Quietly".into());
            v.language = Some("en".into());
            v.speed = Some(1.2);
            v.text_normalization = Some(TtsRequestTextVoiceTextNormalization::False(
                Default::default(),
            ));
            v.timestamp_granularity = Some(TtsRequestTextVoiceTimestampGranularity::Word(
                Default::default(),
            ));
            v.timestamp_delivery = Some(TtsRequestTextVoiceTimestampDelivery::Chunk(
                Default::default(),
            ));
            v.audio_enhancement =
                Some(TtsRequestTextVoiceAudioEnhancement::True(Default::default()));
            v.context_before = Some(TtsRequestTextVoiceContextBefore {
                texts: vec!["Earlier".into()],
            });
            TtsRequest::InworldTts2TextVoice(v)
        }
        6 => {
            v.output = TtsRequestTextVoiceOutput::Object(TtsRequestTextVoiceOutputObject {
                format: TtsRequestTextVoiceOutputObjectFormat::Alaw(Default::default()),
                sample_rate_hz: None,
            });
            v.delivery_mode = Some(TtsRequestInworldTts2TextVoiceDeliveryMode::Stable(
                Default::default(),
            ));
            TtsRequest::InworldTts2TextVoice(v)
        }
        _ => TtsRequest::TextVoice(TtsRequestTextVoice {
            model: match index {
                2 => TtsRequestTextVoiceModel::InworldTts15Max(Default::default()),
                3 => TtsRequestTextVoiceModel::InworldTts15Mini(Default::default()),
                _ => TtsRequestTextVoiceModel::InworldTts2Flash(Default::default()),
            },
            output: match index {
                1 => TtsRequestTextVoiceOutput::Mp3(TtsRequestTextVoiceOutputMp3 {
                    format: Default::default(),
                    sample_rate_hz: None,
                    bit_rate_bps: None,
                }),
                2 => TtsRequestTextVoiceOutput::OggOpus(TtsRequestTextVoiceOutputOggOpus {
                    format: Default::default(),
                    sample_rate_hz: Some(TtsRequestTextVoiceOutputFlacSampleRateHz::Number24000(
                        Default::default(),
                    )),
                    bit_rate_bps: Some(64000.0),
                }),
                3 => TtsRequestTextVoiceOutput::Wav(TtsRequestTextVoiceOutputWav {
                    format: Default::default(),
                    sample_rate_hz: None,
                    sample_encoding: None,
                    byte_order: None,
                }),
                5 => TtsRequestTextVoiceOutput::Object(TtsRequestTextVoiceOutputObject {
                    format: TtsRequestTextVoiceOutputObjectFormat::Mulaw(Default::default()),
                    sample_rate_hz: None,
                }),
                _ => panic!("fixture index"),
            },
            temperature: (index == 5).then_some(0.0),
            text: v.text,
            voice: v.voice,
            audio_enhancement: None,
            context_before: None,
            language: None,
            speed: None,
            text_normalization: None,
            timestamp_delivery: None,
            timestamp_granularity: None,
        }),
    }
}

#[test]
fn every_model_and_format_matches_shared_wire_fixtures() {
    let entries = fixtures()["http"].array().unwrap();
    for (index, case) in entries.into_iter().enumerate() {
        let transport = Http::new(
            200,
            vec![b"{\"result\":{\"audioContent\":\"AP8=\"}}\n".to_vec()],
        );
        let auth = auth();
        let mut stream = ready(synthesize(
            fixture_request(index),
            Options {
                auth: Some(&auth),
                transport: Some(&transport),
                base_url: Some("https://proxy.test/a%2Fb/?tenant=one"),
                ..Default::default()
            },
        ))
        .unwrap();
        let items = collect(&mut stream).unwrap();
        assert_eq!(items.len(), 1);
        if index != 4 {
            assert_eq!(items, vec![Value::Binary(vec![0, 255])]);
        }
        let requests = transport.requests.lock().unwrap();
        let r = &requests[0];
        assert_eq!(r.method, "POST");
        assert_eq!(
            r.url,
            "https://proxy.test/a%2Fb/tts/v1/voice:stream?tenant=one"
        );
        assert_eq!(
            r.headers,
            vec![
                ("authorization".into(), "Basic test-key".into()),
                ("content-type".into(), "application/json".into())
            ]
        );
        assert_eq!(
            fixture(Raw::parse_exact(std::str::from_utf8(&r.body).unwrap()).unwrap()),
            fixture(case.object().unwrap()["body"])
        );
    }
}

#[test]
fn independent_timestamps_at_every_utf8_split() {
    let entries = fixtures()["timeline"].array().unwrap();
    let mut data = b"\xef\xbb\xbf\r\n".to_vec();
    let mut expected = vec![];
    for (index, entry) in entries.iter().enumerate() {
        let entry = entry.object().unwrap();
        // The fixture is pretty-printed; each packet is one wire NDJSON record.
        data.extend(
            entry["packet"]
                .text()
                .lines()
                .collect::<String>()
                .as_bytes(),
        );
        if index + 1 < entries.len() {
            data.extend(b"\r\n");
        }
        expected.push(fixture(entry["item"]));
    }
    for split in 0..=data.len() {
        let transport = Http::new(200, vec![data[..split].to_vec(), data[split..].to_vec()]);
        let auth = auth();
        let mut r = request();
        r.timestamp_granularity = Some(TtsRequestTextVoiceTimestampGranularity::Word(
            Default::default(),
        ));
        let mut stream = ready(synthesize(
            TtsRequest::InworldTts2TextVoice(r),
            Options {
                auth: Some(&auth),
                transport: Some(&transport),
                ..Default::default()
            },
        ))
        .unwrap();
        assert_eq!(collect(&mut stream).unwrap(), expected, "split {split}");
    }
}

#[test]
fn single_response_uses_chunk_association_and_releases_before_yield() {
    let counts = Arc::new(Counts::default());
    let transport = Http::new(200, vec![]);
    transport.response.lock().unwrap().as_mut().unwrap().body = Box::pin(Source {
        values: VecDeque::from([Ok(br#"{"audioContent":"AP8="}"#.to_vec())]),
        counts: counts.clone(),
        stall: false,
        trace: Arc::default(),
    });
    let auth = auth();
    let mut r = request();
    r.timestamp_granularity = Some(TtsRequestTextVoiceTimestampGranularity::Word(
        Default::default(),
    ));
    let mut stream = ready(synthesize(
        TtsRequest::InworldTts2TextVoice(r),
        Options {
            auth: Some(&auth),
            transport: Some(&transport),
            http_mode: Some(HttpMode::Single),
            ..Default::default()
        },
    ))
    .unwrap();
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    assert_eq!(
        collect(&mut stream).unwrap(),
        vec![fixture(
            Raw::parse_exact(
                r#"{"correlation":"chunk","audio":{"$bytes":[0,255]},"timestamps":[]}"#
            )
            .unwrap()
        )]
    );
    let requests = transport.requests.lock().unwrap();
    assert_eq!(requests[0].url, "https://api.inworld.ai/tts/v1/voice");
    let body = Raw::parse_exact(std::str::from_utf8(&requests[0].body).unwrap())
        .unwrap()
        .object()
        .unwrap();
    assert!(!body.contains_key("timestampTransportStrategy"));
}

#[test]
fn native_errors_and_bounded_bodies() {
    for (status, data, message, code) in [
        (403, r#"{"code":7,"message":"denied"}"#, "denied", 7),
        (200, r#"{"error":{"code":8,"message":"quota"}}"#, "quota", 8),
        (
            200,
            r#"{"result":{"audioContent":"","status":{"code":3,"message":"bad"}}}"#,
            "bad",
            3,
        ),
    ] {
        let transport = Http::new(status, vec![data.as_bytes().to_vec()]);
        let auth = auth();
        let result = ready(synthesize(
            TtsRequest::InworldTts2TextVoice(request()),
            Options {
                auth: Some(&auth),
                transport: Some(&transport),
                ..Default::default()
            },
        ));
        let error = match result {
            Err(e) => e,
            Ok(mut stream) => collect(&mut stream).err().unwrap(),
        };
        let error = error.downcast_ref::<Error>().unwrap();
        assert_eq!(
            *error,
            Error {
                message: message.into(),
                code: Some(code),
                status: (status != 200).then_some(status)
            }
        );
    }
    for (status, mode, message) in [
        (
            200,
            HttpMode::Stream,
            "Inworld JSON line exceeds max_json_bytes",
        ),
        (
            200,
            HttpMode::Single,
            "Inworld response exceeds max_json_bytes",
        ),
        (
            403,
            HttpMode::Stream,
            "Inworld response exceeds max_json_bytes",
        ),
    ] {
        let transport = Http::new(status, vec![b"12345".to_vec()]);
        let auth = auth();
        let result = ready(synthesize(
            TtsRequest::InworldTts2TextVoice(request()),
            Options {
                auth: Some(&auth),
                transport: Some(&transport),
                http_mode: Some(mode),
                max_json_bytes: 4,
                ..Default::default()
            },
        ));
        let error = match result {
            Err(e) => e,
            Ok(mut s) => collect(&mut s).err().unwrap(),
        };
        assert_eq!(error.to_string(), message);
    }
}

#[test]
fn dropping_unread_or_pending_http_releases_body() {
    for read in [false, true] {
        let counts = Arc::new(Counts::default());
        let transport = Http::new(200, vec![]);
        transport.response.lock().unwrap().as_mut().unwrap().body = Box::pin(Source {
            values: VecDeque::from([Ok(b"{\"result\":{\"audioContent\":\"AP8=\"}}\n".to_vec())]),
            counts: counts.clone(),
            stall: true,
            trace: Arc::default(),
        });
        let auth = auth();
        let mut stream = ready(synthesize(
            TtsRequest::InworldTts2TextVoice(request()),
            Options {
                auth: Some(&auth),
                transport: Some(&transport),
                ..Default::default()
            },
        ))
        .unwrap();
        if read {
            assert_eq!(
                normalized(next(&mut stream).unwrap().unwrap()),
                Value::Binary(vec![0, 255])
            );
            let waker = Waker::from(counts.clone());
            let mut cx = Context::from_waker(&waker);
            assert!(Pin::new(&mut stream).poll_next(&mut cx).is_pending());
        }
        drop(stream);
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
        if !read {
            assert_eq!(counts.reads.load(Ordering::SeqCst), 0)
        }
    }
}
