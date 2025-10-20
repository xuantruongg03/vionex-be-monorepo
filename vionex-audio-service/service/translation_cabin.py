import asyncio
import io
import logging
import os
import queue
import threading
import time
import wave
from collections import deque
from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, Optional, Any, TYPE_CHECKING, List

from service.pipline_processor.VAD import VoiceActivityDetector
from core.config import SFU_SERVICE_HOST
from service.utils.audio_logger import AudioLogger

if TYPE_CHECKING:
    from service.pipline_processor.translation_pipeline import TranslationPipeline

from .port_manager import port_manager
from .socket_pool import get_shared_socket_manager
from .codec_utils import opus_codec_manager, AudioProcessingUtils, RTPUtils

logger = logging.getLogger(__name__)

# ============================================================================
# FIX: PLAYBACK QUEUE - Solving gaps between audio chunks
# ============================================================================
@dataclass
class AudioChunk:
    """
    Represents a processed audio chunk ready for playback
    """
    data: bytes              # Audio data (WAV or PCM)
    duration: float          # Audio duration (seconds)
    timestamp: float         # Creation timestamp
    chunk_id: int           # ID for tracking

@dataclass
class ContextChunk:
    """
    Represents an audio chunk with context for overlap detection.
    Used in Context Window approach (Option 2).
    """
    audio_data: bytes        # PCM16 mono 16kHz audio data
    timestamp: float         # Creation timestamp
    chunk_id: int           # Sequential chunk ID
    duration: float         # Duration in seconds
    
    def __repr__(self):
        return f"ContextChunk(id={self.chunk_id}, duration={self.duration:.2f}s, size={len(self.audio_data)} bytes)"
    
@dataclass
class PlaybackQueue:
    """
    Queue buffer to ensure continuous audio playback without gaps
    
    Logic:
    1. Processed chunks are enqueued immediately
    2. Wait for BUFFER_DURATION (2s) before starting playback
    3. Play with stable pacing (paced sending)
    4. If queue is empty → play silence to maintain stream
    """
    
    BUFFER_DURATION: float = 2.0    # Buffer 2s before starting playback
    MIN_QUEUE_SIZE: int = 2         # Minimum 2 chunks in queue
    
    def __post_init__(self):
        self._queue: queue.Queue = queue.Queue(maxsize=32)
        self._buffering: bool = True
        self._buffer_start_time: Optional[float] = None
        self._total_enqueued: int = 0
        self._total_dequeued: int = 0
        self._playback_started: bool = False
        
    def enqueue(self, chunk: AudioChunk) -> bool:
        """
        Add chunk to queue
        Returns: True if successful
        """
        try:
            if self._buffer_start_time is None:
                self._buffer_start_time = time.time()
                logger.info(f"[PLAYBACK-QUEUE] Buffering started, need {self.BUFFER_DURATION}s")
            
            self._queue.put_nowait(chunk)
            self._total_enqueued += 1
            
            # Check if buffer is ready to start playback
            if self._buffering:
                buffered_time = time.time() - self._buffer_start_time
                queue_size = self._queue.qsize()
                
                if buffered_time >= self.BUFFER_DURATION or queue_size >= self.MIN_QUEUE_SIZE:
                    self._buffering = False
                    self._playback_started = True
                    logger.info(f"[PLAYBACK-QUEUE] Buffer ready! Queue size: {queue_size}, buffered: {buffered_time:.2f}s")
            
            return True
            
        except queue.Full:
            logger.warning(f"[PLAYBACK-QUEUE] Queue full, dropping oldest chunk")
            try:
                # Drop oldest chunk
                self._queue.get_nowait()
                self._queue.put_nowait(chunk)
                return True
            except Exception as e:
                logger.error(f"[PLAYBACK-QUEUE] Error handling full queue: {e}")
                return False
                
    def dequeue(self, timeout: float = 0.1) -> Optional[AudioChunk]:
        """
        Get chunk from queue for playback
        Returns: AudioChunk if ready, None if buffering or queue is empty
        """
        try:
            # If buffering, not ready to play
            if self._buffering:
                return None
            
            # Get chunk from queue
            chunk = self._queue.get(timeout=timeout)
            self._total_dequeued += 1
            
            return chunk
            
        except queue.Empty:
            # Queue is empty - need to handle to avoid gaps
            if self._playback_started:
                logger.warning(f"[PLAYBACK-QUEUE] Queue empty during playback! Enqueued: {self._total_enqueued}, Dequeued: {self._total_dequeued}")
            return None
            
    def is_ready(self) -> bool:
        """Check if queue is ready to start playback"""
        return not self._buffering and self._playback_started
        
    def get_stats(self) -> dict:
        """Get queue statistics"""
        return {
            "queue_size": self._queue.qsize(),
            "buffering": self._buffering,
            "playback_started": self._playback_started,
            "total_enqueued": self._total_enqueued,
            "total_dequeued": self._total_dequeued,
            "buffer_duration": self.BUFFER_DURATION,
        }
        
    def reset(self):
        """Reset queue to initial state"""
        while not self._queue.empty():
            try:
                self._queue.get_nowait()
            except queue.Empty:
                break
        
        self._buffering = True
        self._buffer_start_time = None
        self._total_enqueued = 0
        self._total_dequeued = 0
        self._playback_started = False
        logger.info("[PLAYBACK-QUEUE] 🔄 Queue reset")

class CabinStatus(Enum):
    """
    Translation cabin operational status enumeration
    
    States:
    - IDLE: Cabin created but not actively processing audio
    - LISTENING: Actively receiving RTP packets from SFU
    - TRANSLATING: Processing audio through STT → Translation → TTS pipeline
    - ERROR: Cabin encountered error and requires restart
    """
    IDLE = "idle"
    LISTENING = "listening"  
    TRANSLATING = "translating"
    ERROR = "error"

@dataclass
class HybridChunkBuffer:
    """
    Hybrid chunk buffer:
    - Startup phase: needs at least 0.5s audio before outputting first chunk
    - After that: 2.0s window, 1.0s step (0.3s overlap)
    - All calculations based on buffer length, not clock time
    """

    init_buffer: float = 0.5       # First 0.5s to get context
    window_duration: float = 1.5   # Each chunk is 1.5s long
    # window_duration: float = 2.0   # Each chunk is 2.0s long
    step_duration: float = 0.75     # 0.75s overlap
    # step_duration: float = 1.0     # 1.0s overlap
    sample_rate: int = 16000       # 16kHz mono PCM16

    def __post_init__(self):
        self._buffer: bytearray = bytearray()
        self._next_start_bytes: int = 0
        self._bytes_per_sample: int = 2
        self._started: bool = False

        self._window_bytes = int(self.window_duration * self.sample_rate * self._bytes_per_sample)
        self._step_bytes = int(self.step_duration * self.sample_rate * self._bytes_per_sample)
        self._init_bytes = int(self.init_buffer * self.sample_rate * self._bytes_per_sample)

    def add_audio_chunk(self, audio_data: bytes) -> Optional[bytes]:
        """Add PCM to buffer, return a window when ready."""
        if not audio_data:
            return None

        self._buffer.extend(audio_data)

        # Not enough data yet, don't output
        if not self._started:
            if len(self._buffer) >= self._init_bytes:
                self._started = True
            else:
                return None

        # After start: check if enough data for 1 window
        if (len(self._buffer) - self._next_start_bytes) >= self._window_bytes:
            start = self._next_start_bytes
            end = start + self._window_bytes
            window = bytes(self._buffer[start:end])

            # Slide buffer: advance step_bytes (default 1s)
            self._next_start_bytes += self._step_bytes

            # Periodic buffer cleanup: only keep (window_duration + some buffer)
            # to ensure overlap works correctly
            keep_bytes = self._window_bytes + self._step_bytes  # window + 1 step buffer
            if self._next_start_bytes > keep_bytes:
                # Trim fully processed portion
                trim_bytes = self._next_start_bytes - keep_bytes
                self._buffer = bytearray(self._buffer[trim_bytes:])
                self._next_start_bytes = keep_bytes

            return window

        return None

    def get_processing_stats(self) -> dict:
        total_dur = len(self._buffer) / (self.sample_rate * self._bytes_per_sample)
        pending_dur = (len(self._buffer) - self._next_start_bytes) / (self.sample_rate * self._bytes_per_sample)
        return {
            "buffer_duration": round(total_dur, 3),
            "pending_duration": round(pending_dur, 3),
            "init_buffer": self.init_buffer,
            "window_size": self.window_duration,
            "step_size": self.step_duration,
            "overlap": self.window_duration - self.step_duration,
            "started": self._started,
        }

    def clear(self):
        self._buffer.clear()
        self._next_start_bytes = 0

class AudioRecorder:
    """
    Record incoming audio to WAV files for debugging
    Uses centralized AudioLogger utility for consistent audio logging
    Supports both input (before processing) and output (after processing) recording
    """
    def __init__(self, cabin_id: str, save_dir: str = "debug_audio"):
        self.cabin_id = cabin_id
        self.save_dir = save_dir
        
        # Use AudioLogger for input and output recording
        self.input_logger = AudioLogger(
            base_dir=os.path.join(save_dir, f"{cabin_id}_input"),
            sample_rate=16000,
            channels=1
        )
        self.output_logger = AudioLogger(
            base_dir=os.path.join(save_dir, f"{cabin_id}_output"),
            sample_rate=16000,
            channels=1
        )
        
        self.input_packet_count = 0
        self.output_packet_count = 0
        
        logger.info(f"[AUDIO-RECORDER] Started recording for cabin {cabin_id}")
    
    def write_audio(self, pcm_16k_mono: bytes):
        """Write input PCM audio to WAV file (BEFORE processing)"""
        try:
            self.input_packet_count += 1
            metadata = {
                "cabin_id": self.cabin_id,
                "packet_count": self.input_packet_count,
                "stage": "input",
                "description": "Audio before translation processing"
            }
            self.input_logger.save_audio(pcm_16k_mono, prefix="input", metadata=metadata)
        except Exception as e:
            logger.error(f"[AUDIO-RECORDER] Error writing input audio: {e}")
    
    def write_output_audio(self, audio_data: bytes):
        """Write output audio to WAV file (AFTER processing - translated audio)"""
        try:
            # Check if input is already WAV format
            if audio_data.startswith(b"RIFF"):
                # Extract PCM from WAV
                with wave.open(io.BytesIO(audio_data), 'rb') as wav_file:
                    pcm_data = wav_file.readframes(wav_file.getnframes())
                    sample_rate = wav_file.getframerate()
                    channels = wav_file.getnchannels()
                    
                    # Convert to mono 16kHz if needed
                    if channels == 2:
                        # Stereo to mono
                        import numpy as np
                        audio_array = np.frombuffer(pcm_data, dtype=np.int16)
                        audio_array = audio_array.reshape(-1, 2)
                        pcm_data = np.mean(audio_array, axis=1).astype(np.int16).tobytes()
                    
                    # Resample if needed (48kHz -> 16kHz or other)
                    if sample_rate != 16000:
                        import numpy as np
                        from scipy.signal import resample_poly
                        audio_array = np.frombuffer(pcm_data, dtype=np.int16)
                        resampled = resample_poly(audio_array, 16000, sample_rate)
                        pcm_data = resampled.astype(np.int16).tobytes()
            else:
                # Already PCM, assume 16kHz mono
                pcm_data = audio_data
            
            # Save using AudioLogger
            self.output_packet_count += 1
            metadata = {
                "cabin_id": self.cabin_id,
                "packet_count": self.output_packet_count,
                "stage": "output",
                "description": "Translated audio output"
            }
            self.output_logger.save_audio(pcm_data, prefix="output", metadata=metadata)
                
        except Exception as e:
            logger.error(f"[AUDIO-RECORDER] Error writing output audio: {e}")
    
    def close(self):
        """Close all audio loggers"""
        self.input_logger.close()
        self.output_logger.close()
        logger.info(f"[AUDIO-RECORDER] Closed recording for cabin {self.cabin_id}")

@dataclass        
class TranslationCabin:
   
    cabin_id: str
    source_language: str
    target_language: str
    receive_port: int = 0 
    send_port: int = 0   
    status: CabinStatus = CabinStatus.IDLE
    room_id: Optional[str] = None
    user_id: Optional[str] = None
    running: bool = False
    
    # Audio processing pipeline components
    audio_buffer: HybridChunkBuffer = field(default_factory=HybridChunkBuffer)
    vad: VoiceActivityDetector = field(default_factory=VoiceActivityDetector)
    
    # Cached translation pipeline to avoid recreation overhead
    _cached_pipeline: Optional['TranslationPipeline'] = None
    
    # Processing state
    processing_lock: threading.Lock = field(default_factory=threading.Lock)
    
    # Audio timing and statistics
    first_packet_time: Optional[float] = None
    last_packet_time: Optional[float] = None
    total_audio_duration: float = 0.0
    
    # SFU integration parameters
    send_port: Optional[int] = None
    sfu_send_port: Optional[int] = None  # Actual SFU destination port
    ssrc: Optional[int] = None           # RTP SSRC identifier
    
    # RTP packet sequencing (for outbound streams)
    _rtp_seq_num: int = 0
    _rtp_timestamp: int = 0
    _rtp_ssrc: Optional[int] = None

    # Processing infra
    chunk_queue: queue.Queue = field(default_factory=lambda: queue.Queue(maxsize=64))
    processor_thread: Optional[threading.Thread] = None
    
    # FIX: Playback queue for smooth audio output
    playback_queue: PlaybackQueue = field(default_factory=PlaybackQueue)
    playback_thread: Optional[threading.Thread] = None
    
    # Audio recorder for debugging
    audio_recorder: Optional[AudioRecorder] = None
    _event_loop: Optional[asyncio.AbstractEventLoop] = None
    
    # CONTEXT WINDOW (Option 2): Store recent chunks for concatenation
    context_buffer: deque = field(default_factory=lambda: deque(maxlen=3))  # Keep last 3 chunks
    context_chunk_counter: int = 0  # Counter for chunk IDs
    last_stt_result: str = ""  # Last STT result for duplicate detection
    last_translated_text: str = ""  # Last translated text to track what was already TTS'd


class TranslationCabinManager:
    """
    Translation Cabin Manager
    
    Centralized manager for all translation cabins using shared socket architecture.
    Handles cabin lifecycle, audio routing, and resource management.
    
    Architecture:
    - Single shared socket for all cabins (via SharedSocketManager)
    - SSRC-based packet routing to individual cabins
    - Automatic resource cleanup and port management
    - Thread-safe cabin operations
    """
    
    def __init__(self):
        """Initialize cabin manager with shared socket infrastructure"""
        self.cabins: Dict[str, TranslationCabin] = {}
        self._lock = threading.Lock()
        self.socket_manager = get_shared_socket_manager()
        logger.info("[CABIN-MANAGER] Initialized")

    def get_or_create_pipeline(self, cabin: TranslationCabin) -> 'TranslationPipeline':
        """
        Get cached translation pipeline or create new one
        
        Avoids recreation overhead for each chunk by caching pipeline per cabin.
        Pipeline is invalidated if language configuration changes.
        """
        try:
            # Check if cached pipeline exists and is valid
            if cabin._cached_pipeline is not None:
                # Verify language configuration hasn't changed
                if (cabin._cached_pipeline.source_language == cabin.source_language and 
                    cabin._cached_pipeline.target_language == cabin.target_language):
                    return cabin._cached_pipeline
                else:
                    # Language changed, cleanup old pipeline
                    logger.info(f"[PIPELINE-CACHE] Language changed, recreating pipeline for {cabin.cabin_id}")
                    try:
                        cabin._cached_pipeline.cleanup()
                    except:
                        pass
                    cabin._cached_pipeline = None
            
            # Create new pipeline
            from service.pipline_processor.translation_pipeline import TranslationPipeline
            cabin._cached_pipeline = TranslationPipeline(
                source_language=cabin.source_language,
                target_language=cabin.target_language,
                user_id=cabin.user_id,
                room_id=cabin.room_id
            )
            
            logger.info(f"[PIPELINE-CACHE] Created new pipeline for {cabin.cabin_id}: {cabin.source_language} → {cabin.target_language}")
            return cabin._cached_pipeline
            
        except Exception as e:
            logger.error(f"[PIPELINE-CACHE] Error creating pipeline for {cabin.cabin_id}: {e}")
            raise

    def create_cabin(
        self, 
        room_id: str, 
        user_id: str,
        source_language: str = "vi",
        target_language: str = "en",
        sfu_send_port: Optional[int] = None
    ) -> Optional[Dict[str, Any]]:
        """
        Create new translation cabin with shared socket routing
        
        Process:
        1. Generate unique cabin ID from parameters
        2. Check for existing cabin (reuse if found)
        3. Create cabin instance with default configuration
        4. Register with SharedSocketManager for RTP routing
        5. Start audio processing thread
        
        Args:
            room_id: Room identifier
            user_id: Target user for translation
            source_language: Source audio language (default: "vi")
            target_language: Target translation language (default: "en")
            sfu_send_port: SFU destination port for outbound RTP
            
        Returns:
            Dict with cabin info or None if creation failed
        """
        try:
            with self._lock:
                # Step 1: Generate deterministic cabin ID
                cabin_id = f"{room_id}_{user_id}_{source_language}_{target_language}"
                
                logger.info(f"[CABIN-MANAGER] 🏗️ Creating cabin: {cabin_id}")
                logger.info(f"[CABIN-MANAGER]    Room: {room_id}, User: {user_id}")
                logger.info(f"[CABIN-MANAGER]    Languages: {source_language} → {target_language}")
                
                # Step 2: Check for existing cabin (reuse pattern)
                if cabin_id in self.cabins:
                    logger.info(f"[CABIN-MANAGER] ♻️ Reusing existing cabin: {cabin_id}")
                    return self.get_cabin_info(cabin_id)
                
                # Step 3: Create cabin instance with default state
                cabin = TranslationCabin(
                    cabin_id=cabin_id,
                    source_language=source_language,
                    target_language=target_language,
                    room_id=room_id,
                    user_id=user_id
                )
                
                # Initialize audio recorder for debugging
                cabin.audio_recorder = AudioRecorder(cabin_id)
                
                # Step 4: Setup SSRC and register with SharedSocketManager
                # Generate unique SSRC from cabin ID for RTP identification
                cabin_ssrc = hash(cabin_id) & 0xFFFFFFFF
                cabin.ssrc = cabin_ssrc

                # Define RTP packet processing callback for this cabin
                def audio_callback(rtp_data: bytes):
                    """Route RTP packets from shared socket to cabin processor"""
                    self._process_rtp_packet(cabin, rtp_data)
                
                # Register cabin with SharedSocketManager for SSRC-based routing
                ports = self.socket_manager.register_cabin_for_routing(
                    cabin_id, cabin_ssrc, audio_callback
                )
                if not ports:
                    logger.error(f"[CABIN-MANAGER] Failed to register cabin {cabin_id} for routing")
                    return None
                
                # Step 5: Configure port allocation and SFU integration
                receive_port, send_port = ports
                cabin.receive_port = receive_port
                cabin.send_port = send_port
                cabin.sfu_send_port = sfu_send_port  # Real SFU destination port
                
                # Step 6: Start cabin processing
                cabin.running = True
                cabin.status = CabinStatus.LISTENING
                
                # Step 8: Register cabin in manager's tracking registry
                self.cabins[cabin_id] = cabin

                logger.info(f"[CABIN-MANAGER] Cabin created successfully!")
                logger.info(f"[CABIN-MANAGER]    Cabin ID: {cabin_id}")
                logger.info(f"[CABIN-MANAGER]    SSRC: {cabin_ssrc}")
                logger.info(f"[CABIN-MANAGER]    RX Port: {receive_port}, TX Port: {send_port}")
                logger.info(f"[CABIN-MANAGER]    Status: {cabin.status.value}")

                # Start single processor thread for this cabin
                self._start_processor_thread(cabin)
                
                # FIX: Start playback thread for smooth audio output
                self._start_playback_thread(cabin)
                logger.info(f"[CABIN-MANAGER] Playback thread started for {cabin_id}")
                
                # Step 9: Return cabin configuration for SFU integration
                return {
                    "cabin_id": cabin_id,
                    "rtp_port": receive_port,
                    "send_port": send_port,
                    "ssrc": cabin_ssrc,
                    "source_language": source_language,
                    "target_language": target_language,
                    "status": cabin.status.value
                }
                
        except Exception as e:
            logger.error(f"[CABIN-MANAGER] Failed to create cabin for room {room_id}, user {user_id}: {e}")
            import traceback
            logger.error(f"[CABIN-MANAGER] Traceback: {traceback.format_exc()}")
            return None

    def _process_rtp_packet(self, cabin: TranslationCabin, rtp_data: bytes):
        """
        Process RTP packet with CONTEXT WINDOW approach (Option 2)
        Flow: RTP → decode → downsample → store in context buffer → enqueue for processing
        """
        try:
            if not cabin.running:
                return
            
            # Parse RTP header using utility
            rtp_info = RTPUtils.parse_rtp_header(rtp_data)
            if not rtp_info:
                logger.debug(f"[AUDIO] Invalid RTP packet")
                return
            
            # Validate payload type for Opus
            if rtp_info['payload_type'] not in [100, 111]:
                logger.debug(f"[AUDIO] Unexpected payload type: {rtp_info['payload_type']}")
                return
            
            opus_payload = rtp_info['payload']
            if not opus_payload:
                return

            # Decode Opus → PCM 48kHz stereo using codec utils
            pcm_48k_stereo = opus_codec_manager.decode_opus(cabin.cabin_id, opus_payload)
            if not pcm_48k_stereo:
                if not hasattr(cabin, '_decode_fail_count'):
                    cabin._decode_fail_count = 0
                cabin._decode_fail_count += 1
                if cabin._decode_fail_count == 1 or cabin._decode_fail_count % 100 == 0:
                    logger.error(f"[AUDIO-CALLBACK] Opus decode failed (count: {cabin._decode_fail_count})")
                return

            # Downsample from 48kHz stereo → 16kHz mono for translation processing
            pcm_16k_mono = AudioProcessingUtils.downsample_48k_to_16k(pcm_48k_stereo)
            if not pcm_16k_mono:
                logger.error(f"[AUDIO-CALLBACK] Downsample failed")
                return
            # Cleanup intermediate data immediately
            del pcm_48k_stereo

            # CONTEXT WINDOW: Add to sliding buffer and create ContextChunk when ready
            complete_chunk = cabin.audio_buffer.add_audio_chunk(pcm_16k_mono)
            if complete_chunk:
                # Calculate chunk duration
                chunk_duration = len(complete_chunk) / (16000 * 2)  # 16kHz, 2 bytes per sample
                
                # Create ContextChunk object
                cabin.context_chunk_counter += 1
                context_chunk = ContextChunk(
                    audio_data=complete_chunk,
                    timestamp=time.time(),
                    chunk_id=cabin.context_chunk_counter,
                    duration=chunk_duration
                )
                
                # Add to context buffer (auto-limits to last 3 chunks)
                cabin.context_buffer.append(context_chunk)
                
                logger.info(
                    f"[CONTEXT-BUFFER] Added chunk {context_chunk.chunk_id}, "
                    f"buffer size: {len(cabin.context_buffer)}, "
                    f"total duration: {sum(c.duration for c in cabin.context_buffer):.2f}s"
                )
                
                # SAVE INDIVIDUAL CHUNK for debugging (before concatenation)
                if cabin.audio_recorder:
                    cabin.audio_recorder.write_audio(complete_chunk)
                
                # Enqueue for processing only if we have enough context (at least 2 chunks)
                if len(cabin.context_buffer) >= 2:
                    try:
                        # Create processing task with current context buffer state
                        processing_task = {
                            'context_chunks': list(cabin.context_buffer),  # Copy current buffer
                            'latest_chunk_id': context_chunk.chunk_id
                        }
                        cabin.chunk_queue.put_nowait(processing_task)
                    except queue.Full:
                        # Drop oldest by getting once and pushing again
                        try:
                            _ = cabin.chunk_queue.get_nowait()
                        except Exception:
                            pass
                        try:
                            cabin.chunk_queue.put_nowait(processing_task)
                        except Exception:
                            pass
                else:
                    logger.debug(
                        f"[CONTEXT-BUFFER] Waiting for more chunks "
                        f"(have {len(cabin.context_buffer)}, need 2)"
                    )
            
        except Exception as e:
            logger.error(f"[AUDIO-CALLBACK] Error processing RTP packet for {cabin.cabin_id}: {e}")

    def _start_processor_thread(self, cabin: TranslationCabin):
        """Start a single background thread with its own event loop to process chunks sequentially."""
        def worker():
            try:
                loop = asyncio.new_event_loop()
                cabin._event_loop = loop
                asyncio.set_event_loop(loop)
                while cabin.running:
                    try:
                        # Block for a short time to allow batching
                        chunk = cabin.chunk_queue.get(timeout=0.1)
                    except queue.Empty:
                        continue
                    try:
                        loop.run_until_complete(self._process_chunk_realtime(cabin, chunk))
                    except Exception as e:
                        logger.error(f"[WORKER] Error processing chunk: {e}")
                # Drain remaining items gracefully on stop
                while True:
                    try:
                        chunk = cabin.chunk_queue.get_nowait()
                    except queue.Empty:
                        break
                    try:
                        loop.run_until_complete(self._process_chunk_realtime(cabin, chunk))
                    except Exception:
                        break
            finally:
                try:
                    if cabin._event_loop:
                        cabin._event_loop.stop()
                        cabin._event_loop.close()
                        cabin._event_loop = None
                except Exception:
                    pass

        if cabin.processor_thread and cabin.processor_thread.is_alive():
            return
        cabin.processor_thread = threading.Thread(target=worker, name=f"cabin-worker-{cabin.cabin_id}", daemon=True)
        cabin.processor_thread.start()

    # ============================================================================
    # FIX: PLAYBACK THREAD - Play audio from PlaybackQueue with stable timing
    # ============================================================================
    def _start_playback_thread(self, cabin: TranslationCabin):
        """
        Start playback thread to send audio from PlaybackQueue to SFU
        
        Logic:
        1. Wait for queue to be ready (buffered 2s)
        2. Dequeue audio chunks
        3. Send to SFU with paced timing (20ms packets)
        4. If queue is empty → send silence to maintain stream
        """
        def playback_worker():
            logger.info(f"[PLAYBACK-THREAD] Started for cabin {cabin.cabin_id}")
            
            try:
                while cabin.running:
                    try:
                        # Check if queue is ready to start playback
                        if not cabin.playback_queue.is_ready():
                            time.sleep(0.1)
                            continue
                        
                        # Dequeue audio chunk
                        audio_chunk = cabin.playback_queue.dequeue(timeout=0.5)
                        
                        if audio_chunk is None:
                            # Queue empty → send silence to maintain stream
                            logger.warning(f"[PLAYBACK-THREAD] Queue empty, sending silence")
                            silence = self._generate_silence_audio(duration=0.5)
                            self._send_audio_sync(cabin, silence)
                            continue
                        
                        # Send audio chunk to SFU
                        logger.debug(
                            f"[PLAYBACK-THREAD] Sending chunk {audio_chunk.chunk_id}, "
                            f"duration: {audio_chunk.duration:.2f}s, "
                            f"queue size: {cabin.playback_queue._queue.qsize()}"
                        )
                        
                        # SAVE OUTPUT AUDIO before sending to SFU
                        if cabin.audio_recorder:
                            cabin.audio_recorder.write_output_audio(audio_chunk.data)
                        
                        self._send_audio_sync(cabin, audio_chunk.data)

                    except Exception as e:
                        logger.error(f"[PLAYBACK-THREAD] Error in playback loop: {e}")
                        time.sleep(0.1)
                        
            finally:
                logger.info(f"[PLAYBACK-THREAD] Stopped for cabin {cabin.cabin_id}")
        
        if cabin.playback_thread and cabin.playback_thread.is_alive():
            logger.warning(f"[PLAYBACK-THREAD] Already running for cabin {cabin.cabin_id}")
            return
            
        cabin.playback_thread = threading.Thread(
            target=playback_worker, 
            name=f"playback-{cabin.cabin_id}", 
            daemon=True
        )
        cabin.playback_thread.start()
        logger.info(f"[PLAYBACK-THREAD] Thread started for cabin {cabin.cabin_id}")

    def _send_audio_sync(self, cabin: TranslationCabin, audio_data: bytes):
        """
        FIX: Synchronous version of send audio to SFU
        Used by playback thread (not async)
        """
        try:
            success = self._send_rtp_chunks_to_sfu(cabin, audio_data)
            if not success:
                logger.error(f"[PLAYBACK-THREAD] Failed to send audio to SFU")
        except Exception as e:
            logger.error(f"[PLAYBACK-THREAD] Error sending audio: {e}")

    def _generate_silence_audio(self, duration: float = 0.5) -> bytes:
        """
        FIX: Generate silence audio for gap filling
        
        Args:
            duration: Duration in seconds (default 0.5s)
            
        Returns:
            WAV format silence audio
        """
        import numpy as np
        import io
        from scipy.io.wavfile import write as write_wav
        
        try:
            sample_rate = 16000  # 16kHz
            samples = int(sample_rate * duration)
            silence = np.zeros(samples, dtype=np.int16)
            
            # Convert to WAV
            buf = io.BytesIO()
            write_wav(buf, rate=sample_rate, data=silence)
            return buf.getvalue()
            
        except Exception as e:
            logger.error(f"[SILENCE] Error generating silence: {e}")
            return b''

    async def _process_chunk_realtime(self, cabin: TranslationCabin, processing_task: Dict[str, Any]):
        """
        CONTEXT WINDOW APPROACH (Option 2)
        
        Process audio with context from previous chunks:
        1. Concatenate 2-3 recent chunks to provide context
        2. Send concatenated audio to Whisper STT
        3. Extract only NEW text (not overlapping with previous result)
        4. Translate and synthesize only the new portion
        
        Args:
            cabin: Translation cabin instance
            processing_task: Dict containing:
                - context_chunks: List[ContextChunk] - recent audio chunks
                - latest_chunk_id: int - ID of the most recent chunk
                
        Flow:
            1. Concatenate context chunks (2-3 chunks = 3-4.5s audio)
            2. VAD check on concatenated audio
            3. STT on full context → get complete transcription
            4. Smart text extraction → only keep NEW words
            5. Translate NEW text only
            6. TTS → Enqueue to PlaybackQueue
        """
        start_time = time.time()
        
        try:
            context_chunks: List[ContextChunk] = processing_task.get('context_chunks', [])
            latest_chunk_id = processing_task.get('latest_chunk_id', 0)
            
            if not context_chunks:
                logger.warning(f"[CONTEXT-WINDOW] No context chunks provided")
                return
            
            # Step 1: Concatenate audio chunks to provide context
            concatenated_audio = b''.join([chunk.audio_data for chunk in context_chunks])
            total_duration = sum(chunk.duration for chunk in context_chunks)
            
            logger.info(
                f"[CONTEXT-WINDOW-{latest_chunk_id}] Processing with context: "
                f"{len(context_chunks)} chunks, total {total_duration:.2f}s"
            )
            
            # Step 2: VAD speech detection on concatenated audio
            has_speech = cabin.vad.detect_speech(concatenated_audio)
            
            if not has_speech:
                logger.debug(f"[CONTEXT-WINDOW-{latest_chunk_id}] No speech detected in context, skipping")
                return
            
            # Step 3: Speech detected → process through translation pipeline
            cabin.status = CabinStatus.TRANSLATING
            logger.info(f"[CONTEXT-WINDOW-{latest_chunk_id}] Speech detected, processing with context...")
            
            # Get cached pipeline to avoid recreation overhead
            pipeline = self.get_or_create_pipeline(cabin)
            
            # Step 4: Convert concatenated PCM to WAV
            wav_data = AudioProcessingUtils.pcm_to_wav_bytes(concatenated_audio)
            
            # Step 5: Process through pipeline WITH context
            # Pipeline will handle overlap detection internally via STT
            result = await pipeline.process_audio_with_context(
                wav_data,
                previous_text=cabin.last_stt_result  # Pass previous STT result for overlap detection
            )
            
            processing_time = time.time() - start_time
            
            # Step 6: Extract new text and enqueue translated audio
            if result['success']:
                # Update last STT result for next iteration
                if result.get('full_stt_text'):
                    cabin.last_stt_result = result['full_stt_text']
                
                # Get the full translated text
                full_translated_text = result.get('translated_text', '')
                
                if not full_translated_text or not full_translated_text.strip():
                    logger.info(
                        f"[CONTEXT-WINDOW-{latest_chunk_id}] No translation result, skipping"
                    )
                    cabin.status = CabinStatus.LISTENING
                    return
                
                logger.info(
                    f"[CONTEXT-WINDOW-{latest_chunk_id}] Full translated text: '{full_translated_text}'"
                )
                logger.info(
                    f"[CONTEXT-WINDOW-{latest_chunk_id}] Last translated text: '{cabin.last_translated_text}'"
                )
                
                # CRITICAL FIX: Extract ONLY the portion NOT YET TTS'd
                # Compare with last_translated_text to find new portion
                text_to_tts = self._extract_new_translated_text(
                    full_translated_text, 
                    cabin.last_translated_text
                )
                
                if not text_to_tts or not text_to_tts.strip():
                    logger.info(
                        f"[CONTEXT-WINDOW-{latest_chunk_id}] No new translated text "
                        f"(already TTS'd), skipping audio generation"
                    )
                    cabin.status = CabinStatus.LISTENING
                    return
                
                # Limit NEW text to prevent TTS issues (max 25 words per chunk)
                text_words = text_to_tts.split()
                if len(text_words) > 25:
                    text_to_tts = ' '.join(text_words[:25])
                    logger.warning(
                        f"[CONTEXT-WINDOW-{latest_chunk_id}] TTS text truncated from "
                        f"{len(text_words)} to 25 words"
                    )
                
                # TTS ONLY the new portion
                logger.info(
                    f"[CONTEXT-WINDOW-{latest_chunk_id}] TTS'ing new portion: '{text_to_tts[:50]}...'"
                )
                
                translated_audio = await pipeline.text_to_speech_only(text_to_tts)
                
                if not translated_audio:
                    logger.warning(f"[CONTEXT-WINDOW-{latest_chunk_id}] TTS failed for new text")
                    cabin.status = CabinStatus.LISTENING
                    return
                
                # Update last translated text
                cabin.last_translated_text = full_translated_text
                
                # Calculate audio duration
                audio_duration = self._calculate_audio_duration(translated_audio)
                
                # Create AudioChunk object
                audio_chunk_obj = AudioChunk(
                    data=translated_audio,
                    duration=audio_duration,
                    timestamp=time.time(),
                    chunk_id=latest_chunk_id
                )
                
                # Enqueue to playback queue
                success = cabin.playback_queue.enqueue(audio_chunk_obj)
                
                if success:
                    logger.info(
                        f"[CONTEXT-WINDOW-{latest_chunk_id}] Processed in {processing_time:.2f}s, "
                        f"new TTS text: '{text_to_tts[:50]}...', "
                        f"audio duration: {audio_duration:.2f}s, "
                        f"queue size: {cabin.playback_queue._queue.qsize()}"
                    )
                else:
                    logger.error(f"[CONTEXT-WINDOW-{latest_chunk_id}] Failed to enqueue to playback queue")
            else:
                error_msg = result.get('message', 'unknown')
                logger.warning(f"[CONTEXT-WINDOW-{latest_chunk_id}] Translation failed: {error_msg}")
            
            cabin.status = CabinStatus.LISTENING
            
        except Exception as e:
            processing_time = time.time() - start_time
            cabin.status = CabinStatus.ERROR
            logger.error(f"[CONTEXT-WINDOW-{latest_chunk_id}] Error processing in {processing_time:.2f}s: {e}")
            import traceback
            logger.error(f"[CONTEXT-WINDOW-{latest_chunk_id}] Traceback: {traceback.format_exc()}")
            
            # Reset status for next chunk
            cabin.status = CabinStatus.LISTENING

    def _calculate_audio_duration(self, audio_data: bytes) -> float:
        """
        FIX: Calculate audio duration from WAV or PCM data
        
        Returns: Duration in seconds
        """
        try:
            # Check if WAV format
            if audio_data.startswith(b"RIFF"):
                import wave
                import io
                
                with wave.open(io.BytesIO(audio_data), 'rb') as wav_file:
                    frames = wav_file.getnframes()
                    rate = wav_file.getframerate()
                    duration = frames / float(rate)
                    return duration
            else:
                # Assume PCM16 mono @ 16kHz
                duration = len(audio_data) / (16000 * 2)
                return duration
                
        except Exception as e:
            logger.error(f"[AUDIO-DURATION] Error calculating duration: {e}")
            # Fallback: estimate 2s
            return 2.0

    def _extract_new_translated_text(self, current_text: str, previous_text: str) -> str:
        """
        Extract ONLY the new portion from current_text that hasn't been TTS'd yet.
        
        Uses same multi-strategy approach as STT overlap detection.
        
        Args:
            current_text: Full translated text from current context window
            previous_text: Previously TTS'd translated text
            
        Returns:
            New portion of text to TTS, or empty string if no new text
        """
        if not current_text:
            return ""
        
        if not previous_text:
            # First translation, return all
            return current_text
        
        # Normalize text for comparison
        curr_norm = current_text.strip()
        prev_norm = previous_text.strip()
        
        if curr_norm == prev_norm:
            # Exact duplicate
            return ""
        
        # Strategy 1: Character-level exact prefix matching (most accurate)
        if curr_norm.startswith(prev_norm):
            new_text = curr_norm[len(prev_norm):].strip()
            if new_text:
                logger.debug(f"[TTS-OVERLAP] Character-level prefix match, new: '{new_text[:30]}...'")
                return new_text
        
        # Strategy 2: Find previous as substring (handles minor variations)
        prev_idx = curr_norm.find(prev_norm)
        if prev_idx != -1:
            new_text = curr_norm[prev_idx + len(prev_norm):].strip()
            if new_text:
                logger.debug(f"[TTS-OVERLAP] Substring match at {prev_idx}, new: '{new_text[:30]}...'")
                return new_text
        
        # Strategy 3: Word-level matching with threshold
        curr_words = curr_norm.split()
        prev_words = prev_norm.split()
        
        # Find longest common prefix in words
        common_prefix_len = 0
        for i, (cw, pw) in enumerate(zip(curr_words, prev_words)):
            if cw.lower() == pw.lower():
                common_prefix_len = i + 1
            else:
                break
        
        # If >50% words match as prefix, extract remaining
        if common_prefix_len > 0 and common_prefix_len >= len(prev_words) * 0.5:
            new_words = curr_words[common_prefix_len:]
            new_text = ' '.join(new_words).strip()
            if new_text:
                logger.debug(
                    f"[TTS-OVERLAP] Word-level match ({common_prefix_len}/{len(prev_words)} words), "
                    f"new: '{new_text[:30]}...'"
                )
                return new_text
        
        # Strategy 4: Fuzzy matching (last resort)
        try:
            from difflib import SequenceMatcher
            ratio = SequenceMatcher(None, prev_norm, curr_norm).ratio()
            
            logger.debug(f"[TTS-OVERLAP] Similarity ratio: {ratio:.2f}")
            
            # CRITICAL: Check for duplicate content (same meaning, different wording)
            if ratio > 0.6:  # 60% similarity → likely same content
                if ratio >= 0.8:
                    # Very high similarity → probably duplicate → SKIP
                    logger.warning(
                        f"[TTS-OVERLAP] HIGH similarity ({ratio:.2f}) detected - "
                        f"likely duplicate content, SKIPPING TTS. "
                        f"Prev: '{prev_norm[:50]}...', Curr: '{curr_norm[:50]}...'"
                    )
                    return ""  # Skip TTS for duplicate content
                elif ratio >= 0.7:
                    # High similarity → extract new portion if possible
                    matcher = SequenceMatcher(None, prev_norm, curr_norm)
                    match = matcher.find_longest_match(0, len(prev_norm), 0, len(curr_norm))
                    
                    if match.size > 0:
                        # Extract text after longest match
                        new_text = curr_norm[match.b + match.size:].strip()
                        if new_text:
                            logger.debug(
                                f"[TTS-OVERLAP] Fuzzy match (ratio={ratio:.2f}), new: '{new_text[:30]}...'"
                            )
                            return new_text
                    
                    # No clear new portion but high similarity → skip
                    logger.warning(
                        f"[TTS-OVERLAP] HIGH similarity ({ratio:.2f}) but no clear new text, "
                        f"SKIPPING to avoid duplicate. Prev: '{prev_norm[:50]}...', Curr: '{curr_norm[:50]}...'"
                    )
                    return ""
                else:
                    # Medium similarity (0.6-0.7) → might be variation of same content
                    # Check word overlap
                    prev_words_set = set(prev_norm.lower().split())
                    curr_words_set = set(curr_norm.lower().split())
                    common_words = prev_words_set & curr_words_set
                    word_overlap_ratio = len(common_words) / max(len(prev_words_set), len(curr_words_set))
                    
                    if word_overlap_ratio > 0.6:
                        logger.warning(
                            f"[TTS-OVERLAP] MEDIUM similarity ({ratio:.2f}) with high word overlap "
                            f"({word_overlap_ratio:.2f}) - likely same content rephrased, SKIPPING. "
                            f"Prev: '{prev_norm[:50]}...', Curr: '{curr_norm[:50]}...'"
                        )
                        return ""  # Skip duplicate content
        except Exception as e:
            logger.warning(f"[TTS-OVERLAP] Fuzzy matching failed: {e}")
        
        # Low similarity → treat as completely new text
        logger.info(
            f"[TTS-OVERLAP] LOW similarity detected, treating as new text. "
            f"Prev: '{prev_norm[:50]}...', Curr: '{curr_norm[:50]}...'"
        )
        return current_text


    def _send_rtp_chunks_to_sfu(self, cabin: TranslationCabin, audio_data: bytes) -> bool:
        """
        Send RTP packets in 20ms chunks for proper streaming.
        """
        import time
        from scipy.signal import resample_poly
        import numpy as np

        try:
            sfu_host = SFU_SERVICE_HOST  # Load from config instead of hardcoded
            sfu_port = cabin.send_port  # Use real SFU port if available
            
            # --- 0) Normalize input: WAV -> PCM16 mono + sample_rate ---
            # If WAV (starts with "RIFF"), extract PCM and get sample_rate
            src_sr = 16000
            if audio_data.startswith(b"RIFF"):
                # Use existing util to extract
                pcm_arr, sr = AudioProcessingUtils.extract_pcm_from_wav(audio_data)
                if sr == 0 or len(pcm_arr) == 0:
                    logger.error("[RTP-CHUNKS] Invalid WAV data")
                    return False
                src_sr = sr
                pcm16 = pcm_arr.astype(np.int16)
            else:
                # RAW PCM Assumes 16-Bit Mono
                pcm16 = np.frombuffer(audio_data, dtype=np.int16)
                src_sr = 16000 

            if src_sr != 48000:
                from scipy.signal import butter, sosfilt
                
                x = pcm16.astype(np.float32) / 32767.0
                
                # Anti-aliasing filter necessary
                if src_sr > 48000:
                    nyquist = src_sr / 2
                    cutoff = 48000 / 2 * 0.9  # 90% of target Nyquist
                    sos = butter(6, cutoff / nyquist, btype='low', output='sos')
                    x = sosfilt(sos, x)
                
                # Resample
                x_48k = resample_poly(x, 48000, src_sr, window=('kaiser', 8.0))
                
                # Normalize carefully
                max_val = np.max(np.abs(x_48k))
                if max_val > 1.0:
                    x_48k = x_48k / max_val
                
                pcm16 = (x_48k * 32767.0).astype(np.int16)
            else:
                pass

            if len(pcm16) == 0:
                return False

            # ---2) Just noise gate to remove Silent Samples ---
            # Instead of Multiple Filters can create Artifacts
            noise_threshold = 500  # Threshold for noise
            mask = np.abs(pcm16) > noise_threshold
            
            from scipy.ndimage import binary_dilation
            mask_expanded = binary_dilation(mask, iterations=480)  # ~10ms expansion @ 48kHz
            
            # Apply noise gate
            pcm16_clean = pcm16.copy()
            pcm16_clean[~mask_expanded] = 0
            
            pcm16 = pcm16_clean

            # --- 3) Split into 20ms @48kHz mono (960 samples) ---
            samples_per_chunk = 960  # 20ms at 48kHz mono
            bytes_per_chunk = samples_per_chunk * 2
            raw = pcm16.tobytes()

            chunks = []
            for i in range(0, len(raw), bytes_per_chunk):
                chunk = raw[i:i + bytes_per_chunk]
                if len(chunk) < bytes_per_chunk:
                    # Pad with last sample instead of zeros to avoid clicks
                    if len(chunk) >= 2:
                        last_sample = chunk[-2:]  # Last 16-bit sample
                        padding_needed = bytes_per_chunk - len(chunk)
                        chunk += last_sample * (padding_needed // 2)
                chunks.append(chunk)

            # --- 4) RTP state ---
            if not cabin._rtp_ssrc:
                cabin._rtp_timestamp = int(time.time() * 48000)
                cabin._rtp_ssrc = cabin.ssrc or (hash(cabin.cabin_id) & 0xFFFFFFFF)

            success_count = 0
            
            encoded_chunks = []
            
            for idx, chunk in enumerate(chunks):
                # Convert mono 48kHz chunk to stereo 48kHz (NO resampling!)
                pcm_mono = np.frombuffer(chunk, dtype=np.int16)
                pcm_stereo = np.column_stack((pcm_mono, pcm_mono)).reshape(-1)
                
                # Ensure Opus frame alignment
                if len(pcm_stereo) != 1920:  # 960 samples * 2 channels
                    if len(pcm_stereo) < 1920:
                        # Pad with last sample
                        last_sample = pcm_stereo[-2:] if len(pcm_stereo) >= 2 else np.array([0, 0], dtype=np.int16)
                        padding_needed = 1920 - len(pcm_stereo)
                        padding = np.tile(last_sample, padding_needed // 2)
                        pcm_stereo = np.concatenate([pcm_stereo, padding])
                    else:
                        # Truncate
                        pcm_stereo = pcm_stereo[:1920]
                
                pcm_48k_stereo = pcm_stereo.astype(np.int16).tobytes()
                
                # Encode Opus
                opus_payload = opus_codec_manager.encode_pcm_to_opus(cabin.cabin_id, pcm_48k_stereo)
                if not opus_payload:
                    encoded_chunks.append(None)
                    continue
                
                encoded_chunks.append(opus_payload)

            start_time = time.time()
            
            # Send RTP packets
            for idx, opus_payload in enumerate(encoded_chunks):
                if opus_payload is None:
                    continue
                    
                # Calculate precise timing for this chunk
                expected_time = start_time + (idx * 0.02)  # 20ms per chunk
                
                # Update RTP headers
                cabin._rtp_seq_num = (cabin._rtp_seq_num + 1) & 0xFFFF
                cabin._rtp_timestamp = (cabin._rtp_timestamp + 960) & 0xFFFFFFFF

                # Create and send RTP packet
                rtp_packet = RTPUtils.create_rtp_packet(opus_payload, 100, cabin._rtp_seq_num, cabin._rtp_timestamp, cabin._rtp_ssrc)
                ok = self.socket_manager.send_rtp_to_sfu(rtp_packet, sfu_host, sfu_port, cabin.cabin_id)  # DEV: Pass cabin_id for test mode
                if ok:
                    success_count += 1
                
                # Precise timing instead of fixed sleep
                current_time = time.time()
                # Log progress every 50 packets
                if (idx + 1) % 50 == 0:
                    logger.debug(f"[RTP-CHUNKS] Sent {idx + 1}/{len(encoded_chunks)} packets")
                
                if current_time < expected_time:
                    sleep_time = expected_time - current_time
                    if sleep_time > 0.001:  
                        time.sleep(sleep_time)
                elif current_time > expected_time + 0.010:
                    pass

            return success_count > (len(chunks) * 0.8)

        except Exception as e:
            logger.error(f"[RTP-CHUNKS] Error: {e}")
            import traceback
            logger.error(f"[RTP-CHUNKS] Traceback: {traceback.format_exc()}")
            return False

    def start_cabin(self, cabin_id: str) -> bool:
        """
        Start cabin processing (legacy method for compatibility)
        Modern cabins auto-start in create_cabin()
        """
        try:
            cabin = self.cabins.get(cabin_id)
            if not cabin:
                logger.error(f"[CABIN-MANAGER] Cabin {cabin_id} not found")
                return False
            
            if cabin.running:
                logger.info(f"[CABIN-MANAGER] Cabin {cabin_id} already running")
                return True
            
            cabin.running = True
            cabin.status = CabinStatus.LISTENING
            logger.info(f"[CABIN-MANAGER] Started cabin {cabin_id}")
            return True
            
        except Exception as e:
            logger.error(f"[CABIN-MANAGER] Error starting cabin {cabin_id}: {e}")
            return False

    def find_cabin_by_user(self, room_id: str, user_id: str) -> Optional[str]:
        """
        Find cabin ID by room and user (regardless of languages)
        This is needed because B1 creates cabin with default languages,
        but B3 may have different languages
        """
        try:
            for cabin_id, cabin in self.cabins.items():
                if cabin.room_id == room_id and cabin.user_id == user_id:
                    return cabin_id
            return None
        except Exception as e:
            logger.error(f"[CABIN-MANAGER] Error finding cabin: {e}")
            return None

    def update_cabin_languages(self, cabin_id: str, source_language: str, target_language: str) -> bool:
        """
        Update translation cabin language configuration during runtime.
        
        Used in B3 step when user changes translation preferences. Handles:
        - Language pair updates (source → target mapping)
        - Cabin ID regeneration when language changes
        - Registry updates to maintain consistency
        
        Args:
            cabin_id: Current cabin identifier
            source_language: New source language code (e.g., 'en', 'vi')
            target_language: New target language code (e.g., 'vi', 'en')
            
        Returns:
            bool: True if update successful, False if cabin not found or error
            
        Process:
            1. Locate existing cabin in registry
            2. Update language configuration
            3. Regenerate cabin_id if language pair changed
            4. Update registry mapping if needed
        """
        try:
            cabin = self.cabins.get(cabin_id)
            if not cabin:
                logger.error(f"[CABIN-MANAGER] Cabin {cabin_id} not found for language update")
                return False
            
            # Update language configuration
            cabin.source_language = source_language
            cabin.target_language = target_language
            
            # Regenerate cabin ID if language pair changed
            new_cabin_id = f"{cabin.room_id}_{cabin.user_id}_{source_language}_{target_language}"
            if new_cabin_id != cabin_id:
                # Update registry with new cabin mapping
                cabin.cabin_id = new_cabin_id
                self.cabins[new_cabin_id] = cabin
                del self.cabins[cabin_id]
                logger.info(f"[CABIN-MANAGER] Updated cabin ID: {cabin_id} → {new_cabin_id}")
            
            logger.info(f"[CABIN-MANAGER] Updated cabin languages: {source_language} → {target_language}")
            return True
            
        except Exception as e:
            logger.error(f"[CABIN-MANAGER] Error updating cabin languages: {e}")
            return False
        
    def destroy_cabin(self, room_id: str, 
        user_id: str,
        source_language: str = "vi",
        target_language: str = "en") -> bool:
        """
        Destroy translation cabin and cleanup all resources
        
        Cleanup Process:
        1. Stop cabin processing and wait for thread completion
        2. Unregister from SharedSocketManager routing
        3. Cleanup OPUS codec resources
        4. Clear audio buffers and queues
        5. Remove from cabin registry
        
        Args:
            room_id: Room identifier
            user_id: User identifier
            source_language: Source language code
            target_language: Target language code
            
        Returns:
            bool: True if cabin was found and destroyed
        """
        cabin_id = f"{room_id}_{user_id}_{source_language}_{target_language}"
        try:
            with self._lock:
                # Step 1: Remove cabin from registry
                cabin = self.cabins.pop(cabin_id, None)
                if not cabin:
                    logger.warning(f"[CABIN-MANAGER] Cabin {cabin_id} not found for destruction")
                    return False
                
                # Step 2: Stop processing thread gracefully
                cabin.running = False
                if cabin.processor_thread and cabin.processor_thread.is_alive():
                    cabin.processor_thread.join(timeout=2.0)
                
                # FIX: Stop playback thread
                if cabin.playback_thread and cabin.playback_thread.is_alive():
                    logger.info(f"[CABIN-MANAGER] Stopping playback thread for {cabin_id}")
                    cabin.playback_thread.join(timeout=2.0)
                
                # Step 3: Unregister from SharedSocketManager routing system
                self.socket_manager.unregister_cabin(cabin_id)
                
                # Step 4: Cleanup voice cloning data
                try:
                    from .voice_cloning.voice_clone_manager import get_voice_clone_manager
                    voice_manager = get_voice_clone_manager()
                    if cabin.user_id and cabin.room_id:
                        voice_manager.cleanup_user_voice(cabin.user_id, cabin.room_id)
                        logger.info(f"[CABIN-MANAGER] Cleaned up voice data for {cabin.user_id}_{cabin.room_id}")
                except Exception as e:
                    logger.warning(f"[CABIN-MANAGER] Error cleaning up voice data: {e}")
                
                # Step 5: Cleanup OPUS codec resources
                opus_codec_manager.cleanup_cabin(cabin_id)
                
                # Step 5.5: Close audio recorder
                if cabin.audio_recorder:
                    cabin.audio_recorder.close()
                    cabin.audio_recorder = None
                
                # Step 6: Cleanup cached pipeline
                if cabin._cached_pipeline:
                    try:
                        cabin._cached_pipeline.cleanup()
                        cabin._cached_pipeline = None
                        logger.debug(f"[CABIN-MANAGER] Cleaned up cached pipeline for {cabin_id}")
                    except Exception as e:
                        logger.warning(f"[CABIN-MANAGER] Error cleaning up pipeline: {e}")
                
                # Clear audio buffers (no queue in realtime mode)
                cabin.audio_buffer.clear()
                
                # Force garbage collection after resource cleanup
                import gc
                collected = gc.collect()
                logger.debug(f"[CABIN-MANAGER] Cleanup collected {collected} objects for {cabin_id}")
                
                logger.info(f"[CABIN-MANAGER] Successfully destroyed cabin {cabin_id}")
                return True
                
        except Exception as e:
            logger.error(f"[CABIN-MANAGER] Error destroying cabin {cabin_id}: {e}")
            return False

    def get_cabin_info(self, cabin_id: str) -> Optional[Dict[str, Any]]:
        """
        Get comprehensive information about a specific translation cabin.
        
        Provides detailed cabin status including:
        - Configuration details (ports, languages, room/user mapping)
        - Runtime status and performance metrics
        - Audio timing and processing statistics
        
        Args:
            cabin_id: Unique identifier for the cabin (format: room_user_src_target)
            
        Returns:
            Dict containing cabin info if found, None if cabin doesn't exist
            
        Info Structure:
            - cabin_id: Unique identifier
            - ports: receive_port, send_port, sfu_send_port
            - languages: source_language, target_language  
            - status: Current cabin status (ACTIVE, INACTIVE, etc.)
            - runtime: room_id, user_id, running state
            - timing_validation: Performance metrics and drift analysis
        """
        cabin = self.cabins.get(cabin_id)
        if not cabin:
            return None
        
        # Calculate timing metrics for performance monitoring
        timing_info = {}
        if cabin.first_packet_time and cabin.last_packet_time:
            # Calculate audio timing accuracy and drift metrics
            real_time_elapsed = cabin.last_packet_time - cabin.first_packet_time
            audio_duration_received = cabin.total_audio_duration
            timing_drift = abs(real_time_elapsed - audio_duration_received)
            timing_accuracy = ((1 - timing_drift/real_time_elapsed) * 100) if real_time_elapsed > 0 else 0
            
            timing_info = {
                "session_duration": round(real_time_elapsed, 3),
                "audio_duration_received": round(audio_duration_received, 3),
                "timing_drift": round(timing_drift, 3),
                "timing_accuracy_percent": round(timing_accuracy, 2),
                "is_timing_acceptable": timing_drift <= 0.1
            }
        
        return {
            "cabin_id": cabin.cabin_id,
            "rtp_port": cabin.receive_port,
            "send_port": cabin.send_port,
            "sfu_send_port": cabin.sfu_send_port,
            "source_language": cabin.source_language,
            "target_language": cabin.target_language,
            "status": cabin.status.value,
            "room_id": cabin.room_id,
            "user_id": cabin.user_id,
            "running": cabin.running,
            "timing_validation": timing_info
        }

# Global cabin manager instance for service-wide translation cabin operations
cabin_manager = TranslationCabinManager()
