import asyncio
import difflib
import logging
import numpy as np
import subprocess
from typing import Any, Dict, Optional

from core.model import whisper_model

logger = logging.getLogger(__name__)

class STTPipeline:
    def __init__(self, source_language: str = "vi"):
        self.prev_text = ""
        self.source_language = source_language
        
        # Language mapping for Whisper
        self.whisper_lang_map = {
            "vi": "vi",
            "en": "en", 
            "lo": "lo"  # Whisper supports Lao
        }

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
            if not whisper_model:
                logger.warning("Whisper model not available")
                return None

            audio_array = decode_audio_to_array(audio_data)

            # Use dynamic language or auto-detection
            whisper_lang = self.whisper_lang_map.get(self.source_language, "vi")
            
            result = await asyncio.get_event_loop().run_in_executor(
                None, _transcribe, audio_array, whisper_lang
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
            logger.error(f"Error in STT: {e}")
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


def _transcribe(audio_array: np.ndarray, language: str = "vi") -> Dict[str, Any]:
    """Synchronous Whisper transcription using faster-whisper with enhanced config"""
    try:
        segments, info = whisper_model.transcribe(
            audio_array,
            language=language,  # Use dynamic language
            task='transcribe',
            beam_size=5,
            temperature=0.0,
            word_timestamps=True,  # Enable word timestamps for sliding window
            condition_on_previous_text=False  # Disable context for better sliding window
        )
        segments_list = list(segments)
        full_text = ' '.join([segment.text for segment in segments_list])
        return {
            'text': full_text.strip(),
            'language': info.language if hasattr(info, 'language') else language,
            'segments': [
                {
                    'text': segment.text,
                    'start': segment.start,
                    'end': segment.end,
                    'words': getattr(segment, 'words', [])  # Include word-level timestamps
                } for segment in segments_list
            ]
        }

    except Exception as e:
        return {'text': '', 'language': language, 'segments': []}
