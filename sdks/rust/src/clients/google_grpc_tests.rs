use super::{google_grpc as wire, google_grpc_beta as beta};
use crate::protobuf::Error;

#[test]
fn oneofs_and_presence_have_exact_wire_bytes() {
    assert_eq!(
        wire::encode_streaming_request(&wire::StreamingSynthesizeRequest::default()),
        Ok(vec![])
    );
    let request = wire::StreamingSynthesizeRequest {
        streaming_request: Some(wire::StreamingSynthesizeRequestStreamingRequest::Input(
            wire::StreamingSynthesisInput {
                input_source: Some(wire::StreamingSynthesisInputInputSource::Text(String::new())),
                prompt: Some(String::new()),
            },
        )),
    };
    assert_eq!(
        wire::encode_streaming_request(&request),
        Ok(vec![18, 4, 10, 0, 50, 0])
    );
    assert_eq!(
        wire::encode_streaming_audio_config(&wire::StreamingAudioConfig {
            audio_encoding: wire::AudioEncoding::AudioEncodingUnspecified,
            sample_rate_hertz: Some(0),
            speaking_rate: Some(0.0),
        }),
        Ok(vec![8, 0, 16, 0, 25, 0, 0, 0, 0, 0, 0, 0, 0])
    );
    assert_eq!(
        wire::encode_advanced_voice_options(&wire::AdvancedVoiceOptions {
            enable_textnorm: Some(false),
            ..Default::default()
        }),
        Ok(vec![16, 0])
    );
    assert_eq!(
        wire::encode_multi_speaker_markup(&wire::MultiSpeakerMarkup { turns: vec![] }),
        Ok(vec![])
    );
    assert_eq!(
        beta::encode_streaming_audio_config(&beta::StreamingAudioConfig {
            audio_encoding: beta::AudioEncoding::Mp364Kbps,
            sample_rate_hertz: None,
            speaking_rate: None,
        }),
        Ok(vec![8, 4])
    );
    assert_eq!(
        wire::STREAMING_SYNTHESIZE_PATH,
        "/google.cloud.texttospeech.v1.TextToSpeech/StreamingSynthesize"
    );
    assert_eq!(
        beta::STREAMING_SYNTHESIZE_PATH,
        "/google.cloud.texttospeech.v1beta1.TextToSpeech/StreamingSynthesize"
    );
}

#[test]
fn response_presence_unknown_fields_and_ownership() {
    for (data, expected) in [
        (vec![], None),
        (vec![10, 0], Some(vec![])),
        (vec![16, 1, 42, 2, 1, 2, 10, 2, 0, 255], Some(vec![0, 255])),
        (vec![10, 3, 0, 255, 1, 10, 0], Some(vec![])),
    ] {
        assert_eq!(
            wire::decode_streaming_response(&data)
                .unwrap()
                .audio_content,
            expected
        );
        assert_eq!(
            beta::decode_streaming_response(&data)
                .unwrap()
                .audio_content,
            expected
        );
    }
    let mut data = vec![10, 2, 1, 2];
    let response = wire::decode_streaming_response(&data).unwrap();
    data[2] = 99;
    assert_eq!(response.audio_content, Some(vec![1, 2]));
}

#[test]
fn exact_response_errors_and_no_partial_encoding() {
    for (data, message) in [
        (vec![0], "Invalid protobuf field number"),
        (
            vec![8, 1],
            "Invalid protobuf wire type for StreamingSynthesizeResponse.audioContent",
        ),
        (vec![10, 4, 1], "Truncated protobuf message"),
        (vec![19], "Unsupported protobuf wire type: 3"),
        (
            vec![255, 255, 255, 255, 255, 255, 255, 255, 255, 2],
            "Invalid protobuf varint",
        ),
    ] {
        assert_eq!(
            wire::decode_streaming_response(&data),
            Err(Error(message.into()))
        );
        assert_eq!(
            beta::decode_streaming_response(&data),
            Err(Error(message.into()))
        );
    }
    for number in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        assert_eq!(
            wire::encode_streaming_audio_config(&wire::StreamingAudioConfig {
                audio_encoding: wire::AudioEncoding::Pcm,
                sample_rate_hertz: None,
                speaking_rate: Some(number),
            }),
            Err(Error("Invalid protobuf double".into()))
        );
    }
}
