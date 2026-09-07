use super::*;
fn outputs() -> Vec<TtsRequestDragonHdFlashTextVoiceOutput> {
    use TtsRequestDragonHdFlashTextVoiceOutput as O;
    vec![
        O::Mp3c7ff7390(TtsRequestDragonHdFlashTextVoiceOutputMp3c7ff7390 {
            format: Default::default(),
            sample_rate_hz: Default::default(),
            bit_rate_bps: TtsRequestDragonHdFlashTextVoiceOutputMp3c7ff7390BitRateBps::Number128000(
                Default::default(),
            ),
        }),
        O::Mp3cfa54ac8(TtsRequestDragonHdFlashTextVoiceOutputMp3cfa54ac8 {
            format: Default::default(),
            sample_rate_hz: Default::default(),
            bit_rate_bps: TtsRequestDragonHdFlashTextVoiceOutputMp3cfa54ac8BitRateBps::Number160000(
                Default::default(),
            ),
        }),
        O::Mp332730738(TtsRequestDragonHdFlashTextVoiceOutputMp332730738 {
            format: Default::default(),
            sample_rate_hz: Default::default(),
            bit_rate_bps: TtsRequestDragonHdFlashTextVoiceOutputMp332730738BitRateBps::Number192000(
                Default::default(),
            ),
        }),
        O::Pcm(TtsRequestDragonHdFlashTextVoiceOutputPcm {
            format: Default::default(),
            sample_rate_hz: TtsRequestDragonHdFlashTextVoiceOutputPcmSampleRateHz::Number22050(
                Default::default(),
            ),
            byte_order: None,
            sample_encoding: None,
        }),
        O::Pcm(TtsRequestDragonHdFlashTextVoiceOutputPcm {
            format: Default::default(),
            sample_rate_hz: TtsRequestDragonHdFlashTextVoiceOutputPcmSampleRateHz::Number44100(
                Default::default(),
            ),
            byte_order: None,
            sample_encoding: None,
        }),
        O::Wavbcb4c8a6(TtsRequestDragonHdFlashTextVoiceOutputWavbcb4c8a6 {
            format: Default::default(),
            sample_rate_hz: TtsRequestDragonHdFlashTextVoiceOutputPcmSampleRateHz::Number16000(
                Default::default(),
            ),
            byte_order: None,
            sample_encoding: None,
        }),
        O::Wav7dc10d1f(TtsRequestDragonHdFlashTextVoiceOutputWav7dc10d1f {
            format: Default::default(),
            sample_rate_hz: Default::default(),
            sample_encoding: TtsRequestDragonHdFlashTextVoiceOutputObjectFormat::Alaw(
                Default::default(),
            ),
        }),
        O::Wav7dc10d1f(TtsRequestDragonHdFlashTextVoiceOutputWav7dc10d1f {
            format: Default::default(),
            sample_rate_hz: Default::default(),
            sample_encoding: TtsRequestDragonHdFlashTextVoiceOutputObjectFormat::Mulaw(
                Default::default(),
            ),
        }),
        O::Object(TtsRequestDragonHdFlashTextVoiceOutputObject {
            format: TtsRequestDragonHdFlashTextVoiceOutputObjectFormat::Alaw(Default::default()),
            sample_rate_hz: Default::default(),
        }),
        O::Object(TtsRequestDragonHdFlashTextVoiceOutputObject {
            format: TtsRequestDragonHdFlashTextVoiceOutputObjectFormat::Mulaw(Default::default()),
            sample_rate_hz: Default::default(),
        }),
        O::OggOpus(TtsRequestDragonHdFlashTextVoiceOutputOggOpus {
            format: Default::default(),
            sample_rate_hz: TtsRequestDragonHdFlashTextVoiceOutputOggOpusSampleRateHz::Number48000(
                Default::default(),
            ),
        }),
        O::Opusacd6a00c(TtsRequestDragonHdFlashTextVoiceOutputOpusacd6a00c {
            format: Default::default(),
            sample_rate_hz: Default::default(),
            bit_rate_bps: Default::default(),
        }),
        O::Opus0a945e79(TtsRequestDragonHdFlashTextVoiceOutputOpus0a945e79 {
            format: Default::default(),
            sample_rate_hz: Default::default(),
            bit_rate_bps: TtsRequestDragonHdFlashTextVoiceOutputOpus0a945e79BitRateBps::Number48000(
                Default::default(),
            ),
        }),
        O::WebmOpus036ccd81(TtsRequestDragonHdFlashTextVoiceOutputWebmOpus036ccd81 {
            format: Default::default(),
            sample_rate_hz: Default::default(),
            bit_rate_bps: Some(Default::default()),
        }),
        O::WebmOpus00bc3439(TtsRequestDragonHdFlashTextVoiceOutputWebmOpus00bc3439 {
            format: Default::default(),
            sample_rate_hz: Default::default(),
        }),
        O::Truesilk(TtsRequestDragonHdFlashTextVoiceOutputTruesilk {
            format: Default::default(),
            sample_rate_hz: TtsRequestDragonHdFlashTextVoiceOutputTruesilkSampleRateHz::Number24000(
                Default::default(),
            ),
        }),
        O::AmrWb(TtsRequestDragonHdFlashTextVoiceOutputAmrWb {
            format: Default::default(),
            sample_rate_hz: Default::default(),
        }),
        O::G722(TtsRequestDragonHdFlashTextVoiceOutputG722 {
            format: Default::default(),
            sample_rate_hz: Default::default(),
            bit_rate_bps: Default::default(),
        }),
    ]
}
#[test]
fn shared_output_format_tokens_and_streaming_subsets() {
    let expected = fixtures()["formats"].array().unwrap();
    assert_eq!(outputs().len(), expected.len());
    for (output, expected) in outputs().into_iter().zip(&expected) {
        let mut r = request();
        r.output = Some(output);
        let r = TtsRequest::TextVoice4ff226b4(r);
        let _ = validate_request(&r).unwrap();
        let c = settings::settings(r).unwrap();
        assert_eq!(c.format, expected.array().unwrap()[1].string().unwrap());
    }
    for (output, expected) in outputs().into_iter().zip(expected) {
        use TtsRequestDragonHdFlashStreamingTextVoiceOutput as S;
        use TtsRequestDragonHdFlashTextVoiceOutput as O;
        let output = match output {
            O::Mp3c7ff7390(v) => S::Mp3c7ff7390(v),
            O::Mp3cfa54ac8(v) => S::Mp3cfa54ac8(v),
            O::Mp332730738(v) => S::Mp332730738(v),
            O::Pcm(v) => S::Pcm(v),
            O::Wavbcb4c8a6(_) => continue,
            O::Wav7dc10d1f(_) => continue,
            O::Object(v) => S::Object(v),
            O::OggOpus(v) => S::OggOpus(v),
            O::Opusacd6a00c(v) => S::Opusacd6a00c(v),
            O::Opus0a945e79(v) => S::Opus0a945e79(v),
            O::WebmOpus036ccd81(v) => S::WebmOpus036ccd81(v),
            O::WebmOpus00bc3439(v) => S::WebmOpus00bc3439(v),
            O::Truesilk(v) => S::Truesilk(v),
            O::AmrWb(v) => S::AmrWb(v),
            O::G722(v) => S::G722(v),
        };
        let mut r = streaming(source(vec![]));
        r.output = Some(output);
        let r = TtsRequest::StreamingTextVoicee86a65c0(r);
        let check = validate_request(&r).unwrap();
        assert_eq!(check(&"Hi".to_owned(), None), Ok(()));
        let c = settings::settings(r).unwrap();
        assert_eq!(c.format, expected.array().unwrap()[1].string().unwrap());
        assert!(!c.wave);
    }
}
