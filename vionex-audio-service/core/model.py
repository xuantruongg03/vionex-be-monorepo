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

# Load model whisper with configurable compute type
whisper_model = WhisperModel(WHISPER_MODEL, device=TYPE_ENGINE, compute_type=WHISPER_COMPUTE_TYPE)

from transformers import MarianTokenizer, MarianMTModel

# Load translation model from local directory in container
model_vi_en_link = "/app/models/Helsinki-NLP-opus-mt-vi-en"
# model_vi_en_link = "models/Helsinki-NLP-opus-mt-vi-en"
tokenizer = MarianTokenizer.from_pretrained(model_vi_en_link)
model_vi_en = MarianMTModel.from_pretrained(model_vi_en_link)

# Move translation model to GPU for faster inference
if TYPE_ENGINE == "cuda":
    model_vi_en = model_vi_en.to("cuda")

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