
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
        CONTEXT WINDOW APPROACH (Option 2) - NO TTS
        
        Process audio with context from previous chunks to improve STT accuracy.
        This method receives concatenated audio (2-3 chunks) and extracts only NEW text.
        
        CRITICAL: Does NOT perform TTS here to avoid audio overlap issues.
        Caller is responsible for:
        1. Comparing translated_text with last_translated_text
        2. Extracting NEW portion of translated text
        3. TTS'ing only the NEW portion
        
        Args:
            audio_data: Concatenated audio data (e.g., 3-4.5s worth of audio)
            previous_text: Full STT result from previous processing for overlap detection
            
        Returns:
            {
                'success': bool,
                'message': str,
                'full_stt_text': str,      # Complete STT result (including overlaps)
                'new_text': str,           # Only NEW portion of STT (for translation)
                'original_text': str,      # Same as new_text (for compatibility)
                'translated_text': str,    # FULL translated text (caller extracts new portion)
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
                    'translated_text': ''
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
                    'translated_text': ''
                }
            
            logger.info(f"[CONTEXT] New text extracted: {new_text}")
            
            # VOICE CLONING: Collect audio for voice learning (non-blocking)
            if self._voice_cloning_enabled and new_text:
                try:
                    logger.debug(f"[VOICE-CLONE] Collecting audio for {self.user_id}_{self.room_id}")
                    self.voice_manager.collect_audio(self.user_id, self.room_id, audio_data)
                except Exception as e:
                    logger.warning(f"Voice collection failed: {e}")
            
            # Step 3: Translation - CRITICAL: Translate FULL text to preserve context!
            # We extract NEW portion later at TTS level
            start_translation = asyncio.get_event_loop().time()
            translated_text = await self._translate_text(full_stt_text)  # ✅ Translate FULL text
            end_translation = asyncio.get_event_loop().time()
            logger.info(f"[CONTEXT] Translation processing time: {end_translation - start_translation:.3f} s")
            
            if not translated_text:
                return {
                    'success': False,
                    'message': 'Translation failed',
                    'full_stt_text': full_stt_text,
                    'new_text': new_text,
                    'original_text': new_text,
                    'translated_text': ''
                }
            
            logger.info(f"[CONTEXT] Translation result: {translated_text}")
            
            # NOTE: Do NOT truncate here! We need full text for overlap detection
            # Truncation (if needed) should happen at TTS level after extracting new portion
            
            end_all = asyncio.get_event_loop().time()
            logger.info(f"[CONTEXT] Total processing time (STT+Translation): {end_all - start_all:.3f} s")

            return {
                'success': True,
                'message': 'Context-aware translation completed',
                'full_stt_text': full_stt_text,    # For next iteration's overlap detection
                'new_text': new_text,               # What we actually processed
                'original_text': new_text,          # For compatibility
                'translated_text': translated_text  # FULL translated text (caller extracts new)
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
                'translated_text': ''
            }


    def _extract_new_text(self, current_text: str, previous_text: str) -> str:
        """
        Smart text extraction: Extract only NEW portion from current_text.
        
        FIXED: Proper overlap detection without cutting words
        
        Strategy:
        1. If no previous text → return all current text
        2. Character-level exact prefix match (most accurate)
        3. Find previous text as substring and extract remainder
        4. Fuzzy matching as fallback
        
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
        
        # Check for exact duplicate
        if current.lower() == previous.lower():
            logger.info("[TEXT-EXTRACT] Exact duplicate detected, no new text")
            return ""
        
        # Strategy 1: CHARACTER-LEVEL exact prefix match (most accurate)
        if current.lower().startswith(previous.lower()):
            new_text = current[len(previous):].strip()
            logger.info(f"[TEXT-EXTRACT] Exact prefix match, extracted: '{new_text}'")
            return new_text
        
        # Strategy 2: Find previous text as SUBSTRING in current
        # This handles cases where Whisper slightly modifies the beginning
        prev_lower = previous.lower()
        curr_lower = current.lower()
        
        # Try to find where previous text ends in current text
        if prev_lower in curr_lower:
            # Find the position where previous text ends
            prev_end_pos = curr_lower.find(prev_lower) + len(prev_lower)
            new_text = current[prev_end_pos:].strip()
            logger.info(f"[TEXT-EXTRACT] Substring match, extracted: '{new_text}'")
            return new_text
        
        # Strategy 3: Fuzzy word-level matching (for Whisper variations)
        # Example: Previous "người dân..." → Current "người dân phát hiện..."
        # Find longest matching word sequence from START
        current_words = current.split()
        previous_words = previous.split()
        
        # Match from beginning to find overlap
        common_prefix_length = 0
        for i in range(min(len(current_words), len(previous_words))):
            if current_words[i].lower() == previous_words[i].lower():
                common_prefix_length += 1
            else:
                break
        
        # Only use word-level if we have significant overlap (at least 50% of previous)
        min_overlap_words = max(2, len(previous_words) // 2)
        
        if common_prefix_length >= min_overlap_words:
            # Extract from AFTER the common prefix
            new_words = current_words[common_prefix_length:]
            new_text = ' '.join(new_words)
            
            if new_text.strip():
                logger.info(
                    f"[TEXT-EXTRACT] Word-level prefix match: "
                    f"{common_prefix_length}/{len(previous_words)} words matched, "
                    f"extracted: '{new_text}'"
                )
                return new_text
            else:
                # All words matched, no new text
                logger.info("[TEXT-EXTRACT] Complete word match, no new text")
                return ""
        
        # Strategy 4: Fuzzy character-level matching (most permissive)
        matcher = difflib.SequenceMatcher(None, prev_lower, curr_lower)
        match = matcher.find_longest_match(0, len(prev_lower), 0, len(curr_lower))
        
        # At least 70% of previous text should match
        if match.size > len(prev_lower) * 0.7:
            # Find end position in current text
            overlap_end = match.b + match.size
            new_text = current[overlap_end:].strip()
            
            if new_text:
                logger.info(
                    f"[TEXT-EXTRACT] Fuzzy match: {match.size}/{len(prev_lower)} chars overlap, "
                    f"extracted: '{new_text}'"
                )
                return new_text
        
        # Strategy 5: No clear overlap - check similarity
        similarity = difflib.SequenceMatcher(None, prev_lower, curr_lower).ratio()
        
        if similarity > 0.8:
            # Very similar but no clear overlap → likely Whisper variation
            # Return all current text but warn
            logger.warning(
                f"[TEXT-EXTRACT] High similarity ({similarity:.2f}) but no clear overlap, "
                f"returning full current text"
            )
        else:
            # Low similarity → completely different audio
            logger.info(
                f"[TEXT-EXTRACT] Low similarity ({similarity:.2f}), "
                f"returning full current text (likely new audio)"
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
    
    async def text_to_speech_only(self, text: str) -> Optional[bytes]:
        """
        TTS-only method for incremental translation.
        
        Used when we already have the translated text and just need to synthesize audio.
        This avoids re-doing STT and translation for overlapping portions.
        
        Args:
            text: Translated text to synthesize
            
        Returns:
            Audio bytes (WAV format) or None if failed
        """
        if not text or not text.strip():
            return None
            
        try:
            audio = await self._text_to_speech(text)
            return audio
        except Exception as e:
            logger.error(f"TTS-only failed: {e}")
            return None
    
    def cleanup(self) -> None:
        """Cleanup pipeline resources"""
        try:
            # Cleanup voice cloning data
            self.cleanup_voice_data()
            
            logger.info(f"Pipeline cleanup completed for {self.source_language} → {self.target_language}")
        except Exception as e:
            logger.error(f"Error during pipeline cleanup: {e}")
