use speechswitch_types::{generated::{amazon, microsoft, validators, xai}, runtime::{self, InputStream, JsonValue, ValidationError}};
use std::{error::Error, pin::Pin, sync::{Arc, atomic::{AtomicUsize, Ordering}}, task::{Context, Poll}};

struct Untouched(Arc<AtomicUsize>);
impl<T> InputStream<T> for Untouched {
    fn poll_next(self: Pin<&mut Self>, _: &mut Context<'_>) -> Poll<Option<Result<T, Box<dyn Error + Send + Sync>>>> {
        panic!("validator advanced input")
    }
}
impl Drop for Untouched {
    fn drop(&mut self) { self.0.fetch_add(1, Ordering::SeqCst); }
}

#[test]
fn input_checkers_preserve_narrowing_and_do_not_borrow_or_consume_requests() {
    let drops = Arc::new(AtomicUsize::new(0));
    let request = xai::TtsRequest::StreamingText(xai::TtsRequestStreamingText {
        text: Box::pin(Untouched(drops.clone())), language: None, latency_optimization: None,
        model: None, output: None, replacements: Some(vec![]), speed: Some(1.0),
        text_normalization: Some(xai::TtsRequestTextTextNormalization::False(xai::TtsRequestTextTextNormalizationFalse)),
        timestamp_granularity: None, voice: Some("existing-voice".into()),
    });
    let check = validators::xai::validate_request(&request).unwrap();
    assert_eq!(drops.load(Ordering::SeqCst), 0);
    // Moving the request after validation proves the checker did not retain a borrow.
    let xai::TtsRequest::StreamingText(request) = request else { panic!("wrong variant") };
    assert!(request.language.is_none());
    assert!(matches!(request.text_normalization, Some(xai::TtsRequestTextTextNormalization::False(_))));
    assert_eq!(request.replacements.as_ref().unwrap().len(), 0);
    assert_eq!(request.voice.as_deref(), Some("existing-voice"));
    drop(request);
    assert_eq!(drops.load(Ordering::SeqCst), 1);
    let clear = xai::TtsRequestStreamingTextTextItem::Clear(xai::TtsRequestStreamingTextTextItemClear {
        command: xai::TtsRequestStreamingTextTextItemClearCommand,
    });
    let update = xai::TtsRequestStreamingTextTextItem::Update(xai::TtsRequestStreamingTextTextItemUpdate {
        command: xai::TtsRequestStreamingTextTextItemUpdateCommand, replacements: vec![],
    });
    assert_eq!(check(&clear, None), Ok(()));
    assert_eq!(check(&update, Some("text")), Ok(()));
    assert_eq!(check(&clear, Some("turns")), Err(ValidationError("Invalid xai TTS input item")));
    assert_eq!(check(&"unwrapped".to_string(), None), Err(ValidationError("Invalid xai TTS input item")));

    let request = amazon::TtsRequest::GenerativeStreamingTextVoice(amazon::TtsRequestGenerativeStreamingTextVoice {
        text: Box::pin(Untouched(drops.clone())), voice: "Joanna".into(),
        model: amazon::TtsRequestTextVoiceModelGenerative, input_type: None, language: None, lexicon: None,
        output: amazon::TtsRequestTextVoiceOutput::Pcm(amazon::TtsRequestTextVoiceOutputPcm {
            format: amazon::TtsRequestTextVoiceOutputPcmFormat, sample_rate_hz: None,
        }),
    });
    let check = validators::amazon::validate_request(&request).unwrap();
    assert_eq!(drops.load(Ordering::SeqCst), 1);
    assert_eq!(check(&"text".to_string(), None), Ok(()));
    assert_eq!(check(&clear, None), Err(ValidationError("Invalid amazon TTS input item")));
    drop(request);
    assert_eq!(drops.load(Ordering::SeqCst), 2);
}

#[test]
fn microsoft_candidate_count_uses_the_generated_integer_constraint() {
    for (top_k, valid) in [(1.0, true), (22.0, true), (50.0, true), (1.5, false), (0.0, false), (51.0, false), (f64::NAN, false)] {
        let request = microsoft::TtsRequest::DragonHdOmniTextVoicea5a77562(microsoft::TtsRequestDragonHdOmniTextVoicea5a77562 {
            model: microsoft::TtsRequestDragonHdOmniTextVoicea5a77562Model, text: "Hello".into(), voice: "en-US-Ava".into(),
            top_k: Some(top_k), emotion: None, input_type: None, language: None, output: None, temperature: None, top_p: None, voice_guidance: None,
        });
        assert_eq!(validators::microsoft::validate_request(&request).map(|_| ()), if valid { Ok(()) } else { Err(ValidationError("Invalid microsoft TTS request")) });
    }
}

#[test]
fn json_numbers_are_checked_inside_the_owned_tree() {
    for number in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        let value = JsonValue::Object(std::collections::BTreeMap::from([
            ("nested".into(), JsonValue::Array(vec![JsonValue::Number(number)])),
        ]));
        assert!(!runtime::is_json_value(&value));
    }
    let mut value = JsonValue::Array(vec![JsonValue::Null, JsonValue::Bool(false), JsonValue::Number(0.0), JsonValue::String("😀".into())]);
    for _ in 0..2000 { value = JsonValue::Array(vec![value]); }
    assert!(runtime::is_json_value(&value));
}
