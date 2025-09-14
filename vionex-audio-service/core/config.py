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

# Legacy port management (for backward compatibility)
PORT_MIN = int(os.getenv("AUDIO_PORT_MIN", 35000))
PORT_MAX = int(os.getenv("AUDIO_PORT_MAX", 35400))

# Semantic service configuration
SEMANTIC_SERVICE_HOST = os.getenv("SEMANTIC_SERVICE_HOST", "localhost")
SEMANTIC_SERVICE_PORT = int(os.getenv("SEMANTIC_SERVICE_PORT", 30006))

# RTP Configuration for Translation Cabin
RTP_PORT_RANGE_START = int(os.getenv("RTP_PORT_RANGE_START", 40000))
RTP_PORT_RANGE_END = int(os.getenv("RTP_PORT_RANGE_END", 40400))

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
