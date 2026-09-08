use speechswitch_types::{generated::google::*, runtime::StreamingInput};
fn chirp(r: &TtsRequestChirp3Hd174648a4) { let _ = &r.instructions; }
fn clone_mp3(r: &mut TtsRequestChirp3InstantCustomVoiceTextVoiced9d056de, output: TtsRequestChirp3HdTextVoiceffbf1cc1OutputMp3) { r.output = TtsRequestChirp3HdTextVoiceffbf1cc1Output::Mp3(output); }
fn lite_dialogue(r: &mut TtsRequestText) { r.model = TtsRequestTextVoiceModel::Gemini25FlashLitePreviewTts(Default::default()); }
fn streaming_volume(r: &TtsRequestObjecta65cbd8a) { let _ = &r.volume_db; }
fn streaming_wav(r: &mut TtsRequestObjecta65cbd8a, output: TtsRequestChirp3HdTextVoiceffbf1cc1OutputWav) { r.output = TtsRequestChirp3HdTextVoiceffbf1cc1Output::Wav(output); }
fn commands(input: StreamingInput<i32>) { let _ = TtsRequestChirp3Hd174648a4Text::AsyncIterable(input); }
