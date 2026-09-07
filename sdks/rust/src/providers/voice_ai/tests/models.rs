use super::*;

fn requests() -> Vec<TtsRequest> {
    vec![
        TtsRequest::Object1ec54d36(TtsRequestObject1ec54d36 {
            api_version: None,
            audio_delivery: None,
            language: Some(TtsRequestObject1ec54d36Language::Es(Default::default())),
            model: Some(Default::default()),
            output: None,
            pronunciation_dictionaries: Some(vec![
                TtsRequestObject1ec54d36PronunciationDictionariesItem {
                    id: "dictionary".into(),
                    version: Some(2.0),
                },
            ]),
            temperature: Some(0.0),
            text: Text::String("Hola 😀".into()),
            top_p: Some(0.0),
            voice: Some("owned-voice".into()),
        }),
        TtsRequest::Object4870017d(TtsRequestObject4870017d {
            api_version: None,
            audio_delivery: Default::default(),
            language: None,
            model: None,
            output: TtsRequestObject4870017dOutput::Pcm(pcm()),
            pronunciation_dictionaries: None,
            temperature: None,
            text: Text::String("Hello".into()),
            top_p: None,
            voice: None,
        }),
        TtsRequest::Object3dd4eb5b(TtsRequestObject3dd4eb5b {
            api_version: None,
            audio_delivery: None,
            language: None,
            model: TtsRequestObject3dd4eb5bModel::VoiceaiTtsV120260210(Default::default()),
            output: Some(TtsRequestObject1ec54d36Output::Mp39b9ac8e8(
                TtsRequestObject1ec54d36OutputMp39b9ac8e8 {
                    format: Default::default(),
                    sample_rate_hz: Default::default(),
                    bit_rate_bps: TtsRequestObject1ec54d36OutputMp39b9ac8e8BitRateBps::Number192000(
                        Default::default(),
                    ),
                },
            )),
            pronunciation_dictionaries: None,
            temperature: None,
            text: Text::String("Hello".into()),
            top_p: None,
            voice: None,
        }),
        TtsRequest::Object50ac9774(TtsRequestObject50ac9774 {
            api_version: None,
            audio_delivery: Default::default(),
            language: None,
            model: TtsRequestObject3dd4eb5bModel::VoiceaiTtsV1Latest(Default::default()),
            output: TtsRequestObject4870017dOutput::Object(TtsRequestObject1ec54d36OutputObject {
                format: TtsRequestObject1ec54d36OutputObjectFormat::Mulaw(Default::default()),
                sample_rate_hz: None,
            }),
            pronunciation_dictionaries: None,
            temperature: None,
            text: Text::String("Hello".into()),
            top_p: None,
            voice: None,
        }),
        TtsRequest::Objectdd71553d(TtsRequestObjectdd71553d {
            api_version: None,
            audio_delivery: None,
            language: None,
            model: TtsRequestObjectdd71553dModel::VoiceaiTtsLiteV120260415(Default::default()),
            output: Some(TtsRequestObject1ec54d36Output::Opus(
                TtsRequestObject1ec54d36OutputOpus {
                    format: Default::default(),
                    sample_rate_hz: None,
                    bit_rate_bps: TtsRequestObject1ec54d36OutputMp39b9ac8e8BitRateBps::Number96000(
                        Default::default(),
                    ),
                },
            )),
            pronunciation_dictionaries: Some(vec![
                TtsRequestObject1ec54d36PronunciationDictionariesItem {
                    id: "latest".into(),
                    version: None,
                },
            ]),
            temperature: None,
            text: Text::String("Hello".into()),
            top_p: None,
            voice: None,
        }),
        TtsRequest::Objectdbc284be(TtsRequestObjectdbc284be {
            api_version: None,
            audio_delivery: Default::default(),
            language: None,
            model: TtsRequestObjectdd71553dModel::VoiceaiTtsLiteV1Latest(Default::default()),
            output: TtsRequestObject4870017dOutput::Pcm(TtsRequestObject1ec54d36OutputPcm {
                format: Default::default(),
                sample_rate_hz: Some(TtsRequestObject1ec54d36OutputPcmSampleRateHz::Number48000(
                    Default::default(),
                )),
                sample_encoding: Some(Default::default()),
                byte_order: Some(Default::default()),
                channel_count: Some(Default::default()),
            }),
            pronunciation_dictionaries: None,
            temperature: None,
            text: Text::String("Hello".into()),
            top_p: None,
            voice: None,
        }),
        TtsRequest::Object239f4158(TtsRequestObject239f4158 {
            api_version: None,
            audio_delivery: None,
            language: TtsRequestObject239f4158Language::Fr(Default::default()),
            model: TtsRequestObject239f4158Model::VoiceaiTtsMultilingualV120260210(
                Default::default(),
            ),
            output: Some(TtsRequestObject1ec54d36Output::Wav(
                TtsRequestObject1ec54d36OutputWav {
                    format: Default::default(),
                    sample_rate_hz: Some(
                        TtsRequestObject1ec54d36OutputWavSampleRateHz::Number22050(
                            Default::default(),
                        ),
                    ),
                },
            )),
            pronunciation_dictionaries: None,
            temperature: None,
            text: Text::String("Bonjour".into()),
            top_p: None,
            voice: None,
        }),
        TtsRequest::Objectcb749376(TtsRequestObjectcb749376 {
            api_version: None,
            audio_delivery: Default::default(),
            language: TtsRequestObject239f4158Language::Fr(Default::default()),
            model: TtsRequestObject239f4158Model::VoiceaiTtsMultilingualV1Latest(Default::default()),
            output: TtsRequestObject4870017dOutput::Object(TtsRequestObject1ec54d36OutputObject {
                format: TtsRequestObject1ec54d36OutputObjectFormat::Alaw(Default::default()),
                sample_rate_hz: None,
            }),
            pronunciation_dictionaries: None,
            temperature: None,
            text: Text::String("Bonjour".into()),
            top_p: None,
            voice: None,
        }),
        TtsRequest::TextVoice(TtsRequestTextVoice {
            api_version: Default::default(),
            text: "Hello".into(),
            voice: "existing-clone".into(),
            output: Some(TtsRequestTextVoiceOutput {
                format: TtsRequestTextVoiceOutputFormat::Pcm(Default::default()),
            }),
            temperature: Some(0.8),
            top_p: Some(0.4),
        }),
    ]
}
fn pcm() -> TtsRequestObject1ec54d36OutputPcm {
    TtsRequestObject1ec54d36OutputPcm {
        format: Default::default(),
        sample_rate_hz: None,
        sample_encoding: None,
        byte_order: None,
        channel_count: None,
    }
}

#[test]
fn every_documented_codec_rate_and_bitrate() {
    use TtsRequestObject1ec54d36Output as Output;
    use TtsRequestObject1ec54d36OutputMp39b9ac8e8BitRateBps as Bitrate;
    use TtsRequestObject1ec54d36OutputPcmSampleRateHz as PcmRate;
    use TtsRequestObject1ec54d36OutputWavSampleRateHz as WavRate;
    let mut cases = vec![
        (
            Output::Mp3904ec5a3(TtsRequestObject1ec54d36OutputMp3904ec5a3 {
                format: Default::default(),
                sample_rate_hz: None,
            }),
            "mp3".into(),
        ),
        (
            Output::Mp36dc1fbe1(TtsRequestObject1ec54d36OutputMp36dc1fbe1 {
                format: Default::default(),
                sample_rate_hz: Default::default(),
                bit_rate_bps: None,
            }),
            "mp3_22050_32".into(),
        ),
        (
            Output::Mp3f58f8da7(TtsRequestObject1ec54d36OutputMp3f58f8da7 {
                format: Default::default(),
                sample_rate_hz: Default::default(),
                bit_rate_bps: None,
            }),
            "mp3_24000_48".into(),
        ),
        (Output::Pcm(pcm()), "pcm_32000".into()),
        (
            Output::Wav(TtsRequestObject1ec54d36OutputWav {
                format: Default::default(),
                sample_rate_hz: None,
            }),
            "wav".into(),
        ),
        (
            Output::Object(TtsRequestObject1ec54d36OutputObject {
                format: TtsRequestObject1ec54d36OutputObjectFormat::Mulaw(Default::default()),
                sample_rate_hz: None,
            }),
            "ulaw_8000".into(),
        ),
        (
            Output::Object(TtsRequestObject1ec54d36OutputObject {
                format: TtsRequestObject1ec54d36OutputObjectFormat::Alaw(Default::default()),
                sample_rate_hz: None,
            }),
            "alaw_8000".into(),
        ),
    ];
    for opus in [false, true] {
        for bitrate in [
            Bitrate::Number32000(Default::default()),
            Bitrate::Number64000(Default::default()),
            Bitrate::Number96000(Default::default()),
            Bitrate::Number128000(Default::default()),
            Bitrate::Number192000(Default::default()),
        ] {
            let wire = format!(
                "{}_{}",
                if opus { "opus_48000" } else { "mp3_44100" },
                bitrate.value() / 1000.0
            );
            let output = if opus {
                Output::Opus(TtsRequestObject1ec54d36OutputOpus {
                    format: Default::default(),
                    sample_rate_hz: None,
                    bit_rate_bps: bitrate,
                })
            } else {
                Output::Mp39b9ac8e8(TtsRequestObject1ec54d36OutputMp39b9ac8e8 {
                    format: Default::default(),
                    sample_rate_hz: Default::default(),
                    bit_rate_bps: bitrate,
                })
            };
            cases.push((output, wire));
        }
    }
    for rate in [
        PcmRate::Number8000(Default::default()),
        PcmRate::Number16000(Default::default()),
        PcmRate::Number22050(Default::default()),
        PcmRate::Number24000(Default::default()),
        PcmRate::Number32000(Default::default()),
        PcmRate::Number44100(Default::default()),
        PcmRate::Number48000(Default::default()),
    ] {
        let wire = format!("pcm_{}", rate.value());
        let mut output = pcm();
        output.sample_rate_hz = Some(rate);
        cases.push((Output::Pcm(output), wire));
    }
    for rate in [
        WavRate::Number16000(Default::default()),
        WavRate::Number22050(Default::default()),
        WavRate::Number24000(Default::default()),
        WavRate::Number32000(Default::default()),
    ] {
        let wire = if rate.value() == 32000.0 {
            "wav".into()
        } else {
            format!("wav_{}", rate.value())
        };
        cases.push((
            Output::Wav(TtsRequestObject1ec54d36OutputWav {
                format: Default::default(),
                sample_rate_hz: Some(rate),
            }),
            wire,
        ));
    }
    for (output, wire) in cases {
        let mut request = request();
        request.output = Some(output);
        let request = TtsRequest::Object1ec54d36(request);
        let _validate = validate_request(&request).unwrap();
        let settings = settings::resolve(request);
        assert_eq!(settings.wire["audio_format"], JsonValue::String(wire));
    }
}

#[test]
fn boundary_rejects_invalid_settings_and_preserves_protocol_defaults() {
    for base in [
        "file:///tmp/test",
        "https://user:pass@example.com",
        "https://example.com?",
        "https://example.com#",
        "https://example.com\\evil",
        "https://example.com/\n",
        "https://example.com:65536",
        "https://[not-an-ip]",
        "https://example.com:",
    ] {
        assert_eq!(endpoint(base,"/api",true).err().unwrap().to_string(),"Voice.ai BaseURL must be an HTTP or WebSocket base without credentials, query or fragment");
    }
    assert_eq!(
        endpoint("https://proxy.test/one%2Ftwo///", "/api", true).unwrap(),
        "wss://proxy.test/one%2Ftwo/api"
    );
    assert_eq!(
        endpoint("ws://[::1]:1234/proxy", "/api", false).unwrap(),
        "http://[::1]:1234/proxy/api"
    );
    let mut a = auth();
    a.voice_ai.as_mut().unwrap().api_key = Some(String::new());
    assert_eq!(
        ready(synthesize(
            TtsRequest::Object1ec54d36(request()),
            Options {
                auth: Some(&a),
                ..Options::default()
            }
        ))
        .err()
        .unwrap()
        .to_string(),
        "Missing auth.voice.ai.apiKey configuration"
    );
    a.voice_ai.as_mut().unwrap().api_key = Some("key\r\ninjection".into());
    assert_eq!(
        ready(synthesize(
            TtsRequest::Object1ec54d36(request()),
            Options {
                auth: Some(&a),
                ..Options::default()
            }
        ))
        .err()
        .unwrap()
        .to_string(),
        "Voice.ai API key must contain only visible ASCII characters"
    );
    for (protocol, request, want) in [
        (
            Protocol::Http,
            live(source(vec![Input::String("Hello".into())])),
            "Voice.ai incremental input and paced delivery require WebSocket",
        ),
        (
            Protocol::Stream,
            requests().remove(1),
            "Voice.ai incremental input and paced delivery require WebSocket",
        ),
        (
            Protocol::WebSocket,
            requests().pop().unwrap(),
            "Voice.ai legacy API does not document WebSocket synthesis",
        ),
    ] {
        assert_eq!(
            ready(synthesize(
                request,
                Options {
                    auth: Some(&auth()),
                    protocol: Some(protocol),
                    ..Options::default()
                }
            ))
            .err()
            .unwrap()
            .to_string(),
            want
        );
    }
    let counts = Arc::new(Counts::default());
    let error = ready(synthesize(
        TtsRequest::Object1ec54d36(request()),
        Options {
            auth: Some(&auth()),
            protocol: Some(Protocol::Http),
            web_socket: Some(socket(Arc::default(), counts.clone(), Arc::default())),
            ..Options::default()
        },
    ))
    .err()
    .unwrap();
    assert_eq!(
        error.to_string(),
        "Voice.ai WebSocket override requires WebSocket transport"
    );
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    assert_eq!(
        ready(synthesize(
            TtsRequest::Object1ec54d36(request()),
            Options {
                auth: Some(&auth()),
                max_message_bytes: 0,
                ..Options::default()
            }
        ))
        .err()
        .unwrap()
        .to_string(),
        "Voice.ai max_message_bytes must be a positive safe integer"
    );
    assert_eq!(
        ready(synthesize(
            TtsRequest::Object1ec54d36(request()),
            Options {
                auth: Some(&auth()),
                ..Options::default()
            }
        ))
        .err()
        .unwrap()
        .to_string(),
        "Voice.ai HTTP transport is required"
    );
    for version in [0.0, 1.5, f64::INFINITY] {
        let mut r = request();
        r.pronunciation_dictionaries = Some(vec![
            TtsRequestObject1ec54d36PronunciationDictionariesItem {
                id: "id".into(),
                version: Some(version),
            },
        ]);
        assert_eq!(
            ready(synthesize(
                TtsRequest::Object1ec54d36(r),
                Options::default()
            ))
            .err()
            .unwrap()
            .to_string(),
            "Invalid voice.ai TTS request"
        );
    }
}

#[test]
fn all_nine_shared_requests() {
    let root = Raw::parse_exact(include_str!("../../../../../fixtures/voice_ai.json"))
        .unwrap()
        .object()
        .unwrap();
    let cases = root["requests"].array().unwrap();
    let requests = requests();
    assert_eq!(requests.len(), cases.len());
    for (request, case) in requests.into_iter().zip(cases) {
        let case = case.object().unwrap();
        let protocol = match case["protocol"].string().unwrap().as_str() {
            "http" => Protocol::Http,
            "stream" => Protocol::Stream,
            "websocket" => Protocol::WebSocket,
            _ => unreachable!(),
        };
        let http = Http {
            requests: Mutex::new(vec![]),
            response: Mutex::new(Some(HttpResponse {
                status: 200,
                headers: vec![("Content-Type".into(), "audio/mpeg".into())],
                body: source(vec![vec![0, 255, 128]]),
            })),
        };
        let data = Arc::new(Mutex::new(SocketData {
            automatic: true,
            ..Default::default()
        }));
        let counts = Arc::new(Counts::default());
        let a = auth();
        let mut options = Options {
            auth: Some(&a),
            transport: Some(&http),
            protocol: Some(protocol),
            ..Options::default()
        };
        if protocol == Protocol::WebSocket {
            options.web_socket = Some(socket(data.clone(), counts.clone(), Arc::default()));
            options.entropy = Some(&entropy);
        }
        let mut stream = ready(synthesize(request, options)).unwrap();
        let items = collect(&mut stream).unwrap();
        if protocol == Protocol::WebSocket {
            let state = data.lock().unwrap();
            let mut wire = Raw::parse_exact(&state.sent[0]).unwrap().object().unwrap();
            assert_eq!(wire.remove("context_id").unwrap().string().unwrap(), FIRST);
            let expected: std::collections::BTreeMap<_, _> = case["body"]
                .object()
                .unwrap()
                .into_iter()
                .map(|(k, v)| (k, fixture(v)))
                .collect();
            let actual: std::collections::BTreeMap<_, _> =
                wire.into_iter().map(|(k, v)| (k, fixture(v))).collect();
            assert_eq!(actual, expected);
            assert_eq!(
                value(&state.sent[1]),
                value(&format!(
                    r#"{{"context_id":"{FIRST}","text":"","flush":true,"auto_close":true}}"#
                ))
            );
            assert_eq!(state.sent.len(), 2);
            assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
            assert_eq!(
                items,
                vec![
                    Value::Array(vec![
                        Value::String("audio".into()),
                        Value::String(FIRST.into()),
                        Value::Binary(vec![0, 255, 128])
                    ]),
                    value(&format!(r#"["flush","{FIRST}"]"#)),
                    value(r#""done""#)
                ]
            );
        } else {
            let requests = http.requests.lock().unwrap();
            assert_eq!(requests.len(), 1);
            let request = &requests[0];
            assert_eq!(request.method, "POST");
            let host = if case["path"].string().unwrap().starts_with("/tts/v2/") {
                "https://api.voice.ai"
            } else {
                "https://dev.voice.ai"
            };
            assert_eq!(
                request.url,
                format!("{host}{}", case["path"].string().unwrap())
            );
            assert_eq!(
                request.headers,
                vec![
                    ("Authorization".into(), "Bearer fixture".into()),
                    ("Content-Type".into(), "application/json".into()),
                    ("Accept".into(), "audio/*, application/octet-stream".into())
                ]
            );
            assert_eq!(
                value(std::str::from_utf8(&request.body).unwrap()),
                fixture(case["body"])
            );
            assert_eq!(
                items,
                vec![Value::Binary(vec![0, 255, 128]), value(r#""done""#)]
            );
        }
    }
}
