
import asyncio
import logging
import numpy as np
from typing import Dict, Any, Optional
from service.pipline_processor.text_to_speech import tts
from service.pipline_processor.translate_process import TranslateProcess
from service.pipline_processor.speech_to_text import STTPipeline

from core.config import (
    SAMPLE_RATE
)

# Voice cloning availability check
_voice_cloning_available = None

def _check_voice_cloning():
    """Check if voice cloning is available"""
    global _voice_cloning_available
    if _voice_cloning_available is None:
        try:
            from service.voice_cloning.voice_clone_manager import get_voice_clone_manager
            _voice_cloning_available = True
        except ImportError:
            _voice_cloning_available = False
    return _voice_cloning_available

logger = logging.getLogger(__name__)

class TranslationPipeline:
    """
        Translation Pipeline

        Handles the complete STT → Translation → TTS pipeline:
        - Speech-to-Text using Whisper
        - Translation using OpenAI or other services  
        - Text-to-Speech using OpenAI TTS or other services
    """
    
    def __init__(self, source_language: str = "vi", target_language: str = "en", 
                 user_id: str = None, room_id: str = None):
        self.source_language = source_language
        self.target_language = target_language
        self.user_id = user_id
        self.room_id = room_id
        self.translator = TranslateProcess()
        self.stt = STTPipeline(source_language=source_language)  # Pass source language to STT
        self.text_to_speech = tts

        self.language_map = {
            "vi": "vietnamese",
            "en": "english",
            "lo": "lao",
        }
        
        # Initialize voice cloning if user info provided
        if self.user_id and self.room_id and _check_voice_cloning():
            try:
                from service.voice_cloning.voice_clone_manager import get_voice_clone_manager
                self.voice_manager = get_voice_clone_manager()
                self._voice_cloning_enabled = True
                logger.info(f"Voice cloning enabled for user {user_id} in room {room_id}")
            except Exception as e:
                self._voice_cloning_enabled = False
                logger.warning(f"Voice cloning initialization failed: {e}")
        else:
            self._voice_cloning_enabled = False
        
        logger.info(f"Translation pipeline: {source_language} → {target_language}")

    async def process_audio_with_context(self, audio_data: bytes, previous_text: str = "") -> Dict[str, Any]:
        """
        CONTEXT WINDOW APPROACH (Option 2)
        
        Process audio with context from previous chunks to improve STT accuracy.
        This method receives concatenated audio (2-3 chunks) and extracts only NEW text.
        
        Args:
            audio_data: Concatenated audio data (e.g., 3-4.5s worth of audio)
            previous_text: Full STT result from previous processing for overlap detection
            
        Returns:
            {
                'success': bool,
                'message': str,
                'full_stt_text': str,      # Complete STT result (including overlaps)
                'new_text': str,           # Only NEW portion (for translation)
                'original_text': str,      # Same as new_text (for compatibility)
                'translated_text': str,
                'translated_audio': bytes
            }
        """
        try:
            start_all = asyncio.get_event_loop().time()
            
            # Step 1: Speech-to-Text on FULL context (concatenated audio)
            start_stt = asyncio.get_event_loop().time()
            stt_result = await self.stt.speech_to_text(audio_data)
            
            if not stt_result or not stt_result.get('text'):
                return {
                    'success': False,
                    'message': 'No speech detected',
                    'full_stt_text': '',
                    'new_text': '',
                    'original_text': '',
                    'translated_text': '',
                    'translated_audio': b''
                }
            
            full_stt_text = stt_result['text'].strip()
            end_stt = asyncio.get_event_loop().time()
            
            logger.info(f"[CONTEXT] Full STT result: {full_stt_text}")
            logger.info(f"[CONTEXT] Previous text: {previous_text}")
            logger.info(f"[CONTEXT] STT processing time: {end_stt - start_stt:.3f} s")
            
            # Step 2: Extract NEW text only (remove overlap with previous)
            new_text = self._extract_new_text(full_stt_text, previous_text)
            
            if not new_text or not new_text.strip():
                logger.info(f"[CONTEXT] No new text detected (complete overlap)")
                return {
                    'success': False,
                    'message': 'No new text (complete overlap)',
                    'full_stt_text': full_stt_text,
                    'new_text': '',
                    'original_text': '',
                    'translated_text': '',
                    'translated_audio': b''
                }
            
            logger.info(f"[CONTEXT] New text extracted: {new_text}")
            
            # VOICE CLONING: Collect audio for voice learning (non-blocking)
            if self._voice_cloning_enabled and new_text:
                try:
                    logger.debug(f"[VOICE-CLONE] Collecting audio for {self.user_id}_{self.room_id}")
                    self.voice_manager.collect_audio(self.user_id, self.room_id, audio_data)
                except Exception as e:
                    logger.warning(f"Voice collection failed: {e}")
            
            # Step 3: Translation (only on NEW text)
            start_translation = asyncio.get_event_loop().time()
            translated_text = await self._translate_text(new_text)
            end_translation = asyncio.get_event_loop().time()
            logger.info(f"[CONTEXT] Translation processing time: {end_translation - start_translation:.3f} s")
            
            if not translated_text:
                return {
                    'success': False,
                    'message': 'Translation failed',
                    'full_stt_text': full_stt_text,
                    'new_text': new_text,
                    'original_text': new_text,
                    'translated_text': '',
                    'translated_audio': b''
                }
            
            logger.info(f"[CONTEXT] Translation result: {translated_text}")
            
            # Limit translated text to prevent TTS issues
            translated_words = translated_text.split()
            if len(translated_words) > 25:
                translated_text = ' '.join(translated_words[:25])
                logger.warning(f"Translation truncated from {len(translated_words)} to 25 words")
            
            # Step 4: Text-to-Speech (only on NEW translated text)
            start_tts = asyncio.get_event_loop().time()
            audio_output = await self._text_to_speech(translated_text)
            end_tts = asyncio.get_event_loop().time()
            logger.info(f"[CONTEXT] TTS processing time: {end_tts - start_tts:.3f} s")

            if not audio_output:
                return {
                    'success': False,
                    'message': 'TTS failed',
                    'full_stt_text': full_stt_text,
                    'new_text': new_text,
                    'original_text': new_text,
                    'translated_text': translated_text,
                    'translated_audio': b''
                }
            
            logger.info(f"[CONTEXT] TTS completed: {len(audio_output)} bytes")
            end_all = asyncio.get_event_loop().time()
            logger.info(f"[CONTEXT] Total processing time: {end_all - start_all:.3f} s")

            return {
                'success': True,
                'message': 'Context-aware translation completed',
                'full_stt_text': full_stt_text,    # For next iteration
                'new_text': new_text,               # What we actually processed
                'original_text': new_text,          # For compatibility
                'translated_text': translated_text,
                'translated_audio': audio_output
            }
            
        except Exception as e:
            logger.error(f"[CONTEXT] Translation pipeline error: {e}")
            import traceback
            logger.error(f"[CONTEXT] Traceback: {traceback.format_exc()}")
            return {
                'success': False,
                'message': f'Pipeline error: {str(e)}',
                'full_stt_text': '',
                'new_text': '',
                'original_text': '',
                'translated_text': '',
                'translated_audio': b''
            }

    def _extract_new_text(self, current_text: str, previous_text: str) -> str:
        """
        Smart text extraction: Extract only NEW portion from current_text.
        
        Strategy:
        1. If no previous text → return all current text
        2. If current starts with previous → return remainder
        3. Use fuzzy matching to find overlap
        4. Extract only the non-overlapping portion
        
        Args:
            current_text: Full STT result from concatenated audio
            previous_text: STT result from previous iteration
            
        Returns:
            Only the NEW portion of text (not in previous)
        """
        import difflib
        
        if not current_text:
            return ""
        
        if not previous_text:
            logger.info("[TEXT-EXTRACT] No previous text, returning all current text")
            return current_text
        
        current = current_text.strip()
        previous = previous_text.strip()
        
        # Strategy 1: Exact prefix match
        if current.startswith(previous):
            new_text = current[len(previous):].strip()
            logger.info(f"[TEXT-EXTRACT] Exact prefix match, extracted: '{new_text}'")
            return new_text
        
        # Strategy 2: Word-level matching
        current_words = current.split()
        previous_words = previous.split()
        
        # Find longest common prefix at word level
        common_prefix_length = 0
        for i in range(min(len(current_words), len(previous_words))):
            if current_words[i].lower() == previous_words[i].lower():
                common_prefix_length += 1
            else:
                break
        
        if common_prefix_length > 0:
            new_words = current_words[common_prefix_length:]
            new_text = ' '.join(new_words)
            logger.info(
                f"[TEXT-EXTRACT] Word-level prefix match: "
                f"{common_prefix_length} words, extracted: '{new_text}'"
            )
            return new_text
        
        # Strategy 3: Fuzzy substring matching
        # Find where previous text ends in current text
        matcher = difflib.SequenceMatcher(None, previous.lower(), current.lower())
        match = matcher.find_longest_match(0, len(previous), 0, len(current))
        
        if match.size > len(previous) * 0.7:  # At least 70% overlap
            # Find end position in current text
            overlap_end = match.b + match.size
            new_text = current[overlap_end:].strip()
            logger.info(
                f"[TEXT-EXTRACT] Fuzzy match: {match.size} chars overlap, "
                f"extracted: '{new_text}'"
            )
            return new_text
        
        # Strategy 4: Check if previous is contained anywhere in current
        if previous.lower() in current.lower():
            # Find position and take everything after
            pos = current.lower().find(previous.lower())
            new_text = current[pos + len(previous):].strip()
            logger.info(f"[TEXT-EXTRACT] Substring found, extracted: '{new_text}'")
            return new_text
        
        # No significant overlap found → return all current text
        # But warn about this case
        similarity = difflib.SequenceMatcher(None, previous.lower(), current.lower()).ratio()
        logger.warning(
            f"[TEXT-EXTRACT] No clear overlap found (similarity: {similarity:.2f}), "
            f"returning full current text"
        )
        return current

    async def _translate_text(self, text: str) -> Optional[str]:
        """Translate text using translation service"""
        try:
            if self.source_language == self.target_language:
                return text

            loop = asyncio.get_event_loop()
            
            # Use the generic translate method instead of specific methods
            result = await loop.run_in_executor(
                None, 
                self.translator.translate, 
                text, 
                self.source_language, 
                self.target_language
            )
                    
            return result[0] if result and len(result) > 0 else None
        except Exception as e:
            logger.error(f"Translation error: {e}")
            return None

    async def _text_to_speech(self, text: str) -> Optional[bytes]:
        """Enhanced TTS với voice cloning support"""
        try:
            logger.info(f"Starting TTS for text: '{text[:50]}...' ({len(text)} chars)")
            
            # Run TTS with user voice cloning in thread
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(
                None, 
                self.text_to_speech, 
                text, 
                self.target_language,
                self.user_id,      # Pass user_id for voice cloning
                self.room_id       # Pass room_id for voice cloning
            )

            if result:
                logger.info(f"TTS successful, generated {len(result)} bytes")
                return result
            else:
                logger.warning("TTS returned empty result, generating silence")
                return self._generate_silence(1000)
                
        except Exception as e:
            logger.error(f"TTS error: {e}")
            # Fallback to silence
            return self._generate_silence(1000)

    # async def _text_to_speech(self, text: str) -> Optional[bytes]:
    #     """Convert text to speech"""
    #     try:
    #         logger.info(f"Starting TTS for text: '{text[:50]}...' ({len(text)} chars)")
            
    #         # Implement TTS with target language
    #         loop = asyncio.get_event_loop()
    #         result = await loop.run_in_executor(None, self.text_to_speech, text, self.target_language)

    #         if result:
    #             logger.info(f"TTS successful, generated {len(result)} bytes")
    #             return result
    #         else:
    #             logger.warning("TTS returned empty result, generating silence")
    #             return self._generate_silence(1000)
                
    #     except Exception as e:
    #         logger.error(f"TTS error - Exception type: {type(e).__name__}")
    #         return None
    
    def _generate_silence(self, duration_ms: int) -> bytes:
        """Generate silence audio for fallback"""
        try:
            samples = int(SAMPLE_RATE * duration_ms / 1000)
            silence = np.zeros(samples, dtype=np.int16)
            return silence.tobytes()
            
        except Exception as e:
            logger.error(f"Silence generation error: {e}")
            return b''
    
    def cleanup_voice_data(self) -> None:
        """Cleanup voice cloning data when pipeline is destroyed"""
        if self._voice_cloning_enabled and self.user_id and self.room_id:
            try:
                self.voice_manager.cleanup_user_voice(self.user_id, self.room_id)
                logger.info(f"Cleaned up voice data for {self.user_id}_{self.room_id}")
            except Exception as e:
                logger.error(f"Error cleaning up voice data: {e}")
    
    def cleanup(self) -> None:
        """Cleanup pipeline resources"""
        try:
            # Cleanup voice cloning data
            self.cleanup_voice_data()
            
            logger.info(f"Pipeline cleanup completed for {self.source_language} → {self.target_language}")
        except Exception as e:
            logger.error(f"Error during pipeline cleanup: {e}")
