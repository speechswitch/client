use speechswitch_types::{generated::{amazon, kugelaudio, lovo, microsoft, xai}, runtime::{InputStream, StreamingInput}};
use std::{pin::Pin, task::{Context, Poll}, error::Error};

struct Once<T>(Option<T>);

#[test]
fn microsoft_generated_model_preserves_streaming_and_zero_temperature() {
    let mut request = microsoft::TtsRequestDragonHdStreamingTextVoice {
        model: microsoft::TtsRequestDragonHdTextVoiceModel,
        voice: "en-US-Ava".into(), text: Box::pin(Once(Some("Hello".to_string()))),
        temperature: Some(0.0), input_type: None, language: None, output: None,
    };
    assert_eq!(request.model.value(), "dragon-hd");
    assert_eq!(request.temperature, Some(0.0));
    let mut context = Context::from_waker(std::task::Waker::noop());
    let Poll::Ready(Some(Ok(text))) = request.text.as_mut().poll_next(&mut context) else { panic!("expected incremental text") };
    assert_eq!(text, "Hello");
}

#[test]
fn lovo_generated_request_preserves_a_saved_voice_style() {
    let request = lovo::TtsRequest { text: "Hello".into(), voice: "speaker".into(), voice_style: Some("saved-style".into()), speed: None };
    assert_eq!(request.voice_style.as_deref(), Some("saved-style"));
    assert_eq!(request.speed, None);
}
impl<T: Send + Unpin> InputStream<T> for Once<T> {
    fn poll_next(mut self: Pin<&mut Self>, _: &mut Context<'_>) -> Poll<Option<Result<T, Box<dyn Error + Send + Sync>>>> {
        Poll::Ready(self.0.take().map(Ok))
    }
}

#[test]
fn xai_commands_and_amazon_text_remain_different_stream_types() {
    let clear = xai::TtsRequestStreamingTextTextItemClear { command: xai::TtsRequestStreamingTextTextItemClearCommand };
    assert_eq!(clear.command.value(), "clear");
    let _xai_input: StreamingInput<xai::TtsRequestStreamingTextTextItem> = Box::pin(Once(Some(xai::TtsRequestStreamingTextTextItem::Clear(clear))));
    let amazon_input: StreamingInput<String> = Box::pin(Once(Some("Hello".to_string())));
    let _request = amazon::TtsRequest::GenerativeStreamingTextVoice(amazon::TtsRequestGenerativeStreamingTextVoice {
        input_type: None, language: None, lexicon: None,
        model: amazon::TtsRequestTextVoiceModelGenerative,
        output: amazon::TtsRequestTextVoiceOutput::Pcm(amazon::TtsRequestTextVoiceOutputPcm {
            format: amazon::TtsRequestTextVoiceOutputPcmFormat, sample_rate_hz: None,
        }),
        text: amazon_input, voice: "Joanna".to_string(),
    });
}

#[test]
fn kugelaudio_generated_updates_preserve_zero_false_and_omission() {
    let update = kugelaudio::TtsRequestStreamingTextVoiceTextItemUpdate {
        command: kugelaudio::TtsRequestStreamingTextVoiceTextItemUpdateCommand,
        language: None, max_audio_tokens: None, speed: None, voice_guidance: None,
        temperature: Some(0.0),
        text_normalization: Some(kugelaudio::TtsRequestTextVoiceTextNormalization::False(kugelaudio::TtsRequestTextVoiceTextNormalizationFalse)),
    };
    let mut stream: StreamingInput<kugelaudio::TtsRequestStreamingTextVoiceTextItem> = Box::pin(Once(Some(kugelaudio::TtsRequestStreamingTextVoiceTextItem::Update(update))));
    let mut context = Context::from_waker(std::task::Waker::noop());
    let Poll::Ready(Some(Ok(kugelaudio::TtsRequestStreamingTextVoiceTextItem::Update(actual)))) = stream.as_mut().poll_next(&mut context) else { panic!("expected update") };
    assert_eq!(actual.command.value(), "update");
    assert_eq!(actual.temperature, Some(0.0));
    assert_eq!(actual.speed, None);
    assert!(matches!(actual.text_normalization, Some(kugelaudio::TtsRequestTextVoiceTextNormalization::False(_))));
    let default_selection = kugelaudio::TtsRequestTextVoicePronunciationDictionarySelection { scope: 10.0, ids: None };
    let disabled = kugelaudio::TtsRequestTextVoicePronunciationDictionarySelection { scope: 10.0, ids: Some(vec![]) };
    assert!(default_selection.ids.is_none());
    assert_eq!(disabled.ids, Some(vec![]));
}
