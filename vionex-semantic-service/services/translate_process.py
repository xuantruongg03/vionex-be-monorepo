import logging
import torch
from core.model import translation_models, translation_tokenizers
from langdetect import detect, LangDetectException

logger = logging.getLogger(__name__)

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
            
            logger.debug(f"[NLLB] Translating {src_lang}→{tgt_lang}: '{text[:50]}...'")
            
            # Tokenize
            inputs = tokenizer(
                text, 
                return_tensors="pt", 
                padding=True, 
                truncation=True,
                max_length=256
            )
            
            # Move to device
            try:
                device = next(model.parameters()).device
                inputs = {k: v.to(device) for k, v in inputs.items()}
            except Exception as e:
                logger.warning(f"[NLLB] Could not move to device: {e}")
            
            # Generate translation
            with torch.no_grad():
                translated = model.generate(
                    **inputs,
                    forced_bos_token_id=tokenizer.convert_tokens_to_ids(tgt_code),
                    max_new_tokens=128,
                    num_beams=2,
                    do_sample=False,
                    early_stopping=True,
                    temperature=1.0,
                    repetition_penalty=1.2,
                    no_repeat_ngram_size=3
                )
            
            # Decode
            result = tokenizer.decode(translated[0], skip_special_tokens=True)
            
            logger.debug(f"[NLLB] Translation result: '{result[:50]}...'")
            
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
            # 1. Detect source language
            source_lang = detect(text)  # e.g., returns "vi", "en", "lo"
            
            # 2. If source is the same as target, no translation needed
            if source_lang == target_lang:
                return text
            
            # 3. Directly call _translate_nllb with the determined parameters
            return self._translate_nllb(text, source_lang, target_lang)

        except LangDetectException:
            logger.warning(f"Could not detect language for text: '{text[:50]}...'. Returning original text.")
            return text # Return original text if detection fails
        except Exception as e:
            logger.error(f"Error in auto-translate: {e}")
            return text # Return original text on error
