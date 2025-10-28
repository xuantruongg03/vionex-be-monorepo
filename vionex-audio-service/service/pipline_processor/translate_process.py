
import logging
import torch
from core.model import translation_models, translation_tokenizers

logger = logging.getLogger(__name__)

class TranslateProcess:
    """
    MarianMT Translation Service
    Supports: Vietnamese (vi), English (en), Lao (lo)
    
    OPTIMIZED FOR SPEED: Target < 2s total pipeline processing
    - Fast inference with MarianMT (smaller models, faster than NLLB)
    - num_beams=1 (greedy decoding for maximum speed)
    - max_new_tokens=128 (sufficient for most cases)
    - Early stopping enabled
    """
    def __init__(self):
        self.models = translation_models
        self.tokenizers = translation_tokenizers
        
        # Log available translation directions
        available_directions = [f"{k.replace('_', '→')}" for k in self.models.keys()]
        logger.info(f"[TranslateProcess] Using MarianMT models: {', '.join(available_directions)}")
        
        if not self.models:
            logger.warning("[TranslateProcess] No translation models loaded!")

    def _get_model_and_tokenizer(self, direction):
        """
        Get MarianMT model and tokenizer for specific direction
        
        Args:
            direction: Translation direction (e.g., "vi_en", "en_vi")
        
        Returns:
            tuple: (model, tokenizer) or (None, None) if not available
        """
        model = self.models.get(direction)
        tokenizer = self.tokenizers.get(direction)
        
        if model is None or tokenizer is None:
            logger.warning(f"[MarianMT] Model not available for direction: {direction}")
            return None, None
            
        return model, tokenizer

    def _translate_generic(self, text, direction):
        """
        Generic translation method using MarianMT
        
        Args:
            text: Text to translate (str or list)
            direction: Translation direction (e.g., "vi_en")
        
        Returns:
            list: Translated text(s)
        """
        text_input = text if isinstance(text, str) else ' '.join(text)
        return self._translate_marian(text_input, direction)
    
    def _translate_marian(self, text: str, direction: str):
        """
        Translate using MarianMT models (OPTIMIZED FOR SPEED)
        
        Speed optimizations:
        - Greedy decoding (num_beams=1) for 3-4x speedup vs beam search
        - Early stopping enabled
        - Reduced max_new_tokens for faster generation
        - No sampling for deterministic results
        
        Args:
            text: Text to translate
            direction: Translation direction (e.g., "vi_en", "en_vi")
        
        Returns:
            list: List containing translated text
        """
        try:
            # Validate input
            if not text or not text.strip():
                logger.warning("[MarianMT] Empty text received")
                return [""]
            
            text = text.strip()
            
            # Check text length (MarianMT works better with shorter sequences)
            if len(text) > 5000:
                logger.warning(f"[MarianMT] Text too long ({len(text)} chars), truncating to 5000")
                text = text[:5000]
            
            # Get model and tokenizer
            model, tokenizer = self._get_model_and_tokenizer(direction)
            
            if model is None or tokenizer is None:
                logger.warning(f"[MarianMT] Model not available for {direction}, returning original text")
                return [text]
            
            src_lang, tgt_lang = direction.split("_")
            logger.debug(f"[MarianMT] Translating {src_lang}→{tgt_lang}: '{text[:50]}...' ({len(text)} chars)")
            
            # Tokenize input
            inputs = tokenizer(
                text, 
                return_tensors="pt", 
                padding=True, 
                truncation=True,
                max_length=512  # MarianMT standard max length
            )
            
            # Move to device (GPU if available)
            try:
                device = next(model.parameters()).device
                inputs = {k: v.to(device) for k, v in inputs.items()}
                logger.debug(f"[MarianMT] Using device: {device}")
            except Exception as device_error:
                logger.warning(f"[MarianMT] Device error: {device_error}, using CPU")
            
            # Generate translation (SPEED OPTIMIZED)
            with torch.no_grad():
                translated = model.generate(
                    **inputs,
                    max_new_tokens=128,      # Sufficient for most sentences (20-30 words)
                    num_beams=1,             # Greedy decoding (fastest, 3-4x speedup vs num_beams=4)
                    do_sample=False,         # Deterministic output
                    early_stopping=True,     # Stop when EOS token is generated
                    pad_token_id=tokenizer.pad_token_id,
                    eos_token_id=tokenizer.eos_token_id,
                )
            
            # Decode output
            result = tokenizer.decode(translated[0], skip_special_tokens=True)
            
            logger.debug(f"[MarianMT] Translation result: '{result[:50]}...' ({len(result)} chars)")
            
            return [result]
            
        except Exception as e:
            logger.error(f"[MarianMT] Translation error for {direction}: {e}")
            import traceback
            logger.error(f"[MarianMT] Traceback: {traceback.format_exc()}")
            return [text]  # Fallback to original text


    def translate_vi_to_en(self, vietnamese_sentences):
        """
        Translate Vietnamese to English
        
        Args:
            vietnamese_sentences: Vietnamese text (str or list)
        
        Returns:
            list: Translated English text(s)
        """
        return self._translate_generic(vietnamese_sentences, "vi_en")
    
    def translate_en_to_vi(self, english_sentences):
        """
        Translate English to Vietnamese
        
        Args:
            english_sentences: English text (str or list)
        
        Returns:
            list: Translated Vietnamese text(s)
        """
        return self._translate_generic(english_sentences, "en_vi")
    
    def translate_vi_to_lo(self, vietnamese_sentences):
        """
        Translate Vietnamese to Lao
        
        Args:
            vietnamese_sentences: Vietnamese text (str or list)
        
        Returns:
            list: Translated Lao text(s)
        """
        return self._translate_generic(vietnamese_sentences, "vi_lo")
    
    def translate_lo_to_vi(self, lao_sentences):
        """
        Translate Lao to Vietnamese
        
        Args:
            lao_sentences: Lao text (str or list)
        
        Returns:
            list: Translated Vietnamese text(s)
        """
        return self._translate_generic(lao_sentences, "lo_vi")
    
    def translate_en_to_lo(self, english_sentences):
        """
        Translate English to Lao
        
        Args:
            english_sentences: English text (str or list)
        
        Returns:
            list: Translated Lao text(s)
        """
        return self._translate_generic(english_sentences, "en_lo")
    
    def translate_lo_to_en(self, lao_sentences):
        """
        Translate Lao to English
        
        Args:
            lao_sentences: Lao text (str or list)
        
        Returns:
            list: Translated English text(s)
        """
        return self._translate_generic(lao_sentences, "lo_en")
    
    def get_supported_directions(self):
        """
        Get list of all supported translation directions based on available models
        
        Returns:
            list: Available translation directions (e.g., ["vi→en", "en→vi", ...])
        """
        direction_map = {
            "vi_en": "vi→en",
            "en_vi": "en→vi",
            "vi_lo": "vi→lo",
            "lo_vi": "lo→vi",
            "en_lo": "en→lo",
            "lo_en": "lo→en"
        }
        
        # Return only directions for which models are loaded
        available = [direction_map[key] for key in self.models.keys() if key in direction_map]
        
        if not available:
            logger.warning("[TranslateProcess] No translation models available!")
        
        return available
    
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
        # No translation needed if same language
        if source_lang == target_lang:
            return [text] if isinstance(text, str) else text
        
        # Map language codes to model direction keys
        direction_key = f"{source_lang}_{target_lang}"
        
        # Check if model exists for this direction
        if direction_key not in self.models:
            logger.warning(f"[TranslateProcess] Model not available for {source_lang}→{target_lang}")
            return [text] if isinstance(text, str) else text
        
        return self._translate_generic(text, direction_key)