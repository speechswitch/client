use super::*;
use crate::{
    generated::{auth::AuthGoogle, google::*},
    grpc::GrpcLike,
    http::{HttpRequest, HttpResponse},
    runtime::{InputStream, StreamingInput},
};
use std::{
    collections::VecDeque,
    future::{poll_fn, Future},
    pin::Pin,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex,
    },
    task::{Context, Poll, Wake, Waker},
};

macro_rules! gemini_fields {
    ($name:ident, $($field:ident:$value:expr),* $(,)?) => { $name {
        input_type:None,instructions:None,safety_settings:None,speed:None,text_normalization:None,language:"en-US".into(),$($field:$value,)*
    } };
}
mod fixtures;
mod lifecycle;
mod native;

#[derive(Default)]
struct Counts {
    reads: AtomicUsize,
    drops: AtomicUsize,
    wakes: AtomicUsize,
}
impl Wake for Counts {
    fn wake(self: Arc<Self>) {
        self.wake_by_ref();
    }
    fn wake_by_ref(self: &Arc<Self>) {
        self.wakes.fetch_add(1, Ordering::SeqCst);
    }
}
struct Source<T> {
    items: VecDeque<Result<T, TransportError>>,
    counts: Arc<Counts>,
    stall: bool,
}
impl<T: Unpin + Send> InputStream<T> for Source<T> {
    fn poll_next(
        self: Pin<&mut Self>,
        _: &mut Context<'_>,
    ) -> Poll<Option<Result<T, TransportError>>> {
        let s = self.get_mut();
        s.counts.reads.fetch_add(1, Ordering::SeqCst);
        match s.items.pop_front() {
            Some(item) => Poll::Ready(Some(item)),
            None if s.stall => Poll::Pending,
            None => Poll::Ready(None),
        }
    }
}
impl<T> Drop for Source<T> {
    fn drop(&mut self) {
        self.counts.drops.fetch_add(1, Ordering::SeqCst);
    }
}
fn source<T: Send + Unpin + 'static>(
    items: Vec<Result<T, TransportError>>,
    counts: &Arc<Counts>,
    stall: bool,
) -> StreamingInput<T> {
    Box::pin(Source {
        items: items.into(),
        counts: counts.clone(),
        stall,
    })
}
fn ready<T>(future: impl Future<Output = T>) -> T {
    let counts = Arc::new(Counts::default());
    let waker = Waker::from(counts.clone());
    let mut cx = Context::from_waker(&waker);
    let mut future = std::pin::pin!(future);
    for _ in 0..10000 {
        let before = counts.wakes.load(Ordering::SeqCst);
        match future.as_mut().poll(&mut cx) {
            Poll::Ready(value) => return value,
            Poll::Pending => assert!(
                counts.wakes.load(Ordering::SeqCst) > before,
                "pending without wake"
            ),
        }
    }
    panic!("did not finish")
}
fn next(stream: &mut Stream) -> Option<Result<Vec<u8>, TransportError>> {
    ready(poll_fn(|cx| Pin::new(&mut *stream).poll_next(cx)))
}
fn pending(stream: &mut Stream) {
    let waker = Waker::from(Arc::new(Counts::default()));
    assert!(Pin::new(stream)
        .poll_next(&mut Context::from_waker(&waker))
        .is_pending());
}
fn collect(stream: &mut Stream) -> Result<Vec<Vec<u8>>, TransportError> {
    let mut values = Vec::new();
    while let Some(item) = next(stream) {
        values.push(item?);
    }
    Ok(values)
}
fn auth() -> Auth {
    Auth {
        google: Some(AuthGoogle {
            api_key: Some("test-key".into()),
            access_token: Some("test-token".into()),
            quota_project: Some("test-project".into()),
        }),
        async_: None,
        aws: None,
        camb: None,
        cartesia: None,
        deepdub: None,
        deepgram: None,
        elevenlabs: None,
        fish: None,
        gradium: None,
        hume: None,
        inworld: None,
        kugelaudio: None,
        lovo: None,
        microsoft: None,
        minimax: None,
        mistral: None,
        murf: None,
        openai: None,
        resemble: None,
        respeecher: None,
        rime: None,
        smallest_ai: None,
        typecast: None,
        vocu: None,
        voice_ai: None,
        xai: None,
    }
}
fn voice() -> TtsRequestChirp3HdTextVoicebb77af5cVoice {
    TtsRequestChirp3HdTextVoicebb77af5cVoice::Kore(Default::default())
}
fn language() -> TtsRequestChirp3HdTextVoicebb77af5cLanguage {
    TtsRequestChirp3HdTextVoicebb77af5cLanguage::EnUS(Default::default())
}
fn wav() -> TtsRequestChirp3HdTextVoicebb77af5cOutputWav {
    TtsRequestChirp3HdTextVoicebb77af5cOutputWav {
        format: Default::default(),
        sample_encoding: None,
        sample_rate_hz: None,
        byte_order: None,
    }
}
fn pcm() -> TtsRequestChirp3HdTextVoicebb77af5cOutputPcm {
    TtsRequestChirp3HdTextVoicebb77af5cOutputPcm {
        format: Default::default(),
        sample_encoding: None,
        sample_rate_hz: None,
        byte_order: None,
    }
}
fn whole() -> TtsRequestTextVoice {
    gemini_fields!(TtsRequestTextVoice,model:TtsRequestTextVoiceModel::Gemini25FlashTts(Default::default()),voice:voice(),text:"hello".into(),output:TtsRequestChirp3HdTextVoicebb77af5cOutput::Wav(wav()),effects_profiles:None,pitch_semitones:None,volume_db:None)
}
fn streaming(input: StreamingInput<String>) -> TtsRequest {
    TtsRequest::Object7d956f3d(
        gemini_fields!(TtsRequestObject7d956f3d,model:TtsRequestTextVoiceModel::Gemini25FlashTts(Default::default()),voice:voice(),text:TtsRequestChirp3Hda92b414cText::AsyncIterable(input),output:TtsRequestChirp3Hda92b414cOutput::Pcm(pcm())),
    )
}
fn speakers() -> Vec<TtsRequestTextSpeakersItem> {
    vec![
        TtsRequestTextSpeakersItem {
            alias: "Sam".into(),
            voice: voice(),
        },
        TtsRequestTextSpeakersItem {
            alias: "Bob".into(),
            voice: TtsRequestChirp3HdTextVoicebb77af5cVoice::Puck(Default::default()),
        },
    ]
}
fn turns() -> Vec<settings::Turn> {
    vec![
        settings::Turn {
            speaker: "Sam".into(),
            text: "Hi".into(),
        },
        settings::Turn {
            speaker: "Bob".into(),
            text: "Hello".into(),
        },
    ]
}
struct Http {
    request: Mutex<Option<HttpRequest>>,
    response: Mutex<Option<HttpResponse>>,
}
impl HttpTransport for Http {
    fn send(
        &self,
        request: HttpRequest,
    ) -> Pin<Box<dyn Future<Output = Result<HttpResponse, TransportError>> + Send + '_>> {
        *self.request.lock().unwrap() = Some(request);
        Box::pin(async { Ok(self.response.lock().unwrap().take().unwrap()) })
    }
}
fn http(status: u16, body: StreamingInput<Vec<u8>>) -> Http {
    Http {
        request: Mutex::new(None),
        response: Mutex::new(Some(HttpResponse {
            status,
            body,
            headers: vec![],
        })),
    }
}

#[derive(Default)]
struct CallState {
    messages: Vec<Vec<u8>>,
    ended: bool,
    early_eof: bool,
    stall_flush: bool,
    send_error: Option<TransportError>,
    flush_error: Option<TransportError>,
    end_error: Option<TransportError>,
    incoming: VecDeque<Result<Vec<u8>, TransportError>>,
    drops: usize,
    receives: usize,
}
struct FakeCall(Arc<Mutex<CallState>>);
impl GrpcLike for FakeCall {
    fn start_send(self: Pin<&mut Self>, bytes: Vec<u8>) -> Result<(), TransportError> {
        let mut s = self.0.lock().unwrap();
        if let Some(error) = s.send_error.take() {
            return Err(error);
        }
        s.messages.push(bytes);
        Ok(())
    }
    fn start_end(self: Pin<&mut Self>) -> Result<(), TransportError> {
        let mut s = self.0.lock().unwrap();
        if let Some(error) = s.end_error.take() {
            return Err(error);
        }
        s.ended = true;
        Ok(())
    }
    fn poll_flush(self: Pin<&mut Self>, _: &mut Context<'_>) -> Poll<Result<(), TransportError>> {
        let mut s = self.0.lock().unwrap();
        if let Some(error) = s.flush_error.take() {
            return Poll::Ready(Err(error));
        }
        if s.stall_flush {
            Poll::Pending
        } else {
            Poll::Ready(Ok(()))
        }
    }
    fn poll_receive(
        self: Pin<&mut Self>,
        _: &mut Context<'_>,
    ) -> Poll<Option<Result<Vec<u8>, TransportError>>> {
        let mut s = self.0.lock().unwrap();
        s.receives += 1;
        match s.incoming.pop_front() {
            Some(value) => Poll::Ready(Some(value)),
            None if s.early_eof || s.ended => Poll::Ready(None),
            None => Poll::Pending,
        }
    }
}
impl Drop for FakeCall {
    fn drop(&mut self) {
        self.0.lock().unwrap().drops += 1;
    }
}
fn call(state: &Arc<Mutex<CallState>>) -> Call {
    Box::pin(FakeCall(state.clone()))
}
fn grpc_stream(request: TtsRequest, state: &Arc<Mutex<CallState>>) -> Stream {
    ready(synthesize(
        request,
        Options {
            auth: Some(&auth()),
            grpc: Some(call(state)),
            ..Default::default()
        },
    ))
    .unwrap()
}
fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
