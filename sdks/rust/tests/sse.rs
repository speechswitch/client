use speechswitch_types::sse::{Decoder, DecodeError};

// The language check invokes this same harness with the shared JSON fixtures.
// Test-only Rust literals are emitted into a temporary file; no JSON dependency
// or parallel hand-maintained golden file is needed in the Rust crate.
pub fn check_case(name: &str, wire: &[u8], limit: usize, expected: &[(&str, &str)], error: Option<&str>) {
    for split in 0..=wire.len() {
        let mut decoder = Decoder::new(limit).unwrap();
        let mut events = Vec::new();
        let mut failure = None;
        'chunks: for chunk in [&wire[..split], &[], &wire[split..]] {
            for &byte in chunk {
                match decoder.push(byte) {
                    Ok(Some(event)) => events.push((event.event, event.data)),
                    Ok(None) => {},
                    Err(error) => { failure = Some(error.to_string()); break 'chunks; }
                }
            }
        }
        let borrowed: Vec<_> = events.iter().map(|(event, data)| (event.as_str(), data.as_str())).collect();
        assert_eq!(borrowed, expected, "{name}, split {split}");
        assert_eq!(failure.as_deref(), error, "{name}, split {split}");
        if failure.is_some() { assert!(matches!(decoder.push(b'\n'), Err(DecodeError::Closed))); }
        decoder.finish();
        decoder.finish();
        assert!(matches!(decoder.push(b'\n'), Err(DecodeError::Closed)));
    }
}

#[test]
fn exact_limits_and_terminal_error() {
    check_case("exact limit", b"data: x\n\n", 8, &[("message", "x")], None);
    check_case("overflow", b"data: x\n\ndata: toolong", 8, &[("message", "x")], Some("SSE event exceeds byte limit"));
    assert!(matches!(Decoder::new(0), Err(DecodeError::InvalidLimit)));
}

#[test]
fn cr_dispatch_does_not_wait_for_next_read() {
    let mut decoder = Decoder::new(100).unwrap();
    for &byte in b"data: x\r" { assert!(decoder.push(byte).unwrap().is_none()); }
    let message = decoder.push(b'\r').unwrap().unwrap();
    assert_eq!((message.event.as_str(), message.data.as_str()), ("message", "x"));
}
