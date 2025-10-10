
import logging
import torch
from core.model import translation_models, translation_tokenizers

logger = logging.getLogger(__name__)

class TranslateProcess:
    """
    REPLACE MODEL: NLLB-Distilled only (no fallback to Marian MT)
    Supports: Vietnamese (vi), English (en), Lao (lo)
    
    OPTIMIZED FOR SPEED: Target < 2s total pipeline processing
    - num_beams=2 (fast, acceptable quality)
    - max_new_tokens=128 (sufficient for most cases)
    """
    def __init__(self):
        self.models = translation_models
        self.tokenizers = translation_tokenizers
        
        # NLLB language codes (ISO 639-3 with script)
        self.nllb_lang_codes = {
            "vi": "vie_Latn",  # Vietnamese (Latin script)
            "en": "eng_Latn",  # English (Latin script)
            "lo": "lao_Laoo"   # Lao (Lao script)
        }
        logger.info("[TranslateProcess] Using NLLB-Distilled (Speed-Optimized for < 2s latency)")

    def _get_model_and_tokenizer(self, direction):
        """Get NLLB model and tokenizer"""
        return self.models.get("nllb"), self.tokenizers.get("nllb")

    def _translate_generic(self, text, direction):
        """
        REPLACE MODEL: NLLB translation only
        """
        text_input = text if isinstance(text, str) else ' '.join(text)
        return self._translate_nllb(text_input, direction)
    
    def _translate_nllb(self, text: str, direction: str):
        """
        REPLACE MODEL: Translate using NLLB-Distilled
        """
        try:
            # Validate input
            if not text or not text.strip():
                logger.warning("[NLLB] Empty text received")
                return [""]
            
            text = text.strip()
            
            # Check text length
            if len(text) > 5000:  # Prevent extremely long texts
                logger.warning(f"[NLLB] Text too long ({len(text)} chars), truncating to 5000")
                text = text[:5000]
            
            # Parse source and target languages from direction (e.g., "vi_en" -> vi, en)
            src_lang, tgt_lang = direction.split("_")
            
            # Get NLLB language codes
            src_code = self.nllb_lang_codes.get(src_lang, "vie_Latn")
            tgt_code = self.nllb_lang_codes.get(tgt_lang, "eng_Latn")
            
            model = self.models["nllb"]
            tokenizer = self.tokenizers["nllb"]
            
            # Set source language
            tokenizer.src_lang = src_code
            
            logger.debug(f"[NLLB] Translating {src_lang}→{tgt_lang}: '{text[:50]}...' ({len(text)} chars)")
            
            # Tokenize (reduced max_length for speed)
            inputs = tokenizer(
                text, 
                return_tensors="pt", 
                padding=True, 
                truncation=True,
                max_length=256  # Reduced from 512 for faster processing
            )
            
            # Move to device
            try:
                device = next(model.parameters()).device
                inputs = {k: v.to(device) for k, v in inputs.items()}
            except Exception as e:
                logger.warning(f"[NLLB] Could not move to device: {e}")
            
            # Generate translation (SPEED OPTIMIZED for < 2s target)
            with torch.no_grad():
                translated = model.generate(
                    **inputs,
                    forced_bos_token_id=tokenizer.lang_code_to_id[tgt_code],
                    max_new_tokens=128,      # Reduced from 256 for speed (sufficient for 20-30 words)
                    num_beams=2,             # Reduced from 4 for speed (2x faster, ~10% quality trade-off)
                    do_sample=False,
                    early_stopping=True,
                    temperature=1.0,
                    repetition_penalty=1.2,
                    no_repeat_ngram_size=3   # Prevent 3-gram repetitions
                )
            
            # Decode
            result = tokenizer.decode(translated[0], skip_special_tokens=True)
            
            logger.debug(f"[NLLB] Translation result: '{result[:50]}...' ({len(result)} chars)")
            
            return [result]
            
        except Exception as e:
            logger.error(f"[NLLB] Translation error {direction}: {e}")
            return [text]

    def translate_vi_to_en(self, vietnamese_sentences):
        """Translate Vietnamese to English"""
        return self._translate_generic(vietnamese_sentences, "vi_en")
    
    def translate_en_to_vi(self, english_sentences):
        """Translate English to Vietnamese"""
        return self._translate_generic(english_sentences, "en_vi")
    
    def translate_vi_to_lo(self, vietnamese_sentences):
        """Translate Vietnamese to Lao"""
        return self._translate_generic(vietnamese_sentences, "vi_lo")
    
    def translate_lo_to_vi(self, lao_sentences):
        """Translate Lao to Vietnamese"""
        return self._translate_generic(lao_sentences, "lo_vi")
    
    def translate_en_to_lo(self, english_sentences):
        """Translate English to Lao"""
        return self._translate_generic(english_sentences, "en_lo")
    
    def translate_lo_to_en(self, lao_sentences):
        """Translate Lao to English"""
        return self._translate_generic(lao_sentences, "lo_en")
    
    def get_supported_directions(self):
        """Get list of all supported translation directions based on available models"""
        # NLLB supports all directions
        return ["vi→en", "en→vi", "vi→lo", "lo→vi", "en→lo", "lo→en"]
    
    def translate(self, text, source_lang, target_lang):
        """
        Generic translation method that routes to appropriate specific method
        Args:
            text (str): Text to translate
            source_lang (str): Source language code (vi, en, lo)
            target_lang (str): Target language code (vi, en, lo)
        Returns:
            list: List of translated sentences
        """
        if source_lang == target_lang:
            return [text] if isinstance(text, str) else text
            
        # Map language codes to model direction keys
        direction_key = f"{source_lang}_{target_lang}"
        return self._translate_generic(text, direction_key)

# ============================================================================
# OLD: Marian MT implementation with fallback logic (COMMENTED OUT)
# ============================================================================
# class TranslateProcess:
#     def __init__(self):
#         self.models = translation_models
#         self.tokenizers = translation_tokenizers
#         
#         # Check if using NLLB
#         self.use_nllb = "nllb" in self.models
#         
#         if self.use_nllb:
#             self.nllb_lang_codes = {...}
#             logger.info("[TranslateProcess] Using NLLB-Distilled")
#         else:
#             available_directions = list(self.models.keys())
#             logger.info(f"[TranslateProcess] Using Marian MT: {available_directions}")
# 
#     def _translate_generic(self, text, direction):
#         text_input = text if isinstance(text, str) else ' '.join(text)
#         
#         if self.use_nllb:
#             return self._translate_nllb(text_input, direction)
#         else:
#             return self._translate_marian(text_input, direction)
# 
#     def _translate_marian(self, text: str, direction: str):
#         model, tokenizer = self._get_model_and_tokenizer(direction)
#         
#         if model is None or tokenizer is None:
#             logger.warning(f"[Marian] Model not available: {direction}")
#             return [text]
#             
#         try:
#             inputs = tokenizer(text, return_tensors="pt", padding=True, truncation=True)
#             
#             try:
#                 device = next(model.parameters()).device
#                 inputs = {k: v.to(device) for k, v in inputs.items()}
#             except Exception as device_error:
#                 logger.warning(f"[Marian] Device error: {device_error}")
# 
#             with torch.no_grad():
#                 translated = model.generate(
#                     **inputs,
#                     max_new_tokens=64,
#                     num_beams=1,
#                     do_sample=False,
#                     early_stopping=True,
#                     pad_token_id=tokenizer.pad_token_id,
#                     eos_token_id=tokenizer.eos_token_id,
#                 )
#             
#             result = [tokenizer.decode(t, skip_special_tokens=True) for t in translated]
#             return result
#             
#         except Exception as e:
#             logger.error(f"[Marian] Error in {direction}: {e}")
#             return [text]
# 
#     def get_supported_directions(self):
#         direction_map = {
#             "vi_en": "vi→en", "en_vi": "en→vi",
#             "vi_lo": "vi→lo", "lo_vi": "lo→vi",
#             "en_lo": "en→lo", "lo_en": "lo→en"
#         }
#         return [direction_map[key] for key in self.models.keys() if key in direction_map]
# 
#     def translate(self, text, source_lang, target_lang):
#         if source_lang == target_lang:
#             return [text] if isinstance(text, str) else text
#             
#         direction_key = f"{source_lang}_{target_lang}"
#         
#         if direction_key in self.models:
#             return self._translate_generic(text, direction_key)
#         else:
#             logger.warning(f"[TranslateProcess] Model not available: {source_lang}→{target_lang}")
#             return [text] if isinstance(text, str) else text