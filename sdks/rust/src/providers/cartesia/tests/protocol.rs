use super::super::protocol::{decode, output};
use super::*;

#[test]
fn malformed_wire_frames_and_timing_are_rejected_exactly() {
    for (text, expected) in [
        ("{", "Cartesia returned invalid JSON"),
        (r#"{"type":"\ud800"}"#, "Cartesia returned invalid JSON"),
        ("[]", "Cartesia returned an invalid frame"),
        ("{}", "Cartesia returned an invalid status_code"),
        (
            r#"{"status_code":1.5}"#,
            "Cartesia returned an invalid status_code",
        ),
        (
            r#"{"status_code":1e309}"#,
            "Cartesia returned an invalid status_code",
        ),
        (
            r#"{"status_code":200,"context_id":7}"#,
            "Cartesia returned an invalid context ID",
        ),
        (
            r#"{"status_code":200,"context_id":null}"#,
            "Cartesia WebSocket output lacks its context ID",
        ),
        (
            r#"{"status_code":200,"context_id":"id","done":0}"#,
            "Cartesia returned an invalid completion flag",
        ),
        (
            r#"{"status_code":200,"context_id":"id","done":false,"type":"future"}"#,
            "Unknown Cartesia event: future",
        ),
        (
            r#"{"status_code":200,"context_id":"id","done":false,"type":"done"}"#,
            "Unknown Cartesia event: done",
        ),
        (
            r#"{"status_code":200,"context_id":"id","done":false,"type":"chunk","data":1}"#,
            "Unknown Cartesia event: chunk",
        ),
        (
            r#"{"status_code":200,"context_id":"id","done":false,"type":"flush_done","flush_done":true}"#,
            "Unknown Cartesia event: flush_done",
        ),
    ] {
        assert_eq!(
            decode(text, true).err().unwrap().to_string(),
            expected,
            "{text}"
        );
    }
    for id in [
        "null",
        "-1",
        "1.5",
        "9007199254740992",
        "1e309",
        "true",
        "\"1\"",
    ] {
        let text = format!(r#"{{"status_code":200,"flush_id":{id}}}"#);
        assert_eq!(
            decode(&text, true).err().unwrap().to_string(),
            "Cartesia returned an invalid flush ID"
        );
    }
    for timing in [
        r#"{"words":["hello"],"start":[],"end":[1]}"#,
        r#"{"words":[],"start":[],"end":null}"#,
    ] {
        let text = format!(
            r#"{{"type":"timestamps","status_code":200,"done":false,"word_timestamps":{timing}}}"#
        );
        assert_eq!(
            decode(&text, false).err().unwrap().to_string(),
            "Cartesia returned mismatched timestamp arrays"
        );
    }
    for (label, start, end) in [
        ("1", "0", "1"),
        ("\"a\"", "-1", "0"),
        ("\"a\"", "2", "1"),
        ("\"a\"", "0", "1e308"),
        ("\"a\"", "null", "1"),
    ] {
        let text = format!(
            r#"{{"type":"timestamps","status_code":200,"done":false,"word_timestamps":{{"words":[{label}],"start":[{start}],"end":[{end}]}}}}"#
        );
        assert_eq!(
            decode(&text, false).err().unwrap().to_string(),
            "Cartesia returned an invalid timestamp"
        );
    }
    let text = r#"{"type":"chunk","status_code":200,"done":false,"data":"not base64"}"#;
    assert_eq!(
        output(decode(text, false).unwrap(), "id", true)
            .err()
            .unwrap()
            .to_string(),
        "Cartesia returned invalid base64 audio"
    );
}

#[test]
fn native_timing_and_nullable_error_metadata_are_preserved() {
    for group in ["0", "-0", "9007199254740991"] {
        let text = format!(
            r#"{{"type":"timestamps","status_code":200,"context_id":"id","done":false,"flush_id":{group}}}"#
        );
        let expected = if group == "-0" { "0" } else { group };
        assert_eq!(
            canonical(
                output(decode(&text, true).unwrap(), "id", false)
                    .unwrap()
                    .unwrap()
            ),
            parse(&format!(
                r#"{{"correlation":"timeline","correlationId":"id","inputGroupId":"{expected}","timestamps":[]}}"#
            ))
        );
    }
    let text = r#"{"type":"phoneme_timestamps","status_code":200,"done":false,"context_id":"id","phoneme_timestamps":{"phonemes":["ɑ"],"start":[0.25],"end":[0.5]}}"#;
    assert_eq!(
        canonical(
            output(decode(text, true).unwrap(), "id", true)
                .unwrap()
                .unwrap()
        ),
        parse(
            r#"{"correlation":"timeline","correlationId":"id","timestamps":[{"kind":"phoneme","value":"ɑ","startTimeMs":250,"endTimeMs":500}]}"#
        )
    );
    let text = r#"{"type":"error","status_code":429,"error_code":"future_code","request_id":"req","doc_url":null,"context_id":null,"title":"Slow down","message":"retry"}"#;
    let error = output(decode(text, true).unwrap(), "id", true)
        .err()
        .unwrap();
    let error = error.downcast_ref::<Error>().unwrap();
    assert_eq!(error.to_string(), "Cartesia 429: Slow down: retry");
    assert_eq!(error.error_code.as_deref(), Some("future_code"));
    assert_eq!(error.request_id.as_deref(), Some("req"));
    assert_eq!(error.doc_url, None);
    assert_eq!(error.context_id, None);
}
