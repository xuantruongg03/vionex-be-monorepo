import os
from dotenv import load_dotenv

load_dotenv()

# Server configuration
GRPC_PORT = int(os.getenv("AUDIO_GRPC_PORT", 30005))

# Audio processing configuration
WHISPER_MODEL = os.getenv("MODEL_WHISPER", "medium")  # Use 'medium' model for better Vietnamese
WHISPER_DEVICE = os.getenv("MODEL_DEVICE", "cpu")
TRANSCRIPT_DIR = os.getenv("TRANSCRIPT_DIR", "./transcripts")

# Audio buffer settings
SAMPLE_RATE = 16000
CHANNELS = 1
MIN_AUDIO_DURATION = 1.0  # Minimum 1.0s - frontend padding ensures quality

# Legacy port management (for backward compatibility)
PORT_MIN = int(os.getenv("AUDIO_PORT_MIN", 35000))
PORT_MAX = int(os.getenv("AUDIO_PORT_MAX", 35400))

# Create directories
os.makedirs(TRANSCRIPT_DIR, exist_ok=True)

# Logging configuration
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")
