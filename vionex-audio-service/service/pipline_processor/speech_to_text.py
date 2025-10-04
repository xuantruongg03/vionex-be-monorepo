import asyncio
import difflib
import logging
import numpy as np
import subprocess
import wave
import os
import datetime
from typing import Any, Dict, Optional

from core.model import whisper_model

logger = logging.getLogger(__name__)

class STTPipeline:
    def __init__(self, source_language: str = "vi", enable_audio_logging: bool = True):
        self.prev_text = ""
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

    def remove_overlap(self, curr: str, prev: str, min_words=2) -> str:
        """Improved overlap removal for Vietnamese speech"""
        
        if not curr or not prev:
            return curr
            
        curr_words = curr.strip().split()
        prev_words = prev.strip().split()

        if not curr_words or not prev_words:
            return curr

        # Check for exact duplicate (same chunk processed twice)
        if curr.strip() == prev.strip():
            logger.warning("Duplicate chunk detected, skipping")
            return ""  # Return empty for exact duplicates
        
        # Check similarity to detect near-duplicates
        similarity = difflib.SequenceMatcher(None, curr.lower(), prev.lower()).ratio()
        if similarity > 0.8:  # 80% similar
            logger.warning(f"High similarity ({similarity:.2f}) detected, likely duplicate")
            return ""  # Skip near-duplicates
        
        # Check for word-level overlap at boundaries
        max_check = min(len(prev_words), len(curr_words), 6)  # Check up to 6 words
        best_overlap = 0
        
        # Check if end of prev matches start of curr
        for i in range(1, max_check + 1):
            if prev_words[-i:] == curr_words[:i]:
                best_overlap = i
        
        if best_overlap >= min_words:
            logger.debug(f"Removing {best_overlap} overlapping words")
            return ' '.join(curr_words[best_overlap:])
        
        return curr

    def limit_words(self, text: str, max_words: int = 20) -> str:
        """Limit text to maximum number of words"""
        words = text.strip().split()
        if len(words) > max_words:
            limited_text = ' '.join(words[:max_words])
            logger.warning(f"Text truncated from {len(words)} to {max_words} words")
            return limited_text
        return text

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

    def _save_audio_wav(self, audio_data: bytes, filename: str) -> str:
        """Save PCM audio data as WAV file"""
        try:
            filepath = os.path.join(self.audio_log_dir, filename)
            
            # Convert PCM bytes to numpy array
            audio_array = np.frombuffer(audio_data, dtype=np.int16)
            
            # Save as WAV file
            with wave.open(filepath, 'wb') as wav_file:
                wav_file.setnchannels(1)  # Mono
                wav_file.setsampwidth(2)  # 16-bit
                wav_file.setframerate(16000)  # 16kHz sample rate
                wav_file.writeframes(audio_data)
            
            return filepath
            
        except Exception as e:
            logger.error(f"Failed to save audio WAV: {e}")
            return None

    def _log_stt_result(self, audio_file: str, stt_text: str, processing_time: float, 
                       audio_duration: float, confidence: float = None):
        """Log STT processing result"""
        if not self.enable_audio_logging:
            return
            
        try:
            log_entry = (
                f"FILE: {os.path.basename(audio_file)} | "
                f"DURATION: {audio_duration:.2f}s | "
                f"PROCESSING: {processing_time:.3f}s | "
                f"CONFIDENCE: {confidence or 'N/A'} | "
                f"STT_RESULT: {stt_text}"
            )
            
            self.audio_logger.info(log_entry)
            
        except Exception as e:
            logger.warning(f"Failed to log STT result: {e}")

    def reset_context(self):
        """Reset context to prevent pollution"""
        self.prev_text = ""
        logger.debug("STT context reset")
        
        # Log context reset
        if self.enable_audio_logging:
            self.audio_logger.info("CONTEXT_RESET | STT context cleared")
    
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
            cutoff_time = datetime.datetime.now() - datetime.timedelta(days=days_to_keep)
            cleaned_count = 0
            
            for filename in os.listdir(self.audio_log_dir):
                filepath = os.path.join(self.audio_log_dir, filename)
                
                if os.path.isfile(filepath):
                    file_time = datetime.datetime.fromtimestamp(os.path.getctime(filepath))
                    
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
        start_time = datetime.datetime.now()
        audio_file_path = None
        
        try:
            if not whisper_model:
                logger.warning("Whisper model not available")
                return None

            # Calculate audio duration
            audio_duration = len(audio_data) / (16000 * 2)  # 16kHz, 16-bit
            
            # Save audio file for logging if enabled
            if self.enable_audio_logging:
                timestamp = start_time.strftime("%Y%m%d_%H%M%S_%f")[:-3]  # Include milliseconds
                audio_filename = f"stt_{timestamp}_{audio_duration:.2f}s.wav"
                audio_file_path = self._save_audio_wav(audio_data, audio_filename)

            # audio_array = decode_audio_to_array(audio_data)
            audio_array = pcm16_to_float32(audio_data)

            # Use dynamic language or auto-detection
            whisper_lang = self.whisper_lang_map.get(self.source_language, "vi")
            
            # Process with Whisper
            process_start = datetime.datetime.now()
            result = await asyncio.get_event_loop().run_in_executor(
                None, _transcribe, audio_array, whisper_lang
            )
            processing_time = (datetime.datetime.now() - process_start).total_seconds()

            original_text = ""
            final_text = ""
            confidence = None

            if result and result["text"]:
                original_text = result["text"].strip()
                
                # Remove overlap first
                cleaned_text = self.remove_overlap(original_text, self.prev_text, min_words=3)
                
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
                
                # Use sliding window context (keep only recent text)
                self.prev_text = limited_text  # Replace instead of accumulate
                result["text"] = limited_text  # Send cleaned text
                final_text = limited_text
                
                # Extract confidence if available
                if result.get('segments'):
                    # Calculate average confidence from segments if available
                    confidences = []
                    for segment in result['segments']:
                        if hasattr(segment, 'avg_logprob'):
                            confidences.append(segment.avg_logprob)
                    if confidences:
                        confidence = sum(confidences) / len(confidences)

            # Log the result
            if self.enable_audio_logging and audio_file_path:
                log_text = final_text if final_text else "[NO_SPEECH_DETECTED]"
                if original_text != final_text and original_text:
                    log_text += f" (original: {original_text})"
                    
                self._log_stt_result(
                    audio_file_path, 
                    log_text, 
                    processing_time, 
                    audio_duration, 
                    confidence
                )

            return result

        except Exception as e:
            logger.error(f"Error in STT: {e}")
            
            # Log error if audio logging is enabled
            if self.enable_audio_logging and audio_file_path:
                self._log_stt_result(
                    audio_file_path, 
                    f"[ERROR: {str(e)}]", 
                    (datetime.datetime.now() - start_time).total_seconds(), 
                    len(audio_data) / (16000 * 2) if audio_data else 0
                )
            
            return None

def pcm16_to_float32(audio_bytes: bytes) -> np.ndarray:
    return np.frombuffer(audio_bytes, dtype=np.int16).astype(np.float32) / 32768.0

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


def _transcribe(audio_array: np.ndarray, language: str = "vi") -> Dict[str, Any]:
    """Whisper transcription optimized for Vietnamese accuracy"""
    try:
        segments, info = whisper_model.transcribe(
            audio_array,
            language=language,
            task="transcribe",
            beam_size=3,                      # Balanced accuracy vs speed
            best_of=3,                        # Try multiple attempts
            temperature=0.0,                  # Deterministic results
            word_timestamps=True,
            condition_on_previous_text=False, # Prevent context pollution
            vad_filter=True,                  # Enable VAD filtering
            no_speech_threshold=0.5,          # More conservative speech detection
            compression_ratio_threshold=2.4,  # Detect repetitive text
            logprob_threshold=-1.0            # Quality threshold
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
