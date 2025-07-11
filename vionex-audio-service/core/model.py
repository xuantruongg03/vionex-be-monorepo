from faster_whisper import WhisperModel
from core.config import WHISPER_MODEL, WHISPER_DEVICE
# Load model
model = WhisperModel(WHISPER_MODEL, device=WHISPER_DEVICE, compute_type="int8")
