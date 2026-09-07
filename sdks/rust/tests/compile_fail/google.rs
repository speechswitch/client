use speechswitch_types::{generated::google::*, runtime::StreamingInput};
fn chirp(r: &TtsRequestChirp3Hda92b414c) { let _ = &r.instructions; }
fn clone_mp3(r: &mut TtsRequestChirp3InstantCustomVoiceTextVoicedb488368, output: TtsRequestChirp3HdTextVoicebb77af5cOutputMp3) { r.output = TtsRequestChirp3HdTextVoicebb77af5cOutput::Mp3(output); }
fn lite_dialogue(r: &mut TtsRequestText) { r.model = TtsRequestTextVoiceModel::Gemini25FlashLitePreviewTts(Default::default()); }
fn streaming_volume(r: &TtsRequestObject7d956f3d) { let _ = &r.volume_db; }
fn streaming_wav(r: &mut TtsRequestObject7d956f3d, output: TtsRequestChirp3HdTextVoicebb77af5cOutputWav) { r.output = TtsRequestChirp3HdTextVoicebb77af5cOutput::Wav(output); }
fn commands(input: StreamingInput<i32>) { let _ = TtsRequestChirp3Hda92b414cText::AsyncIterable(input); }
