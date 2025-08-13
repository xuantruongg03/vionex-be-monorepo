from dataclasses import dataclass, field
import time
import numpy as np
import logging

logger = logging.getLogger(__name__)

@dataclass
class VoiceActivityDetector:
    """
    Simple energy-based voice activity detection to skip silent periods.
    """
    energy_threshold: float = 50.0  # Lowered threshold to detect more subtle speech
    silence_duration_ms: int = 2000  # Increased tolerance for silence
    last_speech_time: float = field(default=0.0)  # Start with 0 instead of current time
    _debug_counter: int = field(default=0, init=False)
    _has_detected_speech: bool = field(default=False, init=False)  # Track if any speech detected

    def detect_speech(self, audio_data: bytes) -> bool:
        """
        Detect if audio contains speech based on energy level.
        
        Args:
            audio_data: Raw PCM audio data
            
        Returns:
            bool: True if speech detected, False otherwise (silence)
        """
        try:
            # Ensure buffer size is multiple of element size (2 bytes for int16)
            data_len = len(audio_data)
            if data_len == 0:
                return False
            
            # Truncate to nearest multiple of 2 bytes for int16
            aligned_len = (data_len // 2) * 2
            if aligned_len == 0:
                return False
                
            aligned_data = audio_data[:aligned_len]
            audio_array = np.frombuffer(aligned_data, dtype=np.int16)
            
            energy = np.mean(np.abs(audio_array.astype(np.float32)))
            current_time = time.time()
            self._debug_counter += 1

            if self._debug_counter % 100 == 0:
                logger.debug(f"[VAD] energy={energy:.2f}, threshold={self.energy_threshold}, speech={energy > self.energy_threshold}")

            if energy > self.energy_threshold:
                self.last_speech_time = current_time
                self._has_detected_speech = True
                if self._debug_counter % 50 == 0:
                    logger.info(f"[VAD] Speech detected! energy={energy:.2f}")
                return True

            # If no speech has been detected yet, return False for silence
            if not self._has_detected_speech:
                return False
                
            # Check if we're still within the silence tolerance period after last speech
            silence_duration = (current_time - self.last_speech_time) * 1000  # in ms
            return silence_duration < self.silence_duration_ms

        except Exception as e:
            logger.error(f"[VAD] Error during detection: {e}")
            return True  # Fail-safe: assume speech to avoid cutting real input
