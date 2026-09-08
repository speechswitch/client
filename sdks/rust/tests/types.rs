use speechswitch_types::{generated::{amazon, xai}, runtime::{InputStream, StreamingInput}};
use std::{pin::Pin, task::{Context, Poll}, error::Error};

struct Once<T>(Option<T>);
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
