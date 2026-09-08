use speechswitch_types::generated::{camb, xai};

#[test]
fn closed_literal_unions_expose_const_scalar_values() {
    const LANGUAGE: &str = camb::TtsRequestMars81FlashBetaStreamingTextVoiceLanguage::EnUs(
        camb::TtsRequestMars81FlashBetaStreamingTextVoiceLanguageEnUs,
    )
    .value();
    const ENABLED: bool =
        camb::TtsRequestMars81FlashBetaStreamingTextVoiceAccentPreservation::True(
            camb::TtsRequestMars81FlashBetaStreamingTextVoiceAccentPreservationTrue,
        )
        .value();
    const DISABLED: bool =
        camb::TtsRequestMars81FlashBetaStreamingTextVoiceAccentPreservation::False(
            camb::TtsRequestMars81FlashBetaStreamingTextVoiceAccentPreservationFalse,
        )
        .value();
    const BIT_RATE: f64 = xai::TtsRequestTextOutputMp3BitRateBps::Number32000(
        xai::TtsRequestTextOutputMp3BitRateBpsNumber32000,
    )
    .value();
    assert_eq!(LANGUAGE, "en-us");
    assert_eq!((ENABLED, DISABLED), (true, false));
    assert_eq!(BIT_RATE, 32000.0);
}
