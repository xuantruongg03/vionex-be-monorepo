import torch
from core.model import translation_models, translation_tokenizers, detect_model, vi_correction_model, vi_correction_tokenizer
from utils.log_manager import logger

class TranslateProcess:
    def __init__(self):
        self.models = translation_models
        self.tokenizers = translation_tokenizers
        self.detect_model = detect_model
        
        # Vietnamese text correction model
        self.vi_correction_model = vi_correction_model
        self.vi_correction_tokenizer = vi_correction_tokenizer
        
        # Supported language pairs
        self.supported_pairs = {
            "vi": "vi-en",  # Vietnamese to English
            "lo": "lo-en",  # Lao to English
            "en": "en-en"   # English (no translation)
        }
    
    def correct_vietnamese_text(self, text: str) -> str:
        """
        Correct Vietnamese text using ProtonX model before translation.
        Fixes: OCR errors, typos, missing diacritics, word segmentation issues.
        
        Args:
            text: Vietnamese text to correct
            
        Returns:
            Corrected Vietnamese text
        """
        if not self.vi_correction_model or not self.vi_correction_tokenizer:
            logger.debug("[Text-Correction] Model not loaded, skipping correction")
            return text
        
        if not text or not text.strip():
            return text
        
        try:
            text = text.strip()
            
            # Skip if text is too short (likely already correct)
            if len(text) < 5:
                return text
            
            # Tokenize input
            inputs = self.vi_correction_tokenizer(
                text,
                return_tensors="pt",
                truncation=True,
                max_length=128
            )
            
            # Move to device
            device = next(self.vi_correction_model.parameters()).device
            inputs = {k: v.to(device) for k, v in inputs.items()}
            
            # Generate corrected text
            with torch.no_grad():
                outputs = self.vi_correction_model.generate(
                    **inputs,
                    num_beams=5,
                    num_return_sequences=1,
                    max_new_tokens=128,
                    length_penalty=1.0,
                    early_stopping=True,
                    repetition_penalty=1.2,
                    no_repeat_ngram_size=2
                )
            
            # Decode result
            corrected = self.vi_correction_tokenizer.decode(outputs[0], skip_special_tokens=True)
            
            # Log if correction was made
            if corrected != text:
                logger.info(f"[Text-Correction] '{text}' → '{corrected}'")
            
            return corrected if corrected else text
            
        except Exception as e:
            logger.warning(f"[Text-Correction] Error correcting text: {e}")
            return text

    def _translate_process(self, text: str, src_lang: str, tgt_lang: str = "en"):
        """
        Translate text using translation models.
        - vi-en: VinAI vinai-translate-vi2en-v2
        - lo-en: MarianMT (when available)
        - en-en: No translation
        """
        try:
            # Validate input
            if not text or not text.strip():
                logger.warning("[Translation] Empty text received")
                return ""
            
            text = text.strip()
            
            # Check text length
            if len(text) > 5000:
                logger.warning(f"[Translation] Text too long ({len(text)} chars), truncating to 5000")
                text = text[:5000]
            
            # Get model pair key
            pair_key = self.supported_pairs.get(src_lang)
            
            if not pair_key:
                logger.error(f"[Translation] Unsupported source language: {src_lang}")
                return text
            
            # If English to English, no translation needed
            if pair_key == "en-en":
                logger.info(f"[Translation] English detected, no translation needed")
                return text
            
            # Get model and tokenizer for this pair
            model = self.models.get(pair_key)
            tokenizer = self.tokenizers.get(pair_key)
            
            if not model or not tokenizer:
                logger.error(f"[Translation] Model not loaded for pair: {pair_key}")
                return text
            
            logger.info(f"[Translation] Translating '{text}' | {src_lang} → {tgt_lang} using {pair_key}")
            
            # Special handling for VinAI vi-en model
            if pair_key == "vi-en":
                # Step 1: Correct Vietnamese text before translation
                # This fixes OCR errors, typos, missing diacritics, etc.
                corrected_text = self.correct_vietnamese_text(text)
                
                # VinAI-specific tokenization and generation
                input_ids = tokenizer(corrected_text, return_tensors="pt").input_ids
                
                # Move to device
                try:
                    device = next(model.parameters()).device
                    input_ids = input_ids.to(device)
                except Exception as e:
                    logger.warning(f"[Translation] Could not move to device: {e}")
                
                # Generate translation with VinAI model
                with torch.no_grad():
                    output_ids = model.generate(
                        input_ids,
                        decoder_start_token_id=tokenizer.lang_code_to_id["en_XX"],
                        num_return_sequences=1,
                        num_beams=5,
                        early_stopping=True,
                        max_length=512
                    )
                
                # Decode
                result = tokenizer.batch_decode(output_ids, skip_special_tokens=True)
                result = " ".join(result).strip()
                
            else:
                # Standard MarianMT handling for other language pairs (lo-en, etc.)
                inputs = tokenizer(
                    text, 
                    return_tensors="pt", 
                    padding=True, 
                    truncation=True,
                    max_length=512
                )
                
                # Move to device
                try:
                    device = next(model.parameters()).device
                    inputs = {k: v.to(device) for k, v in inputs.items()}
                except Exception as e:
                    logger.warning(f"[Translation] Could not move to device: {e}")
                
                # Generate translation
                with torch.no_grad():
                    translated = model.generate(
                        **inputs,
                        max_length=512,
                        num_beams=4,
                        early_stopping=True,
                        pad_token_id=tokenizer.pad_token_id,
                        eos_token_id=tokenizer.eos_token_id
                    )
                
                # Decode
                result = tokenizer.decode(translated[0], skip_special_tokens=True).strip()
            
            logger.info(f"[Translation] Translation result: '{result}'")
            
            # Validation
            if not result or len(result) == 0:
                logger.warning(f"[Translation] Empty translation result, returning original text")
                return text
            
            return result
            
        except Exception as e:
            logger.error(f"[Translation] Translation error {src_lang} -> {tgt_lang}: {e}")
            import traceback
            logger.error(traceback.format_exc())
            return text

    def translate(self, text: str, target_lang: str = "en"):
        """
        Automatically detect the source language and translate to the target language.
        """
        if not text or not text.strip():
            return ""

        try:
            text_stripped = text.strip()
            
            # Use FastText for language detection
            predictions = self.detect_model.predict(text_stripped, k=1)
            detected_lang_code = predictions[0][0].replace('__label__', '')  # e.g., '__label__vi' -> 'vi'
            confidence = predictions[1][0]
            
            logger.info(f"[Translate] Detected language: '{detected_lang_code}' (confidence: {confidence:.2f}) for text: '{text_stripped[:50]}...'")
            
            # Map language code (might be 'vie' from fasttext, need to convert to 'vi')
            # FastText returns ISO 639-3, we need ISO 639-1
            lang_map = {
                'vie': 'vi',  # Vietnamese
                'lao': 'lo',  # Lao
                'eng': 'en',  # English
            }
            source_lang = lang_map.get(detected_lang_code, detected_lang_code)
            
            # If detected language is not supported, default to Vietnamese
            if source_lang not in self.supported_pairs:
                logger.warning(f"[Translate] Detected language '{source_lang}' not supported, defaulting to Vietnamese")
                source_lang = "vi"
            
            # If source is the same as target, no translation needed
            if source_lang == target_lang:
                logger.info(f"[Translate] Source ({source_lang}) same as target ({target_lang}), skipping translation")
                return text

            # Translate using MarianMT
            return self._translate_process(text, source_lang, target_lang)

        except Exception as e:
            logger.error(f"Error in auto-translate: {e}")
            return text

