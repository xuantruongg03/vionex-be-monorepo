from dataclasses import dataclass, field
import time
import numpy as np
import logging
import webrtcvad

logger = logging.getLogger(__name__)

@dataclass
class VoiceActivityDetector:
    """
    Optimized energy-based voice activity detection for real-time translation.
    
    Features:
    - Lower energy threshold for better sensitivity
    - Immediate speech detection (no warmup period)
    - Configurable silence tolerance
    """
    # energy_threshold: float = 25.0  # Lowered for better sensitivity to quiet speech
    silence_duration_ms: int = 1500  # Reduced silence tolerance for faster response
    vad_aggressiveness: int = 2  # WebRTC VAD aggressiveness level (0-3)
    last_speech_time: float = field(default=0.0)
    _debug_counter: int = field(default=0, init=False)
    _vad: object = field(default=None, init=False)  # WebRTC VAD instance
    
    def __post_init__(self):
        """Initialize WebRTC VAD instance once during object creation."""
        try:
            self._vad = webrtcvad.Vad(self.vad_aggressiveness)
            logger.info(f"[VAD] WebRTC VAD initialized with aggressiveness level {self.vad_aggressiveness}")
        except Exception as e:
            logger.error(f"[VAD] Failed to initialize WebRTC VAD: {e}")
            self._vad = None

    # def detect_speech(self, audio_data: bytes) -> bool:
    #     """
    #     Detect if audio contains speech based on energy level.
        
    #     Optimized for real-time translation:
    #     - Immediate detection without warmup period
    #     - Lower threshold for better sensitivity
    #     - Shorter silence tolerance for responsiveness
        
    #     Args:
    #         audio_data: Raw PCM audio data (16kHz mono)
            
    #     Returns:
    #         bool: True if speech detected, False for silence/background noise
    #     """
    #     try:
    #         # Validate input data
    #         data_len = len(audio_data)
    #         if data_len == 0:
    #             return False
            
    #         # Ensure data is aligned for int16 processing
    #         aligned_len = (data_len // 2) * 2
    #         if aligned_len == 0:
    #             return False
                
    #         aligned_data = audio_data[:aligned_len]
    #         audio_array = np.frombuffer(aligned_data, dtype=np.int16)
            
    #         # Calculate RMS energy for better speech detection
    #         rms_energy = np.sqrt(np.mean(audio_array.astype(np.float32) ** 2))
    #         current_time = time.time()
    #         self._debug_counter += 1

    #         # Debug logging every 100 samples
    #         if self._debug_counter % 100 == 0:
    #             logger.debug(f"[VAD] RMS energy={rms_energy:.2f}, threshold={self.energy_threshold}, speech_detected={rms_energy > self.energy_threshold}")

    #         # Immediate speech detection - no warmup period required
    #         if rms_energy > self.energy_threshold:
    #             self.last_speech_time = current_time
    #             if self._debug_counter % 50 == 0:
    #                 logger.info(f"[VAD] Speech detected! RMS energy={rms_energy:.2f}")
    #             return True

    #         # Check if we're still within silence tolerance after last speech
    #         if self.last_speech_time > 0:  # Only check if we've detected speech before
    #             silence_duration = (current_time - self.last_speech_time) * 1000  # in ms
    #             is_in_tolerance = silence_duration < self.silence_duration_ms
                
    #             if self._debug_counter % 200 == 0 and is_in_tolerance:
    #                 logger.debug(f"[VAD] Silence tolerance: {silence_duration:.0f}ms / {self.silence_duration_ms}ms")
                    
    #             return is_in_tolerance
            
    #         # No previous speech detected and current audio is silent
    #         return False

    #     except Exception as e:
    #         logger.error(f"[VAD] Error during speech detection: {e}")
    #         return True  # Fail-safe: assume speech to avoid cutting real input

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

            # Iterate through consecutive 20ms frames
            total_frames = 0
            speech_frames = 0

            # If the frame is not enough 20ms, process according to the hangover below
            if len(pcm) < frame_bytes:
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

            # Decide based on frame-level
            if speech_frames > 0:
                # At least 1 speech frame → consider speaking
                self.last_speech_time = current_time
                # Occasionally log for easier tracking
                if self._debug_counter % 50 == 0:
                    logger.info(f"[WebRTC-VAD] Speech detected: {speech_frames}/{max(total_frames,1)} frames")
                return True

            # No speech frames in this batch:
            # Keep hangover if still within allowed silence
            if self.last_speech_time > 0.0:
                silence_ms = (current_time - self.last_speech_time) * 1000.0
                in_tolerance = silence_ms < float(self.silence_duration_ms)
                if self._debug_counter % 200 == 0 and in_tolerance:
                    logger.debug(f"[WebRTC-VAD] Silence tolerance: {silence_ms:.0f}ms / {self.silence_duration_ms}ms")
                return in_tolerance

            # Never detected speech and currently silent
            return False

        except Exception as e:
            logger.error(f"[WebRTC-VAD] Error during speech detection: {e}")
            # Maintain old behavior: fail-open to avoid cutting off real speech
            return True