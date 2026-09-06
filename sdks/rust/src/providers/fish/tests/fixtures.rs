use super::*;

fn samples() -> Vec<TtsRequestS1TextReferenceSamplesItem> {
    vec![TtsRequestS1TextReferenceSamplesItem {
        audio: vec![0, 255, 1],
        text: "my voice".into(),
    }]
}
pub(super) fn requests() -> Vec<TtsRequest> {
    let a = voice();
    let b = request_fields!(TtsRequestS1TextVoice,model:Default::default(),voice:"custom-voice".into(),text:"hello".into(),reference_samples:None,timestamp_granularity:None,output:TtsRequestS1TextOutput::Object(TtsRequestS1TextOutputObject {format:TtsRequestS1TextOutputObjectFormat::Pcm(Default::default()),sample_rate_hz:Some(24000.0)}));
    let mut c = voice();
    c.model = TtsRequestText486ba478Model::S21Pro(Default::default());
    c.output = TtsRequestS1TextOutput::Object(TtsRequestS1TextOutputObject {
        format: TtsRequestS1TextOutputObjectFormat::Wav(Default::default()),
        sample_rate_hz: None,
    });
    let mut d = voice();
    d.model = TtsRequestText486ba478Model::S21ProFree(Default::default());
    d.output = TtsRequestS1TextOutput::Mp3(TtsRequestS1TextOutputMp3 {
        format: Default::default(),
        sample_rate_hz: None,
        bit_rate_bps: Some(TtsRequestS1TextOutputMp3BitRateBps::Number192000(
            Default::default(),
        )),
    });
    let mut e = voice();
    e.output = TtsRequestS1TextOutput::OggOpus(TtsRequestS1TextOutputOggOpus {
        format: Default::default(),
        sample_rate_hz: None,
        bit_rate_bps: Some(TtsRequestS1TextOutputOggOpusBitRateBps::Number32000(
            Default::default(),
        )),
    });
    e.speed = Some(0.5);
    e.volume_db = Some(-6.0);
    e.loudness_normalization = Some(TtsRequestS1TextConditionOnPreviousChunks::False(
        Default::default(),
    ));
    e.temperature = Some(0.0);
    e.top_p = Some(0.0);
    e.text_chunk_length = Some(100.0);
    e.min_text_chunk_length = Some(0.0);
    e.max_audio_tokens = Some(2048.0);
    e.repetition_penalty = Some(1.5);
    e.condition_on_previous_chunks = Some(TtsRequestS1TextConditionOnPreviousChunks::False(
        Default::default(),
    ));
    e.early_stop_threshold = Some(0.0);
    e.text_normalization = Some(TtsRequestS1TextConditionOnPreviousChunks::False(
        Default::default(),
    ));
    e.latency_optimization = Some(TtsRequestS1TextLatencyOptimization::Aggressive(
        Default::default(),
    ));
    e.features = Some(vec!["quality-guard".into()]);
    let f = request_fields!(TtsRequestS1Text,model:Default::default(),text:"hello".into(),voice:None,reference_samples:samples(),output:mp3(),timestamp_granularity:None);
    let mut g = voice();
    g.reference_samples = Some(samples());
    let h = request_fields!(TtsRequestText486ba478,model:model(),text:"<|speaker:0|>Hello<|speaker:1|>Hi".into(),output:mp3(),loudness_normalization:None,timestamp_granularity:None,speakers:TtsRequestText486ba478Speakers::Arraybc859dfb(vec![TtsRequestText486ba478SpeakersArraybc859dfbItem{voice:"a".into()},TtsRequestText486ba478SpeakersArraybc859dfbItem{voice:"b".into()}]));
    let i = request_fields!(TtsRequestText486ba478,model:model(),text:"<|speaker:0|>Hello<|speaker:1|>Hi".into(),output:mp3(),loudness_normalization:None,timestamp_granularity:None,speakers:TtsRequestText486ba478Speakers::Array66345558(vec![TtsRequestText486ba478SpeakersArray66345558Item {reference_samples:vec![TtsRequestS1TextReferenceSamplesItem{audio:vec![1,2],text:"a".into()}]},TtsRequestText486ba478SpeakersArray66345558Item{reference_samples:vec![TtsRequestS1TextReferenceSamplesItem{audio:vec![3,4],text:"b".into()}]}]));
    vec![
        TtsRequest::TextVoice(a),
        TtsRequest::S1TextVoice(b),
        TtsRequest::TextVoice(c),
        TtsRequest::TextVoice(d),
        TtsRequest::TextVoice(e),
        TtsRequest::S1Text(f),
        TtsRequest::TextVoice(g),
        TtsRequest::Text486ba478(h),
        TtsRequest::Text486ba478(i),
    ]
}

#[test]
fn every_request_variant_converts_without_polling() {
    let counts = Arc::new(Counts::default());
    let input = || source(vec![], &counts, false);
    let speakers = || {
        TtsRequestText486ba478Speakers::Arraybc859dfb(vec![
            TtsRequestText486ba478SpeakersArraybc859dfbItem { voice: "a".into() },
        ])
    };
    let cases = vec![
        TtsRequest::S1Text(
            request_fields!(TtsRequestS1Text,model:Default::default(),text:"hello".into(),voice:None,reference_samples:samples(),output:mp3(),timestamp_granularity:None),
        ),
        TtsRequest::S1StreamingText(
            request_fields!(TtsRequestS1StreamingText,model:Default::default(),text:input(),voice:None,reference_samples:samples(),output:mp3()),
        ),
        TtsRequest::S1TextVoice(
            request_fields!(TtsRequestS1TextVoice,model:Default::default(),text:"hello".into(),voice:"custom-voice".into(),reference_samples:None,output:mp3(),timestamp_granularity:None),
        ),
        TtsRequest::S1StreamingTextVoice(
            request_fields!(TtsRequestS1StreamingTextVoice,model:Default::default(),text:input(),voice:"custom-voice".into(),reference_samples:None,output:mp3()),
        ),
        TtsRequest::Text486ba478(
            request_fields!(TtsRequestText486ba478,model:model(),text:"hello".into(),speakers:speakers(),output:mp3(),timestamp_granularity:None,loudness_normalization:None),
        ),
        TtsRequest::StreamingText5a166f9a(
            request_fields!(TtsRequestStreamingText5a166f9a,model:model(),text:input(),speakers:speakers(),output:mp3(),loudness_normalization:None),
        ),
        TtsRequest::Text054c2c18(
            request_fields!(TtsRequestText054c2c18,model:model(),text:"hello".into(),voice:None,reference_samples:samples(),output:mp3(),timestamp_granularity:None,loudness_normalization:None),
        ),
        TtsRequest::StreamingText8d1c40c1(
            request_fields!(TtsRequestStreamingText8d1c40c1,model:model(),text:input(),voice:None,reference_samples:samples(),output:mp3(),loudness_normalization:None),
        ),
        TtsRequest::TextVoice(voice()),
        streaming(input()),
    ];
    for request in cases {
        let _ = validate_request(&request).unwrap();
        let c = settings::prepare(request);
        let Value::Map(wire) = settings::wire(&c).unwrap() else {
            panic!()
        };
        assert_eq!(wire["format"], Value::String("mp3".into()));
        assert_eq!(wire["sample_rate"], Value::Number(44100.0));
    }
    assert_eq!(counts.reads.load(Ordering::SeqCst), 0);
    assert_eq!(counts.drops.load(Ordering::SeqCst), 5);
}
