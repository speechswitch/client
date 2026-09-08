use speechswitch_types::generated::fish;
fn speakers(r: &fish::TtsRequestS1TextVoice) { let _ = &r.speakers; }
fn loudness(r: &fish::TtsRequestS1TextVoice) { let _ = &r.loudness_normalization; }
fn bitrate(r: &fish::TtsRequestS1TextOutputObject) { let _ = &r.bit_rate_bps; }
fn timestamps(r: &fish::TtsRequestStreamingTextVoice) { let _ = &r.timestamp_granularity; }
