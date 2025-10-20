"""
T5/MT5-based Text Error Corrector for STT output
Uses fine-tuned models for grammar/spelling correction
Supports: Vietnamese, English, Lao
"""

import logging
import os
from typing import Dict, Optional
from transformers import AutoTokenizer, AutoModelForSeq2SeqLM

logger = logging.getLogger(__name__)

# Fine-tuned models for each language
MODEL_MAP = {
    "vi": "bmd1905/vietnamese-correction",  # Vietnamese grammar correction
    "en": "vennify/t5-base-grammar-correction",          # English grammar correction
    "lo": "google/mt5-base"                              # Lao (fallback to pretrained)
}


class MT5TextCorrector:
    """
    Multilingual text error corrector using fine-tuned T5/MT5 models
    Corrects STT errors with grammar correction models
    """
    
    def __init__(self, model_size: str = "base", enable: bool = True):
        """
        Args:
            model_size: Ignored for now (using specific models per language)
            enable: Enable/disable corrector
        """
        self.enabled = enable
        
        if not self.enabled:
            logger.info("[TextCorrector] Disabled by configuration")
            return
        
        # Lazy loading - models loaded on demand
        self.models = {}
        self.tokenizers = {}
        
        # Context buffer per language
        self.context_buffer = {
            "vi": [],
            "en": [],
            "lo": []
        }
        
        logger.info("[TextCorrector] Grammar corrector initialized (lazy loading)")
    
    def _load_model(self, language: str):
        """Load model for specific language on demand"""
        if language in self.models:
            return True  # Already loaded
        
        if language not in MODEL_MAP:
            logger.debug(f"[TextCorrector] No model defined for {language}")
            return False
        
        try:
            model_name = MODEL_MAP[language]
            logger.info(f"[TextCorrector] Loading {language} model: {model_name}...")
            
            self.tokenizers[language] = AutoTokenizer.from_pretrained(model_name)
            self.models[language] = AutoModelForSeq2SeqLM.from_pretrained(model_name)
            
            logger.info(f"[TextCorrector] {language.upper()} model loaded successfully")
            return True
            
        except Exception as e:
            logger.error(f"[TextCorrector] Failed to load {language} model: {e}")
            return False
    
    def correct(self, text: str, language: str = "vi", use_context: bool = True) -> Dict:
        """
        Correct text errors using fine-tuned grammar correction models
        
        Args:
            text: Input text with potential errors
            language: Language code ("vi", "en", "lo")
            use_context: Whether to use previous chunks as context (currently not used)
            
        Returns:
            {
                "original": str,
                "corrected": str,
                "context_used": bool,
                "enabled": bool
            }
        """
        if not self.enabled:
            return {
                "original": text,
                "corrected": text,
                "context_used": False,
                "enabled": False
            }
        
        if not text or not text.strip():
            return {
                "original": text,
                "corrected": text,
                "context_used": False,
                "enabled": True
            }
        
        # Check if we have model for this language
        model_loaded = self._load_model(language)
        
        if not model_loaded:
            logger.debug(f"[TextCorrector] No model for language: {language}, returning original")
            return {
                "original": text,
                "corrected": text,
                "context_used": False,
                "enabled": True,
                "skipped": True
            }
        
        try:
            model = self.models[language]
            tokenizer = self.tokenizers[language]
            
            # Get context (for future use)
            context = self.context_buffer.get(language, [])
            
            # Simple input format (these models are trained for direct correction)
            # No special prefix needed - just pass the text
            input_text = text
            
            # Tokenize
            inputs = tokenizer(
                input_text,
                return_tensors="pt",
                max_length=256,
                truncation=True,
                padding=True
            )
            
            # Remove token_type_ids if present (T5/MT5 models don't use it)
            if "token_type_ids" in inputs:
                inputs.pop("token_type_ids")
            
            # Generate correction
            outputs = model.generate(
                **inputs,
                max_length=128,
                num_beams=3,  # Balance between quality and speed
                early_stopping=True,
                no_repeat_ngram_size=3  # Prevent repetition
            )
            
            corrected = tokenizer.decode(outputs[0], skip_special_tokens=True).strip()
            
            # Update context
            if language in self.context_buffer:
                self.context_buffer[language].append(corrected)
                if len(self.context_buffer[language]) > 5:
                    self.context_buffer[language].pop(0)
            
            return {
                "original": text,
                "corrected": corrected,
                "context_used": bool(context),  # Fixed: use context variable
                "enabled": True
            }
            
        except Exception as e:
            logger.error(f"[TextCorrector] Correction failed: {e}")
            return {
                "original": text,
                "corrected": text,
                "context_used": False,
                "enabled": True,
                "error": str(e)
            }
    
    def reset_context(self, language: Optional[str] = None):
        """Reset context buffer for specific language or all"""
        if language:
            self.context_buffer[language] = []
        else:
            for lang in self.context_buffer:
                self.context_buffer[lang] = []


def create_text_corrector(
    model_size: Optional[str] = None,
    enable: Optional[bool] = None
) -> MT5TextCorrector:
    """
    Factory function to create text corrector with env config
    
    Env variables:
        ENABLE_TEXT_CORRECTOR: "true"/"false" (default: false)
        TEXT_CORRECTOR_MODEL_SIZE: "small"/"base" (default: small)
    """
    # Read from env
    if enable is None:
        enable = os.getenv("ENABLE_TEXT_CORRECTOR", "false").lower() == "true"
    
    if model_size is None:
        model_size = os.getenv("TEXT_CORRECTOR_MODEL_SIZE", "small")
    
    return MT5TextCorrector(model_size=model_size, enable=enable)
