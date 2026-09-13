use super::*;

#[test]
fn every_inline_splitter_alternative_preserves_inheritance() {
    let requests=vec![
TtsRequest::Text8f38e545(TtsRequestText8f38e545{text:"[A] hi".into(),output:None,text_splitter:TtsRequestText8f38e545TextSplitter::Object1611dc76(TtsRequestText8f38e545TextSplitterObject1611dc76{
brackets:vec![TtsRequestText8f38e545TextSplitterObject1611dc76BracketsItem{open:"[".into(),close:"]".into()}],
fallback:Some(TtsRequestText8f38e545TextSplitterObject1611dc76Fallback::Object7f01c485(TtsRequestText8f38e545TextSplitterObject1611dc76FallbackObject7f01c485{voice:"narrator".into(),reference_emphasis:Some(TtsRequestObject42a4f93cSegmentsItemTextVoicef8490aaeReferenceEmphasis::Balanced(Default::default())),..fixtures::marked_fallback()})),
placeholders:Some(vec![TtsRequestText8f38e545TextSplitterObject1611dc76PlaceholdersItem::Object50954e5c(TtsRequestText8f38e545TextSplitterObject1611dc76PlaceholdersItemObject50954e5c{voice:Some("alice".into()),reference_emphasis:Some(TtsRequestObject42a4f93cSegmentsItemTextVoicef8490aaeReferenceEmphasis::Balanced(Default::default())),..fixtures::marked_placeholder()})]),
lookup:Some(vec![TtsRequestText8f38e545TextSplitterObject1611dc76LookupItem::Object943eda1d(TtsRequestText8f38e545TextSplitterObject1611dc76LookupItemObject943eda1d{reference_emphasis:Some(TtsRequestObject42a4f93cSegmentsItemTextVoicef8490aaeReferenceEmphasis::Balanced(Default::default())),..fixtures::marked_lookup()})]),
})}),
TtsRequest::Text8f38e545(TtsRequestText8f38e545{text:"[A] hi".into(),output:None,text_splitter:TtsRequestText8f38e545TextSplitter::Objectda2887fb(TtsRequestText8f38e545TextSplitterObjectda2887fb{
brackets:Some(vec![TtsRequestText8f38e545TextSplitterObject1611dc76BracketsItem{open:"[".into(),close:"]".into()}]),
fallback:TtsRequestText8f38e545TextSplitterObject1611dc76Fallback::Object7f01c485(TtsRequestText8f38e545TextSplitterObject1611dc76FallbackObject7f01c485{voice:"narrator".into(),reference_emphasis:Some(TtsRequestObject42a4f93cSegmentsItemTextVoicef8490aaeReferenceEmphasis::Balanced(Default::default())),..fixtures::marked_fallback()}),
placeholders:Some(vec![TtsRequestText8f38e545TextSplitterObject1611dc76PlaceholdersItem::Object50954e5c(TtsRequestText8f38e545TextSplitterObject1611dc76PlaceholdersItemObject50954e5c{voice:Some("alice".into()),reference_emphasis:Some(TtsRequestObject42a4f93cSegmentsItemTextVoicef8490aaeReferenceEmphasis::Balanced(Default::default())),..fixtures::marked_placeholder()})]),
lookup:Some(vec![TtsRequestText8f38e545TextSplitterObject1611dc76LookupItem::Object943eda1d(TtsRequestText8f38e545TextSplitterObject1611dc76LookupItemObject943eda1d{reference_emphasis:Some(TtsRequestObject42a4f93cSegmentsItemTextVoicef8490aaeReferenceEmphasis::Balanced(Default::default())),..fixtures::marked_lookup()})]),
})}),
TtsRequest::Text8f38e545(TtsRequestText8f38e545{text:"[A] hi".into(),output:None,text_splitter:TtsRequestText8f38e545TextSplitter::Object2a1f0164(TtsRequestText8f38e545TextSplitterObject2a1f0164{
brackets:Some(vec![TtsRequestText8f38e545TextSplitterObject1611dc76BracketsItem{open:"[".into(),close:"]".into()}]),
fallback:Some(TtsRequestText8f38e545TextSplitterObject1611dc76Fallback::Object7f01c485(TtsRequestText8f38e545TextSplitterObject1611dc76FallbackObject7f01c485{voice:"narrator".into(),reference_emphasis:Some(TtsRequestObject42a4f93cSegmentsItemTextVoicef8490aaeReferenceEmphasis::Balanced(Default::default())),..fixtures::marked_fallback()})),
placeholders:vec![TtsRequestText8f38e545TextSplitterObject1611dc76PlaceholdersItem::Object50954e5c(TtsRequestText8f38e545TextSplitterObject1611dc76PlaceholdersItemObject50954e5c{voice:Some("alice".into()),reference_emphasis:Some(TtsRequestObject42a4f93cSegmentsItemTextVoicef8490aaeReferenceEmphasis::Balanced(Default::default())),..fixtures::marked_placeholder()})],
lookup:Some(vec![TtsRequestText8f38e545TextSplitterObject1611dc76LookupItem::Object943eda1d(TtsRequestText8f38e545TextSplitterObject1611dc76LookupItemObject943eda1d{reference_emphasis:Some(TtsRequestObject42a4f93cSegmentsItemTextVoicef8490aaeReferenceEmphasis::Balanced(Default::default())),..fixtures::marked_lookup()})]),
})}),
TtsRequest::Textb838f1b5(TtsRequestTextb838f1b5{text:"[A] hi".into(),output:None,subtitle_format:Default::default(),text_splitter:TtsRequestTextb838f1b5TextSplitter::Objectc0dd7752(TtsRequestTextb838f1b5TextSplitterObjectc0dd7752{
brackets:vec![TtsRequestText8f38e545TextSplitterObject1611dc76BracketsItem{open:"[".into(),close:"]".into()}],
fallback:Some(TtsRequestText8f38e545TextSplitterObject1611dc76FallbackObject8e112a71{voice:"narrator".into(),input_type:Some(Default::default()),..fixtures::fallback()}),
placeholders:Some(vec![TtsRequestText8f38e545TextSplitterObject1611dc76PlaceholdersItemObject87c9e6cd{voice:Some("alice".into()),input_type:Some(Default::default()),..fixtures::placeholder()}]),
lookup:Some(vec![TtsRequestText8f38e545TextSplitterObject1611dc76LookupItemObjectdbedc771{input_type:Some(Default::default()),..fixtures::lookup()}]),
})}),
TtsRequest::Textb838f1b5(TtsRequestTextb838f1b5{text:"[A] hi".into(),output:None,subtitle_format:Default::default(),text_splitter:TtsRequestTextb838f1b5TextSplitter::Object6b7b3424(TtsRequestTextb838f1b5TextSplitterObject6b7b3424{
brackets:Some(vec![TtsRequestText8f38e545TextSplitterObject1611dc76BracketsItem{open:"[".into(),close:"]".into()}]),
fallback:TtsRequestText8f38e545TextSplitterObject1611dc76FallbackObject8e112a71{voice:"narrator".into(),input_type:Some(Default::default()),..fixtures::fallback()},
placeholders:Some(vec![TtsRequestText8f38e545TextSplitterObject1611dc76PlaceholdersItemObject87c9e6cd{voice:Some("alice".into()),input_type:Some(Default::default()),..fixtures::placeholder()}]),
lookup:Some(vec![TtsRequestText8f38e545TextSplitterObject1611dc76LookupItemObjectdbedc771{input_type:Some(Default::default()),..fixtures::lookup()}]),
})}),
TtsRequest::Textb838f1b5(TtsRequestTextb838f1b5{text:"[A] hi".into(),output:None,subtitle_format:Default::default(),text_splitter:TtsRequestTextb838f1b5TextSplitter::Object94322b13(TtsRequestTextb838f1b5TextSplitterObject94322b13{
brackets:Some(vec![TtsRequestText8f38e545TextSplitterObject1611dc76BracketsItem{open:"[".into(),close:"]".into()}]),
fallback:Some(TtsRequestText8f38e545TextSplitterObject1611dc76FallbackObject8e112a71{voice:"narrator".into(),input_type:Some(Default::default()),..fixtures::fallback()}),
placeholders:vec![TtsRequestText8f38e545TextSplitterObject1611dc76PlaceholdersItemObject87c9e6cd{voice:Some("alice".into()),input_type:Some(Default::default()),..fixtures::placeholder()}],
lookup:Some(vec![TtsRequestText8f38e545TextSplitterObject1611dc76LookupItemObjectdbedc771{input_type:Some(Default::default()),..fixtures::lookup()}]),
})}),

 ];
    let auth = auth();
    for (index, request) in requests.into_iter().enumerate() {
        let (generated, _) = metadata(shared()["generatedJob"].text());
        let (audio, _) = audio();
        let http = transport(vec![(generated, false), (audio, false)]);
        let mut stream = ready(synthesize(
            &request,
            &http,
            Options {
                auth: Some(&auth),
                ..Default::default()
            },
        ))
        .unwrap();
        assert_eq!(collect(&mut stream).unwrap().len(), 2);
        let subtitles = index >= 3;
        let mut placeholder = BTreeMap::from([
            ("voiceId".into(), Value::String("alice".into())),
            ("instruct_mode".into(), Value::Bool(!subtitles)),
        ]);
        let mut fallback = BTreeMap::from([
            ("voiceId".into(), Value::String("narrator".into())),
            ("instruct_mode".into(), Value::Bool(!subtitles)),
        ]);
        let mut lookup = BTreeMap::from([
            (
                "tags".into(),
                Value::Array(vec![Value::String("tag".into())]),
            ),
            ("instruct_mode".into(), Value::Bool(!subtitles)),
        ]);
        if !subtitles {
            for map in [&mut placeholder, &mut fallback, &mut lookup] {
                map.insert("reference_mode".into(), Value::String("balanced".into()));
            }
        }
        let expected = Value::Map(BTreeMap::from([
            ("text".into(), Value::String("[A] hi".into())),
            ("srt".into(), Value::Bool(subtitles)),
            (
                "splitter".into(),
                Value::Map(BTreeMap::from([
                    ("[A]".into(), Value::Map(placeholder)),
                    ("fallbackConfig".into(), Value::Map(fallback)),
                    (
                        "splitterMarks".into(),
                        Value::Array(vec![Value::String("[]".into())]),
                    ),
                    (
                        "lookupTable".into(),
                        Value::Map(BTreeMap::from([("entry0".into(), Value::Map(lookup))])),
                    ),
                ])),
            ),
        ]));
        let requests = http.requests.lock().unwrap();
        assert_eq!(
            fixture(Raw::parse_exact(std::str::from_utf8(&requests[0].body).unwrap()).unwrap()),
            expected
        );
    }
}

#[test]
fn ordered_rules_do_not_sort_entry10_before_entry2() {
    let lookup = (0..12)
        .map(|index| {
            // All rules overlap, but each selects a different voice. Checking
            // entry names alone would miss reordered values assigned new keys.
            let mut rule = fixtures::lookup();
            rule.voice = Some(format!("voice{index}"));
            TtsRequestText8f38e545TextSplitterObject1611dc76LookupItem::Objectdbedc771(rule)
        })
        .collect();
    let request=TtsRequest::Text8f38e545(TtsRequestText8f38e545{output:None,text:"hi".into(),text_splitter:TtsRequestText8f38e545TextSplitter::Object2a1f0164(TtsRequestText8f38e545TextSplitterObject2a1f0164{
 brackets:None,fallback:None,lookup:Some(lookup),placeholders:vec![
 TtsRequestText8f38e545TextSplitterObject1611dc76PlaceholdersItem::Object87c9e6cd(TtsRequestText8f38e545TextSplitterObject1611dc76PlaceholdersItemObject87c9e6cd{marker:"[z]".into(),voice:Some("z".into()),..fixtures::placeholder()}),
 TtsRequestText8f38e545TextSplitterObject1611dc76PlaceholdersItem::Object87c9e6cd(TtsRequestText8f38e545TextSplitterObject1611dc76PlaceholdersItemObject87c9e6cd{marker:"[a]".into(),voice:Some("a".into()),..fixtures::placeholder()}),
 ],
 })});
    let auth = auth();
    let (response, _) = metadata(shared()["generatedJob"].text());
    let (audio, _) = audio();
    let http = transport(vec![(response, false), (audio, false)]);
    drop(
        ready(synthesize(
            &request,
            &http,
            Options {
                auth: Some(&auth),
                ..Default::default()
            },
        ))
        .unwrap(),
    );
    let entries: Vec<String> = (0..12)
        .map(|i| format!("\"entry{i}\":{{\"voiceId\":\"voice{i}\",\"tags\":[\"tag\"]}}"))
        .collect();
    let expected = format!(
        "{{\"[z]\":{{\"voiceId\":\"z\"}},\"[a]\":{{\"voiceId\":\"a\"}},\"lookupTable\":{{{}}}}}",
        entries.join(",")
    );
    let requests = http.requests.lock().unwrap();
    let raw = Raw::parse_exact(std::str::from_utf8(&requests[0].body).unwrap())
        .unwrap()
        .object()
        .unwrap();
    assert_eq!(raw["splitter"].text(), expected);
}

#[test]
fn duplicate_and_reserved_markers_fail_before_submission() {
    let auth = auth();
    for marker in [
        "splitterMarks",
        "lookupTable",
        "fallbackConfig",
        "duplicate",
    ] {
        let request=TtsRequest::Text8f38e545(TtsRequestText8f38e545{output:None,text:"hi".into(),text_splitter:TtsRequestText8f38e545TextSplitter::Object2a1f0164(TtsRequestText8f38e545TextSplitterObject2a1f0164{
   brackets:None,fallback:None,lookup:None,
   placeholders:vec![
    TtsRequestText8f38e545TextSplitterObject1611dc76PlaceholdersItem::Object87c9e6cd(TtsRequestText8f38e545TextSplitterObject1611dc76PlaceholdersItemObject87c9e6cd{marker:marker.into(),voice:Some("a".into()),..fixtures::placeholder()}),
    TtsRequestText8f38e545TextSplitterObject1611dc76PlaceholdersItem::Object87c9e6cd(TtsRequestText8f38e545TextSplitterObject1611dc76PlaceholdersItemObject87c9e6cd{marker:marker.into(),voice:Some("b".into()),..fixtures::placeholder()}),
   ],
  })});
        let http = transport(vec![]);
        let error = ready(synthesize(
            &request,
            &http,
            Options {
                auth: Some(&auth),
                ..Default::default()
            },
        ))
        .err()
        .unwrap();
        assert_eq!(
            error.to_string(),
            "Vocu splitter markers must be unique and cannot use reserved protocol keys"
        );
        assert!(http.requests.lock().unwrap().is_empty());
    }
}

#[test]
fn subtitle_batch_and_audio_only_saved_splitter_are_native_jobs() {
    let auth = auth();
    let requests = [
        TtsRequest::Object9cd7c2ee(TtsRequestObject9cd7c2ee {
            output: None,
            subtitle_format: Default::default(),
            segments: vec![TtsRequestObject42a4f93cSegmentsItemTextVoicec00e1b14 {
                voice: "a".into(),
                input_type: Some(Default::default()),
                ..fixtures::segment()
            }],
        }),
        TtsRequest::Text8f38e545(TtsRequestText8f38e545 {
            output: None,
            text: "[A] hi".into(),
            text_splitter: TtsRequestText8f38e545TextSplitter::Object0ad93c7b(
                TtsRequestText8f38e545TextSplitterObject0ad93c7b { id: "saved".into() },
            ),
        }),
    ];
    let expected = [
        r#"{"contents":[{"type":"text","text":"Hello","voiceId":"a","promptId":"default","preset":"balance","language":"auto","vivid":false,"speechRate":1,"seed":-1,"instruct_mode":false}],"srt":true}"#,
        r#"{"text":"[A] hi","splitterId":"saved","srt":false}"#,
    ];
    for (index, request) in requests.into_iter().enumerate() {
        let (generated, _) = metadata(shared()["generatedJob"].text());
        let (audio, _) = audio();
        let http = transport(vec![(generated, false), (audio, false)]);
        let mut stream = ready(synthesize(
            &request,
            &http,
            Options {
                auth: Some(&auth),
                ..Default::default()
            },
        ))
        .unwrap();
        assert_eq!(collect(&mut stream).unwrap().len(), 2);
        let requests = http.requests.lock().unwrap();
        assert_eq!(
            fixture(Raw::parse_exact(std::str::from_utf8(&requests[0].body).unwrap()).unwrap()),
            fixture(Raw::parse_exact(expected[index]).unwrap())
        );
    }
}
