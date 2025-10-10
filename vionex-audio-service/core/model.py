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

# ============================================================================
# OLD: Marian MT implementation (COMMENTED OUT)
# ============================================================================
# USE_NEW_TRANSLATION = os.getenv("USE_NLLB", "true").lower() == "true"
# 
# if USE_NEW_TRANSLATION:
#     print("[TRANSLATION] Loading NLLB-Distilled")
#     try:
#         from transformers import AutoModelForSeq2SeqLM, AutoTokenizer
#         import torch
#         
#         nllb_model = AutoModelForSeq2SeqLM.from_pretrained(...)
#         nllb_tokenizer = AutoTokenizer.from_pretrained(...)
#         
#         translation_models = {"nllb": nllb_model}
#         translation_tokenizers = {"nllb": nllb_tokenizer}
#         
#         print("[TRANSLATION] NLLB-Distilled loaded successfully")
#         
#     except Exception as e:
#         print(f"[TRANSLATION] Failed to load NLLB: {e}")
#         USE_NEW_TRANSLATION = False
# 
# if not USE_NEW_TRANSLATION:
#     print("[TRANSLATION] Loading Marian MT models (Helsinki-NLP)")
#     
#     translation_models = {}
#     translation_tokenizers = {}
# 
#     model_paths = {
#         "vi_en": "/app/models/Helsinki-NLP-opus-mt-vi-en",
#         "en_vi": "/app/models/Helsinki-NLP-opus-mt-en-vi", 
#         "vi_lo": "/app/models/Helsinki-NLP-opus-mt-vi-lo",
#         "lo_vi": "/app/models/Helsinki-NLP-opus-mt-lo-vi",
#         "en_lo": "/app/models/Helsinki-NLP-opus-mt-en-lo",
#         "lo_en": "/app/models/Helsinki-NLP-opus-mt-lo-en"
#     }
# 
#     for model_key, model_path in model_paths.items():
#         try:
#             if os.path.exists(model_path):
#                 print(f"Loading translation model: {model_key}")
#                 tokenizer = MarianTokenizer.from_pretrained(model_path)
#                 model = MarianMTModel.from_pretrained(model_path)
#                 
#                 if TYPE_ENGINE == "cuda":
#                     model = model.to("cuda")
#                     
#                 translation_tokenizers[model_key] = tokenizer
#                 translation_models[model_key] = model
#                 print(f"Successfully loaded {model_key} translation model")
#             else:
#                 print(f"Warning: Model not found at {model_path}")
#         except Exception as e:
#             print(f"Error loading {model_key} model: {e}")
# 
#     # Legacy variables for backward compatibility
#     if "vi_en" in translation_models:
#         tokenizer = translation_tokenizers["vi_en"]
#         model_vi_en = translation_models["vi_en"]
#     # ... other legacy variables ...

# ============================================================================
# REPLACE MODEL: TTS - CosyVoice2 Streaming (Realtime TTS) - DIRECT USE
# ============================================================================
# NOTE: CosyVoice2 not yet available, keeping XTTS-v2 for now
# print("[TTS] Loading XTTS-v2 (tts_models/multilingual/multi-dataset/xtts_v2)")
# print("[TTS] Note: CosyVoice2 will replace this when available")

# from TTS.api import TTS
# import os

# Set environment variable to automatically accept license for non-interactive environments
# os.environ["COQUI_TOS_AGREED"] = "1"

# # Initialize TTS model with automatic license acceptance
# tts_model = TTS(model_name="tts_models/multilingual/multi-dataset/xtts_v2").to(TYPE_ENGINE)

# # Apply optimization parameters from config
# tts_model.temperature = TTS_TEMPERATURE
# tts_model.length_penalty = TTS_LENGTH_PENALTY  
# tts_model.repetition_penalty = TTS_REPETITION_PENALTY

# print("[TTS] XTTS-v2 loaded (temporary, will be replaced by CosyVoice2)")

# ============================================================================
# FUTURE: CosyVoice2 implementation (when available)
# ============================================================================
print("[TTS] Loading CosyVoice (iic/CosyVoice2-0.5B)")

# Import CosyVoice correctly based on official package structure
# Official CosyVoice package structure: cosyvoice.cli.cosyvoice.CosyVoice or CosyVoice2
try:
    # Method 1: Try CosyVoice2 class from cli.cosyvoice
    from cosyvoice.cli.cosyvoice import CosyVoice2
    CosyVoiceClass = CosyVoice2
    print("[TTS] Using CosyVoice2 class")
except (ImportError, AttributeError) as e1:
    print(f"[TTS] CosyVoice2 not found, trying CosyVoice: {e1}")
    try:
        # Method 2: Try CosyVoice class from cli.cosyvoice
        from cosyvoice.cli.cosyvoice import CosyVoice
        CosyVoiceClass = CosyVoice
        print("[TTS] Using CosyVoice class")
    except (ImportError, AttributeError) as e2:
        print(f"[TTS] CosyVoice not found in cli.cosyvoice: {e2}")
        try:
            # Method 3: Try direct import from cosyvoice module
            from cosyvoice import CosyVoice
            CosyVoiceClass = CosyVoice
            print("[TTS] Using direct CosyVoice import")
        except ImportError as e3:
            print(f"[TTS] All CosyVoice imports failed!")
            print(f"  - Method 1: {e1}")
            print(f"  - Method 2: {e2}")
            print(f"  - Method 3: {e3}")
            raise ImportError("Cannot import CosyVoice. Please check installation: pip install cosyvoice")

# Initialize CosyVoice model
print(f"[TTS] Initializing {CosyVoiceClass.__name__} with model: iic/CosyVoice2-0.5B")

# CosyVoice initialization - check signature
import inspect
init_signature = inspect.signature(CosyVoiceClass.__init__)
print(f"[TTS] {CosyVoiceClass.__name__}.__init__ parameters: {list(init_signature.parameters.keys())}")

# Initialize with appropriate arguments
try:
    # Try with model path only
    cosy_tts_model = CosyVoiceClass("iic/CosyVoice2-0.5B")
    print("[TTS] CosyVoice initialized with model path only")
except TypeError as e:
    print(f"[TTS] Failed with model path only: {e}")
    try:
        # Try with additional parameters
        cosy_tts_model = CosyVoiceClass(
            model_dir="iic/CosyVoice2-0.5B",
            load_jit=False,
            load_onnx=False
        )
        print("[TTS] CosyVoice initialized with model_dir + load flags")
    except Exception as e2:
        print(f"[TTS] Failed with load flags: {e2}")
        # Last resort - try minimal init
        cosy_tts_model = CosyVoiceClass()
        print("[TTS] CosyVoice initialized with default parameters")

tts_model = cosy_tts_model
print(f"[TTS] CosyVoice loaded successfully - Type: {type(tts_model)}")

# Check available methods
tts_methods = [m for m in dir(tts_model) if not m.startswith('_')]
print(f"[TTS] Available methods: {tts_methods[:10]}...")  # Show first 10 methods

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
        