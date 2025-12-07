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

    async def process_audio_block(self, audio_data: bytes) -> Dict[str, Any]:
        """
        NEW: Hybrid Window Processing
        
        Processes a self-contained block of audio (either a fast-tracked single
        chunk or a concatenated block of chunks) through the full STT -> Translate -> TTS
        pipeline. This is much simpler than the old context-aware method.
        
        Args:
            audio_data: The audio data for the block.
            
        Returns:
            A dictionary containing the result of the processing.
            - On success: {'success': True, 'translated_audio': bytes, 'translated_text': str}
            - On failure: {'success': False, 'message': str}
        """
        try:
            start_time = asyncio.get_event_loop().time()
            logger.info(f"[HYBRID-PIPELINE] Processing audio block of size {len(audio_data)} bytes.")

            # 1. Speech-to-Text
            stt_result = await self.stt.speech_to_text(audio_data)
            if not stt_result or not stt_result.get('text'):
                logger.info("[HYBRID-PIPELINE] STT returned no text.")
                return {'success': False, 'message': 'STT returned no text'}
            
            stt_text = stt_result['text'].strip()
            logger.info(f"[HYBRID-PIPELINE] STT Result: '{stt_text}'")

            # VOICE CLONING: Collect audio for voice learning (non-blocking)
            if self._voice_cloning_enabled and stt_text:
                try:
                    logger.debug(f"[VOICE-CLONE] Collecting audio for {self.user_id}_{self.room_id}")
                    self.voice_manager.collect_audio(self.user_id, self.room_id, audio_data)
                except Exception as e:
                    logger.warning(f"Voice collection failed: {e}")

            # 2. Translation
            translated_text = await self._translate_text(stt_text)
            if not translated_text:
                logger.warning(f"[HYBRID-PIPELINE] Translation failed for text: '{stt_text}'")
                return {'success': False, 'message': 'Translation failed'}
            
            logger.info(f"[HYBRID-PIPELINE] Translation Result: '{translated_text}'")

            # 3. Text-to-Speech
            tts_audio = await self._text_to_speech(translated_text)
            if not tts_audio:
                logger.error(f"[HYBRID-PIPELINE] TTS failed for text: '{translated_text}'")
                return {'success': False, 'message': 'TTS failed'}

            end_time = asyncio.get_event_loop().time()
            logger.info(
                f"[HYBRID-PIPELINE] Successfully processed block in {end_time - start_time:.3f}s. "
                f"Returning {len(tts_audio)} bytes of audio."
            )
            
            return {
                'success': True,
                'translated_audio': tts_audio,
                'translated_text': translated_text
            }

        except Exception as e:
            logger.error(f"[HYBRID-PIPELINE] Error in processing block: {e}")
            import traceback
            logger.error(f"[HYBRID-PIPELINE] Traceback: {traceback.format_exc()}")
            return {'success': False, 'message': f'Error in processing block: {e}'}

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