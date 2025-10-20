from faster_whisper import WhisperModel 
from core.config import (
    WHISPER_MODEL, 
    TYPE_ENGINE, 
    WHISPER_COMPUTE_TYPE,
    TTS_TEMPERATURE,
    TTS_LENGTH_PENALTY, 
    TTS_REPETITION_PENALTY,
    ENABLE_MIXED_PRECISION,
    ENABLE_TENSOR_CORES,
    BATCH_SIZE,
    ENABLE_ECC_MONITORING,
    POWER_LIMIT,
    THERMAL_THROTTLE_TEMP
)

print("[STT] Loading Distil-Whisper (distil-large-v3) - Direct use, no fallback")

from transformers import pipeline
import torch
import os

distil_whisper_model = pipeline(
    "automatic-speech-recognition",
    model="distil-whisper/distil-large-v3",
    device=0 if TYPE_ENGINE == "cuda" else -1,
    torch_dtype=torch.float16 if TYPE_ENGINE == "cuda" else torch.float32
    # Removed model_kwargs with use_flash_attention_2 for compatibility
)
if TYPE_ENGINE == "cuda":
    compute_type = WHISPER_COMPUTE_TYPE
else:
    compute_type = "int8"

whisper_model = WhisperModel(WHISPER_MODEL, device=TYPE_ENGINE, compute_type=compute_type)
print("[STT] Distil-Whisper loaded successfully (2x faster than Whisper)")

import os

# ============================================================================
# REPLACE MODEL: Translation - NLLB-Distilled (Better VI↔EN) - DIRECT USE
# ============================================================================
print("[TRANSLATION] Loading NLLB-Distilled (facebook/nllb-200-distilled-600M) - Direct use, no fallback")

from transformers import AutoModelForSeq2SeqLM, AutoTokenizer
import torch

nllb_model = AutoModelForSeq2SeqLM.from_pretrained(
    "facebook/nllb-200-distilled-600M",
    torch_dtype=torch.float16 if TYPE_ENGINE == "cuda" else torch.float32
)
nllb_tokenizer = AutoTokenizer.from_pretrained("facebook/nllb-200-distilled-600M")

if TYPE_ENGINE == "cuda":
    nllb_model = nllb_model.to("cuda")

# Create unified interface
translation_models = {"nllb": nllb_model}
translation_tokenizers = {"nllb": nllb_tokenizer}

print("[TRANSLATION] NLLB-Distilled loaded successfully (supports 200+ languages)")

from TTS.api import TTS
import os

# Set environment variable to automatically accept license for non-interactive environments
os.environ["COQUI_TOS_AGREED"] = "1"

# Monkey patch torch.load to allow pickle for TTS models (PyTorch 2.6+ compatibility)
import torch
_original_torch_load = torch.load
def _patched_torch_load(*args, **kwargs):
    if 'weights_only' not in kwargs:
        kwargs['weights_only'] = False
    return _original_torch_load(*args, **kwargs)
torch.load = _patched_torch_load

# Initialize TTS model with automatic license acceptance
tts_model = TTS(model_name="tts_models/multilingual/multi-dataset/xtts_v2").to(TYPE_ENGINE)

# Apply optimization parameters from config
tts_model.temperature = TTS_TEMPERATURE
tts_model.length_penalty = TTS_LENGTH_PENALTY  
tts_model.repetition_penalty = TTS_REPETITION_PENALTY

print("[TTS] XTTS-v2 loaded (temporary, will be replaced by CosyVoice2)")

# ============================================================================
# FUTURE: CosyVoice2 implementation (when available)
# ============================================================================
# print("[TTS] Loading CosyVoice2 Streaming (iic/CosyVoice2-0.5B)")
# from cosyvoice import CosyVoice2
# # 
# cosy_tts_model = CosyVoice2.from_pretrained(
#     "iic/CosyVoice2-0.5B",
#     device=TYPE_ENGINE if TYPE_ENGINE == "cuda" else "cpu",
#     streaming=True  # Enable streaming mode
# )
# # 
# tts_model = cosy_tts_model
# print("[TTS] CosyVoice2 Streaming loaded successfully (sub-second latency)")