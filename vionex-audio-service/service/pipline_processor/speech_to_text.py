import asyncio
import io
import logging
import os
import wave
from datetime import datetime, timedelta
from typing import Any, Dict, Optional

import numpy as np

from core.model import distil_whisper_model, whisper_model

logger = logging.getLogger(__name__)

class STTPipeline:
    def __init__(self, source_language: str = "vi", enable_audio_logging: bool = False):
        self.source_language = source_language
        self.enable_audio_logging = enable_audio_logging
        
        # Language mapping for Whisper
        self.whisper_lang_map = {
            "vi": "vi",
            "en": "en", 
            "lo": "lo"  # Whisper supports Lao
        }
        
        # Audio logging setup
        if self.enable_audio_logging:
            self.audio_log_dir = os.path.join(os.getcwd(), "audio_logs")
            os.makedirs(self.audio_log_dir, exist_ok=True)
            
            # Setup audio log file
            log_file = os.path.join(self.audio_log_dir, "stt_results.log")
            self.audio_logger = self._setup_audio_logger(log_file)
            
            logger.info(f"Audio logging enabled: {self.audio_log_dir}")

    def _setup_audio_logger(self, log_file: str):
        """Setup dedicated logger for audio processing results"""
        audio_logger = logging.getLogger(f"audio_stt_{id(self)}")
        audio_logger.setLevel(logging.INFO)
        
        # Avoid duplicate handlers
        if not audio_logger.handlers:
            handler = logging.FileHandler(log_file, mode='a', encoding='utf-8')
            formatter = logging.Formatter(
                '%(asctime)s | %(message)s',
                datefmt='%Y-%m-%d %H:%M:%S'
            )
            handler.setFormatter(formatter)
            audio_logger.addHandler(handler)
            audio_logger.propagate = False
        
        return audio_logger
    
    def get_audio_log_stats(self) -> Dict[str, Any]:
        """Get statistics about audio logging"""
        if not self.enable_audio_logging:
            return {"enabled": False}
            
        try:
            log_dir = self.audio_log_dir
            wav_files = [f for f in os.listdir(log_dir) if f.endswith('.wav')]
            log_files = [f for f in os.listdir(log_dir) if f.endswith('.log')]
            
            total_size = sum(
                os.path.getsize(os.path.join(log_dir, f)) 
                for f in os.listdir(log_dir)
            )
            
            return {
                "enabled": True,
                "log_directory": log_dir,
                "wav_files_count": len(wav_files),
                "log_files_count": len(log_files),
                "total_size_mb": round(total_size / (1024 * 1024), 2)
            }
            
        except Exception as e:
            logger.error(f"Failed to get audio log stats: {e}")
            return {"enabled": True, "error": str(e)}
    
    def cleanup_old_logs(self, days_to_keep: int = 7) -> Dict[str, int]:
        """Clean up audio logs older than specified days"""
        if not self.enable_audio_logging:
            return {"cleaned_files": 0, "error": "Audio logging not enabled"}
            
        try:
            cutoff_time = datetime.now() - timedelta(days=days_to_keep)
            cleaned_count = 0
            
            for filename in os.listdir(self.audio_log_dir):
                filepath = os.path.join(self.audio_log_dir, filename)
                
                if os.path.isfile(filepath):
                    file_time = datetime.fromtimestamp(os.path.getctime(filepath))
                    
                    if file_time < cutoff_time:
                        os.remove(filepath)
                        cleaned_count += 1
                        logger.debug(f"Cleaned old audio log: {filename}")
            
            if cleaned_count > 0:
                self.audio_logger.info(f"CLEANUP | Removed {cleaned_count} old files (older than {days_to_keep} days)")
            
            return {"cleaned_files": cleaned_count}
            
        except Exception as e:
            logger.error(f"Failed to cleanup old logs: {e}")
            return {"cleaned_files": 0, "error": str(e)}

    async def speech_to_text(self, audio_data: bytes) -> Optional[Dict[str, Any]]:
        start_time = datetime.now()
        
        try:
            if not whisper_model:
                logger.warning("Whisper model not available")
                return None

            # Extract PCM from WAV if needed, then convert to float32
            if audio_data.startswith(b'RIFF'):
                # Input is WAV format - extract PCM data
                import wave
                import io
                with wave.open(io.BytesIO(audio_data), 'rb') as wav_file:
                    sample_rate = wav_file.getframerate()
                    channels = wav_file.getnchannels()
                    pcm_data = wav_file.readframes(wav_file.getnframes())
                    
                    # Validate format
                    if sample_rate != 16000 or channels != 1:
                        logger.warning(f"Unexpected WAV format: {sample_rate}Hz, {channels}ch (expected 16kHz mono)")
                    
                    # Calculate audio duration from PCM
                    audio_duration = len(pcm_data) / (sample_rate * channels * 2)
            else:
                # Input is raw PCM16
                pcm_data = audio_data
                sample_rate = 16000
                audio_duration = len(pcm_data) / (sample_rate * 2)

            # Convert PCM16 to Float32 for model (no file I/O - cabin already saved audio)
            audio_array = pcm16_to_float32(pcm_data)

            # Use dynamic language or auto-detection
            whisper_lang = self.whisper_lang_map.get("vi")
            # whisper_lang = self.whisper_lang_map.get(self.source_language, "vi")
            
            # Process with Whisper
            process_start = datetime.now()
            # Use faster-whisper (full model) for better Vietnamese support
            result = await asyncio.get_event_loop().run_in_executor(
                None, _transcribe_whisper, audio_array, whisper_lang
            )
            processing_time = (datetime.now() - process_start).total_seconds()

            # Extract text from result
            final_text = ""
            confidence = None

            if result and result["text"]:
                final_text = result["text"].strip()
                
                # Store raw text in result
                result["raw_text"] = final_text
                
                # Extract confidence if available
                if result.get('segments'):
                    # Calculate average confidence from segments if available
                    confidences = []
                    for segment in result['segments']:
                        if hasattr(segment, 'avg_logprob'):
                            confidences.append(segment.avg_logprob)
                    if confidences:
                        confidence = sum(confidences) / len(confidences)

            # Log result to text log only (no file I/O - audio already saved by cabin)
            if self.enable_audio_logging:
                log_text = final_text if final_text else "[NO_SPEECH_DETECTED]"
                
                # Log to text file only with timestamp and metrics
                try:
                    log_entry = (
                        f"DURATION: {audio_duration:.2f}s | "
                        f"PROCESSING: {processing_time:.3f}s | "
                        f"CONFIDENCE: {confidence or 'N/A'} | "
                        f"STT_RESULT: {log_text}"
                    )
                    self.audio_logger.info(log_entry)
                except Exception as e:
                    logger.warning(f"Failed to log STT result: {e}")

            return result

        except Exception as e:
            logger.error(f"Error in STT: {e}")
            
            # Log error to text file if logging enabled
            if self.enable_audio_logging:
                try:
                    processing_time = (datetime.now() - start_time).total_seconds()
                    error_duration = len(audio_data) / (16000 * 2) if audio_data else 0
                    log_entry = (
                        f"DURATION: {error_duration:.2f}s | "
                        f"PROCESSING: {processing_time:.3f}s | "
                        f"STT_RESULT: [ERROR: {str(e)}]"
                    )
                    self.audio_logger.info(log_entry)
                except Exception as log_err:
                    logger.warning(f"Failed to log error: {log_err}")
            
            return None

def pcm16_to_float32(pcm_bytes: bytes) -> np.ndarray:
    """
    Convert raw PCM16 bytes to Float32 array normalized to [-1.0, 1.0]
    
    Args:
        pcm_bytes: Raw PCM16 data (NOT WAV format - must be extracted first)
        
    Returns:
        np.ndarray: Float32 array normalized to [-1.0, 1.0]
    """
    return np.frombuffer(pcm_bytes, dtype=np.int16).astype(np.float32) / 32768.0

def _transcribe(audio_array: np.ndarray, language: str = "vi") -> Dict[str, Any]:
    """
    REPLACE MODEL: Distil-Whisper
    """
    try:
        # REPLACE MODEL: Distil-Whisper via transformers pipeline
        logger.info(f"[STT] Using Distil-Whisper for language: {language}")
        logger.info(f"[STT] Audio array shape: {audio_array.shape}, duration: {len(audio_array)/16000:.2f}s")
        
        result = distil_whisper_model(
            audio_array,
            generate_kwargs={
                "language": language,
                "task": "transcribe",
                "max_new_tokens": 128,
                "num_beams": 1,  # Greedy decoding for speed
                "do_sample": False,
            },
            return_timestamps=False,  # Don't need timestamps for realtime
        )
        
        logger.info(f"[STT] Transcription result: '{result['text']}'")
        
        return {
            'text': result['text'].strip(),
            'language': language,
            'segments': result.get('chunks', [])
        }

    except Exception as e:
        logger.error(f"[STT] Error in _transcribe: {e}")
        return {'text': '', 'language': language, 'segments': []}

def _transcribe_whisper(audio_array: np.ndarray, language: str = "vi") -> Dict[str, Any]:
    try:
        logger.info(f"[STT] Using faster-whisper for language: {language}")
            
        segments, info = whisper_model.transcribe(
            audio_array,
            language=language,
            task="transcribe",
            beam_size=3,
            temperature=0.0,
            vad_filter=True,
            condition_on_previous_text=False
        )

        segments_list = list(segments)
        full_text = ' '.join([segment.text for segment in segments_list])
        
        logger.info(f"[STT] Transcription result: '{full_text}'")
        
        return {
            'text': full_text.strip(),
            'language': info.language if hasattr(info, 'language') else language,
            'segments': [
                {
                    'text': segment.text,
                    'start': segment.start,
                    'end': segment.end,
                    'words': getattr(segment, 'words', [])
                } for segment in segments_list
            ]
        }
    except Exception as e:
        logger.error(f"[STT] Error in _transcribe: {e}")
        return {'text': '', 'language': language, 'segments': []}
        return {'text': '', 'language': language, 'segments': []}
