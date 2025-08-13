import os
from dotenv import load_dotenv

load_dotenv()

# Server configuration
GRPC_PORT = int(os.getenv("AUDIO_GRPC_PORT", 30005))

# Audio processing configuration
WHISPER_MODEL = os.getenv("MODEL_WHISPER", "tiny")  # Use 'medium' model for better Vietnamese
WHISPER_DEVICE = os.getenv("MODEL_DEVICE", "cpu")

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

# Logging configuration
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")
