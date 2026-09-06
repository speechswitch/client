# Generated from https://texttospeech.googleapis.com/$discovery/rest?version=v1beta1. Do not edit.
import json
from collections.abc import Mapping, Sequence
from typing import Literal, Never, NotRequired, ReadOnly, TypeGuard, TypedDict
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from speechswitch.http import HttpRequest, HttpResponse, HttpTransport
from speechswitch.validation import is_mapping, is_number, is_sequence

DEFAULT_BASE_URL = "https://texttospeech.googleapis.com/"

def _invalid_json_constant(value: str) -> Never:
    raise TypeError("Invalid Google JSON constant")

SynthesizeSpeechRequest = TypedDict("SynthesizeSpeechRequest", {
    "advancedVoiceOptions": NotRequired[ReadOnly["AdvancedVoiceOptions"]],
    "audioConfig": NotRequired[ReadOnly["AudioConfig"]],
    "enableTimePointing": NotRequired[ReadOnly[Sequence[Literal["TIMEPOINT_TYPE_UNSPECIFIED", "SSML_MARK"]]]],
    "input": NotRequired[ReadOnly["SynthesisInput"]],
    "voice": NotRequired[ReadOnly["VoiceSelectionParams"]],
})

def is_synthesize_speech_request(value: object) -> TypeGuard[SynthesizeSpeechRequest]:
    return (is_mapping(value) and ("advancedVoiceOptions" not in value or is_advanced_voice_options(value["advancedVoiceOptions"])) and ("audioConfig" not in value or is_audio_config(value["audioConfig"])) and ("enableTimePointing" not in value or (is_sequence(value["enableTimePointing"]) and all((isinstance(item1, str) and item1 in ("TIMEPOINT_TYPE_UNSPECIFIED", "SSML_MARK",)) for item1 in value["enableTimePointing"]))) and ("input" not in value or is_synthesis_input(value["input"])) and ("voice" not in value or is_voice_selection_params(value["voice"])))

def _encode_synthesize_speech_request(value: SynthesizeSpeechRequest) -> object:
    result: dict[str, object] = {}
    if "advancedVoiceOptions" in value:
        result["advancedVoiceOptions"] = _encode_advanced_voice_options(value["advancedVoiceOptions"])
    if "audioConfig" in value:
        result["audioConfig"] = _encode_audio_config(value["audioConfig"])
    if "enableTimePointing" in value:
        result["enableTimePointing"] = [item0 for item0 in value["enableTimePointing"]]
    if "input" in value:
        result["input"] = _encode_synthesis_input(value["input"])
    if "voice" in value:
        result["voice"] = _encode_voice_selection_params(value["voice"])
    return result

AdvancedVoiceOptions = TypedDict("AdvancedVoiceOptions", {
    "enableTextnorm": NotRequired[ReadOnly[bool]],
    "lowLatencyJourneySynthesis": NotRequired[ReadOnly[bool]],
    "relaxSafetyFilters": NotRequired[ReadOnly[bool]],
    "safetySettings": NotRequired[ReadOnly["SafetySettings"]],
})

def is_advanced_voice_options(value: object) -> TypeGuard[AdvancedVoiceOptions]:
    return (is_mapping(value) and ("enableTextnorm" not in value or isinstance(value["enableTextnorm"], bool)) and ("lowLatencyJourneySynthesis" not in value or isinstance(value["lowLatencyJourneySynthesis"], bool)) and ("relaxSafetyFilters" not in value or isinstance(value["relaxSafetyFilters"], bool)) and ("safetySettings" not in value or is_safety_settings(value["safetySettings"])))

def _encode_advanced_voice_options(value: AdvancedVoiceOptions) -> object:
    result: dict[str, object] = {}
    if "enableTextnorm" in value:
        result["enableTextnorm"] = value["enableTextnorm"]
    if "lowLatencyJourneySynthesis" in value:
        result["lowLatencyJourneySynthesis"] = value["lowLatencyJourneySynthesis"]
    if "relaxSafetyFilters" in value:
        result["relaxSafetyFilters"] = value["relaxSafetyFilters"]
    if "safetySettings" in value:
        result["safetySettings"] = _encode_safety_settings(value["safetySettings"])
    return result

SafetySettings = TypedDict("SafetySettings", {
    "settings": NotRequired[ReadOnly[Sequence["SafetySetting"]]],
})

def is_safety_settings(value: object) -> TypeGuard[SafetySettings]:
    return (is_mapping(value) and ("settings" not in value or (is_sequence(value["settings"]) and all(is_safety_setting(item1) for item1 in value["settings"]))))

def _encode_safety_settings(value: SafetySettings) -> object:
    result: dict[str, object] = {}
    if "settings" in value:
        result["settings"] = [_encode_safety_setting(item0) for item0 in value["settings"]]
    return result

SafetySetting = TypedDict("SafetySetting", {
    "category": NotRequired[ReadOnly[Literal["HARM_CATEGORY_UNSPECIFIED", "HARM_CATEGORY_HATE_SPEECH", "HARM_CATEGORY_DANGEROUS_CONTENT", "HARM_CATEGORY_HARASSMENT", "HARM_CATEGORY_SEXUALLY_EXPLICIT"]]],
    "threshold": NotRequired[ReadOnly[Literal["HARM_BLOCK_THRESHOLD_UNSPECIFIED", "BLOCK_LOW_AND_ABOVE", "BLOCK_MEDIUM_AND_ABOVE", "BLOCK_ONLY_HIGH", "BLOCK_NONE", "OFF"]]],
})

def is_safety_setting(value: object) -> TypeGuard[SafetySetting]:
    return (is_mapping(value) and ("category" not in value or (isinstance(value["category"], str) and value["category"] in ("HARM_CATEGORY_UNSPECIFIED", "HARM_CATEGORY_HATE_SPEECH", "HARM_CATEGORY_DANGEROUS_CONTENT", "HARM_CATEGORY_HARASSMENT", "HARM_CATEGORY_SEXUALLY_EXPLICIT",))) and ("threshold" not in value or (isinstance(value["threshold"], str) and value["threshold"] in ("HARM_BLOCK_THRESHOLD_UNSPECIFIED", "BLOCK_LOW_AND_ABOVE", "BLOCK_MEDIUM_AND_ABOVE", "BLOCK_ONLY_HIGH", "BLOCK_NONE", "OFF",))))

def _encode_safety_setting(value: SafetySetting) -> object:
    result: dict[str, object] = {}
    if "category" in value:
        result["category"] = value["category"]
    if "threshold" in value:
        result["threshold"] = value["threshold"]
    return result

AudioConfig = TypedDict("AudioConfig", {
    "audioEncoding": NotRequired[ReadOnly[Literal["AUDIO_ENCODING_UNSPECIFIED", "LINEAR16", "MP3", "MP3_64_KBPS", "OGG_OPUS", "MULAW", "ALAW", "PCM", "M4A"]]],
    "effectsProfileId": NotRequired[ReadOnly[Sequence[str]]],
    "pitch": NotRequired[ReadOnly[float]],
    "sampleRateHertz": NotRequired[ReadOnly[int]],
    "speakingRate": NotRequired[ReadOnly[float]],
    "volumeGainDb": NotRequired[ReadOnly[float]],
})

def is_audio_config(value: object) -> TypeGuard[AudioConfig]:
    return (is_mapping(value) and ("audioEncoding" not in value or (isinstance(value["audioEncoding"], str) and value["audioEncoding"] in ("AUDIO_ENCODING_UNSPECIFIED", "LINEAR16", "MP3", "MP3_64_KBPS", "OGG_OPUS", "MULAW", "ALAW", "PCM", "M4A",))) and ("effectsProfileId" not in value or (is_sequence(value["effectsProfileId"]) and all(isinstance(item1, str) for item1 in value["effectsProfileId"]))) and ("pitch" not in value or is_number(value["pitch"])) and ("sampleRateHertz" not in value or (isinstance(value["sampleRateHertz"], int) and not isinstance(value["sampleRateHertz"], bool))) and ("speakingRate" not in value or is_number(value["speakingRate"])) and ("volumeGainDb" not in value or is_number(value["volumeGainDb"])))

def _encode_audio_config(value: AudioConfig) -> object:
    result: dict[str, object] = {}
    if "audioEncoding" in value:
        result["audioEncoding"] = value["audioEncoding"]
    if "effectsProfileId" in value:
        result["effectsProfileId"] = [item0 for item0 in value["effectsProfileId"]]
    if "pitch" in value:
        result["pitch"] = value["pitch"]
    if "sampleRateHertz" in value:
        result["sampleRateHertz"] = value["sampleRateHertz"]
    if "speakingRate" in value:
        result["speakingRate"] = value["speakingRate"]
    if "volumeGainDb" in value:
        result["volumeGainDb"] = value["volumeGainDb"]
    return result

SynthesisInput = TypedDict("SynthesisInput", {
    "customPronunciations": NotRequired[ReadOnly["CustomPronunciations"]],
    "markup": NotRequired[ReadOnly[str]],
    "multiSpeakerMarkup": NotRequired[ReadOnly["MultiSpeakerMarkup"]],
    "prompt": NotRequired[ReadOnly[str]],
    "ssml": NotRequired[ReadOnly[str]],
    "text": NotRequired[ReadOnly[str]],
})

def is_synthesis_input(value: object) -> TypeGuard[SynthesisInput]:
    return (is_mapping(value) and ("customPronunciations" not in value or is_custom_pronunciations(value["customPronunciations"])) and ("markup" not in value or isinstance(value["markup"], str)) and ("multiSpeakerMarkup" not in value or is_multi_speaker_markup(value["multiSpeakerMarkup"])) and ("prompt" not in value or isinstance(value["prompt"], str)) and ("ssml" not in value or isinstance(value["ssml"], str)) and ("text" not in value or isinstance(value["text"], str)))

def _encode_synthesis_input(value: SynthesisInput) -> object:
    result: dict[str, object] = {}
    if "customPronunciations" in value:
        result["customPronunciations"] = _encode_custom_pronunciations(value["customPronunciations"])
    if "markup" in value:
        result["markup"] = value["markup"]
    if "multiSpeakerMarkup" in value:
        result["multiSpeakerMarkup"] = _encode_multi_speaker_markup(value["multiSpeakerMarkup"])
    if "prompt" in value:
        result["prompt"] = value["prompt"]
    if "ssml" in value:
        result["ssml"] = value["ssml"]
    if "text" in value:
        result["text"] = value["text"]
    return result

CustomPronunciations = TypedDict("CustomPronunciations", {
    "pronunciations": NotRequired[ReadOnly[Sequence["CustomPronunciationParams"]]],
})

def is_custom_pronunciations(value: object) -> TypeGuard[CustomPronunciations]:
    return (is_mapping(value) and ("pronunciations" not in value or (is_sequence(value["pronunciations"]) and all(is_custom_pronunciation_params(item1) for item1 in value["pronunciations"]))))

def _encode_custom_pronunciations(value: CustomPronunciations) -> object:
    result: dict[str, object] = {}
    if "pronunciations" in value:
        result["pronunciations"] = [_encode_custom_pronunciation_params(item0) for item0 in value["pronunciations"]]
    return result

CustomPronunciationParams = TypedDict("CustomPronunciationParams", {
    "phoneticEncoding": NotRequired[ReadOnly[Literal["PHONETIC_ENCODING_UNSPECIFIED", "PHONETIC_ENCODING_IPA", "PHONETIC_ENCODING_X_SAMPA", "PHONETIC_ENCODING_JAPANESE_YOMIGANA", "PHONETIC_ENCODING_PINYIN"]]],
    "phrase": NotRequired[ReadOnly[str]],
    "pronunciation": NotRequired[ReadOnly[str]],
})

def is_custom_pronunciation_params(value: object) -> TypeGuard[CustomPronunciationParams]:
    return (is_mapping(value) and ("phoneticEncoding" not in value or (isinstance(value["phoneticEncoding"], str) and value["phoneticEncoding"] in ("PHONETIC_ENCODING_UNSPECIFIED", "PHONETIC_ENCODING_IPA", "PHONETIC_ENCODING_X_SAMPA", "PHONETIC_ENCODING_JAPANESE_YOMIGANA", "PHONETIC_ENCODING_PINYIN",))) and ("phrase" not in value or isinstance(value["phrase"], str)) and ("pronunciation" not in value or isinstance(value["pronunciation"], str)))

def _encode_custom_pronunciation_params(value: CustomPronunciationParams) -> object:
    result: dict[str, object] = {}
    if "phoneticEncoding" in value:
        result["phoneticEncoding"] = value["phoneticEncoding"]
    if "phrase" in value:
        result["phrase"] = value["phrase"]
    if "pronunciation" in value:
        result["pronunciation"] = value["pronunciation"]
    return result

MultiSpeakerMarkup = TypedDict("MultiSpeakerMarkup", {
    "turns": NotRequired[ReadOnly[Sequence["Turn"]]],
})

def is_multi_speaker_markup(value: object) -> TypeGuard[MultiSpeakerMarkup]:
    return (is_mapping(value) and ("turns" not in value or (is_sequence(value["turns"]) and all(is_turn(item1) for item1 in value["turns"]))))

def _encode_multi_speaker_markup(value: MultiSpeakerMarkup) -> object:
    result: dict[str, object] = {}
    if "turns" in value:
        result["turns"] = [_encode_turn(item0) for item0 in value["turns"]]
    return result

Turn = TypedDict("Turn", {
    "speaker": NotRequired[ReadOnly[str]],
    "text": NotRequired[ReadOnly[str]],
})

def is_turn(value: object) -> TypeGuard[Turn]:
    return (is_mapping(value) and ("speaker" not in value or isinstance(value["speaker"], str)) and ("text" not in value or isinstance(value["text"], str)))

def _encode_turn(value: Turn) -> object:
    result: dict[str, object] = {}
    if "speaker" in value:
        result["speaker"] = value["speaker"]
    if "text" in value:
        result["text"] = value["text"]
    return result

VoiceSelectionParams = TypedDict("VoiceSelectionParams", {
    "customVoice": NotRequired[ReadOnly["CustomVoiceParams"]],
    "languageCode": NotRequired[ReadOnly[str]],
    "modelName": NotRequired[ReadOnly[str]],
    "multiSpeakerVoiceConfig": NotRequired[ReadOnly["MultiSpeakerVoiceConfig"]],
    "name": NotRequired[ReadOnly[str]],
    "ssmlGender": NotRequired[ReadOnly[Literal["SSML_VOICE_GENDER_UNSPECIFIED", "MALE", "FEMALE", "NEUTRAL"]]],
    "voiceClone": NotRequired[ReadOnly["VoiceCloneParams"]],
})

def is_voice_selection_params(value: object) -> TypeGuard[VoiceSelectionParams]:
    return (is_mapping(value) and ("customVoice" not in value or is_custom_voice_params(value["customVoice"])) and ("languageCode" not in value or isinstance(value["languageCode"], str)) and ("modelName" not in value or isinstance(value["modelName"], str)) and ("multiSpeakerVoiceConfig" not in value or is_multi_speaker_voice_config(value["multiSpeakerVoiceConfig"])) and ("name" not in value or isinstance(value["name"], str)) and ("ssmlGender" not in value or (isinstance(value["ssmlGender"], str) and value["ssmlGender"] in ("SSML_VOICE_GENDER_UNSPECIFIED", "MALE", "FEMALE", "NEUTRAL",))) and ("voiceClone" not in value or is_voice_clone_params(value["voiceClone"])))

def _encode_voice_selection_params(value: VoiceSelectionParams) -> object:
    result: dict[str, object] = {}
    if "customVoice" in value:
        result["customVoice"] = _encode_custom_voice_params(value["customVoice"])
    if "languageCode" in value:
        result["languageCode"] = value["languageCode"]
    if "modelName" in value:
        result["modelName"] = value["modelName"]
    if "multiSpeakerVoiceConfig" in value:
        result["multiSpeakerVoiceConfig"] = _encode_multi_speaker_voice_config(value["multiSpeakerVoiceConfig"])
    if "name" in value:
        result["name"] = value["name"]
    if "ssmlGender" in value:
        result["ssmlGender"] = value["ssmlGender"]
    if "voiceClone" in value:
        result["voiceClone"] = _encode_voice_clone_params(value["voiceClone"])
    return result

CustomVoiceParams = TypedDict("CustomVoiceParams", {
    "model": NotRequired[ReadOnly[str]],
    "reportedUsage": NotRequired[ReadOnly[Literal["REPORTED_USAGE_UNSPECIFIED", "REALTIME", "OFFLINE"]]],
})

def is_custom_voice_params(value: object) -> TypeGuard[CustomVoiceParams]:
    return (is_mapping(value) and ("model" not in value or isinstance(value["model"], str)) and ("reportedUsage" not in value or (isinstance(value["reportedUsage"], str) and value["reportedUsage"] in ("REPORTED_USAGE_UNSPECIFIED", "REALTIME", "OFFLINE",))))

def _encode_custom_voice_params(value: CustomVoiceParams) -> object:
    result: dict[str, object] = {}
    if "model" in value:
        result["model"] = value["model"]
    if "reportedUsage" in value:
        result["reportedUsage"] = value["reportedUsage"]
    return result

MultiSpeakerVoiceConfig = TypedDict("MultiSpeakerVoiceConfig", {
    "speakerVoiceConfigs": NotRequired[ReadOnly[Sequence["MultispeakerPrebuiltVoice"]]],
})

def is_multi_speaker_voice_config(value: object) -> TypeGuard[MultiSpeakerVoiceConfig]:
    return (is_mapping(value) and ("speakerVoiceConfigs" not in value or (is_sequence(value["speakerVoiceConfigs"]) and all(is_multispeaker_prebuilt_voice(item1) for item1 in value["speakerVoiceConfigs"]))))

def _encode_multi_speaker_voice_config(value: MultiSpeakerVoiceConfig) -> object:
    result: dict[str, object] = {}
    if "speakerVoiceConfigs" in value:
        result["speakerVoiceConfigs"] = [_encode_multispeaker_prebuilt_voice(item0) for item0 in value["speakerVoiceConfigs"]]
    return result

MultispeakerPrebuiltVoice = TypedDict("MultispeakerPrebuiltVoice", {
    "speakerAlias": NotRequired[ReadOnly[str]],
    "speakerId": NotRequired[ReadOnly[str]],
})

def is_multispeaker_prebuilt_voice(value: object) -> TypeGuard[MultispeakerPrebuiltVoice]:
    return (is_mapping(value) and ("speakerAlias" not in value or isinstance(value["speakerAlias"], str)) and ("speakerId" not in value or isinstance(value["speakerId"], str)))

def _encode_multispeaker_prebuilt_voice(value: MultispeakerPrebuiltVoice) -> object:
    result: dict[str, object] = {}
    if "speakerAlias" in value:
        result["speakerAlias"] = value["speakerAlias"]
    if "speakerId" in value:
        result["speakerId"] = value["speakerId"]
    return result

VoiceCloneParams = TypedDict("VoiceCloneParams", {
    "voiceCloningKey": NotRequired[ReadOnly[str]],
})

def is_voice_clone_params(value: object) -> TypeGuard[VoiceCloneParams]:
    return (is_mapping(value) and ("voiceCloningKey" not in value or isinstance(value["voiceCloningKey"], str)))

def _encode_voice_clone_params(value: VoiceCloneParams) -> object:
    result: dict[str, object] = {}
    if "voiceCloningKey" in value:
        result["voiceCloningKey"] = value["voiceCloningKey"]
    return result

SynthesizeSpeechResponse = TypedDict("SynthesizeSpeechResponse", {
    "audioConfig": NotRequired[ReadOnly["AudioConfig"]],
    "audioContent": NotRequired[ReadOnly[str]],
    "timepoints": NotRequired[ReadOnly[Sequence["Timepoint"]]],
})

def is_synthesize_speech_response(value: object) -> TypeGuard[SynthesizeSpeechResponse]:
    return (is_mapping(value) and ("audioConfig" not in value or is_audio_config(value["audioConfig"])) and ("audioContent" not in value or isinstance(value["audioContent"], str)) and ("timepoints" not in value or (is_sequence(value["timepoints"]) and all(is_timepoint(item1) for item1 in value["timepoints"]))))

Timepoint = TypedDict("Timepoint", {
    "markName": NotRequired[ReadOnly[str]],
    "timeSeconds": NotRequired[ReadOnly[float]],
})

def is_timepoint(value: object) -> TypeGuard[Timepoint]:
    return (is_mapping(value) and ("markName" not in value or isinstance(value["markName"], str)) and ("timeSeconds" not in value or is_number(value["timeSeconds"])))

ListVoicesInput = TypedDict("ListVoicesInput", {
    "languageCode": NotRequired[ReadOnly[str]],
})

def is_list_voices_input(value: object) -> TypeGuard[ListVoicesInput]:
    return (is_mapping(value) and ("languageCode" not in value or isinstance(value["languageCode"], str)))

ListVoicesResponse = TypedDict("ListVoicesResponse", {
    "voices": NotRequired[ReadOnly[Sequence["Voice"]]],
})

def is_list_voices_response(value: object) -> TypeGuard[ListVoicesResponse]:
    return (is_mapping(value) and ("voices" not in value or (is_sequence(value["voices"]) and all(is_voice(item1) for item1 in value["voices"]))))

Voice = TypedDict("Voice", {
    "languageCodes": NotRequired[ReadOnly[Sequence[str]]],
    "name": NotRequired[ReadOnly[str]],
    "naturalSampleRateHertz": NotRequired[ReadOnly[int]],
    "ssmlGender": NotRequired[ReadOnly[Literal["SSML_VOICE_GENDER_UNSPECIFIED", "MALE", "FEMALE", "NEUTRAL"]]],
})

def is_voice(value: object) -> TypeGuard[Voice]:
    return (is_mapping(value) and ("languageCodes" not in value or (is_sequence(value["languageCodes"]) and all(isinstance(item1, str) for item1 in value["languageCodes"]))) and ("name" not in value or isinstance(value["name"], str)) and ("naturalSampleRateHertz" not in value or (isinstance(value["naturalSampleRateHertz"], int) and not isinstance(value["naturalSampleRateHertz"], bool))) and ("ssmlGender" not in value or (isinstance(value["ssmlGender"], str) and value["ssmlGender"] in ("SSML_VOICE_GENDER_UNSPECIFIED", "MALE", "FEMALE", "NEUTRAL",))))

async def synthesize_speech(value: SynthesizeSpeechRequest, *, base_url: str, headers: Mapping[str, str], transport: HttpTransport) -> HttpResponse:
    if not is_synthesize_speech_request(value):
        raise TypeError("Invalid Google synthesizeSpeech input")
    url = urlsplit(base_url)
    if url.scheme not in ("http", "https") or not url.hostname or url.username is not None or url.password is not None or url.fragment:
        raise TypeError("Google base_url must be an HTTP(S) URL without credentials or a fragment")
    query = parse_qsl(url.query, keep_blank_values=True)
    target = urlunsplit((url.scheme, url.netloc, url.path.removesuffix("/") + "/v1beta1/text:synthesize", urlencode(query), ""))
    request_headers = {key: item for key, item in headers.items() if key.lower() != "content-type"}
    request_headers["content-type"] = "application/json"
    body = json.dumps(_encode_synthesize_speech_request(value), separators=(",", ":"), allow_nan=False).encode("utf-8")
    return await transport.send(HttpRequest("POST", target, request_headers, body))

def decode_synthesize_speech_response(data: bytes) -> SynthesizeSpeechResponse:
    value: object = json.loads(data, parse_constant=_invalid_json_constant)
    if not is_synthesize_speech_response(value):
        raise TypeError("Invalid Google synthesizeSpeech response")
    return value

async def list_voices(value: ListVoicesInput, *, base_url: str, headers: Mapping[str, str], transport: HttpTransport) -> HttpResponse:
    if not is_list_voices_input(value):
        raise TypeError("Invalid Google listVoices input")
    url = urlsplit(base_url)
    if url.scheme not in ("http", "https") or not url.hostname or url.username is not None or url.password is not None or url.fragment:
        raise TypeError("Google base_url must be an HTTP(S) URL without credentials or a fragment")
    query = parse_qsl(url.query, keep_blank_values=True)
    if "languageCode" in value:
        query = [(key, item) for key, item in query if key != "languageCode"]
        query.append(("languageCode", str(value["languageCode"])))
    target = urlunsplit((url.scheme, url.netloc, url.path.removesuffix("/") + "/v1beta1/voices", urlencode(query), ""))
    return await transport.send(HttpRequest("GET", target, dict(headers), b""))

def decode_list_voices_response(data: bytes) -> ListVoicesResponse:
    value: object = json.loads(data, parse_constant=_invalid_json_constant)
    if not is_list_voices_response(value):
        raise TypeError("Invalid Google listVoices response")
    return value
