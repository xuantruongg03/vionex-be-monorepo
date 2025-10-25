import torch
from core.model import translation_models, translation_tokenizers
from langdetect import detect, LangDetectException
from utils.log_manager import logger

class TranslateProcess:
    def __init__(self):
        self.models = translation_models
        self.tokenizers = translation_tokenizers
        
        # NLLB language codes (ISO 639-3 with script)
        self.nllb_lang_codes = {
            "vi": "vie_Latn",  # Vietnamese (Latin script)
            "en": "eng_Latn",  # English (Latin script)
            "lo": "lao_Laoo"   # Lao (Lao script)
        }
        logger.info("[TranslateProcess] Using NLLB-Distilled")

    def _translate_nllb(self, text: str, src_lang: str, tgt_lang: str):
        """
        Revised NLLB translation function to explicitly accept source and target languages.
        """
        try:
            # Validate input
            if not text or not text.strip():
                logger.warning("[NLLB] Empty text received")
                return ""
            
            text = text.strip()
            
            # Check text length
            if len(text) > 5000:  # Prevent extremely long texts
                logger.warning(f"[NLLB] Text too long ({len(text)} chars), truncating to 5000")
                text = text[:5000]
            
            # Get NLLB language codes
            src_code = self.nllb_lang_codes.get(src_lang)
            tgt_code = self.nllb_lang_codes.get(tgt_lang)

            if not src_code or not tgt_code:
                logger.error(f"[NLLB] Unsupported language pair: {src_lang} -> {tgt_lang}")
                return text

            model = self.models["nllb"]
            tokenizer = self.tokenizers["nllb"]
            
            # Set source language
            tokenizer.src_lang = src_code
            
            logger.info(f"[NLLB] Translating '{text}' | {src_code} → {tgt_code}")
            
            # Tokenize with proper settings
            inputs = tokenizer(
                text, 
                return_tensors="pt", 
                padding=True, 
                truncation=True,
                max_length=512,  # Increase max length
                add_special_tokens=True
            )
            
            # Move to device
            try:
                device = next(model.parameters()).device
                inputs = {k: v.to(device) for k, v in inputs.items()}
            except Exception as e:
                logger.warning(f"[NLLB] Could not move to device: {e}")
            
            # Generate translation with better parameters
            with torch.no_grad():
                translated = model.generate(
                    **inputs,
                    forced_bos_token_id=tokenizer.convert_tokens_to_ids(tgt_code),
                    max_length=512,  # Use max_length instead of max_new_tokens
                    num_beams=5,  # Increase beam search
                    early_stopping=True,
                    no_repeat_ngram_size=2,
                    length_penalty=1.0,
                    pad_token_id=tokenizer.pad_token_id,
                    eos_token_id=tokenizer.eos_token_id
                )
            
            # Decode
            result = tokenizer.decode(translated[0], skip_special_tokens=True).strip()
            
            logger.info(f"[NLLB] Translation result: '{result}'")
            
            # Validation: Check if translation is reasonable
            if not result or len(result) == 0:
                logger.warning(f"[NLLB] Empty translation result, returning original text")
                return text
                
            # If result is exactly same as input (unusual), return original
            if result.lower() == text.lower():
                logger.warning(f"[NLLB] Translation identical to input, returning original")
                return text
            
            return result
            
        except Exception as e:
            logger.error(f"[NLLB] Translation error {src_lang} -> {tgt_lang}: {e}")
            return text

    def translate(self, text: str, target_lang: str = "en"):
        """
        Automatically detect the source language and translate to the target language.
        """
        if not text or not text.strip():
            return ""

        try:
            text_stripped = text.strip()
            
            # For very short text (< 4 characters), skip detection and default to Vietnamese
            # This prevents misdetection like "sss" being detected as Finnish
            if len(text_stripped) < 4:
                logger.info(f"[Translate] Text too short ({len(text_stripped)} chars), defaulting to Vietnamese: '{text_stripped}'")
                source_lang = "vi"
            else:
                try:
                    source_lang = detect(text_stripped)  # e.g., returns "vi", "en", "lo"
                    logger.debug(f"[Translate] Detected language '{source_lang}' for text: '{text_stripped[:50]}...'")
                    
                    # If detected language is not supported, default to Vietnamese
                    if source_lang not in self.nllb_lang_codes:
                        logger.warning(f"[Translate] Detected language '{source_lang}' not supported, defaulting to Vietnamese")
                        source_lang = "vi"
                        
                except LangDetectException:
                    logger.warning(f"[Translate] Could not detect language, defaulting to Vietnamese: '{text_stripped[:50]}...'")
                    source_lang = "vi"  # Default to Vietnamese

            # 2. If source is the same as target, no translation needed
            if source_lang == target_lang:
                logger.debug(f"[Translate] Source ({source_lang}) same as target ({target_lang}), skipping translation")
                return text

            # 3. Directly call _translate_nllb with the determined parameters
            return self._translate_nllb(text, source_lang, target_lang)

        except Exception as e:
            logger.error(f"Error in auto-translate: {e}")
            return text # Return original text on error
