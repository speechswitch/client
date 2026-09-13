use crate::generated::typecast::*;

pub(super) fn plain() -> TtsRequestSsfmV30TextVoicec9d5257e {
    TtsRequestSsfmV30TextVoicec9d5257e {
        text: "Hi".into(),
        voice: "uc_voice".into(),
        model: Default::default(),
        language: None,
        speed: None,
        pitch_semitones: None,
        random_seed: None,
        emotion: None,
        emotion_intensity: None,
        target_loudness_lufs: None,
        output: None,
    }
}
pub(super) fn timed() -> TtsRequestSsfmV30TextVoiceda7d6fa9 {
    TtsRequestSsfmV30TextVoiceda7d6fa9 {
        text: "Hi".into(),
        voice: "uc_voice".into(),
        model: Default::default(),
        language: None,
        speed: None,
        pitch_semitones: None,
        random_seed: None,
        emotion: None,
        emotion_intensity: None,
        target_loudness_lufs: None,
        output: None,
        timestamp_granularity: TtsRequestSsfmV21TextVoicec8409957TimestampGranularity::Word(
            Default::default(),
        ),
    }
}
pub(super) fn speech() -> TtsRequestObjectSegmentsItemSsfmV21TextVoice4e8a729e {
    TtsRequestObjectSegmentsItemSsfmV21TextVoice4e8a729e {
        text: "Hi".into(),
        voice: "uc_voice".into(),
        model: Default::default(),
        language: None,
        speed: None,
        pitch_semitones: None,
        random_seed: None,
        emotion: None,
        emotion_intensity: None,
        volume_scale: None,
        kind: Default::default(),
    }
}
pub(super) fn requests() -> Vec<TtsRequest> {
    vec![
        TtsRequest::SsfmV21TextVoicef82be0f4(TtsRequestSsfmV21TextVoicef82be0f4 {
            text: " Hello <|0.3s|> ".into(),
            voice: "tc_voice".into(),
            model: Default::default(),
            language: None,
            speed: None,
            pitch_semitones: None,
            random_seed: None,
            emotion: None,
            emotion_intensity: None,
            target_loudness_lufs: None,
            output: None,
        }),
        TtsRequest::SsfmV21TextVoicec8409957(TtsRequestSsfmV21TextVoicec8409957 {
            text: "안녕!".into(),
            voice: "uc_voice".into(),
            model: Default::default(),
            language: Some(
                TtsRequestObjectSegmentsItemSsfmV21TextVoiceb3babbe2Language::Ko(Default::default()),
            ),
            speed: None,
            pitch_semitones: None,
            random_seed: None,
            emotion: None,
            emotion_intensity: None,
            target_loudness_lufs: None,
            output: None,
            timestamp_granularity: TtsRequestSsfmV21TextVoicec8409957TimestampGranularity::Word(
                Default::default(),
            ),
        }),
        TtsRequest::SsfmV21TextVoiceb54b9734(TtsRequestSsfmV21TextVoiceb54b9734 {
            text: "Hi".into(),
            voice: "tc_voice".into(),
            model: Default::default(),
            language: None,
            speed: None,
            pitch_semitones: None,
            random_seed: Some(0.0),
            emotion: Some(
                TtsRequestObjectSegmentsItemSsfmV21TextVoiceb3babbe2Emotion::Angry(
                    Default::default(),
                ),
            ),
            emotion_intensity: Some(0.0),
            volume_scale: 0.0,
            output: None,
            timestamp_granularity: None,
        }),
        TtsRequest::SsfmV30TextVoicec9d5257e(TtsRequestSsfmV30TextVoicec9d5257e {
            text: "Hi".into(),
            voice: "uc_voice".into(),
            model: Default::default(),
            language: Some(
                TtsRequestObjectSegmentsItemSsfmV30TextVoiceaa70b792Language::Hi(Default::default()),
            ),
            speed: Some(0.5),
            pitch_semitones: Some(-12.0),
            random_seed: None,
            emotion: Some(
                TtsRequestObjectSegmentsItemSsfmV30TextVoiceaa70b792Emotion::Whisper(
                    Default::default(),
                ),
            ),
            emotion_intensity: None,
            target_loudness_lufs: None,
            output: Some(TtsRequestSsfmV21TextVoicef82be0f4Output::Mp3(
                TtsRequestObjectOutputMp3 {
                    format: Default::default(),
                    bit_rate_bps: Some(Default::default()),
                    sample_rate_hz: Some(Default::default()),
                },
            )),
        }),
        TtsRequest::SsfmV30TextVoiceda7d6fa9(TtsRequestSsfmV30TextVoiceda7d6fa9 {
            text: "안녕!".into(),
            voice: "tc_voice".into(),
            model: Default::default(),
            language: None,
            speed: None,
            pitch_semitones: None,
            random_seed: None,
            emotion: Some(
                TtsRequestObjectSegmentsItemSsfmV30TextVoiceaa70b792Emotion::Toneup(
                    Default::default(),
                ),
            ),
            emotion_intensity: Some(2.0),
            target_loudness_lufs: None,
            output: None,
            timestamp_granularity: TtsRequestSsfmV21TextVoicec8409957TimestampGranularity::Array(
                vec![
                    TtsRequestSsfmV21TextVoicec8409957TimestampGranularityArrayItem::Character(
                        Default::default(),
                    ),
                    TtsRequestSsfmV21TextVoicec8409957TimestampGranularityArrayItem::Word(
                        Default::default(),
                    ),
                    TtsRequestSsfmV21TextVoicec8409957TimestampGranularityArrayItem::Word(
                        Default::default(),
                    ),
                ],
            ),
        }),
        TtsRequest::SsfmV30TextVoice2e7e5231(TtsRequestSsfmV30TextVoice2e7e5231 {
            text: "Hi".into(),
            voice: "tc_voice".into(),
            model: Default::default(),
            language: None,
            speed: Some(2.0),
            pitch_semitones: None,
            random_seed: Some(4294967295.0),
            emotion: None,
            emotion_intensity: None,
            volume_scale: 0.005,
            output: None,
            timestamp_granularity: None,
        }),
        TtsRequest::SsfmV30TextVoicebb79df90(TtsRequestSsfmV30TextVoicebb79df90 {
            text: "Hi".into(),
            voice: "uc_voice".into(),
            model: Default::default(),
            language: Some(
                TtsRequestObjectSegmentsItemSsfmV30TextVoiceaa70b792Language::Auto(
                    Default::default(),
                ),
            ),
            speed: None,
            pitch_semitones: None,
            random_seed: None,
            emotion: Default::default(),
            context_before: Some(
                TtsRequestObjectSegmentsItemSsfmV30TextVoice0e2e956cContextAfter {
                    text: "Before".into(),
                },
            ),
            context_after: Some(
                TtsRequestObjectSegmentsItemSsfmV30TextVoice0e2e956cContextAfter {
                    text: "After".into(),
                },
            ),
            target_loudness_lufs: Some(0.0),
            output: None,
        }),
        TtsRequest::SsfmV30TextVoice862867af(TtsRequestSsfmV30TextVoice862867af {
            text: "안녕!".into(),
            voice: "tc_voice".into(),
            model: Default::default(),
            language: None,
            speed: None,
            pitch_semitones: None,
            random_seed: None,
            emotion: Default::default(),
            context_before: None,
            context_after: None,
            target_loudness_lufs: None,
            output: None,
            timestamp_granularity:
                TtsRequestSsfmV21TextVoicec8409957TimestampGranularity::Character(Default::default()),
        }),
        TtsRequest::SsfmV30TextVoicec3047c31(TtsRequestSsfmV30TextVoicec3047c31 {
            text: "Hi".into(),
            voice: "uc_voice".into(),
            model: Default::default(),
            language: None,
            speed: None,
            pitch_semitones: None,
            random_seed: None,
            emotion: Default::default(),
            context_before: Some(
                TtsRequestObjectSegmentsItemSsfmV30TextVoice0e2e956cContextAfter {
                    text: "".into(),
                },
            ),
            context_after: None,
            volume_scale: 2.0,
            output: None,
            timestamp_granularity: None,
        }),
        TtsRequest::SsfmV30TextVoiceda7d6fa9(TtsRequestSsfmV30TextVoiceda7d6fa9 {
            text: "Hi".into(),
            voice: "tc_voice".into(),
            model: Default::default(),
            language: None,
            speed: None,
            pitch_semitones: None,
            random_seed: None,
            emotion: None,
            emotion_intensity: None,
            target_loudness_lufs: None,
            output: None,
            timestamp_granularity: TtsRequestSsfmV21TextVoicec8409957TimestampGranularity::Array(
                vec![],
            ),
        }),
        TtsRequest::SsfmV21TextVoicef82be0f4(TtsRequestSsfmV21TextVoicef82be0f4 {
            text: "Hi".into(),
            voice: "tc_voice".into(),
            model: Default::default(),
            language: None,
            speed: None,
            pitch_semitones: None,
            random_seed: None,
            emotion: None,
            emotion_intensity: None,
            target_loudness_lufs: None,
            output: Some(TtsRequestSsfmV21TextVoicef82be0f4Output::Wav(
                TtsRequestSsfmV21TextVoicef82be0f4OutputWav {
                    format: Default::default(),
                    byte_order: None,
                    channel_count: None,
                    sample_encoding: None,
                    sample_rate_hz: Some(
                        TtsRequestSsfmV21TextVoicef82be0f4OutputWavSampleRateHz::Number44100(
                            Default::default(),
                        ),
                    ),
                },
            )),
        }),
        TtsRequest::Object(TtsRequestObject {
            output: Some(TtsRequestObjectOutput::Mp3(TtsRequestObjectOutputMp3 {
                format: Default::default(),
                sample_rate_hz: None,
                bit_rate_bps: None,
            })),
            segments: vec![
                TtsRequestObjectSegmentsItem::SsfmV21TextVoice4e8a729e(
                    TtsRequestObjectSegmentsItemSsfmV21TextVoice4e8a729e {
                        text: "A".into(),
                        voice: "tc_one".into(),
                        model: Default::default(),
                        language: None,
                        speed: None,
                        pitch_semitones: None,
                        random_seed: None,
                        emotion: None,
                        emotion_intensity: None,
                        volume_scale: Some(0.0),
                        kind: Default::default(),
                    },
                ),
                TtsRequestObjectSegmentsItem::SsfmV21TextVoiceb3babbe2(
                    TtsRequestObjectSegmentsItemSsfmV21TextVoiceb3babbe2 {
                        text: "B".into(),
                        voice: "uc_two".into(),
                        model: Default::default(),
                        language: None,
                        speed: None,
                        pitch_semitones: None,
                        random_seed: None,
                        emotion: None,
                        emotion_intensity: None,
                        target_loudness_lufs: -70.0,
                        kind: Default::default(),
                    },
                ),
                TtsRequestObjectSegmentsItem::SsfmV30TextVoice0a18e1a3(
                    TtsRequestObjectSegmentsItemSsfmV30TextVoice0a18e1a3 {
                        text: "C".into(),
                        voice: "tc_three".into(),
                        model: Default::default(),
                        language: None,
                        speed: None,
                        pitch_semitones: None,
                        random_seed: None,
                        emotion: Some(
                            TtsRequestObjectSegmentsItemSsfmV30TextVoiceaa70b792Emotion::Whisper(
                                Default::default(),
                            ),
                        ),
                        emotion_intensity: None,
                        volume_scale: None,
                        kind: Default::default(),
                    },
                ),
                TtsRequestObjectSegmentsItem::SsfmV30TextVoiceaa70b792(
                    TtsRequestObjectSegmentsItemSsfmV30TextVoiceaa70b792 {
                        text: "D".into(),
                        voice: "tc_four".into(),
                        model: Default::default(),
                        language: None,
                        speed: None,
                        pitch_semitones: None,
                        random_seed: None,
                        emotion: None,
                        emotion_intensity: None,
                        target_loudness_lufs: 0.0,
                        kind: Default::default(),
                    },
                ),
                TtsRequestObjectSegmentsItem::Object(TtsRequestObjectSegmentsItemObject {
                    kind: Default::default(),
                    pause_ms: 500.0,
                }),
                TtsRequestObjectSegmentsItem::SsfmV30TextVoice9cf1a777(
                    TtsRequestObjectSegmentsItemSsfmV30TextVoice9cf1a777 {
                        text: "E".into(),
                        voice: "uc_five".into(),
                        model: Default::default(),
                        language: None,
                        speed: None,
                        pitch_semitones: None,
                        random_seed: None,
                        emotion: Default::default(),
                        context_before: None,
                        context_after: None,
                        volume_scale: Some(1.0),
                        kind: Default::default(),
                    },
                ),
                TtsRequestObjectSegmentsItem::SsfmV30TextVoice0e2e956c(
                    TtsRequestObjectSegmentsItemSsfmV30TextVoice0e2e956c {
                        text: "F".into(),
                        voice: "uc_six".into(),
                        model: Default::default(),
                        language: None,
                        speed: None,
                        pitch_semitones: None,
                        random_seed: None,
                        emotion: Default::default(),
                        context_before: None,
                        context_after: Some(
                            TtsRequestObjectSegmentsItemSsfmV30TextVoice0e2e956cContextAfter {
                                text: "Next".into(),
                            },
                        ),
                        target_loudness_lufs: -20.0,
                        kind: Default::default(),
                    },
                ),
            ],
        }),
    ]
}
