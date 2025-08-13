from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Optional as _Optional

DESCRIPTOR: _descriptor.FileDescriptor

class PortRequest(_message.Message):
    __slots__ = ("roomId", "userId")
    ROOMID_FIELD_NUMBER: _ClassVar[int]
    USERID_FIELD_NUMBER: _ClassVar[int]
    roomId: str
    userId: str
    def __init__(self, roomId: _Optional[str] = ..., userId: _Optional[str] = ...) -> None: ...

class PortReply(_message.Message):
    __slots__ = ("success", "port", "ready")
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    PORT_FIELD_NUMBER: _ClassVar[int]
    READY_FIELD_NUMBER: _ClassVar[int]
    success: bool
    port: int
    ready: bool
    def __init__(self, success: bool = ..., port: _Optional[int] = ..., ready: bool = ...) -> None: ...

class Empty(_message.Message):
    __slots__ = ("success",)
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    success: bool
    def __init__(self, success: bool = ...) -> None: ...

class ProcessAudioBufferRequest(_message.Message):
    __slots__ = ("userId", "roomId", "timestamp", "buffer", "duration", "sampleRate", "channels")
    USERID_FIELD_NUMBER: _ClassVar[int]
    ROOMID_FIELD_NUMBER: _ClassVar[int]
    TIMESTAMP_FIELD_NUMBER: _ClassVar[int]
    BUFFER_FIELD_NUMBER: _ClassVar[int]
    DURATION_FIELD_NUMBER: _ClassVar[int]
    SAMPLERATE_FIELD_NUMBER: _ClassVar[int]
    CHANNELS_FIELD_NUMBER: _ClassVar[int]
    userId: str
    roomId: str
    timestamp: int
    buffer: bytes
    duration: float
    sampleRate: int
    channels: int
    def __init__(self, userId: _Optional[str] = ..., roomId: _Optional[str] = ..., timestamp: _Optional[int] = ..., buffer: _Optional[bytes] = ..., duration: _Optional[float] = ..., sampleRate: _Optional[int] = ..., channels: _Optional[int] = ...) -> None: ...

class ProcessAudioBufferResponse(_message.Message):
    __slots__ = ("success", "transcript", "confidence", "message")
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    TRANSCRIPT_FIELD_NUMBER: _ClassVar[int]
    CONFIDENCE_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    success: bool
    transcript: str
    confidence: float
    message: str
    def __init__(self, success: bool = ..., transcript: _Optional[str] = ..., confidence: _Optional[float] = ..., message: _Optional[str] = ...) -> None: ...

class ProcessAudioRequest(_message.Message):
    __slots__ = ("roomId", "userId", "timestamp", "audioBuffer", "duration")
    ROOMID_FIELD_NUMBER: _ClassVar[int]
    USERID_FIELD_NUMBER: _ClassVar[int]
    TIMESTAMP_FIELD_NUMBER: _ClassVar[int]
    AUDIOBUFFER_FIELD_NUMBER: _ClassVar[int]
    DURATION_FIELD_NUMBER: _ClassVar[int]
    roomId: str
    userId: str
    timestamp: int
    audioBuffer: bytes
    duration: float
    def __init__(self, roomId: _Optional[str] = ..., userId: _Optional[str] = ..., timestamp: _Optional[int] = ..., audioBuffer: _Optional[bytes] = ..., duration: _Optional[float] = ...) -> None: ...

class ProcessAudioResponse(_message.Message):
    __slots__ = ("success", "message")
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    success: bool
    message: str
    def __init__(self, success: bool = ..., message: _Optional[str] = ...) -> None: ...

class ServiceStatsResponse(_message.Message):
    __slots__ = ("success", "message", "totalProcessed", "successful", "failed", "tooShort", "noSpeech", "successRate", "modelLoaded")
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    TOTALPROCESSED_FIELD_NUMBER: _ClassVar[int]
    SUCCESSFUL_FIELD_NUMBER: _ClassVar[int]
    FAILED_FIELD_NUMBER: _ClassVar[int]
    TOOSHORT_FIELD_NUMBER: _ClassVar[int]
    NOSPEECH_FIELD_NUMBER: _ClassVar[int]
    SUCCESSRATE_FIELD_NUMBER: _ClassVar[int]
    MODELLOADED_FIELD_NUMBER: _ClassVar[int]
    success: bool
    message: str
    totalProcessed: int
    successful: int
    failed: int
    tooShort: int
    noSpeech: int
    successRate: float
    modelLoaded: bool
    def __init__(self, success: bool = ..., message: _Optional[str] = ..., totalProcessed: _Optional[int] = ..., successful: _Optional[int] = ..., failed: _Optional[int] = ..., tooShort: _Optional[int] = ..., noSpeech: _Optional[int] = ..., successRate: _Optional[float] = ..., modelLoaded: bool = ...) -> None: ...

class CreateTranslationCabinRequest(_message.Message):
    __slots__ = ("roomId", "userId", "sourceLanguage", "targetLanguage")
    ROOMID_FIELD_NUMBER: _ClassVar[int]
    USERID_FIELD_NUMBER: _ClassVar[int]
    SOURCELANGUAGE_FIELD_NUMBER: _ClassVar[int]
    TARGETLANGUAGE_FIELD_NUMBER: _ClassVar[int]
    roomId: str
    userId: str
    sourceLanguage: str
    targetLanguage: str
    def __init__(self, roomId: _Optional[str] = ..., userId: _Optional[str] = ..., sourceLanguage: _Optional[str] = ..., targetLanguage: _Optional[str] = ...) -> None: ...

class CreateTranslationCabinResponse(_message.Message):
    __slots__ = ("success", "message", "streamId")
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    STREAMID_FIELD_NUMBER: _ClassVar[int]
    success: bool
    message: str
    streamId: str
    def __init__(self, success: bool = ..., message: _Optional[str] = ..., streamId: _Optional[str] = ...) -> None: ...
