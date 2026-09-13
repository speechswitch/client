use super::*;
use std::time::{Duration, Instant};

const PING: &str = r#"{"type":"ping"}"#;

#[test]
fn continuation_eof_and_batch_keep_heartbeat_alive_after_clear() {
    let (socket, state) = socket(false);
    let (source, counts, _) = body(vec![Ok(clear())], true);
    let mut stream = heartbeat(continuation(source), socket);
    assert_eq!(item(pull(&mut stream).unwrap().unwrap()), Item::Clear);
    let final_message = sent(&mut stream, &state, 2);
    assert_eq!(
        value(&final_message),
        value(r#"{"context_id":"context","voice_id":"custom-uuid","continue":false}"#)
    );
    reply(&state, r#"{"type":"pong"}"#);
    reply(
        &state,
        r#"{"status":"complete","request_id":"batch","external_request_id":"000102030405060708090a0b0c0d0e0f-1"}"#,
    );
    assert_eq!(
        item(pull(&mut stream).unwrap().unwrap()),
        Item::Batch("batch".into())
    );
    let reads = counts.reads.load(Ordering::SeqCst);
    wait_until(|| state.lock().unwrap().sent.len() == 3);
    assert_eq!(state.lock().unwrap().sent[2], PING);
    assert_eq!(counts.reads.load(Ordering::SeqCst), reads);
    drop(stream);
    assert_eq!(state.lock().unwrap().drops, 1);
}
fn heartbeat(request: TtsRequest, socket: Socket) -> Stream {
    let auth = auth();
    ready(synthesize(
        request,
        Options {
            auth: Some(&auth),
            web_socket: Some(socket),
            entropy: Some(&entropy),
            protocol: Some(Protocol::WebSocket),
            idle_timeout_seconds: 1,
            ..Default::default()
        },
    ))
    .unwrap()
}
fn wait_until(mut condition: impl FnMut() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(3);
    while !condition() {
        assert!(
            Instant::now() < deadline,
            "background socket work did not progress"
        );
        std::thread::sleep(Duration::from_millis(1));
    }
}
fn reply(state: &Arc<Mutex<SocketState>>, packet: &str) {
    let mut state = state.lock().unwrap();
    state.replies.push_back(Ok(Message::Text(packet.into())));
    let waker = state.read_waker.take();
    drop(state);
    if let Some(waker) = waker {
        waker.wake();
    }
}

#[test]
fn idle_heartbeat_never_polls_input_and_drop_stops_it() {
    let (socket, state) = socket(false);
    let (source, counts, _) = body::<String>(vec![], false);
    let stream = heartbeat(streaming(source), socket);
    wait_until(|| !state.lock().unwrap().sent.is_empty());
    assert_eq!(state.lock().unwrap().sent, vec![PING]);
    assert_eq!(counts.reads.load(Ordering::SeqCst), 0);
    reply(&state, r#"{"type":"pong"}"#);
    wait_until(|| state.lock().unwrap().replies.is_empty());
    drop(stream);
    assert_eq!(state.lock().unwrap().drops, 1);
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    std::thread::sleep(Duration::from_millis(550));
    assert_eq!(state.lock().unwrap().sent, vec![PING]);
}

#[test]
fn heartbeat_write_failure_closes_paused_socket_and_keeps_original_error() {
    let (socket, state) = socket(false);
    let mut stream = heartbeat(whole(), socket);
    tick(&mut stream);
    reply(&state, CHUNK);
    assert!(matches!(
        pull(&mut stream),
        Some(Ok(SynthesisItem::Bytes(_)))
    ));
    state.lock().unwrap().failure = Some(Box::new(std::io::Error::other("heartbeat failed")));
    wait_until(|| state.lock().unwrap().drops == 1);
    let error = pull(&mut stream).unwrap().err().unwrap();
    assert_eq!(
        error.downcast_ref::<std::io::Error>().unwrap().to_string(),
        "heartbeat failed"
    );
    assert!(pull(&mut stream).is_none());
    assert_eq!(state.lock().unwrap().drops, 1);
}

#[test]
fn heartbeat_waits_for_backpressure_without_advancing_input() {
    let (socket, state) = socket(false);
    state.lock().unwrap().flush_pending = true;
    let (source, counts, _) = body(vec![Ok("Hello".into()), Ok("Later".into())], false);
    let mut stream = heartbeat(streaming(source), socket);
    tick(&mut stream);
    reply(&state, CHUNK);
    assert!(matches!(
        pull(&mut stream),
        Some(Ok(SynthesisItem::Bytes(_)))
    ));
    std::thread::sleep(Duration::from_millis(550));
    assert_eq!(state.lock().unwrap().sent.len(), 1);
    assert_eq!(counts.reads.load(Ordering::SeqCst), 1);
    let waker = {
        let mut state = state.lock().unwrap();
        state.flush_pending = false;
        state.write_waker.take().unwrap()
    };
    waker.wake();
    wait_until(|| state.lock().unwrap().sent.len() == 2);
    assert_eq!(state.lock().unwrap().sent[1], PING);
    assert_eq!(counts.reads.load(Ordering::SeqCst), 1);
    drop(stream);
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    assert_eq!(state.lock().unwrap().drops, 1);
}

#[test]
fn ordinary_completion_stops_heartbeat_at_receipt_while_consumer_paused() {
    let (socket, state) = socket(false);
    let mut stream = heartbeat(whole(), socket);
    tick(&mut stream);
    reply(&state, CHUNK);
    assert!(matches!(
        pull(&mut stream),
        Some(Ok(SynthesisItem::Bytes(_)))
    ));
    reply(&state, COMPLETE);
    wait_until(|| state.lock().unwrap().replies.is_empty());
    std::thread::sleep(Duration::from_millis(550));
    assert_eq!(state.lock().unwrap().sent.len(), 1);
    assert!(matches!(
        pull(&mut stream),
        Some(Ok(SynthesisItem::Done(_)))
    ));
    assert_eq!(state.lock().unwrap().drops, 1);
}

#[test]
fn pong_is_internal_but_cannot_mask_native_errors() {
    let (socket, state) = socket(false);
    let mut stream = heartbeat(whole(), socket);
    tick(&mut stream);
    for _ in 0..1000 {
        reply(&state, r#"{"type":"pong"}"#);
    }
    reply(
        &state,
        r#"{"type":"pong","status":"error","error":{"code":"QUOTA","message":"quota exceeded"}}"#,
    );
    wait_until(|| state.lock().unwrap().drops == 1);
    let error = pull(&mut stream).unwrap().err().unwrap();
    let error = error.downcast_ref::<Error>().unwrap();
    assert_eq!(error.message, "quota exceeded");
    assert_eq!(error.code.as_deref(), Some("QUOTA"));
}
