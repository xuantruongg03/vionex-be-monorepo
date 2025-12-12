from dataclasses import dataclass, field
import time
import numpy as np
import logging
import webrtcvad

logger = logging.getLogger(__name__)

@dataclass
class VoiceActivityDetector:
    """
    Optimized voice activity detection for real-time translation.
    
    Features:
    - WebRTC VAD with energy-based fallback
    - Configurable energy threshold and speech ratio
    - Hangover logic for smooth transitions
    - Higher thresholds to prevent Whisper hallucinations on silence
    
    CRITICAL: Both WebRTC VAD speech ratio AND energy threshold must be met
    to prevent hallucinations on silence/noise.
    """
    energy_threshold: float = 200.0  # Increased from 50 to prevent noise triggering
    silence_duration_ms: int = 300   # Reduced from 800ms for faster silence detection
    vad_aggressiveness: int = 3      # Maximum strictness (0-3)
    min_speech_ratio: float = 0.3    # At least 30% of frames must have speech
    last_speech_time: float = field(default=0.0)
    _debug_counter: int = field(default=0, init=False)
    _vad: object = field(default=None, init=False)  # WebRTC VAD instance
    
    def __post_init__(self):
        """Initialize WebRTC VAD instance once during object creation."""
        try:
            self._vad = webrtcvad.Vad(self.vad_aggressiveness)
            logger.info(
                f"[VAD] WebRTC VAD initialized: aggressiveness={self.vad_aggressiveness}, "
                f"energy_threshold={self.energy_threshold}, min_speech_ratio={self.min_speech_ratio}"
            )
        except Exception as e:
            logger.error(f"[VAD] Failed to initialize WebRTC VAD: {e}")
            self._vad = None

    def detect_speech(self, audio_data: bytes) -> bool:
        """
        Detect speech using WebRTC VAD (16kHz mono, 16-bit PCM).
        - Frame 20ms (320 samples = 640 bytes)
        - Hysteresis/hangover based on last_speech_time + silence_duration_ms
        - Keep I/O (bytes -> bool)
        """
        try:
            # Check if VAD instance is available
            if self._vad is None:
                logger.warning("[WebRTC-VAD] VAD instance not available, falling back to fail-safe mode")
                return True  # Fail-safe: assume speech to avoid cutting real input

            data_len = len(audio_data)
            if data_len == 0:
                return False

            # Align length to 16-bit (2 bytes)
            aligned_len = (data_len // 2) * 2
            if aligned_len == 0:
                return False
            pcm = audio_data[:aligned_len]

            # Frame 20ms @ 16kHz
            sample_rate = 16000
            frame_bytes = int(0.02 * sample_rate) * 2  # 320 samples * 2 bytes = 640

            self._debug_counter += 1
            current_time = time.time()

            # --- Calculate energy for logging and fallback ---
            pcm_array = np.frombuffer(pcm, dtype=np.int16)
            energy = np.mean(np.abs(pcm_array))
            
            # Iterate through consecutive 20ms frames using WebRTC VAD
            total_frames = 0
            speech_frames = 0

            # If the frame is not enough 20ms, use energy-based fallback
            if len(pcm) < frame_bytes:
                # Short audio: use energy threshold only
                if energy > self.energy_threshold:
                    self.last_speech_time = current_time
                    return True
                total_frames = 0
            else:
                # Only use full frames; any remainder is discarded (next stream will compensate)
                usable_len = (len(pcm) // frame_bytes) * frame_bytes
                view = memoryview(pcm)[:usable_len]
                for off in range(0, usable_len, frame_bytes):
                    frame = view[off : off + frame_bytes]
                    # WebRTC VAD requires 16-bit little-endian PCM @ 8/16/32k; we use 16k
                    is_sp = self._vad.is_speech(frame.tobytes(), sample_rate)
                    total_frames += 1
                    if is_sp:
                        speech_frames += 1

            # Calculate speech ratio
            speech_ratio = speech_frames / max(total_frames, 1)
            
            # CRITICAL: Must meet BOTH conditions to prevent hallucinations
            # 1. WebRTC VAD detects speech in sufficient frames
            # 2. Audio energy is above threshold (not just noise)
            has_sufficient_speech = (
                total_frames > 0 and 
                speech_ratio >= self.min_speech_ratio and
                energy > self.energy_threshold
            )
            
            # Always log VAD decision for debugging Whisper hallucinations
            if self._debug_counter % 10 == 0:
                logger.info(
                    f"[VAD] Check: frames={speech_frames}/{total_frames} "
                    f"({speech_ratio:.1%}), energy={energy:.1f} (threshold={self.energy_threshold}), "
                    f"decision={'SPEECH' if has_sufficient_speech else 'SILENCE'}"
                )
            
            if has_sufficient_speech:
                self.last_speech_time = current_time
                return True

            # No sufficient speech in this batch - check hangover
            if self.last_speech_time > 0.0:
                silence_ms = (current_time - self.last_speech_time) * 1000.0
                in_tolerance = silence_ms < float(self.silence_duration_ms)
                
                # Log silence detection periodically
                if self._debug_counter % 100 == 0:
                    if in_tolerance:
                        logger.debug(
                            f"[VAD] Hangover active: silence={silence_ms:.0f}ms/{self.silence_duration_ms}ms, "
                            f"energy={energy:.1f}"
                        )
                    else:
                        logger.info(
                            f"[VAD] SILENCE detected: ratio={speech_ratio:.1%}, "
                            f"energy={energy:.1f} (threshold={self.energy_threshold})"
                        )
                return in_tolerance

            # Never detected speech and currently silent
            if self._debug_counter % 100 == 0:
                logger.debug(f"[VAD] No speech history, energy={energy:.1f}")
            return False

        except Exception as e:
            logger.error(f"[WebRTC-VAD] Error during speech detection: {e}")
            # Maintain old behavior: fail-open to avoid cutting off real speech
            return True