
import logging
import torch
from core.model import translation_models, translation_tokenizers

logger = logging.getLogger(__name__)

class TranslateProcess:
    """
        Class to handle translation between multiple languages using MarianMTModel.
        Supports: Vietnamese (vi), English (en), Lao (lo)
        Translation directions available based on loaded models.
    """
    def __init__(self):
        self.models = translation_models
        self.tokenizers = translation_tokenizers
        
        # Log available models
        available_directions = list(self.models.keys())
        logger.info(f"[TranslateProcess] Available translation models: {available_directions}")

    def _get_model_and_tokenizer(self, direction):
        """Get model and tokenizer for a specific direction"""
        if direction not in self.models or direction not in self.tokenizers:
            return None, None
        return self.models[direction], self.tokenizers[direction]

    def _translate_generic(self, text, direction):
        """Generic translation method for any direction"""
        model, tokenizer = self._get_model_and_tokenizer(direction)
        
        if model is None or tokenizer is None:
            logger.warning(f"[TranslateProcess] Model not available for direction: {direction}")
            return [text] if isinstance(text, str) else text
            
        try:
            # Handle both string and list inputs
            text_input = text if isinstance(text, str) else ' '.join(text)
            
            # Tokenize input sentences
            inputs = tokenizer(text_input, return_tensors="pt", padding=True, truncation=True)
            
            # Move inputs to the same device as the model
            try:
                device = next(model.parameters()).device
                inputs = {k: v.to(device) for k, v in inputs.items()}
            except Exception as device_error:
                logger.warning(f"[TranslateProcess] Could not move inputs to model device: {device_error}")

            with torch.no_grad():  # Disable gradient computation for inference
                translated = model.generate(
                    **inputs,
                    max_new_tokens=64,          # giới hạn output ngắn hơn
                    num_beams=1,                # greedy decode → nhanh hơn
                    do_sample=False,
                    early_stopping=True,
                    pad_token_id=tokenizer.pad_token_id,
                    eos_token_id=tokenizer.eos_token_id,
                )

            
            # Decode the generated tokens
            result = [tokenizer.decode(t, skip_special_tokens=True) for t in translated]
            
            # Clean up GPU memory if using CUDA
            # if torch.cuda.is_available():
            #     torch.cuda.empty_cache()
            
            return result
        except Exception as e:
            logger.error(f"[TranslateProcess] Error in {direction} translation: {e}")
            return [text] if isinstance(text, str) else text

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
        direction_map = {
            "vi_en": "vi→en",
            "en_vi": "en→vi", 
            "vi_lo": "vi→lo",
            "lo_vi": "lo→vi",
            "en_lo": "en→lo", 
            "lo_en": "lo→en"
        }
        return [direction_map[key] for key in self.models.keys() if key in direction_map]
    
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
        
        if direction_key in self.models:
            return self._translate_generic(text, direction_key)
        else:
            logger.warning(f"[TranslateProcess] Model not available for direction: {source_lang}→{target_lang}")
            return [text] if isinstance(text, str) else text