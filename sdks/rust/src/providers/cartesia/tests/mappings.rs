use super::*;

#[test]
fn all_six_streaming_and_timed_request_shapes_preserve_independent_options() {
    for index in 0..6 {
        let counts = Arc::new(Counts::default());
        let trace = Trace::default();
        let text = || body(Vec::new(), &counts, &trace, false, "input");
        let output = || TtsRequestStreamingTextVoice0bf53a99Output::Pcm(pcm());
        let granularity = || {
            TtsRequestStreamingTextVoice12b0fd0cTimestampGranularity::Phoneme(Default::default())
        };
        let normalization = || {
            Some(TtsRequestTextVoicef0bb1766TextNormalization::False(
                Default::default(),
            ))
        };
        let timestamp_text = || {
            Some(TtsRequestStreamingTextVoice12b0fd0cTimestampText::Normalized(Default::default()))
        };
        let request = match index {
            0 => {
                let mut request = live(text());
                request.max_buffer_delay_ms = Some(0.0);
                request.text_normalization = normalization();
                request.language =
                    Some(TtsRequestTextVoicef0bb1766Language::En(Default::default()));
                TtsRequest::StreamingTextVoice0bf53a99(request)
            }
            1 => TtsRequest::StreamingTextVoice12b0fd0c(TtsRequestStreamingTextVoice12b0fd0c {
                text: text(),
                voice: "saved-custom".into(),
                output: output(),
                model: TtsRequestTextVoicef0bb1766Model::Sonic35(Default::default()),
                language: Some(TtsRequestTextVoicef0bb1766Language::En(Default::default())),
                timestamp_granularity: granularity(),
                timestamp_text: timestamp_text(),
                max_buffer_delay_ms: Some(0.0),
                text_normalization: normalization(),
                accent: None,
                emotion: None,
                lexicon: None,
                speed: None,
                volume_scale: None,
            }),
            2 => TtsRequest::TextVoicec75c718e(TtsRequestTextVoicec75c718e {
                text: "Hello".into(),
                voice: "saved-custom".into(),
                output: output(),
                model: TtsRequestTextVoicef0bb1766Model::Sonic35(Default::default()),
                language: Some(TtsRequestTextVoicef0bb1766Language::En(Default::default())),
                timestamp_granularity: granularity(),
                timestamp_text: timestamp_text(),
                text_normalization: normalization(),
                accent: None,
                emotion: None,
                lexicon: None,
                speed: None,
                volume_scale: None,
            }),
            3 => TtsRequest::Sonic36StreamingTextVoice15b369c8(
                TtsRequestSonic36StreamingTextVoice15b369c8 {
                    text: text(),
                    voice: "saved-custom".into(),
                    output: output(),
                    model: Default::default(),
                    language: Some("en-GB".into()),
                    max_buffer_delay_ms: Some(0.0),
                    text_normalization: normalization(),
                    accent: None,
                    emotion: None,
                    lexicon: None,
                    speed: None,
                    volume_scale: None,
                },
            ),
            4 => TtsRequest::Sonic36StreamingTextVoice9ed3706f(
                TtsRequestSonic36StreamingTextVoice9ed3706f {
                    text: text(),
                    voice: "saved-custom".into(),
                    output: output(),
                    model: Default::default(),
                    language: Some("en-GB".into()),
                    max_buffer_delay_ms: Some(0.0),
                    text_normalization: normalization(),
                    timestamp_granularity: granularity(),
                    timestamp_text: timestamp_text(),
                    accent: None,
                    emotion: None,
                    lexicon: None,
                    speed: None,
                    volume_scale: None,
                },
            ),
            5 => TtsRequest::Sonic36TextVoice448a171b(TtsRequestSonic36TextVoice448a171b {
                text: "Hello".into(),
                voice: "saved-custom".into(),
                output: output(),
                model: Default::default(),
                language: Some("en-GB".into()),
                text_normalization: normalization(),
                timestamp_granularity: granularity(),
                timestamp_text: timestamp_text(),
                accent: None,
                emotion: None,
                lexicon: None,
                speed: None,
                volume_scale: None,
            }),
            _ => unreachable!(),
        };
        assert!(validate_request(&request).is_ok());
        let prepared = settings::prepare(request);
        let model = if index < 3 { "sonic-3.5" } else { "sonic-3.6" };
        let language = if index < 3 {
            r#""language":"en""#
        } else {
            r#""locale":"en-GB""#
        };
        let timed = index != 0 && index != 3;
        let streaming = index != 2 && index != 5;
        let buffer = if streaming {
            r#", "max_buffer_delay_ms":0"#
        } else {
            ""
        };
        assert_eq!(
            parse(&prepared.settings),
            parse(&format!(
                r#"{{"model_id":"{model}","voice":"saved-custom","output_format":{{"container":"raw","sample_rate":24000,"encoding":"pcm_s16le"}},{language},"normalization":"off","generation_config":{{}},"add_timestamps":false,"add_phoneme_timestamps":{timed},"use_normalized_timestamps":{timed}{buffer}}}"#
            ))
        );
        assert_eq!(prepared.timed, timed);
        assert_eq!(
            matches!(&prepared.text, settings::Text::Streaming(_)),
            streaming
        );
        drop(prepared);
        assert_eq!(counts.reads.load(Ordering::SeqCst), 0);
        assert_eq!(counts.drops.load(Ordering::SeqCst), usize::from(streaming));
    }
}
