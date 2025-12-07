import os
from dotenv import load_dotenv

load_dotenv()

# Server configuration
GRPC_PORT = int(os.getenv("AUDIO_GRPC_PORT", 30005))

# Audio processing configuration
WHISPER_MODEL = os.getenv("MODEL_WHISPER", "tiny") 
WHISPER_COMPUTE_TYPE = os.getenv("WHISPER_COMPUTE_TYPE", "int8")

# TTS optimization parameters - A4000 balanced settings
TTS_TEMPERATURE = float(os.getenv("TTS_TEMPERATURE", "0.6"))
TTS_LENGTH_PENALTY = float(os.getenv("TTS_LENGTH_PENALTY", "0.9"))
TTS_REPETITION_PENALTY = float(os.getenv("TTS_REPETITION_PENALTY", "2.8"))

# GPU optimization - RTX A4000 Ampere architecture
ENABLE_MIXED_PRECISION = os.getenv("ENABLE_MIXED_PRECISION", "true").lower() == "true"
ENABLE_TENSOR_CORES = os.getenv("ENABLE_TENSOR_CORES", "true").lower() == "true"
BATCH_SIZE = int(os.getenv("BATCH_SIZE", "3"))

# A4000 Professional workstation specific
ENABLE_ECC_MONITORING = os.getenv("ENABLE_ECC_MONITORING", "true").lower() == "true"
POWER_LIMIT = int(os.getenv("POWER_LIMIT", "140"))
THERMAL_THROTTLE_TEMP = int(os.getenv("THERMAL_THROTTLE_TEMP", "83")) 

# Audio buffer settings
SAMPLE_RATE = 16000
CHANNELS = 1
MIN_AUDIO_DURATION = 1.0  # Minimum 1.0s - frontend padding ensures quality

# ============================================================================
# SHARED SOCKET CONFIGURATION (Translation Cabin)
# ============================================================================
# Single shared port for ALL translation cabins
# Audio Service receives RTP from SFU on this port
# Routing is based on SSRC extracted from RTP header
SHARED_SOCKET_PORT = int(os.getenv("SHARED_SOCKET_PORT", 35000))

# Semantic service configuration
SEMANTIC_SERVICE_HOST = os.getenv("SEMANTIC_SERVICE_HOST", "localhost")
SEMANTIC_SERVICE_PORT = int(os.getenv("SEMANTIC_SERVICE_PORT", 30006))

# Mediasoup Integration
MEDIASOUP_WORKER_HOST = os.getenv("MEDIASOUP_WORKER_HOST", "localhost")
MEDIASOUP_WORKER_PORT = int(os.getenv("MEDIASOUP_WORKER_PORT", 3000))

# SFU service configuration
SFU_SERVICE_HOST = os.getenv("SFU_SERVICE_HOST", "127.0.0.1")
SFU_SERVICE_PORT = int(os.getenv("SFU_SERVICE_PORT", 30004))

# Type engine
TYPE_ENGINE = os.getenv("TYPE_ENGINE", "cpu")

# Logging configuration
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")
LOG_TO_FILE = os.getenv("LOG_TO_FILE", "true").lower() == "true"
LOG_DIR = os.getenv("LOG_DIR", "logs")
LOG_FILE_PREFIX = os.getenv("LOG_FILE_PREFIX", "audio_service")

ENABLE_TEST_MODE = os.getenv("ENABLE_TEST_MODE", "false").lower() == "true"

# ============================================================================
# TRANSLATION CABIN CONFIGURATION
# ============================================================================
# Playback queue settings
PLAYBACK_BUFFER_DURATION = float(os.getenv("PLAYBACK_BUFFER_DURATION", "1.0"))  # Buffer before starting playback (seconds)
PLAYBACK_MIN_QUEUE_SIZE = int(os.getenv("PLAYBACK_MIN_QUEUE_SIZE", "2"))  # Minimum chunks in queue before playback
PLAYBACK_QUEUE_MAX_SIZE = int(os.getenv("PLAYBACK_QUEUE_MAX_SIZE", "32"))  # Max queue size

# Audio chunking settings for translation
TRANSLATION_WINDOW_DURATION = float(os.getenv("TRANSLATION_WINDOW_DURATION", "1.5"))  # Each chunk duration (seconds)
TRANSLATION_SAMPLE_RATE = int(os.getenv("TRANSLATION_SAMPLE_RATE", "16000"))  # 16kHz mono PCM16
