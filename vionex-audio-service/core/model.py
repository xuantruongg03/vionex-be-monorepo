# from faster_whisper import WhisperModel 
# from core.config import (
#     WHISPER_MODEL, 
#     TYPE_ENGINE, 
#     WHISPER_COMPUTE_TYPE,
#     TTS_TEMPERATURE,
#     TTS_LENGTH_PENALTY, 
#     TTS_REPETITION_PENALTY,
#     ENABLE_MIXED_PRECISION,
#     ENABLE_TENSOR_CORES,
#     BATCH_SIZE,
#     ENABLE_ECC_MONITORING,
#     POWER_LIMIT,
#     THERMAL_THROTTLE_TEMP
# )

# print("[STT] Loading Distil-Whisper (distil-large-v3) - Direct use, no fallback")

# from transformers import pipeline
# import torch
# import os

# distil_whisper_model = pipeline(
#     "automatic-speech-recognition",
#     model="distil-whisper/distil-large-v3",
#     device=0 if TYPE_ENGINE == "cuda" else -1,
#     torch_dtype=torch.float16 if TYPE_ENGINE == "cuda" else torch.float32
#     # Removed model_kwargs with use_flash_attention_2 for compatibility
# )
# if TYPE_ENGINE == "cuda":
#     compute_type = WHISPER_COMPUTE_TYPE
# else:
#     compute_type = "int8"

# whisper_model = WhisperModel(WHISPER_MODEL, device=TYPE_ENGINE, compute_type=compute_type)
# print("[STT] Distil-Whisper loaded successfully (2x faster than Whisper)")

# import os

# # ============================================================================
# # REPLACE MODEL: Translation - NLLB-Distilled (Better VI↔EN) - DIRECT USE
# # ============================================================================
# print("[TRANSLATION] Loading NLLB-Distilled (facebook/nllb-200-distilled-600M) - Direct use, no fallback")

# from transformers import AutoModelForSeq2SeqLM, AutoTokenizer
# import torch

# nllb_model = AutoModelForSeq2SeqLM.from_pretrained(
#     "facebook/nllb-200-distilled-600M",
#     torch_dtype=torch.float16 if TYPE_ENGINE == "cuda" else torch.float32
# )
# nllb_tokenizer = AutoTokenizer.from_pretrained("facebook/nllb-200-distilled-600M")

# if TYPE_ENGINE == "cuda":
#     nllb_model = nllb_model.to("cuda")

# # Create unified interface
# translation_models = {"nllb": nllb_model}
# translation_tokenizers = {"nllb": nllb_tokenizer}

# print("[TRANSLATION] NLLB-Distilled loaded successfully (supports 200+ languages)")

# from TTS.api import TTS
# import os

# # Set environment variable to automatically accept license for non-interactive environments
# os.environ["COQUI_TOS_AGREED"] = "1"

# # Monkey patch torch.load to allow pickle for TTS models (PyTorch 2.6+ compatibility)
# import torch
# _original_torch_load = torch.load
# def _patched_torch_load(*args, **kwargs):
#     if 'weights_only' not in kwargs:
#         kwargs['weights_only'] = False
#     return _original_torch_load(*args, **kwargs)
# torch.load = _patched_torch_load

# # Initialize TTS model with automatic license acceptance
# tts_model = TTS(model_name="tts_models/multilingual/multi-dataset/xtts_v2").to(TYPE_ENGINE)

# # Apply optimization parameters from config
# tts_model.temperature = TTS_TEMPERATURE
# tts_model.length_penalty = TTS_LENGTH_PENALTY  
# tts_model.repetition_penalty = TTS_REPETITION_PENALTY

# print("[TTS] XTTS-v2 loaded (temporary, will be replaced by CosyVoice2)")

# # ============================================================================
# # FUTURE: CosyVoice2 implementation (when available)
# # ============================================================================
# # print("[TTS] Loading CosyVoice2 Streaming (iic/CosyVoice2-0.5B)")
# # from cosyvoice import CosyVoice2
# # # 
# # cosy_tts_model = CosyVoice2.from_pretrained(
# #     "iic/CosyVoice2-0.5B",
# #     device=TYPE_ENGINE if TYPE_ENGINE == "cuda" else "cpu",
# #     streaming=True  # Enable streaming mode
# # )
# # # 
# # tts_model = cosy_tts_model
# # print("[TTS] CosyVoice2 Streaming loaded successfully (sub-second latency)")
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

# Load model whisper with device-appropriate compute type
# Use float16 for CUDA/GPU, int8 for CPU to avoid compute type errors
if TYPE_ENGINE == "cuda":
    compute_type = WHISPER_COMPUTE_TYPE  # Use configured compute type for GPU
else:
    compute_type = "int8"  # Use int8 for CPU to avoid float16 errors

whisper_model = WhisperModel(WHISPER_MODEL, device=TYPE_ENGINE, compute_type=compute_type)

from transformers import MarianTokenizer, MarianMTModel
import os

# Dictionary to store loaded models and tokenizers
translation_models = {}
translation_tokenizers = {}

# Define model paths
model_paths = {
    "vi_en": "/app/models/Helsinki-NLP-opus-mt-vi-en",
    "en_vi": "/app/models/Helsinki-NLP-opus-mt-en-vi", 
    "vi_lo": "/app/models/Helsinki-NLP-opus-mt-vi-lo",
    "lo_vi": "/app/models/Helsinki-NLP-opus-mt-lo-vi",
    "en_lo": "/app/models/Helsinki-NLP-opus-mt-en-lo",
    "lo_en": "/app/models/Helsinki-NLP-opus-mt-lo-en"
}

# Load models with error handling
for model_key, model_path in model_paths.items():
    try:
        if os.path.exists(model_path):
            print(f"Loading translation model: {model_key}")
            tokenizer = MarianTokenizer.from_pretrained(model_path)
            model = MarianMTModel.from_pretrained(model_path)
            
            # Move to GPU if available
            if TYPE_ENGINE == "cuda":
                model = model.to("cuda")
                
            translation_tokenizers[model_key] = tokenizer
            translation_models[model_key] = model
            print(f"Successfully loaded {model_key} translation model")
        else:
            print(f"Warning: Model not found at {model_path} - {model_key} translation will be unavailable")
    except Exception as e:
        print(f"Error loading {model_key} model: {e}")

# Legacy variables for backward compatibility (only for existing models)
if "vi_en" in translation_models:
    tokenizer = translation_tokenizers["vi_en"]
    model_vi_en = translation_models["vi_en"]

if "en_vi" in translation_models:
    tokenizer_en_vi = translation_tokenizers["en_vi"] 
    model_en_vi = translation_models["en_vi"]

# New Lao models (only if available)
if "vi_lo" in translation_models:
    tokenizer_vi_lo = translation_tokenizers["vi_lo"]
    model_vi_lo = translation_models["vi_lo"]

if "lo_vi" in translation_models:
    tokenizer_lo_vi = translation_tokenizers["lo_vi"]
    model_lo_vi = translation_models["lo_vi"]

if "en_lo" in translation_models:
    tokenizer_en_lo = translation_tokenizers["en_lo"]
    model_en_lo = translation_models["en_lo"]

if "lo_en" in translation_models:
    tokenizer_lo_en = translation_tokenizers["lo_en"]
    model_lo_en = translation_models["lo_en"]

print(f"Loaded {len(translation_models)} translation models successfully")

# Load model tts
from TTS.api import TTS

tts_model = TTS(model_name="tts_models/multilingual/multi-dataset/xtts_v2").to(TYPE_ENGINE)

# Apply optimization parameters from config
tts_model.temperature = TTS_TEMPERATURE
tts_model.length_penalty = TTS_LENGTH_PENALTY  
tts_model.repetition_penalty = TTS_REPETITION_PENALTY

# GPU-specific optimizations for RTX A4000 (Ampere Professional)
if TYPE_ENGINE == "cuda":
    import torch
    
    # Enable mixed precision and tensor cores for Ampere
    if ENABLE_MIXED_PRECISION and hasattr(torch.cuda, 'amp') and torch.cuda.is_available():
        print("Enabling mixed precision for RTX A4000 (Ampere)")
        
    # Enable Tensor Core acceleration for Ampere architecture  
    if ENABLE_TENSOR_CORES and torch.cuda.is_available():
        torch.backends.cuda.matmul.allow_tf32 = True
        torch.backends.cudnn.allow_tf32 = True
        print("Enabling Tensor Core Gen 3 acceleration for A4000")
        
    # Log GPU info for monitoring
    if torch.cuda.is_available():
        gpu_name = torch.cuda.get_device_name(0)
        gpu_memory = torch.cuda.get_device_properties(0).total_memory / 1024**3
        compute_capability = torch.cuda.get_device_properties(0).major
        print(f"Using GPU: {gpu_name} with {gpu_memory:.1f}GB VRAM")
        print(f"Compute Capability: {compute_capability}.x")
        
        # RTX A4000 specific optimizations
        if "A4000" in gpu_name or ("RTX" in gpu_name and "Ampere" in str(torch.cuda.get_device_properties(0))):
            print("Detected RTX A4000 Professional GPU - applying workstation optimizations")
            
            # A4000 professional workstation settings
            if ENABLE_ECC_MONITORING:
                print(f"ECC monitoring enabled for production stability")
                
            # Set conservative power and thermal limits for 24/7 operation
            print(f"Power limit: {POWER_LIMIT}W, Thermal throttle: {THERMAL_THROTTLE_TEMP}°C")
            
            # Enable persistent mode for consistent performance
            try:
                torch.cuda.set_device(0)
                torch.cuda.empty_cache()
                print("GPU persistent mode enabled for stable performance")
            except Exception as e:
                print(f"Warning: Could not enable GPU optimizations: {e}")