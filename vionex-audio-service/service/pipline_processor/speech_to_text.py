import asyncio
import difflib
import logging
import numpy as np
import subprocess
import torch
import torchaudio
from typing import Any, Dict, Optional
from transformers import Wav2Vec2ForCTC, Wav2Vec2Processor

logger = logging.getLogger(__name__)

# Global Wav2Vec2 models - initialized once for performance
_wav2vec2_models = {}
_wav2vec2_processors = {}

def get_wav2vec2_model(language: str):
    """Get or load Wav2Vec2 model for specific language"""
    global _wav2vec2_models, _wav2vec2_processors
    
    # Model mapping for different languages
    model_map = {
        "vi": "nguyenvulebinh/wav2vec2-base-vietnamese-250h",
        "en": "facebook/wav2vec2-base-960h", 
        "lo": "facebook/wav2vec2-base-960h"  # Fallback to English for Lao
    }
    
    model_name = model_map.get(language, "nguyenvulebinh/wav2vec2-base-vietnamese-250h")
    
    if language not in _wav2vec2_models:
        try:
            logger.info(f"Loading Wav2Vec2 model for {language}: {model_name}")
            processor = Wav2Vec2Processor.from_pretrained(model_name)
            model = Wav2Vec2ForCTC.from_pretrained(model_name)
            
            # Move to GPU if available
            device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
            model = model.to(device)
            
            _wav2vec2_models[language] = model
            _wav2vec2_processors[language] = processor
            
            logger.info(f"Loaded Wav2Vec2 model for {language} on {device}")
            
        except Exception as e:
            logger.error(f"Failed to load Wav2Vec2 model for {language}: {e}")
            return None, None
    
    return _wav2vec2_models[language], _wav2vec2_processors[language]

class STTPipeline:
    def __init__(self, source_language: str = "vi"):
        self.prev_text = ""
        self.source_language = source_language
        
        # Language mapping for Wav2Vec2
        self.wav2vec2_lang_map = {
            "vi": "vi",
            "en": "en", 
            "lo": "en"  # Use English model for Lao as fallback
        }
        
        # Preload model for this language
        self.model, self.processor = get_wav2vec2_model(self.source_language)

    def remove_overlap(self, curr: str, prev: str, min_words=2) -> str:
        """Enhanced overlap removal using difflib for better accuracy"""
        
        curr_words = curr.strip().split()
        prev_words = prev.strip().split()

        if not curr_words or not prev_words:
            return curr

        # Use difflib to find best overlap
        matcher = difflib.SequenceMatcher(None, prev_words, curr_words)
        matches = matcher.get_matching_blocks()
        
        # Find the longest overlap at the end of prev and start of curr
        best_overlap = 0
        for match in matches:
            if match.a + match.size == len(prev_words):  # Overlap at end of prev
                if match.b == 0:  # Overlap at start of curr
                    best_overlap = match.size
                    break
        
        # Remove overlapping words if found and above minimum threshold
        if best_overlap >= min_words:
            return ' '.join(curr_words[best_overlap:])
        
        return curr  # No significant overlap found

    def limit_words(self, text: str, max_words: int = 20) -> str:
        """Limit text to maximum number of words"""
        words = text.strip().split()
        if len(words) > max_words:
            limited_text = ' '.join(words[:max_words])
            logger.warning(f"Text truncated from {len(words)} to {max_words} words")
            return limited_text
        return text

    async def speech_to_text(self, audio_data: bytes) -> Optional[Dict[str, Any]]:
        try:
            if not self.model or not self.processor:
                logger.warning("Wav2Vec2 model not available")
                return None

            audio_array = decode_audio_to_array(audio_data)
            
            result = await asyncio.get_event_loop().run_in_executor(
                None, _wav2vec2_transcribe, audio_array, self.model, self.processor, self.source_language
            )

            if result and result["text"]:
                # Remove overlap first
                cleaned_text = self.remove_overlap(result["text"], self.prev_text)
                
                # Limit to max 20 words
                limited_text = self.limit_words(cleaned_text, max_words=20)
                
                # Check for excessive repetition (same word repeated > 5 times)
                words = limited_text.split()
                if len(words) > 5:
                    # Count consecutive repetitions
                    consecutive_count = 1
                    for i in range(1, len(words)):
                        if words[i] == words[i-1]:
                            consecutive_count += 1
                            if consecutive_count > 3:  # More than 3 consecutive same words
                                logger.warning(f"Detected excessive repetition, truncating text")
                                limited_text = ' '.join(words[:i-2])  # Keep only up to first repetition
                                break
                        else:
                            consecutive_count = 1
                
                self.prev_text += " " + limited_text
                result["text"] = limited_text  # Send cleaned text
                return result

            return result

        except Exception as e:
            logger.error(f"Error in Wav2Vec2 STT: {e}")
            return None

def decode_audio_to_array(audio_bytes: bytes) -> np.ndarray:
    """Decode audio bytes to 16kHz mono float32 numpy array using ffmpeg"""
    process = subprocess.Popen(
        ['ffmpeg', '-f', 'wav', '-i', 'pipe:0', '-ar', '16000', '-ac', '1',
         '-f', 'f32le', 'pipe:1'],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL
    )
    out, _ = process.communicate(audio_bytes)
    audio_array = np.frombuffer(out, np.float32)
    return audio_array


# async def _speech_to_text(audio_data: bytes) -> Optional[Dict[str, Any]]:
#     """Convert audio to text using Whisper"""
#     try:
#         if not whisper_model:
#             logger.warning("Whisper model not available")
#             return None

#         # Decode audio bytes properly
#         audio_array = decode_audio_to_array(audio_data)

#         # Run transcription in thread
#         result = await asyncio.get_event_loop().run_in_executor(
#             None, _transcribe, audio_array, "vi"  # Default to Vietnamese
#         )
#         return result

#     except Exception as e:
#         logger.error(f"Error in speech to text: {e}")
#         return None


def _wav2vec2_transcribe(audio_array: np.ndarray, model, processor, language: str = "vi") -> Dict[str, Any]:
    """Synchronous Wav2Vec2 transcription optimized for streaming"""
    try:
        # Ensure audio is float32 and normalized
        if audio_array.dtype != np.float32:
            audio_array = audio_array.astype(np.float32)
        
        # Normalize audio to [-1, 1] range
        max_val = np.abs(audio_array).max()
        if max_val > 0:
            audio_array = audio_array / max_val
        
        # Process audio with Wav2Vec2 processor
        inputs = processor(
            audio_array, 
            sampling_rate=16000, 
            return_tensors="pt", 
            padding=True
        )
        
        # Move to same device as model
        device = next(model.parameters()).device
        inputs = {k: v.to(device) for k, v in inputs.items()}
        
        # Inference
        with torch.no_grad():
            logits = model(**inputs).logits
        
        # Decode predictions
        predicted_ids = torch.argmax(logits, dim=-1)
        transcription = processor.batch_decode(predicted_ids)[0]
        
        # Clean up transcription
        transcription = transcription.strip().lower()
        
        # Remove special tokens and clean text
        transcription = transcription.replace('[UNK]', '').replace('[PAD]', '').strip()
        
        # Basic post-processing for Vietnamese
        if language == "vi":
            transcription = _postprocess_vietnamese_text(transcription)
        
        return {
            'text': transcription,
            'language': language,
            'segments': [{
                'text': transcription,
                'start': 0.0,
                'end': len(audio_array) / 16000.0,  # Duration in seconds
                'words': []
            }]
        }

    except Exception as e:
        logger.error(f"Error in Wav2Vec2 transcription: {e}")
        return {'text': '', 'language': language, 'segments': []}

def _postprocess_vietnamese_text(text: str) -> str:
    """Post-process Vietnamese text from Wav2Vec2"""
    try:
        # Basic cleaning
        text = text.strip()
        
        # Remove extra spaces
        import re
        text = re.sub(r'\s+', ' ', text)
        
        # Capitalize first letter
        if text:
            text = text[0].upper() + text[1:]
        
        return text
    except:
        return text
