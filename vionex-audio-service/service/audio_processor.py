"""
 * Copyright (c) 2025 xuantruongg003
 *
 * This software is licensed for non-commercial use only.
 * You may use, study, and modify this code for educational and research purposes.
 *
 * Commercial use of this code, in whole or in part, is strictly prohibited
 * without prior written permission from the author.
 *
 * Author Contact: lexuantruong098@gmail.com
 */
"""
"""
AUDIO PROCESSOR

Core audio processing via Whisper:
- Convert audio buffer → Whisper format
- Transcribe via Whisper model
"""

import asyncio
import json
import logging
import numpy as np
import os
from datetime import datetime
from typing import Dict, Any, Optional
from clients.semantic import SemanticClient

from core.config import MIN_AUDIO_DURATION, SAMPLE_RATE, TRANSCRIPT_DIR
from core.model import model as whisper_model


logger = logging.getLogger(__name__)


class AudioProcessor:
    """
    Simplified audio processor using Whisper
    """
    
    def __init__(self):
        """Initialize audio processor with pre-loaded Whisper model"""
        # Use pre-loaded model from core.model
        self.model = whisper_model
        self.semantic_client = SemanticClient()
        
        # Statistics
        self.stats = {
            'total_processed': 0,
            'successful': 0,
            'failed': 0,
            'too_short': 0,
            'no_speech': 0
        }
        
        # Verify model is loaded
        if self.model is None:
            logger.error("Whisper model not available from core.model")
        else:
            logger.info(f"Using pre-loaded Whisper model from core.model")



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
        Process audio buffer, transcribe, and save to JSON file
        
        Args:
            buffer: PCM audio data as bytes
            room_id: Room identifier for transcript file
            user_id: User identifier for transcript
            sample_rate: Audio sample rate
            channels: Number of audio channels
            duration: Duration in milliseconds
            
        Returns:
            {
                'success': bool,
                'message': str,
                'processing_time': float,
                'transcript_saved': bool
            }
        """
        import time
        start_time = time.time()
        
        try:
            self.stats['total_processed'] += 1
            
            # Validate Whisper model
            if not self.model:
                self.stats['failed'] += 1
                return {
                    'success': False,
                    'message': 'Whisper model not available',
                    'processing_time': time.time() - start_time,
                    'transcript_saved': False
                }

            # Convert buffer to audio array
            audio_array = self._buffer_to_audio_array(buffer, sample_rate, channels)
            
            if audio_array is None:
                self.stats['failed'] += 1
                return {
                    'success': False,
                    'message': 'Failed to convert audio buffer',
                    'processing_time': time.time() - start_time,
                    'transcript_saved': False
                }

            # Basic audio analysis
            audio_duration = len(audio_array) / SAMPLE_RATE
            audio_rms = float(np.sqrt(np.mean(audio_array ** 2)))
            audio_max = float(np.max(np.abs(audio_array)))
            
            logger.debug(f"Audio analysis: duration={audio_duration:.2f}s, RMS={audio_rms:.4f}, max={audio_max:.4f}")
            
            # Check for silent audio (very low RMS)
            if audio_rms < 0.001:
                logger.warning(f"Very quiet audio (RMS: {audio_rms:.4f}) - may cause hallucination")
            
            # Check for clipped audio (high max)
            if audio_max > 0.95:
                logger.warning(f"Audio may be clipped (max: {audio_max:.4f})")

            # Check minimum duration
            if audio_duration < MIN_AUDIO_DURATION:
                self.stats['too_short'] += 1
                logger.debug(f"Audio too short ({audio_duration:.2f}s < {MIN_AUDIO_DURATION}s)")
                return {
                    'success': True,
                    'message': f'Audio too short ({audio_duration:.2f}s)',
                    'processing_time': time.time() - start_time,
                    'transcript_saved': False
                }

            # Transcribe with Whisper
            logger.info(f"Starting transcription for {audio_duration:.2f}s audio")
            result = await asyncio.get_event_loop().run_in_executor(
                None, self._transcribe_sync, audio_array
            )
            
            transcript = result.get("text", "").strip()
            language = result.get("language", "vi")

            # Calculate confidence
            confidence = self._calculate_confidence(result)
            
            processing_time = time.time() - start_time
            
            if transcript:
                self.stats['successful'] += 1
                logger.info(f"Transcription successful in {processing_time:.2f}s: '{transcript}' (confidence: {confidence:.2f})")
                
                # Save transcript to JSON file
                # transcript_saved = await self._save_transcript_to_file(room_id, user_id, transcript)
                
                # Calling semantic service to save transcript (non-blocking)
                # Use current timestamp instead of processing_time
                current_timestamp = str(int(time.time()))
                asyncio.create_task(self._save_to_semantic_service(room_id, user_id, transcript, language, current_timestamp))

                return {
                    'success': True,
                    'message': 'Transcription successful',
                    'processing_time': processing_time,
                    'transcript_saved': True  # Always return True since semantic service is non-blocking
                }
            else:
                self.stats['no_speech'] += 1
                logger.info(f"No speech detected in {processing_time:.2f}s")
                return {
                    'success': True,
                    'message': 'No speech detected',
                    'processing_time': processing_time,
                    'transcript_saved': False
                }
                
        except Exception as e:
            self.stats['failed'] += 1
            processing_time = time.time() - start_time
            logger.error(f"Processing error in {processing_time:.2f}s: {e}")
            return {
                'success': False,
                'message': f'Processing error: {str(e)}',
                'processing_time': processing_time,
                'transcript_saved': False
            }

    def _buffer_to_audio_array(self, buffer: bytes, sample_rate: int, channels: int) -> Optional[np.ndarray]:
        """
        Convert audio buffer to numpy array for Whisper
        
        Args:
            buffer: PCM audio data (16-bit)
            sample_rate: Sample rate
            channels: Number of channels
            
        Returns:
            Normalized audio array for Whisper or None if failed
        """
        try:
            # Calculate expected duration from buffer size
            expected_duration = len(buffer) / 2 / sample_rate
            logger.info(f"Audio buffer: {len(buffer)} bytes, expected duration: {expected_duration:.2f}s")
            
            # Convert bytes to numpy array (assume 16-bit PCM little-endian)
            audio_data = np.frombuffer(buffer, dtype=np.int16)
            logger.info(f"Audio data: shape={audio_data.shape}, min={np.min(audio_data)}, max={np.max(audio_data)}")
            
            # Calculate RMS for audio level check
            rms = np.sqrt(np.mean(audio_data.astype(np.float64) ** 2))
            logger.info(f"Audio RMS level: {rms:.2f}")
            
            # Convert to float32 and normalize to [-1, 1]
            audio_float = audio_data.astype(np.float32) / 32768.0
            
            # Handle multi-channel (convert to mono)
            if channels > 1:
                audio_float = audio_float.reshape(-1, channels)
                audio_float = np.mean(audio_float, axis=1)
                logger.debug(f"Converted {channels} channels to mono")
            
            # Resample to 16kHz if needed (Whisper requirement)
            if sample_rate != SAMPLE_RATE:
                logger.debug(f"Resampling from {sample_rate}Hz to {SAMPLE_RATE}Hz")
                audio_float = self._resample_audio(audio_float, sample_rate, SAMPLE_RATE)
            
            # Final audio info before Whisper
            final_duration = len(audio_float) / SAMPLE_RATE
            final_rms = np.sqrt(np.mean(audio_float**2))
            logger.info(f"Final audio for Whisper: duration={final_duration:.2f}s, RMS={final_rms:.4f}, samples={len(audio_float)}")
            
            return audio_float
            
        except Exception as e:
            logger.error(f"Error converting buffer: {e}")
            return None

    def _resample_audio(self, audio_data: np.ndarray, from_rate: int, to_rate: int) -> np.ndarray:
        """
        Simple resampling using linear interpolation
        
        Args:
            audio_data: Input audio array
            from_rate: Source sample rate
            to_rate: Target sample rate
            
        Returns:
            Resampled audio array
        """
        try:
            if from_rate == to_rate:
                return audio_data
            
            # Calculate new length
            ratio = to_rate / from_rate
            new_length = int(len(audio_data) * ratio)
            
            # Linear interpolation
            old_indices = np.arange(len(audio_data))
            new_indices = np.linspace(0, len(audio_data) - 1, new_length)
            resampled = np.interp(new_indices, old_indices, audio_data)
            
            return resampled.astype(np.float32)
            
        except Exception as e:
            logger.error(f"Error resampling: {e}")
            return audio_data

    def _transcribe_sync(self, audio_array: np.ndarray) -> Dict[str, Any]:
        """
        Synchronous Whisper transcription (runs in thread pool)
        
        Args:
            audio_array: Audio data as numpy array
            
        Returns:
            Whisper transcription result
        """
        # Run transcription
        segments, info = self.model.transcribe(
            audio_array,
            task="transcribe",
            temperature=0.0,
            beam_size=5,
            no_speech_threshold=0.3,
            condition_on_previous_text=False,
            compression_ratio_threshold=2.4,
            vad_filter=False,
        )
        
        # Convert iterator to list
        segments_list_raw = list(segments)
        
        # Convert faster-whisper result to compatible format
        text = ""
        segments_list = []
        
        logger.info(f"Whisper detected {len(segments_list_raw)} segments")
        
        for i, segment in enumerate(segments_list_raw):
            segment_text = segment.text.strip()
            logger.info(f"Segment {i+1}: [{segment.start:.2f}s-{segment.end:.2f}s] '{segment_text}'")
            
            text += segment_text
            segments_list.append({
                "text": segment_text,
                "start": segment.start,
                "end": segment.end,
                "avg_logprob": segment.avg_logprob,
                "no_speech_prob": segment.no_speech_prob
            })
        
        logger.info(f"Final transcript: '{text}' (length: {len(text)} chars)")
        
        # Check for repetitive text (hallucination detection)
        if text and self._is_repetitive_text(text):
            logger.warning(f"Detected repetitive transcript: '{text[:50]}...' - filtering out")
            return {
                "text": "",
                "language": info.language,
                "segments": [],
                "filtered_reason": "repetitive_content"
            }
        
        return {
            "text": text,
            "language": info.language,
            "segments": segments_list
        }

    def _calculate_confidence(self, result: Dict[str, Any]) -> float:
        """
        Calculate confidence score from Whisper result
        
        Args:
            result: Whisper transcription result
            
        Returns:
            Confidence score (0.0 to 1.0)
        """
        try:
            segments = result.get("segments", [])
            if not segments:
                return 0.0
            
            # Average confidence from segments
            total_confidence = 0.0
            total_length = 0.0
            
            for segment in segments:
                text_length = len(segment.get("text", ""))
                avg_logprob = segment.get("avg_logprob", -1.0)
                
                # Convert log probability to confidence (rough approximation)
                confidence = max(0.0, min(1.0, (avg_logprob + 1.0)))
                
                total_confidence += confidence * text_length
                total_length += text_length
            
            return (total_confidence / total_length) if total_length > 0 else 0.0
            
        except Exception as e:
            logger.warning(f"Error calculating confidence: {e}")
            return 0.5  # Default confidence

    async def _save_transcript_to_file(self, room_id: str, user_id: str, transcript: str) -> bool:
        """
        Save transcript to JSON file using the same format as stream_manager.py
        
        Logic: If the last entry is from the same user, append the text.
        Otherwise, create a new entry.
        
        Args:
            room_id: Room identifier
            user_id: User identifier  
            transcript: Transcribed text
            
        Returns:
            True if saved successfully, False otherwise
        """
        try:
            # Create transcript filename based on room_id
            transcript_file = os.path.join(TRANSCRIPT_DIR, f"{room_id}.json")
            
            # Load existing transcripts or create new list
            transcripts = []
            if os.path.exists(transcript_file):
                try:
                    with open(transcript_file, 'r', encoding='utf-8') as f:
                        transcripts = json.load(f)
                except (json.JSONDecodeError, IOError) as e:
                    logger.warning(f"Error reading existing transcript file {transcript_file}: {e}")
                    transcripts = []
            
            # Check if we should append to the last entry or create a new one
            if transcripts and transcripts[-1]["userId"] == user_id:
                # Append to the same user's last entry
                transcripts[-1]["text"] += ". " + transcript
                logger.debug(f"Appended to existing entry for user {user_id}")
            else:
                # Create new transcript entry
                transcript_entry = {
                    "userId": user_id,
                    "text": transcript,
                    "timestamp": datetime.now().isoformat()
                }
                transcripts.append(transcript_entry)
                logger.debug(f"Created new entry for user {user_id}")
            
            # Save updated transcripts
            with open(transcript_file, 'w', encoding='utf-8') as f:
                json.dump(transcripts, f, ensure_ascii=False, indent=2)
            
            logger.info(f"Saved transcript for room {room_id}, user {user_id}: '{transcript[:50]}...' (total entries: {len(transcripts)})")
            return True
            
        except Exception as e:
            logger.error(f"Error saving transcript to file: {e}")
            return False

    async def _save_to_semantic_service(self, room_id: str, user_id: str, transcript: str, language: str, timestamp: str):
        """
        Save transcript to semantic service in background (non-blocking)
        
        Args:
            room_id: Room identifier
            user_id: User identifier (speaker)
            transcript: Transcribed text
            language: Language code
            timestamp: Timestamp as string
        """
        try:
            # Call semantic service to save transcript
            success = await self.semantic_client.save_transcript(room_id, user_id, transcript, language, timestamp)
            if success:
                logger.info(f"Successfully saved transcript to semantic service for room {room_id}, speaker {user_id}")
            else:
                logger.warning(f"Failed to save transcript to semantic service for room {room_id}, speaker {user_id}")
        except Exception as e:
            logger.error(f"Error saving transcript to semantic service: {e}")
            # Don't re-raise - this is background task

    def get_stats(self) -> Dict[str, Any]:
        """Get processor statistics"""
        total = self.stats['total_processed']
        return {
            'total_processed': total,
            'successful': self.stats['successful'],
            'failed': self.stats['failed'],
            'too_short': self.stats['too_short'],
            'no_speech': self.stats['no_speech'],
            'success_rate': (self.stats['successful'] / total * 100) if total > 0 else 0,
            'model_loaded': self.model is not None
        }

    def reset_stats(self):
        """Reset processor statistics"""
        self.stats = {
            'total_processed': 0,
            'successful': 0,
            'failed': 0,
            'too_short': 0,
            'no_speech': 0
        }

    def _is_repetitive_text(self, text: str) -> bool:
        """
        Detect repetitive text that indicates Whisper hallucination
        
        Args:
            text: Transcribed text to check
            
        Returns:
            True if text appears to be repetitive/hallucination
        """
        if not text or len(text.strip()) < 10:
            return False
            
        # Remove spaces and convert to lowercase for analysis
        clean_text = text.replace(" ", "").replace(",", "").lower()
        
        # Short phrases are likely legitimate
        words = text.split()
        if len(words) <= 6:
            return False
            
        # Check for very short repeating patterns
        for pattern_len in range(1, 4):
            if len(clean_text) >= pattern_len * 8:
                pattern = clean_text[:pattern_len]
                repetitions = 0
                pos = 0
                while pos < len(clean_text) - pattern_len + 1:
                    if clean_text[pos:pos + pattern_len] == pattern:
                        repetitions += 1
                        pos += pattern_len
                    else:
                        break
                
                if repetitions * pattern_len > len(clean_text) * 0.85:
                    return True
        
        # Check for repeating words
        if len(words) >= 6:
            word_counts = {}
            for word in words:
                word_counts[word.lower()] = word_counts.get(word.lower(), 0) + 1
            
            max_count = max(word_counts.values())
            if max_count > len(words) * 0.75:
                return True
                
        return False
