# Generated from cataloged Google protobuf definitions. Do not edit.
from collections.abc import Sequence
from typing import Literal, Never, NotRequired, ReadOnly, TypedDict, cast
from speechswitch.protobuf import ProtoReader, ProtoWriter

type SsmlVoiceGender = Literal["SSML_VOICE_GENDER_UNSPECIFIED", "MALE", "FEMALE", "NEUTRAL"]
_SsmlVoiceGender_values: dict[SsmlVoiceGender, int] = {"SSML_VOICE_GENDER_UNSPECIFIED":0,"MALE":1,"FEMALE":2,"NEUTRAL":3}

type CustomVoiceParamsReportedUsage = Literal["REPORTED_USAGE_UNSPECIFIED", "REALTIME", "OFFLINE"]
_CustomVoiceParamsReportedUsage_values: dict[CustomVoiceParamsReportedUsage, int] = {"REPORTED_USAGE_UNSPECIFIED":0,"REALTIME":1,"OFFLINE":2}

type AudioEncoding = Literal["AUDIO_ENCODING_UNSPECIFIED", "LINEAR16", "MP3", "MP3_64_KBPS", "OGG_OPUS", "MULAW", "ALAW", "PCM", "M4A"]
_AudioEncoding_values: dict[AudioEncoding, int] = {"AUDIO_ENCODING_UNSPECIFIED":0,"LINEAR16":1,"MP3":2,"MP3_64_KBPS":4,"OGG_OPUS":3,"MULAW":5,"ALAW":6,"PCM":7,"M4A":8}

type CustomPronunciationParamsPhoneticEncoding = Literal["PHONETIC_ENCODING_UNSPECIFIED", "PHONETIC_ENCODING_IPA", "PHONETIC_ENCODING_X_SAMPA", "PHONETIC_ENCODING_JAPANESE_YOMIGANA", "PHONETIC_ENCODING_PINYIN"]
_CustomPronunciationParamsPhoneticEncoding_values: dict[CustomPronunciationParamsPhoneticEncoding, int] = {"PHONETIC_ENCODING_UNSPECIFIED":0,"PHONETIC_ENCODING_IPA":1,"PHONETIC_ENCODING_X_SAMPA":2,"PHONETIC_ENCODING_JAPANESE_YOMIGANA":3,"PHONETIC_ENCODING_PINYIN":4}

type AdvancedVoiceOptionsHarmCategory = Literal["HARM_CATEGORY_UNSPECIFIED", "HARM_CATEGORY_HATE_SPEECH", "HARM_CATEGORY_DANGEROUS_CONTENT", "HARM_CATEGORY_HARASSMENT", "HARM_CATEGORY_SEXUALLY_EXPLICIT"]
_AdvancedVoiceOptionsHarmCategory_values: dict[AdvancedVoiceOptionsHarmCategory, int] = {"HARM_CATEGORY_UNSPECIFIED":0,"HARM_CATEGORY_HATE_SPEECH":1,"HARM_CATEGORY_DANGEROUS_CONTENT":2,"HARM_CATEGORY_HARASSMENT":3,"HARM_CATEGORY_SEXUALLY_EXPLICIT":4}

type AdvancedVoiceOptionsHarmBlockThreshold = Literal["HARM_BLOCK_THRESHOLD_UNSPECIFIED", "BLOCK_LOW_AND_ABOVE", "BLOCK_MEDIUM_AND_ABOVE", "BLOCK_ONLY_HIGH", "BLOCK_NONE", "OFF"]
_AdvancedVoiceOptionsHarmBlockThreshold_values: dict[AdvancedVoiceOptionsHarmBlockThreshold, int] = {"HARM_BLOCK_THRESHOLD_UNSPECIFIED":0,"BLOCK_LOW_AND_ABOVE":1,"BLOCK_MEDIUM_AND_ABOVE":2,"BLOCK_ONLY_HIGH":3,"BLOCK_NONE":4,"OFF":5}

StreamingSynthesizeRequestVariant0 = TypedDict("StreamingSynthesizeRequestVariant0", {
    "streaming_config": ReadOnly["StreamingSynthesizeConfig"],
    "input": NotRequired[ReadOnly[Never]],
})

StreamingSynthesizeRequestVariant1 = TypedDict("StreamingSynthesizeRequestVariant1", {
    "streaming_config": NotRequired[ReadOnly[Never]],
    "input": ReadOnly["StreamingSynthesisInput"],
})

StreamingSynthesizeRequestVariant2 = TypedDict("StreamingSynthesizeRequestVariant2", {
    "streaming_config": NotRequired[ReadOnly[Never]],
    "input": NotRequired[ReadOnly[Never]],
})

type StreamingSynthesizeRequest = StreamingSynthesizeRequestVariant0 | StreamingSynthesizeRequestVariant1 | StreamingSynthesizeRequestVariant2

_StreamingSynthesizeRequestFields = TypedDict("_StreamingSynthesizeRequestFields", {
    "streaming_config": NotRequired[ReadOnly["StreamingSynthesizeConfig"]],
    "input": NotRequired[ReadOnly["StreamingSynthesisInput"]],
})

def encode_streaming_synthesize_request(value: StreamingSynthesizeRequest) -> bytes:
    writer = ProtoWriter()
    fields = cast(_StreamingSynthesizeRequestFields, value)
    if int("streaming_config" in value) + int("input" in value) > 1:
        raise TypeError("StreamingSynthesizeRequest.streamingRequest permits at most one field")
    if "streaming_config" in fields:
        writer.uint32(10).bytes(encode_streaming_synthesize_config(fields["streaming_config"]))
    if "input" in fields:
        writer.uint32(18).bytes(encode_streaming_synthesis_input(fields["input"]))
    return writer.finish()

StreamingSynthesizeConfig = TypedDict("StreamingSynthesizeConfig", {
    "voice": ReadOnly["VoiceSelectionParams"],
    "streaming_audio_config": NotRequired[ReadOnly["StreamingAudioConfig"]],
    "custom_pronunciations": NotRequired[ReadOnly["CustomPronunciations"]],
    "advanced_voice_options": NotRequired[ReadOnly["AdvancedVoiceOptions"]],
})

def encode_streaming_synthesize_config(value: StreamingSynthesizeConfig) -> bytes:
    writer = ProtoWriter()
    if "voice" not in value:
        raise TypeError("Missing StreamingSynthesizeConfig.voice")
    if "voice" in value:
        writer.uint32(10).bytes(encode_voice_selection_params(value["voice"]))
    if "streaming_audio_config" in value:
        writer.uint32(34).bytes(encode_streaming_audio_config(value["streaming_audio_config"]))
    if "custom_pronunciations" in value:
        writer.uint32(42).bytes(encode_custom_pronunciations(value["custom_pronunciations"]))
    if "advanced_voice_options" in value:
        writer.uint32(58).bytes(encode_advanced_voice_options(value["advanced_voice_options"]))
    return writer.finish()

VoiceSelectionParams = TypedDict("VoiceSelectionParams", {
    "language_code": ReadOnly[str],
    "name": NotRequired[ReadOnly[str]],
    "ssml_gender": NotRequired[ReadOnly["SsmlVoiceGender"]],
    "custom_voice": NotRequired[ReadOnly["CustomVoiceParams"]],
    "voice_clone": NotRequired[ReadOnly["VoiceCloneParams"]],
    "model_name": NotRequired[ReadOnly[str]],
    "multi_speaker_voice_config": NotRequired[ReadOnly["MultiSpeakerVoiceConfig"]],
})

def encode_voice_selection_params(value: VoiceSelectionParams) -> bytes:
    writer = ProtoWriter()
    if "language_code" not in value:
        raise TypeError("Missing VoiceSelectionParams.languageCode")
    if "language_code" in value:
        writer.uint32(10).string(value["language_code"])
    if "name" in value:
        writer.uint32(18).string(value["name"])
    if "ssml_gender" in value:
        writer.uint32(24).int32(_SsmlVoiceGender_values[value["ssml_gender"]])
    if "custom_voice" in value:
        writer.uint32(34).bytes(encode_custom_voice_params(value["custom_voice"]))
    if "voice_clone" in value:
        writer.uint32(42).bytes(encode_voice_clone_params(value["voice_clone"]))
    if "model_name" in value:
        writer.uint32(50).string(value["model_name"])
    if "multi_speaker_voice_config" in value:
        writer.uint32(58).bytes(encode_multi_speaker_voice_config(value["multi_speaker_voice_config"]))
    return writer.finish()

CustomVoiceParams = TypedDict("CustomVoiceParams", {
    "model": ReadOnly[str],
    "reported_usage": NotRequired[ReadOnly["CustomVoiceParamsReportedUsage"]],
})

def encode_custom_voice_params(value: CustomVoiceParams) -> bytes:
    writer = ProtoWriter()
    if "model" not in value:
        raise TypeError("Missing CustomVoiceParams.model")
    if "model" in value:
        writer.uint32(10).string(value["model"])
    if "reported_usage" in value:
        writer.uint32(24).int32(_CustomVoiceParamsReportedUsage_values[value["reported_usage"]])
    return writer.finish()

VoiceCloneParams = TypedDict("VoiceCloneParams", {
    "voice_cloning_key": ReadOnly[str],
})

def encode_voice_clone_params(value: VoiceCloneParams) -> bytes:
    writer = ProtoWriter()
    if "voice_cloning_key" not in value:
        raise TypeError("Missing VoiceCloneParams.voiceCloningKey")
    if "voice_cloning_key" in value:
        writer.uint32(10).string(value["voice_cloning_key"])
    return writer.finish()

MultiSpeakerVoiceConfig = TypedDict("MultiSpeakerVoiceConfig", {
    "speaker_voice_configs": ReadOnly[Sequence["MultispeakerPrebuiltVoice"]],
})

def encode_multi_speaker_voice_config(value: MultiSpeakerVoiceConfig) -> bytes:
    writer = ProtoWriter()
    if "speaker_voice_configs" not in value:
        raise TypeError("Missing MultiSpeakerVoiceConfig.speakerVoiceConfigs")
    if "speaker_voice_configs" in value:
        for item in value["speaker_voice_configs"]:
            writer.uint32(18).bytes(encode_multispeaker_prebuilt_voice(item))
    return writer.finish()

MultispeakerPrebuiltVoice = TypedDict("MultispeakerPrebuiltVoice", {
    "speaker_alias": ReadOnly[str],
    "speaker_id": ReadOnly[str],
})

def encode_multispeaker_prebuilt_voice(value: MultispeakerPrebuiltVoice) -> bytes:
    writer = ProtoWriter()
    if "speaker_alias" not in value:
        raise TypeError("Missing MultispeakerPrebuiltVoice.speakerAlias")
    if "speaker_alias" in value:
        writer.uint32(10).string(value["speaker_alias"])
    if "speaker_id" not in value:
        raise TypeError("Missing MultispeakerPrebuiltVoice.speakerId")
    if "speaker_id" in value:
        writer.uint32(18).string(value["speaker_id"])
    return writer.finish()

StreamingAudioConfig = TypedDict("StreamingAudioConfig", {
    "audio_encoding": ReadOnly["AudioEncoding"],
    "sample_rate_hertz": NotRequired[ReadOnly[int]],
    "speaking_rate": NotRequired[ReadOnly[float]],
})

def encode_streaming_audio_config(value: StreamingAudioConfig) -> bytes:
    writer = ProtoWriter()
    if "audio_encoding" not in value:
        raise TypeError("Missing StreamingAudioConfig.audioEncoding")
    if "audio_encoding" in value:
        writer.uint32(8).int32(_AudioEncoding_values[value["audio_encoding"]])
    if "sample_rate_hertz" in value:
        writer.uint32(16).int32(value["sample_rate_hertz"])
    if "speaking_rate" in value:
        writer.uint32(25).double(value["speaking_rate"])
    return writer.finish()

CustomPronunciations = TypedDict("CustomPronunciations", {
    "pronunciations": NotRequired[ReadOnly[Sequence["CustomPronunciationParams"]]],
})

def encode_custom_pronunciations(value: CustomPronunciations) -> bytes:
    writer = ProtoWriter()
    if "pronunciations" in value:
        for item in value["pronunciations"]:
            writer.uint32(10).bytes(encode_custom_pronunciation_params(item))
    return writer.finish()

CustomPronunciationParams = TypedDict("CustomPronunciationParams", {
    "phrase": NotRequired[ReadOnly[str]],
    "phonetic_encoding": NotRequired[ReadOnly["CustomPronunciationParamsPhoneticEncoding"]],
    "pronunciation": NotRequired[ReadOnly[str]],
})

def encode_custom_pronunciation_params(value: CustomPronunciationParams) -> bytes:
    writer = ProtoWriter()
    if "phrase" in value:
        writer.uint32(10).string(value["phrase"])
    if "phonetic_encoding" in value:
        writer.uint32(16).int32(_CustomPronunciationParamsPhoneticEncoding_values[value["phonetic_encoding"]])
    if "pronunciation" in value:
        writer.uint32(26).string(value["pronunciation"])
    return writer.finish()

AdvancedVoiceOptions = TypedDict("AdvancedVoiceOptions", {
    "low_latency_journey_synthesis": NotRequired[ReadOnly[bool]],
    "relax_safety_filters": NotRequired[ReadOnly[bool]],
    "safety_settings": NotRequired[ReadOnly["AdvancedVoiceOptionsSafetySettings"]],
    "enable_textnorm": NotRequired[ReadOnly[bool]],
})

def encode_advanced_voice_options(value: AdvancedVoiceOptions) -> bytes:
    writer = ProtoWriter()
    if "low_latency_journey_synthesis" in value:
        writer.uint32(8).bool(value["low_latency_journey_synthesis"])
    if "relax_safety_filters" in value:
        writer.uint32(64).bool(value["relax_safety_filters"])
    if "safety_settings" in value:
        writer.uint32(74).bytes(encode_advanced_voice_options_safety_settings(value["safety_settings"]))
    if "enable_textnorm" in value:
        writer.uint32(16).bool(value["enable_textnorm"])
    return writer.finish()

AdvancedVoiceOptionsSafetySettings = TypedDict("AdvancedVoiceOptionsSafetySettings", {
    "settings": NotRequired[ReadOnly[Sequence["AdvancedVoiceOptionsSafetySetting"]]],
})

def encode_advanced_voice_options_safety_settings(value: AdvancedVoiceOptionsSafetySettings) -> bytes:
    writer = ProtoWriter()
    if "settings" in value:
        for item in value["settings"]:
            writer.uint32(10).bytes(encode_advanced_voice_options_safety_setting(item))
    return writer.finish()

AdvancedVoiceOptionsSafetySetting = TypedDict("AdvancedVoiceOptionsSafetySetting", {
    "category": NotRequired[ReadOnly["AdvancedVoiceOptionsHarmCategory"]],
    "threshold": NotRequired[ReadOnly["AdvancedVoiceOptionsHarmBlockThreshold"]],
})

def encode_advanced_voice_options_safety_setting(value: AdvancedVoiceOptionsSafetySetting) -> bytes:
    writer = ProtoWriter()
    if "category" in value:
        writer.uint32(8).int32(_AdvancedVoiceOptionsHarmCategory_values[value["category"]])
    if "threshold" in value:
        writer.uint32(16).int32(_AdvancedVoiceOptionsHarmBlockThreshold_values[value["threshold"]])
    return writer.finish()

StreamingSynthesisInputVariant0 = TypedDict("StreamingSynthesisInputVariant0", {
    "text": ReadOnly[str],
    "markup": NotRequired[ReadOnly[Never]],
    "multi_speaker_markup": NotRequired[ReadOnly[Never]],
    "prompt": NotRequired[ReadOnly[str]],
})

StreamingSynthesisInputVariant1 = TypedDict("StreamingSynthesisInputVariant1", {
    "text": NotRequired[ReadOnly[Never]],
    "markup": ReadOnly[str],
    "multi_speaker_markup": NotRequired[ReadOnly[Never]],
    "prompt": NotRequired[ReadOnly[str]],
})

StreamingSynthesisInputVariant2 = TypedDict("StreamingSynthesisInputVariant2", {
    "text": NotRequired[ReadOnly[Never]],
    "markup": NotRequired[ReadOnly[Never]],
    "multi_speaker_markup": ReadOnly["MultiSpeakerMarkup"],
    "prompt": NotRequired[ReadOnly[str]],
})

StreamingSynthesisInputVariant3 = TypedDict("StreamingSynthesisInputVariant3", {
    "text": NotRequired[ReadOnly[Never]],
    "markup": NotRequired[ReadOnly[Never]],
    "multi_speaker_markup": NotRequired[ReadOnly[Never]],
    "prompt": NotRequired[ReadOnly[str]],
})

type StreamingSynthesisInput = StreamingSynthesisInputVariant0 | StreamingSynthesisInputVariant1 | StreamingSynthesisInputVariant2 | StreamingSynthesisInputVariant3

_StreamingSynthesisInputFields = TypedDict("_StreamingSynthesisInputFields", {
    "text": NotRequired[ReadOnly[str]],
    "markup": NotRequired[ReadOnly[str]],
    "multi_speaker_markup": NotRequired[ReadOnly["MultiSpeakerMarkup"]],
    "prompt": NotRequired[ReadOnly[str]],
})

def encode_streaming_synthesis_input(value: StreamingSynthesisInput) -> bytes:
    writer = ProtoWriter()
    fields = cast(_StreamingSynthesisInputFields, value)
    if int("text" in value) + int("markup" in value) + int("multi_speaker_markup" in value) > 1:
        raise TypeError("StreamingSynthesisInput.inputSource permits at most one field")
    if "text" in fields:
        writer.uint32(10).string(fields["text"])
    if "markup" in fields:
        writer.uint32(42).string(fields["markup"])
    if "multi_speaker_markup" in fields:
        writer.uint32(58).bytes(encode_multi_speaker_markup(fields["multi_speaker_markup"]))
    if "prompt" in fields:
        writer.uint32(50).string(fields["prompt"])
    return writer.finish()

MultiSpeakerMarkup = TypedDict("MultiSpeakerMarkup", {
    "turns": ReadOnly[Sequence["MultiSpeakerMarkupTurn"]],
})

def encode_multi_speaker_markup(value: MultiSpeakerMarkup) -> bytes:
    writer = ProtoWriter()
    if "turns" not in value:
        raise TypeError("Missing MultiSpeakerMarkup.turns")
    if "turns" in value:
        for item in value["turns"]:
            writer.uint32(10).bytes(encode_multi_speaker_markup_turn(item))
    return writer.finish()

MultiSpeakerMarkupTurn = TypedDict("MultiSpeakerMarkupTurn", {
    "speaker": ReadOnly[str],
    "text": ReadOnly[str],
})

def encode_multi_speaker_markup_turn(value: MultiSpeakerMarkupTurn) -> bytes:
    writer = ProtoWriter()
    if "speaker" not in value:
        raise TypeError("Missing MultiSpeakerMarkupTurn.speaker")
    if "speaker" in value:
        writer.uint32(10).string(value["speaker"])
    if "text" not in value:
        raise TypeError("Missing MultiSpeakerMarkupTurn.text")
    if "text" in value:
        writer.uint32(18).string(value["text"])
    return writer.finish()

StreamingSynthesizeResponse = TypedDict("StreamingSynthesizeResponse", {
    "audio_content": NotRequired[ReadOnly[bytes]],
})

def encode_streaming_synthesize_response(value: StreamingSynthesizeResponse) -> bytes:
    writer = ProtoWriter()
    if "audio_content" in value:
        writer.uint32(10).bytes(value["audio_content"])
    return writer.finish()

_StreamingSynthesizeResponseDecoded = TypedDict("_StreamingSynthesizeResponseDecoded", {
    "audio_content": NotRequired[bytes],
})

def decode_streaming_synthesize_response(data: bytes) -> StreamingSynthesizeResponse:
    reader = ProtoReader(data)
    value: _StreamingSynthesizeResponseDecoded = {}
    while not reader.done:
        tag = reader.uint32()
        if tag >> 3 == 0:
            raise TypeError("Invalid protobuf field number")
        if tag >> 3 == 1:
            if tag & 7 != 2:
                raise TypeError("Invalid protobuf wire type for StreamingSynthesizeResponse.audioContent")
            value["audio_content"] = reader.bytes()
        else:
            reader.skip(tag & 7)
    return value

STREAMING_SYNTHESIZE_PATH = "/google.cloud.texttospeech.v1beta1.TextToSpeech/StreamingSynthesize"
encode_streaming_request = encode_streaming_synthesize_request
decode_streaming_response = decode_streaming_synthesize_response
