"""
Audio Processor

Core audio processing using Whisper:
- Convert audio buffer to Whisper format
- Transcribe using Whisper model
- Save transcripts to JSON files
"""

import asyncio
import logging
import numpy as np
from datetime import datetime
from typing import Dict, Any, Optional

from clients.semantic import SemanticClient
from core.config import MIN_AUDIO_DURATION, SAMPLE_RATE
from core.model import whisper_model

logger = logging.getLogger(__name__)


class AudioProcessor:
    """Audio processor using Whisper for transcription"""
    
    def __init__(self):
        """Initialize audio processor"""
        self.model = whisper_model
        self.semantic_client = SemanticClient()
        self._init_stats()
        self._validate_model()

    def _init_stats(self) -> None:
        """Initialize processing statistics"""
        self.stats = {
            'total_processed': 0,
            'successful': 0,
            'failed': 0,
            'too_short': 0,
            'no_speech': 0
        }

    def _validate_model(self) -> None:
        """Validate Whisper model availability"""
        if self.model is None:
            logger.error("Whisper model not available")
        else:
            logger.info("Whisper model loaded successfully")

    async def process_buffer(
        self, 
        buffer: bytes, 
        room_id: str,
        user_id: str,
        sample_rate: int = SAMPLE_RATE, 
        channels: int = 1,
        duration: float = 0
    ) -> Dict[str, Any]:
        """
        Process audio buffer and transcribe
        
        Args:
            buffer: PCM audio data
            room_id: Room identifier
            user_id: User identifier
            sample_rate: Audio sample rate
            channels: Number of channels
            duration: Duration in milliseconds
            
        Returns:
            Processing result dictionary
        """
        import time
        start_time = time.time()
        
        try:
            self.stats['total_processed'] += 1
            
            if not self._validate_input(buffer):
                return self._create_result(False, 'Invalid input', start_time, False)

            # Convert and analyze audio
            audio_array = self._buffer_to_audio_array(buffer, sample_rate, channels)
            if audio_array is None:
                return self._create_result(False, 'Failed to convert audio', start_time, False)

            # Check audio quality and duration
            audio_duration = len(audio_array) / SAMPLE_RATE
            if not self._validate_audio_quality(audio_array, audio_duration):
                return self._create_result(True, f'Audio too short ({audio_duration:.2f}s)', start_time, False)

            # Transcribe
            result = await self._transcribe_audio(audio_array)
            
            # Save transcript if valid
            transcript_saved = False
            if result and result.get('text', '').strip():
                transcript_saved = await self._save_transcript(
                    result, room_id, user_id, audio_duration
                )
                self.stats['successful'] += 1
            else:
                self.stats['no_speech'] += 1

            message = 'Transcription completed' if transcript_saved else 'No speech detected'
            return self._create_result(True, message, start_time, transcript_saved)
            
        except Exception as e:
            logger.error(f"Processing error: {e}")
            self.stats['failed'] += 1
            return self._create_result(False, f'Processing error: {str(e)}', start_time, False)

    def _validate_input(self, buffer: bytes) -> bool:
        """Validate input buffer"""
        if not self.model:
            self.stats['failed'] += 1
            return False
        
        if not buffer or len(buffer) == 0:
            self.stats['failed'] += 1
            return False
            
        return True

    def _buffer_to_audio_array(self, buffer: bytes, sample_rate: int, channels: int) -> Optional[np.ndarray]:
        """
        Convert raw audio buffer to numpy array for Whisper processing
        
        This method handles audio format conversion and normalization:
        1. Convert bytes to 16-bit integer numpy array
        2. Normalize values from [-32768, 32767] to [-1.0, 1.0] (float32)
        3. Convert multi-channel audio to mono by averaging channels
        4. Resample audio if sample rate doesn't match Whisper's expected 16kHz
        
        Args:
            buffer: Raw PCM audio data as bytes (16-bit signed integers)
            sample_rate: Original sample rate of the audio
            channels: Number of audio channels (1=mono, 2=stereo)
            
        Returns:
            Optional[np.ndarray]: Processed audio array ready for Whisper, or None if conversion fails
        """
        try:
            # Convert bytes to numpy array (assuming 16-bit signed PCM format)
            # Each sample is 2 bytes, so buffer length / 2 = number of samples
            audio_array = np.frombuffer(buffer, dtype=np.int16).astype(np.float32)
            
            # Normalize from 16-bit integer range [-32768, 32767] to float range [-1.0, 1.0]
            # This is required by Whisper which expects normalized float32 audio
            audio_array = audio_array / 32768.0
            
            # Handle multi-channel audio (stereo, 5.1, etc.)
            if channels > 1:
                # Reshape array to separate channels: [sample1_ch1, sample1_ch2, sample2_ch1, ...]
                # becomes [[sample1_ch1, sample1_ch2], [sample2_ch1, sample2_ch2], ...]
                audio_array = audio_array.reshape(-1, channels)
                # Convert to mono by averaging all channels
                audio_array = np.mean(audio_array, axis=1)
            
            # Resample audio if sample rate doesn't match Whisper's expected 16kHz
            if sample_rate != SAMPLE_RATE:
                audio_array = self._resample_audio(audio_array, sample_rate, SAMPLE_RATE)
            
            return audio_array
            
        except Exception as e:
            logger.error(f"Audio conversion error: {e}")
            return None

    def _resample_audio(self, audio: np.ndarray, orig_sr: int, target_sr: int) -> np.ndarray:
        """Resample audio to target sample rate"""
        try:
            import librosa
            return librosa.resample(audio, orig_sr=orig_sr, target_sr=target_sr)
        except ImportError:
            logger.warning("librosa not available, using simple resampling")
            # Simple resampling (not ideal but functional)
            ratio = target_sr / orig_sr
            new_length = int(len(audio) * ratio)
            return np.interp(np.linspace(0, len(audio), new_length), np.arange(len(audio)), audio)

    def _validate_audio_quality(self, audio_array: np.ndarray, duration: float) -> bool:
        """Validate audio quality and duration"""
        # Check minimum duration
        if duration < MIN_AUDIO_DURATION:
            self.stats['too_short'] += 1
            logger.debug(f"Audio too short ({duration:.2f}s < {MIN_AUDIO_DURATION}s)")
            return False

        # Check for silent audio
        audio_rms = float(np.sqrt(np.mean(audio_array ** 2)))
        if audio_rms < 0.001:
            logger.warning(f"Very quiet audio (RMS: {audio_rms:.4f})")
        
        # Check for clipped audio
        audio_max = float(np.max(np.abs(audio_array)))
        if audio_max > 0.95:
            logger.warning(f"Audio may be clipped (max: {audio_max:.4f})")

        return True

    async def _transcribe_audio(self, audio_array: np.ndarray) -> Optional[Dict[str, Any]]:
        """Transcribe audio using Whisper"""
        try:
            logger.info(f"Transcribing {len(audio_array)/SAMPLE_RATE:.2f}s audio")
            
            result = await asyncio.get_event_loop().run_in_executor(
                None, self._whisper_transcribe, audio_array
            )
            
            return result
            
        except Exception as e:
            logger.error(f"Transcription error: {e}")
            return None

    def _whisper_transcribe(self, audio_array: np.ndarray) -> Dict[str, Any]:
        """
        Synchronous Whisper transcription using faster-whisper
        
        This method performs the actual speech-to-text conversion using the faster-whisper model.
        It runs in a separate thread executor to avoid blocking the async event loop.
        
        Faster-Whisper Configuration:
        - language: Set to Vietnamese ("vi") or auto-detect
        - task: 'transcribe' (vs 'translate' which would translate to English)
        
        Note: faster-whisper has different API than openai-whisper:
        - Returns (segments, info) tuple instead of dict
        - No fp16 or verbose parameters
        - Segments are iterator that needs to be converted to list
        
        Args:
            audio_array: Normalized float32 audio array at 16kHz sample rate
            
        Returns:
            Dict containing:
                - text: Transcribed text (empty string if no speech detected)
                - language: Detected or specified language code
                - segments: Detailed segment information with timestamps
        """
        try:
            # Run Whisper transcription
            # The model is pre-loaded in core.model to avoid loading overhead
            # Note: faster-whisper uses different parameters than openai-whisper
            segments, info = self.model.transcribe(
                audio_array,
                language='vi',        # Force Vietnamese (or use 'auto' for detection)
                task='transcribe'     # Transcribe to same language (not translate to English)
            )
            
            # Convert segments to list and extract text
            segments_list = list(segments)
            full_text = ' '.join([segment.text for segment in segments_list])
            
            result = {
                'text': full_text.strip(),
                'language': info.language if hasattr(info, 'language') else 'vi',
                'segments': [
                    {
                        'text': segment.text,
                        'start': segment.start,
                        'end': segment.end
                    } for segment in segments_list
                ]
            }
            
            return result
            
        except Exception as e:
            logger.error(f"Whisper transcription error: {e}")
            # Return empty result on error to prevent pipeline failure
            return {'text': '', 'language': 'unknown', 'segments': []}

    async def _save_transcript(
        self, 
        result: Dict[str, Any], 
        room_id: str, 
        user_id: str, 
        duration: float
    ) -> bool:
        """Save transcript to JSON file and semantic service"""
        try:
            transcript_data = {
                'room_id': room_id,
                'user_id': user_id,
                'timestamp': datetime.utcnow().isoformat(),
                'text': result['text'],
                'language': result.get('language', 'unknown'),
                'duration': duration,
                'segments': result.get('segments', [])
            }
            
            # Send to semantic service
            await self._send_to_semantic(transcript_data)
            
            logger.info(f"Transcript saved for {user_id} in {room_id}")
            return True
            
        except Exception as e:
            logger.error(f"Failed to save transcript: {e}")
            return False

    async def _send_to_semantic(self, data: Dict[str, Any]) -> None:
        """Send transcript to semantic service"""
        try:
            await self.semantic_client.save_transcript(data)
        except Exception as e:
            logger.error(f"Failed to send to semantic service: {e}")

    def _create_result(self, success: bool, message: str, start_time: float, transcript_saved: bool) -> Dict[str, Any]:
        """Create standardized result dictionary"""
        import time
        return {
            'success': success,
            'message': message,
            'processing_time': time.time() - start_time,
            'transcript_saved': transcript_saved
        }

    def get_stats(self) -> Dict[str, Any]:
        """Get processing statistics"""
        return self.stats.copy()
