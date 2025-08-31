
from core.model import (
    model_vi_en, tokenizer,
    # Import additional models
    model_en_vi, tokenizer_en_vi,
    model_vi_lo, tokenizer_vi_lo,
    model_lo_vi, tokenizer_lo_vi,
    model_en_lo, tokenizer_en_lo,
    model_lo_en, tokenizer_lo_en
)

class TranslateProcess:
    """
        Class to handle translation between multiple languages using MarianMTModel.
        Supports: Vietnamese (vi), English (en), Lao (lo)
        All translation directions are available.
    """
    def __init__(self):
        # Vi-En models
        self.tokenizer_vi_en = tokenizer
        self.model_vi_en = model_vi_en
        
        # En-Vi models
        self.tokenizer_en_vi = tokenizer_en_vi
        self.model_en_vi = model_en_vi
        
        # Vi-Lo models
        self.tokenizer_vi_lo = tokenizer_vi_lo
        self.model_vi_lo = model_vi_lo
        
        # Lo-Vi models
        self.tokenizer_lo_vi = tokenizer_lo_vi
        self.model_lo_vi = model_lo_vi
        
        # En-Lo models
        self.tokenizer_en_lo = tokenizer_en_lo
        self.model_en_lo = model_en_lo
        
        # Lo-En models
        self.tokenizer_lo_en = tokenizer_lo_en
        self.model_lo_en = model_lo_en

    def translate_vi_to_en(self, vietnamese_sentences):
        """Translate Vietnamese to English"""
        try:
            # Handle both string and list inputs
            text_input = vietnamese_sentences if isinstance(vietnamese_sentences, str) else ' '.join(vietnamese_sentences)
            
            # Tokenize input sentences
            inputs = self.tokenizer_vi_en(text_input, return_tensors="pt", padding=True, truncation=True)
            
            # Generate translations
            translated = self.model_vi_en.generate(**inputs)
            
            # Decode the generated tokens to English sentences
            english_sentences = [self.tokenizer_vi_en.decode(t, skip_special_tokens=True) for t in translated]
            
            return english_sentences
        except Exception as e:
            print(f"[TranslateProcess] Error in Vi→En translation: {e}")
            return [vietnamese_sentences] if isinstance(vietnamese_sentences, str) else vietnamese_sentences
    
    def translate_en_to_vi(self, english_sentences):
        """Translate English to Vietnamese"""
        try:
            # Handle both string and list inputs
            text_input = english_sentences if isinstance(english_sentences, str) else ' '.join(english_sentences)
            
            # Tokenize input sentences
            inputs = self.tokenizer_en_vi(text_input, return_tensors="pt", padding=True, truncation=True)
            
            # Generate translations
            translated = self.model_en_vi.generate(**inputs)
            
            # Decode the generated tokens to Vietnamese sentences
            vietnamese_sentences = [self.tokenizer_en_vi.decode(t, skip_special_tokens=True) for t in translated]
            
            return vietnamese_sentences
        except Exception as e:
            print(f"[TranslateProcess] Error in En→Vi translation: {e}")
            return [english_sentences] if isinstance(english_sentences, str) else english_sentences
    
    def translate_vi_to_lo(self, vietnamese_sentences):
        """Translate Vietnamese to Lao"""
        try:
            # Handle both string and list inputs
            text_input = vietnamese_sentences if isinstance(vietnamese_sentences, str) else ' '.join(vietnamese_sentences)
            
            # Tokenize input sentences
            inputs = self.tokenizer_vi_lo(text_input, return_tensors="pt", padding=True, truncation=True)
            
            # Generate translations
            translated = self.model_vi_lo.generate(**inputs)
            
            # Decode the generated tokens to Lao sentences
            lao_sentences = [self.tokenizer_vi_lo.decode(t, skip_special_tokens=True) for t in translated]
            
            return lao_sentences
        except Exception as e:
            print(f"[TranslateProcess] Error in Vi→Lo translation: {e}")
            return [vietnamese_sentences] if isinstance(vietnamese_sentences, str) else vietnamese_sentences
    
    def translate_lo_to_vi(self, lao_sentences):
        """Translate Lao to Vietnamese"""
        try:
            # Handle both string and list inputs
            text_input = lao_sentences if isinstance(lao_sentences, str) else ' '.join(lao_sentences)
            
            # Tokenize input sentences
            inputs = self.tokenizer_lo_vi(text_input, return_tensors="pt", padding=True, truncation=True)
            
            # Generate translations
            translated = self.model_lo_vi.generate(**inputs)
            
            # Decode the generated tokens to Vietnamese sentences
            vietnamese_sentences = [self.tokenizer_lo_vi.decode(t, skip_special_tokens=True) for t in translated]
            
            return vietnamese_sentences
        except Exception as e:
            print(f"[TranslateProcess] Error in Lo→Vi translation: {e}")
            return [lao_sentences] if isinstance(lao_sentences, str) else lao_sentences
    
    def translate_en_to_lo(self, english_sentences):
        """Translate English to Lao"""
        try:
            # Handle both string and list inputs
            text_input = english_sentences if isinstance(english_sentences, str) else ' '.join(english_sentences)
            
            # Tokenize input sentences
            inputs = self.tokenizer_en_lo(text_input, return_tensors="pt", padding=True, truncation=True)
            
            # Generate translations
            translated = self.model_en_lo.generate(**inputs)
            
            # Decode the generated tokens to Lao sentences
            lao_sentences = [self.tokenizer_en_lo.decode(t, skip_special_tokens=True) for t in translated]
            
            return lao_sentences
        except Exception as e:
            print(f"[TranslateProcess] Error in En→Lo translation: {e}")
            return [english_sentences] if isinstance(english_sentences, str) else english_sentences
    
    def translate_lo_to_en(self, lao_sentences):
        """Translate Lao to English"""
        try:
            # Handle both string and list inputs
            text_input = lao_sentences if isinstance(lao_sentences, str) else ' '.join(lao_sentences)
            
            # Tokenize input sentences
            inputs = self.tokenizer_lo_en(text_input, return_tensors="pt", padding=True, truncation=True)
            
            # Generate translations
            translated = self.model_lo_en.generate(**inputs)
            
            # Decode the generated tokens to English sentences
            english_sentences = [self.tokenizer_lo_en.decode(t, skip_special_tokens=True) for t in translated]
            
            return english_sentences
        except Exception as e:
            print(f"[TranslateProcess] Error in Lo→En translation: {e}")
            return [lao_sentences] if isinstance(lao_sentences, str) else lao_sentences
    
    def get_supported_directions(self):
        """Get list of all supported translation directions"""
        return [
            "vi→en", "en→vi",
            "vi→lo", "lo→vi", 
            "en→lo", "lo→en"
        ]
    
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
            
        translation_map = {
            ("vi", "en"): self.translate_vi_to_en,
            ("en", "vi"): self.translate_en_to_vi,
            ("vi", "lo"): self.translate_vi_to_lo,
            ("lo", "vi"): self.translate_lo_to_vi,
            ("en", "lo"): self.translate_en_to_lo,
            ("lo", "en"): self.translate_lo_to_en,
        }
        
        translate_func = translation_map.get((source_lang, target_lang))
        if translate_func:
            return translate_func(text)
        else:
            print(f"[TranslateProcess] Unsupported translation direction: {source_lang}→{target_lang}")
            return [text] if isinstance(text, str) else text