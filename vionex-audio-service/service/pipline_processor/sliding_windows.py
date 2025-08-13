from dataclasses import dataclass, field
from core.config import SAMPLE_RATE, CHANNELS
from typing import Optional, List, Dict, Any, Tuple
import difflib
import logging
import time

logger = logging.getLogger(__name__)

@dataclass
class WordTimestamp:
    """Word with precise timing information from Whisper"""
    word: str
    start: float
    end: float
    confidence: float = 0.0

@dataclass
class TranscriptionResult:
    """Complete transcription result with word-level timing"""
    text: str
    words: List[WordTimestamp]
    start_time: float
    end_time: float
    window_id: int

@dataclass
class SmartAudioBuffer:
    """
    Enhanced audio buffer with sliding window processing optimized for Whisper STT.
    
    Key improvements:
    - 4s window size with 1s stride for better context
    - Word-level timestamp filtering to extract middle portion (1s-3s)
    - Duplicate removal between overlapping windows
    - VAD integration for speech-only processing
    - Whisper-specific optimizations (condition_on_previous_text=False)
    """

    # Enhanced constants for better STT accuracy
    WINDOW_SIZE_MS = 4000      # 4s window for better context
    STRIDE_MS = 1000           # 1s stride for real-time processing
    EXTRACT_START_MS = 1000    # Extract from 1s (avoid edge artifacts)
    EXTRACT_END_MS = 3000      # Extract to 3s (avoid edge artifacts)
    
    def __init__(self):
        self.buffer = bytearray()
        self.processed_windows: List[TranscriptionResult] = []
        self.final_transcript = ""
        self.window_counter = 0
        self.last_processing_time = 0.0
        
        # Calculate byte sizes based on audio format (16kHz, 16-bit, mono)
        self.bytes_per_second = SAMPLE_RATE * CHANNELS * 2
        self.window_size_bytes = int(self.bytes_per_second * (self.WINDOW_SIZE_MS / 1000))
        self.stride_size_bytes = int(self.bytes_per_second * (self.STRIDE_MS / 1000))
        self.extract_start_bytes = int(self.bytes_per_second * (self.EXTRACT_START_MS / 1000))
        self.extract_end_bytes = int(self.bytes_per_second * (self.EXTRACT_END_MS / 1000))
        
        logger.info(f"SmartAudioBuffer initialized:")
        logger.info(f"  Window: {self.WINDOW_SIZE_MS}ms ({self.window_size_bytes} bytes)")
        logger.info(f"  Stride: {self.STRIDE_MS}ms ({self.stride_size_bytes} bytes)")
        logger.info(f"  Extract range: {self.EXTRACT_START_MS}-{self.EXTRACT_END_MS}ms")
        logger.info(f"  Strategy: Process immediately when possible, don't wait for full window")

    def add_audio_chunk(self, audio_data: bytes) -> Optional[Dict[str, Any]]:
        """
        Add audio chunk and return processing window if ready.
        Strategy: Process 4s windows when available, otherwise process available data.
        
        Returns:
            Optional[Dict]: Window data ready for Whisper processing with metadata
        """
        self.buffer.extend(audio_data)

        # Prefer 4s windows when available
        if len(self.buffer) >= self.window_size_bytes:
            # Create 4s window for processing
            window = bytes(self.buffer[:self.window_size_bytes])
            
            # Move buffer forward by stride (1s)
            self.buffer = self.buffer[self.stride_size_bytes:]
            
            self.window_counter += 1
            current_time = time.time()
            
            window_info = {
                'audio_data': window,
                'window_id': self.window_counter,
                'window_duration': self.WINDOW_SIZE_MS / 1000.0,
                'extract_start': self.EXTRACT_START_MS / 1000.0,
                'extract_end': self.EXTRACT_END_MS / 1000.0,
                'timestamp': current_time,
                'is_optimal_size': True,
                'whisper_config': {
                    'word_timestamps': True,
                    'condition_on_previous_text': False,
                    'no_speech_threshold': 0.6,
                    'logprob_threshold': -1.0
                }
            }
            
            logger.debug(f"Optimal Window #{self.window_counter} ready: {len(window)} bytes, buffer remaining: {len(self.buffer)} bytes")
            return window_info

        return None

    def force_process_current_buffer(self, reason: str = "manual") -> Optional[Dict[str, Any]]:
        """
        Force process current buffer immediately, regardless of size.
        Use when stream ends or when you want to process available data immediately.
        
        Args:
            reason: Reason for forcing processing (for logging)
            
        Returns:
            Optional[Dict]: Window data if any buffer exists
        """
        if len(self.buffer) == 0:
            logger.debug(f"No buffer to force process (reason: {reason})")
            return None
        
        # Process whatever we have in buffer
        self.window_counter += 1
        current_time = time.time()
        
        buffer_duration = len(self.buffer) / self.bytes_per_second
        logger.info(f"Force processing buffer (reason: {reason}): {len(self.buffer)} bytes ({buffer_duration:.2f}s)")
        
        # Adaptive extract range based on available duration
        if buffer_duration >= 4.0:
            # If we have >= 4s, use standard extract range (1s-3s)
            extract_start = 1.0
            extract_end = 3.0
        elif buffer_duration >= 2.0:
            # If we have >= 2s, extract middle portion
            margin = buffer_duration * 0.2  # 20% margins
            extract_start = margin
            extract_end = buffer_duration - margin
        else:
            # If < 2s, extract almost everything (minimal margins)
            extract_start = min(0.1, buffer_duration * 0.05)
            extract_end = max(buffer_duration - 0.1, buffer_duration * 0.95)
        
        window_info = {
            'audio_data': bytes(self.buffer),
            'window_id': self.window_counter,
            'window_duration': buffer_duration,
            'extract_start': extract_start,
            'extract_end': extract_end,
            'timestamp': current_time,
            'is_forced': True,
            'force_reason': reason,
            'is_optimal_size': buffer_duration >= 4.0,
            'whisper_config': {
                'word_timestamps': True,
                'condition_on_previous_text': False,
                'no_speech_threshold': 0.6,
                'logprob_threshold': -1.0
            }
        }
        
        logger.info(f"Forced Window #{self.window_counter}:")
        logger.info(f"  Size: {len(self.buffer)} bytes ({buffer_duration:.2f}s)")
        logger.info(f"  Extract range: {extract_start:.2f}s - {extract_end:.2f}s")
        logger.info(f"  Reason: {reason}")
        logger.info(f"  Optimal size: {window_info['is_optimal_size']}")
        
        self.buffer.clear()  # Clear buffer after processing
        return window_info

    def get_remaining_buffer(self) -> Optional[Dict[str, Any]]:
        """
        Get remaining buffer as final window regardless of size.
        Process any remaining audio, no matter how short.
        
        Returns:
            Optional[Dict]: Final window data if any buffer remains
        """
        min_final_size = self.bytes_per_second * 0.5  # Process anything >= 0.5s
        
        if len(self.buffer) >= min_final_size:
            self.window_counter += 1
            current_time = time.time()
            
            # Calculate actual buffer duration
            buffer_duration = len(self.buffer) / self.bytes_per_second
            
            # Adaptive extract range based on available duration
            if buffer_duration >= 4.0:
                # If we have >= 4s, use standard extract range (1s-3s)
                extract_start = 1.0
                extract_end = 3.0
            elif buffer_duration >= 2.0:
                # If we have >= 2s, extract middle 50%
                margin = buffer_duration * 0.25
                extract_start = margin
                extract_end = buffer_duration - margin
            else:
                # If < 2s, extract almost everything (leave small margins)
                extract_start = min(0.1, buffer_duration * 0.1)
                extract_end = max(buffer_duration - 0.1, buffer_duration * 0.9)
            
            window_info = {
                'audio_data': bytes(self.buffer),
                'window_id': self.window_counter,
                'window_duration': buffer_duration,
                'extract_start': extract_start,
                'extract_end': extract_end,
                'timestamp': current_time,
                'is_final': True,
                'is_optimal_size': buffer_duration >= 4.0,
                'whisper_config': {
                    'word_timestamps': True,
                    'condition_on_previous_text': False,
                    'no_speech_threshold': 0.6,
                    'logprob_threshold': -1.0
                }
            }
            
            logger.info(f"Final window #{self.window_counter} created: {len(self.buffer)} bytes ({buffer_duration:.2f}s)")
            logger.info(f"  Extract range adapted to: {extract_start:.2f}s - {extract_end:.2f}s")
            logger.info(f"  Optimal size: {window_info['is_optimal_size']}")
            self.buffer.clear()  # Clear buffer after processing
            return window_info
        
        logger.debug(f"Buffer too small for processing: {len(self.buffer)} bytes ({len(self.buffer)/self.bytes_per_second:.2f}s)")
        return None

    def process_whisper_result(self, raw_result: Any, window_info: Dict[str, Any]) -> Optional[str]:
        """
        Process Whisper result with word-level filtering and duplicate removal.
        
        Args:
            raw_result: Raw result from Whisper/faster-whisper
            window_info: Window metadata from add_audio_chunk()
            
        Returns:
            Optional[str]: Filtered text from middle portion of window
        """
        try:
            # Extract word timestamps from faster-whisper result
            words = []
            if hasattr(raw_result, 'segments'):
                for segment in raw_result.segments:
                    if hasattr(segment, 'words') and segment.words:
                        for word in segment.words:
                            words.append(WordTimestamp(
                                word=word.word.strip(),
                                start=word.start,
                                end=word.end,
                                confidence=getattr(word, 'probability', 0.0)
                            ))
            
            if not words:
                logger.debug(f"No words with timestamps in window #{window_info['window_id']}")
                return None
            
            # Filter words in middle portion (1s - 3s)
            extract_start = window_info['extract_start']
            extract_end = window_info['extract_end']
            
            filtered_words = [
                word for word in words
                if extract_start <= word.start <= extract_end or extract_start <= word.end <= extract_end
            ]
            
            if not filtered_words:
                logger.debug(f"No words in extract range {extract_start}-{extract_end}s for window #{window_info['window_id']}")
                return None
            
            # Create transcription result
            filtered_text = " ".join([word.word for word in filtered_words])
            
            result = TranscriptionResult(
                text=filtered_text,
                words=filtered_words,
                start_time=filtered_words[0].start,
                end_time=filtered_words[-1].end,
                window_id=window_info['window_id']
            )
            
            # Remove duplicates and update final transcript
            deduplicated_text = self._remove_duplicates_and_update(result)
            
            logger.info(f"Window #{window_info['window_id']} processed:")
            logger.info(f"  Full text: '{' '.join([w.word for w in words])}'")
            logger.info(f"  Filtered ({extract_start}-{extract_end}s): '{filtered_text}'")
            logger.info(f"  After dedup: '{deduplicated_text}'")
            
            return deduplicated_text
            
        except Exception as e:
            logger.error(f"Error processing Whisper result for window #{window_info.get('window_id', '?')}: {e}")
            return None

    def _remove_duplicates_and_update(self, new_result: TranscriptionResult) -> str:
        """
        Remove duplicates between consecutive windows and update final transcript.
        
        Args:
            new_result: New transcription result to process
            
        Returns:
            str: Deduplicated text portion to add to final transcript
        """
        if not self.processed_windows:
            # First window - no duplicates to remove
            self.processed_windows.append(new_result)
            self.final_transcript = new_result.text
            return new_result.text
        
        # Get last processed window for comparison
        last_result = self.processed_windows[-1]
        
        # Split into words for comparison
        last_words = last_result.text.split()
        new_words = new_result.text.split()
        
        if not last_words or not new_words:
            self.processed_windows.append(new_result)
            if new_result.text.strip():
                self.final_transcript += " " + new_result.text
            return new_result.text
        
        # Find overlap using difflib
        matcher = difflib.SequenceMatcher(None, last_words, new_words)
        matches = matcher.get_matching_blocks()
        
        # Find the longest overlap at the end of last_words and start of new_words
        best_overlap = 0
        for match in matches:
            if match.a + match.size == len(last_words):  # Overlap at end of last window
                if match.b == 0:  # Overlap at start of new window
                    best_overlap = match.size
                    break
        
        # Remove overlapping words from new result
        if best_overlap > 0:
            unique_words = new_words[best_overlap:]
            logger.debug(f"Removed {best_overlap} overlapping words: {new_words[:best_overlap]}")
        else:
            unique_words = new_words
        
        # Update final transcript
        unique_text = " ".join(unique_words)
        if unique_text.strip():
            if self.final_transcript:
                self.final_transcript += " " + unique_text
            else:
                self.final_transcript = unique_text
        
        # Store processed result
        self.processed_windows.append(new_result)
        
        # Keep only last 10 windows to prevent memory growth
        if len(self.processed_windows) > 10:
            self.processed_windows = self.processed_windows[-10:]
        
        return unique_text

    def get_final_transcript(self) -> str:
        """Get the complete deduplicated transcript"""
        return self.final_transcript.strip()

    def get_processing_stats(self) -> Dict[str, Any]:
        """Get processing statistics for monitoring"""
        return {
            'total_windows': self.window_counter,
            'processed_results': len(self.processed_windows),
            'buffer_size_bytes': len(self.buffer),
            'buffer_duration_seconds': len(self.buffer) / self.bytes_per_second,
            'final_transcript_length': len(self.final_transcript),
            'final_transcript_words': len(self.final_transcript.split()) if self.final_transcript else 0
        }

    def has_enough_for_processing(self) -> bool:
        """Check if buffer has enough data for a processing window"""
        return len(self.buffer) >= self.window_size_bytes

    def clear(self):
        """Clear all buffers and reset state"""
        self.buffer.clear()
        self.processed_windows.clear()
        self.final_transcript = ""
        self.window_counter = 0
        logger.info("SmartAudioBuffer cleared")
