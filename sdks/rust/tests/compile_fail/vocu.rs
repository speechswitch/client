use speechswitch_types::generated::vocu;
pub fn markup(request: &mut vocu::TtsRequestTextVoicee296d426) {
    request.subtitle_format = Some(String::from("srt"));
}
