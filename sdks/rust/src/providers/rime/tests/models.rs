use super::*;

fn incremental(request: TtsRequest) -> TtsRequest {
    match request {
        TtsRequest::CodaTextVoicef75e9756(v) => {
            TtsRequest::CodaStreamingTextVoice33f4bd25(TtsRequestCodaStreamingTextVoice33f4bd25 {
                language: v.language,
                model: v.model,
                output: v.output,
                segmentation: v.segmentation,
                speed: v.speed,
                text: body(vec![Ok(text(&v.text))], true).0,
                timestamp_granularity: v.timestamp_granularity,
                voice: v.voice,
            })
        }
        TtsRequest::CodaTextVoice50d85478(v) => {
            TtsRequest::CodaStreamingTextVoice84ec2db1(TtsRequestCodaStreamingTextVoice84ec2db1 {
                language: v.language,
                model: v.model,
                output: v.output,
                segmentation: v.segmentation,
                speed: v.speed,
                text: body(vec![Ok(text(&v.text))], true).0,
                voice: v.voice,
            })
        }
        TtsRequest::MistV3TextVoice2a5bc5c5(v) => TtsRequest::MistV3StreamingTextVoice88a01d24(
            TtsRequestMistV3StreamingTextVoice88a01d24 {
                language: v.language,
                model: v.model,
                output: v.output,
                segmentation: v.segmentation,
                speed: v.speed,
                text: body(vec![Ok(text(&v.text))], true).0,
                timestamp_granularity: v.timestamp_granularity,
                text_markup: v.text_markup,
                voice: v.voice,
            },
        ),
        TtsRequest::MistV3TextVoice3fb6eaa2(v) => TtsRequest::MistV3StreamingTextVoice3acf8862(
            TtsRequestMistV3StreamingTextVoice3acf8862 {
                language: v.language,
                model: v.model,
                output: v.output,
                segmentation: v.segmentation,
                speed: v.speed,
                text: body(vec![Ok(text(&v.text))], true).0,
                timestamp_granularity: v.timestamp_granularity,
                text_markup: v.text_markup,
                voice: v.voice,
            },
        ),
        TtsRequest::MistV3TextVoice7d020de1(v) => TtsRequest::MistV3StreamingTextVoice49f68e83(
            TtsRequestMistV3StreamingTextVoice49f68e83 {
                language: v.language,
                model: v.model,
                output: v.output,
                segmentation: v.segmentation,
                speed: v.speed,
                text: body(vec![Ok(text(&v.text))], true).0,
                text_markup: v.text_markup,
                voice: v.voice,
            },
        ),
        TtsRequest::MistV2TextVoiceae274411(v) => TtsRequest::MistV2StreamingTextVoicec0dcaaf1(
            TtsRequestMistV2StreamingTextVoicec0dcaaf1 {
                language: v.language,
                model: v.model,
                output: v.output,
                segmentation: v.segmentation,
                speed: v.speed,
                text: body(vec![Ok(text(&v.text))], true).0,
                timestamp_granularity: v.timestamp_granularity,
                text_markup: v.text_markup,
                text_normalization: v.text_normalization,
                voice: v.voice,
            },
        ),
        TtsRequest::MistV2TextVoice20785ce4(v) => TtsRequest::MistV2StreamingTextVoice03cc8904(
            TtsRequestMistV2StreamingTextVoice03cc8904 {
                language: v.language,
                model: v.model,
                output: v.output,
                segmentation: v.segmentation,
                speed: v.speed,
                text: body(vec![Ok(text(&v.text))], true).0,
                text_markup: v.text_markup,
                text_normalization: v.text_normalization,
                voice: v.voice,
            },
        ),
        _ => panic!("fixture must supply whole text"),
    }
}

#[test]
fn every_model_language_branch_preserves_settings_and_text_in_both_input_forms() {
    let root = Raw::parse_exact(FIXTURES).unwrap().object().unwrap();
    let mut fixtures = root["requests"].array().unwrap();
    fixtures.push(Raw::parse_exact(r#"{"body":{"speaker":"custom-uuid","modelId":"mistv3","lang":"fr","samplingRate":24000,"timeScaleFactor":1,"pauseBetweenBrackets":false,"text":"Bonjour"}}"#).unwrap());
    for streaming in [false, true] {
        let mut requests = fixture_requests();
        requests.push(TtsRequest::MistV3TextVoice7d020de1(TtsRequestMistV3TextVoice7d020de1 {
            model: Default::default(), language: TtsRequestMistV2StreamingTextVoice03cc8904Language::Fr(Default::default()),
            voice: "custom-uuid".into(), text: "Bonjour".into(), output: None,
            speed: None, segmentation: None, text_markup: None,
        }));
        assert_eq!(requests.len(), fixtures.len());
        for ((request, f), format) in requests
            .into_iter()
            .zip(&fixtures)
            .zip(["pcm", "webm", "wav", "ogg", "pcm", "mp3", "mulaw", "pcm"])
        {
            let request = if streaming {
                incremental(request)
            } else {
                request
            };
            let expected = f.object().unwrap()["body"].object().unwrap();
            let prepared = settings::prepare(&request).unwrap();
            let actual = Raw::parse_exact(&prepared.wire).unwrap().object().unwrap();
            let expected_settings: std::collections::BTreeMap<_, _> = expected
                .iter()
                .filter(|(k, _)| k.as_str() != "text")
                .map(|(k, v)| (k.clone(), fixture(*v)))
                .collect();
            let actual_settings: std::collections::BTreeMap<_, _> =
                actual.into_iter().map(|(k, v)| (k, fixture(v))).collect();
            assert_eq!(actual_settings, expected_settings);
            let mut expected_query: std::collections::BTreeMap<_, _> = expected
                .iter()
                .filter(|(k, _)| k.as_str() != "text")
                .map(|(k, v)| (k.as_str(), v.string().unwrap_or_else(|_| v.text().into())))
                .collect();
            expected_query.insert("audioFormat", format.into());
            expected_query.insert("segment", "bySentence".into());
            let actual_query: std::collections::BTreeMap<_, _> =
                prepared.query.into_iter().collect();
            assert_eq!(actual_query, expected_query);
            let auth = auth();
            let (socket, state) = socket(true);
            let mut stream = ready(synthesize(
                request,
                Options {
                    auth: Some(&auth),
                    web_socket: Some(socket),
                    entropy: Some(&entropy),
                    ..Default::default()
                },
            ))
            .unwrap();
            assert_eq!(
                item(pull(&mut stream).unwrap().unwrap()),
                Item::Bytes(vec![0, 255])
            );
            assert_eq!(item(pull(&mut stream).unwrap().unwrap()), Item::Done);
            assert!(pull(&mut stream).is_none());
            let s = state.lock().unwrap();
            assert_eq!(s.drops, 1);
            assert_eq!(s.sent.len(), 2);
            let first = Raw::parse_exact(&s.sent[0]).unwrap().object().unwrap();
            assert_eq!(first.len(), 2);
            assert_eq!(
                first["text"].string().unwrap(),
                expected["text"].string().unwrap()
            );
            assert_eq!(
                first["contextId"].string().unwrap(),
                "000102030405060708090a0b0c0d0e0f:0"
            );
            assert_eq!(value(&s.sent[1]), value(r#"{"operation":"eos"}"#));
        }
    }
}

#[test]
fn binary_frames_are_rejected_and_release_owned_resources() {
    let (socket, state) = socket(false);
    state
        .lock()
        .unwrap()
        .replies
        .push_back(Ok(Message::Binary(vec![0, 255])));
    let (input, counts, _) = body(vec![], false);
    let mut stream = live(input, socket, false);
    assert_eq!(
        pull(&mut stream).unwrap().err().unwrap().to_string(),
        "Rime returned a non-text WebSocket frame"
    );
    assert!(pull(&mut stream).is_none());
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    assert_eq!(state.lock().unwrap().drops, 1);
}
