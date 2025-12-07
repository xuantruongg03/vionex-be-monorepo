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
from core.config import (
    SFU_SERVICE_HOST,
    PLAYBACK_BUFFER_DURATION,
    PLAYBACK_MIN_QUEUE_SIZE,
    PLAYBACK_QUEUE_MAX_SIZE,
    TRANSLATION_WINDOW_DURATION,
    TRANSLATION_SAMPLE_RATE,
)
from utils.audio_logger import AudioLogger

if TYPE_CHECKING:
    from service.pipline_processor.translation_pipeline import TranslationPipeline

# DEPRECATED: port_manager no longer used - all cabins share SHARED_SOCKET_PORT
# from .port_manager import port_manager
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
    2. Wait for BUFFER_DURATION (1s) before starting playback
    3. Play with stable pacing (paced sending)
    4. If queue is empty → play silence to maintain stream
    """
    
    BUFFER_DURATION: float = PLAYBACK_BUFFER_DURATION    # Buffer before starting playback
    MIN_QUEUE_SIZE: int = PLAYBACK_MIN_QUEUE_SIZE         # Minimum chunks in queue
    
    def __post_init__(self):
        self._queue: queue.Queue = queue.Queue(maxsize=PLAYBACK_QUEUE_MAX_SIZE)
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
    Tumbling Window Buffer (No Overlap)
    
    This buffer collects audio data and emits it in fixed-size, non-overlapping
    chunks (tumbling windows). This is the simplest and most robust way to
    prevent audio duplication caused by reprocessing overlapping segments.
    
    Logic:
    1. Audio data is appended to an internal buffer.
    2. When the buffer contains enough data for a full chunk (window_duration),
       a chunk is sliced from the beginning of the buffer and returned.
    3. The sliced portion is then removed from the buffer.
    """
    window_duration: float = TRANSLATION_WINDOW_DURATION   # Each chunk duration
    sample_rate: int = TRANSLATION_SAMPLE_RATE              # Sample rate for processing

    def __post_init__(self):
        self._buffer: bytearray = bytearray()
        self._bytes_per_sample: int = 2
        self._window_bytes = int(self.window_duration * self.sample_rate * self._bytes_per_sample)

    def add_audio_chunk(self, audio_data: bytes) -> Optional[bytes]:
        """Add PCM to buffer and return a complete, non-overlapping chunk when ready."""
        if not audio_data:
            return None

        self._buffer.extend(audio_data)

        # Check if we have enough data for at least one full chunk
        if len(self._buffer) >= self._window_bytes:
            # Extract the first complete chunk
            chunk = bytes(self._buffer[:self._window_bytes])
            
            # Remove the extracted chunk from the buffer (tumble forward)
            self._buffer = self._buffer[self._window_bytes:]
            
            return chunk

        return None

    def get_processing_stats(self) -> dict:
        """Returns statistics about the current state of the buffer."""
        buffered_duration = len(self._buffer) / (self.sample_rate * self._bytes_per_sample)
        return {
            "buffer_duration": round(buffered_duration, 3),
            "window_size": self.window_duration,
            "pending_chunks": int(len(self._buffer) / self._window_bytes)
        }

    def clear(self):
        """Clears the internal buffer."""
        self._buffer.clear()

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
            import numpy as np
            from scipy.signal import resample_poly
            from math import gcd
            
            # Check if input is already WAV format
            if audio_data.startswith(b"RIFF"):
                # Extract PCM from WAV
                with wave.open(io.BytesIO(audio_data), 'rb') as wav_file:
                    pcm_data = wav_file.readframes(wav_file.getnframes())
                    sample_rate = wav_file.getframerate()
                    channels = wav_file.getnchannels()
                    
                    # Convert to numpy array
                    audio_array = np.frombuffer(pcm_data, dtype=np.int16)
                    
                    # Convert to mono if needed
                    if channels == 2:
                        audio_array = audio_array.reshape(-1, 2)
                        audio_array = np.mean(audio_array, axis=1).astype(np.int16)
                    
                    # Resample if needed (e.g., 24kHz -> 16kHz)
                    if sample_rate != 16000:
                        # FIX: Convert to float before resampling (resample_poly fails with int16)
                        audio_float = audio_array.astype(np.float32)
                        
                        # Simplify ratio using GCD for better performance
                        g = gcd(16000, sample_rate)
                        up = 16000 // g
                        down = sample_rate // g
                        
                        resampled = resample_poly(audio_float, up, down)
                        audio_array = resampled.astype(np.int16)
                    
                    pcm_data = audio_array.tobytes()
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
    ssrc: Optional[int] = None           # RTP SSRC identifier (generated)
    expected_consumer_ssrc: Optional[int] = None  # Actual SFU consumer SSRC for routing
    
    # SharedSocket references for SSRC routing updates
    _shared_socket_manager: Optional[Any] = None  # Reference to SharedSocketManager
    _shared_socket_id: Optional[str] = None       # Cabin ID used in socket registration
    
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
    # DEPRECATED by Hybrid Window
    # context_buffer: deque = field(default_factory=lambda: deque(maxlen=3)))
    context_chunk_counter: int = 0  # Counter for chunk IDs
    # last_stt_result: str = ""  # Last STT result for duplicate detection
    # last_translated_text: str = ""  # Last translated text to track what was already TTS'd
    
    # HYBRID WINDOW: These states are now deprecated by the simpler Tumbling Window
    # _is_new_speech_segment: bool = True
    # _processing_buffer: List[ContextChunk] = field(default_factory=list)


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
                # DISABLED: Reduce CPU load during testing
                # cabin.audio_recorder = AudioRecorder(cabin_id)
                
                # ============================================================================
                # Step 4: Setup SSRC and register with SharedSocketManager
                # ============================================================================
                # IMPORTANT: All cabins share single socket (port from config.SHARED_SOCKET_PORT)
                #            Routing is based on SSRC extracted from RTP header
                #            NO need for individual port per cabin
                
                # Generate unique SSRC from cabin ID for RTP identification
                cabin_ssrc = hash(cabin_id) & 0xFFFFFFFF
                cabin.ssrc = cabin_ssrc

                # Define RTP packet processing callback for this cabin
                def audio_callback(rtp_data: bytes):
                    """Route RTP packets from shared socket to cabin processor"""
                    self._process_rtp_packet(cabin, rtp_data)
                
                # ============================================================================
                # Register cabin with SharedSocketManager for SSRC-based routing
                # ============================================================================
                # All cabins share SHARED_SOCKET_PORT, routing based on SSRC
                ports = self.socket_manager.register_cabin_for_routing(
                    cabin_id, cabin_ssrc, audio_callback
                )
                if not ports:
                    logger.error(f"[CABIN-MANAGER] Failed to register cabin {cabin_id} for routing")
                    return None
                
                # Store reference to socket manager for SSRC routing updates
                cabin._shared_socket_manager = self.socket_manager
                cabin._shared_socket_id = cabin_id
                
                # ============================================================================
                # Step 5: All cabins use SHARED_SOCKET_PORT (no virtual ports)
                # ============================================================================
                # All RTP communication uses SHARED_SOCKET_PORT with SSRC-based routing
                # ports tuple now contains (SHARED_SOCKET_PORT, SHARED_SOCKET_PORT)
                receive_port, send_port = ports
                cabin.receive_port = receive_port      # SHARED_SOCKET_PORT
                cabin.send_port = send_port            # SHARED_SOCKET_PORT
                cabin.sfu_send_port = sfu_send_port    # Real SFU destination port (for TX)
                
                # Step 6: Start cabin processing
                cabin.running = True
                cabin.status = CabinStatus.LISTENING
                
                # Step 8: Register cabin in manager's tracking registry
                self.cabins[cabin_id] = cabin

                logger.info(f"[CABIN-MANAGER] Cabin created successfully!")
                logger.info(f"[CABIN-MANAGER]    Cabin ID: {cabin_id}")
                logger.info(f"[CABIN-MANAGER]    SSRC: {cabin_ssrc}")
                logger.info(f"[CABIN-MANAGER]    Shared RX/TX Port: {receive_port} (SSRC-based routing)")
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

            # HYBRID WINDOW logic is now deprecated. Using a simple Tumbling Window.
            complete_chunk = cabin.audio_buffer.add_audio_chunk(pcm_16k_mono)
            
            if complete_chunk:
                # Calculate chunk duration
                chunk_duration = len(complete_chunk) / (16000 * 2)
                
                # Create ContextChunk object
                cabin.context_chunk_counter += 1
                context_chunk = ContextChunk(
                    audio_data=complete_chunk,
                    timestamp=time.time(),
                    chunk_id=cabin.context_chunk_counter,
                    duration=chunk_duration
                )
                
                # SAVE INDIVIDUAL CHUNK for debugging
                # DISABLED: Reduce CPU load during testing
                # if cabin.audio_recorder:
                #     cabin.audio_recorder.write_audio(complete_chunk)
                
                # --- TUMBLING WINDOW LOGIC ---
                # The buffer now only returns complete, non-overlapping chunks.
                # We can process them directly.
                logger.info(f"[TUMBLING-WINDOW] Processing chunk {context_chunk.chunk_id} ({context_chunk.duration:.2f}s)")
                processing_task = {
                    'context_chunks': [context_chunk], # Still pass as a list for compatibility
                    'latest_chunk_id': context_chunk.chunk_id
                }
                try:
                    cabin.chunk_queue.put_nowait(processing_task)
                except queue.Full:
                    logger.warning("[TUMBLING-WINDOW] Chunk queue full, dropping chunk.")
            
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
                            # Queue empty → just wait, don't send silence
                            # logger.warning(f"[PLAYBACK-THREAD] Queue empty, waiting...")
                            continue
                        
                        # Send audio chunk to SFU
                        logger.debug(
                            f"[PLAYBACK-THREAD] Sending chunk {audio_chunk.chunk_id}, "
                            f"duration: {audio_chunk.duration:.2f}s, "
                            f"queue size: {cabin.playback_queue._queue.qsize()}"
                        )
                        
                        # SAVE OUTPUT AUDIO before sending to SFU
                        # DISABLED: Reduce CPU load during testing
                        # if cabin.audio_recorder:
                        #     cabin.audio_recorder.write_output_audio(audio_chunk.data)
                        
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
        start_time = time.time()
        try:
            logger.info(f"[SEND-AUDIO-SYNC] Sending {len(audio_data)} bytes to SFU for cabin {cabin.cabin_id}")
            success = self._send_rtp_chunks_to_sfu(cabin, audio_data)
            elapsed = time.time() - start_time
            if not success:
                logger.error(f"[SEND-AUDIO-SYNC] Failed to send audio to SFU after {elapsed:.2f}s")
            else:
                logger.info(f"[SEND-AUDIO-SYNC] ✅ Successfully sent audio to SFU in {elapsed:.2f}s")
        except Exception as e:
            elapsed = time.time() - start_time
            logger.error(f"[SEND-AUDIO-SYNC] Error sending audio after {elapsed:.2f}s: {e}")
            import traceback
            logger.error(f"[SEND-AUDIO-SYNC] Traceback: {traceback.format_exc()}")

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
                logger.warning(f"[TUMBLING-WINDOW] No chunks provided to process.")
                return
            
            # Step 1: Concatenate audio chunks from the block
            concatenated_audio = b''.join([chunk.audio_data for chunk in context_chunks])
            total_duration = sum(chunk.duration for chunk in context_chunks)
            
            logger.info(
                f"[TUMBLING-WINDOW-{latest_chunk_id}] Processing chunk: "
                f"{len(context_chunks)} chunks, total {total_duration:.2f}s"
            )
            
            # Step 2: VAD Gate - Skip STT if no speech detected (prevents Whisper hallucinations)
            has_speech = cabin.vad.detect_speech(concatenated_audio)
            if not has_speech:
                logger.info(
                    f"[TUMBLING-WINDOW-{latest_chunk_id}] No speech detected (VAD filtered), "
                    f"skipping STT to prevent hallucination. Duration: {total_duration:.2f}s"
                )
                # Reset status and return - do not process silence through STT
                cabin.status = CabinStatus.LISTENING
                return
            
            # Step 3: Process through translation pipeline (speech detected)
            cabin.status = CabinStatus.TRANSLATING
            logger.info(f"[TUMBLING-WINDOW-{latest_chunk_id}] Speech detected, processing through STT...")
            
            # Get cached pipeline to avoid recreation overhead
            pipeline = self.get_or_create_pipeline(cabin)
            
            # Step 4: Convert concatenated PCM to WAV
            wav_data = AudioProcessingUtils.pcm_to_wav_bytes(concatenated_audio)
            
            # Step 5: Process through pipeline (NO overlap detection needed anymore)
            result = await pipeline.process_audio_block(wav_data)
            
            processing_time = time.time() - start_time
            
            # Step 6: Enqueue the resulting translated audio
            if result['success'] and result.get('translated_audio'):
                translated_audio = result['translated_audio']
                translated_text = result.get('translated_text', '')
                
                # Calculate audio duration
                audio_duration = self._calculate_audio_duration(translated_audio)
                
                # Create AudioChunk object for playback
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
                        f"[TUMBLING-WINDOW-{latest_chunk_id}] Processed in {processing_time:.2f}s, "
                        f"text: '{translated_text[:50]}...', "
                        f"audio duration: {audio_duration:.2f}s, "
                        f"queue size: {cabin.playback_queue._queue.qsize()}"
                    )
                else:
                    logger.error(f"[TUMBLING-WINDOW-{latest_chunk_id}] Failed to enqueue to playback queue")
            else:
                error_msg = result.get('message', 'unknown')
                logger.warning(f"[TUMBLING-WINDOW-{latest_chunk_id}] Translation failed: {error_msg}")
            
            cabin.status = CabinStatus.LISTENING
            
        except Exception as e:
            processing_time = time.time() - start_time
            cabin.status = CabinStatus.ERROR
            logger.error(f"[TUMBLING-WINDOW-{latest_chunk_id}] Error processing in {processing_time:.2f}s: {e}")
            import traceback
            logger.error(f"[TUMBLING-WINDOW-{latest_chunk_id}] Traceback: {traceback.format_exc()}")
            
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

    def _send_rtp_chunks_to_sfu(self, cabin: TranslationCabin, audio_data: bytes) -> bool:
        """
        Send RTP packets in 20ms chunks for proper streaming.
        """
        import time
        from scipy.signal import resample_poly
        import numpy as np

        logger.info(f"[RTP-CHUNKS] Starting to send {len(audio_data)} bytes for cabin {cabin.cabin_id}")

        try:
            sfu_host = SFU_SERVICE_HOST  # Load from config instead of hardcoded
            # Use actual SFU port (from receiveTransport) - sfu_send_port must be set via updateTranslationPort
            sfu_port = cabin.sfu_send_port if cabin.sfu_send_port else cabin.send_port
            
            if not cabin.sfu_send_port:
                logger.warning(
                    f"[RTP-CHUNKS] Cabin {cabin.cabin_id} missing sfu_send_port! "
                    "SFU port not updated via updateTranslationPort - may cause NAT issues!"
                )
            
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
                from math import gcd
                
                x = pcm16.astype(np.float32) / 32767.0
                
                # Anti-aliasing filter necessary for downsampling
                if src_sr > 48000:
                    nyquist = src_sr / 2
                    cutoff = 48000 / 2 * 0.9  # 90% of target Nyquist
                    sos = butter(6, cutoff / nyquist, btype='low', output='sos')
                    x = sosfilt(sos, x)
                
                # Resample using simplified ratio (GCD optimization)
                g = gcd(48000, src_sr)
                up = 48000 // g
                down = src_sr // g
                x_48k = resample_poly(x, up, down, window=('kaiser', 8.0))
                
                # Normalize carefully
                max_val = np.max(np.abs(x_48k))
                if max_val > 1.0:
                    x_48k = x_48k / max_val
                
                pcm16 = (x_48k * 32767.0).astype(np.int16)
            else:
                pass

            if len(pcm16) == 0:
                return False

            # DEBUG: Log audio stats before sending
            pcm16_rms = np.sqrt(np.mean(pcm16.astype(np.float32)**2))
            pcm16_max = np.max(np.abs(pcm16))
            pcm16_nonzero = np.count_nonzero(pcm16)
            logger.info(f"[RTP-CHUNKS] Audio before sending: RMS={pcm16_rms:.1f}, Max={pcm16_max}, NonZero={pcm16_nonzero}/{len(pcm16)}, SampleRate={src_sr}->48000")

            # ---2) Noise gate DISABLED - causing audio to be silent ---
            # The threshold was too aggressive and removing actual speech
            # TODO: Re-enable with proper calibration if needed
            # noise_threshold = 500  # Threshold for noise
            # mask = np.abs(pcm16) > noise_threshold
            # from scipy.ndimage import binary_dilation
            # mask_expanded = binary_dilation(mask, iterations=480)
            # pcm16_clean = pcm16.copy()
            # pcm16_clean[~mask_expanded] = 0
            # pcm16 = pcm16_clean

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
            # Always use cabin.ssrc (which is updated via update_sfu_port with consumer SSRC from SFU)
            # Initialize timestamp only if not set
            if not cabin._rtp_timestamp:
                cabin._rtp_timestamp = int(time.time() * 48000)
            
            # Always use the current cabin.ssrc (may have been updated by update_sfu_port)
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
                
                # DEBUG: Log first chunk audio level
                if idx == 0:
                    stereo_rms = np.sqrt(np.mean(pcm_stereo.astype(np.float32)**2))
                    logger.info(f"[RTP-CHUNKS] First chunk stereo: RMS={stereo_rms:.1f}, len={len(pcm_48k_stereo)}")
                
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
                ok = self.socket_manager.send_rtp_to_sfu(rtp_packet, sfu_host, sfu_port, cabin.cabin_id)
                if ok:
                    success_count += 1
                
                # Precise timing instead of fixed sleep
                current_time = time.time()
                # Log progress every 25 packets (more frequent for debugging)
                if (idx + 1) % 25 == 0 or idx == len(encoded_chunks) - 1:
                    elapsed = current_time - start_time
                    logger.info(f"[RTP-CHUNKS] Progress: {idx + 1}/{len(encoded_chunks)} packets sent in {elapsed:.2f}s, success: {success_count}")
                
                if current_time < expected_time:
                    sleep_time = expected_time - current_time
                    if sleep_time > 0.001:  
                        time.sleep(sleep_time)
                elif current_time > expected_time + 0.010:
                    pass

            total_time = time.time() - start_time
            logger.info(f"[RTP-CHUNKS] Completed: {success_count}/{len(chunks)} packets in {total_time:.2f}s for cabin {cabin.cabin_id}")
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

    def find_cabin_by_user(self, room_id: str, user_id: str) -> Optional[str]:
        """
        Find cabin ID by room and user (regardless of languages)
        
        Args:
            room_id: Room identifier
            user_id: User identifier
            
        Returns:
            cabin_id if found, None otherwise
        """
        with self._lock:
            for cabin_id, cabin in self.cabins.items():
                if cabin.room_id == room_id and cabin.user_id == user_id:
                    return cabin_id
        return None
    
    def update_sfu_port(self, cabin_id: str, sfu_port: int, consumer_ssrc: int = None) -> bool:
        """
        Update SFU send port and consumer SSRC for a cabin (NAT FIX + SSRC FIX)
        
        Args:
            cabin_id: Cabin identifier
            sfu_port: Actual SFU receiveTransport listen port
            consumer_ssrc: Actual SFU consumer SSRC for RTP routing
            
        Returns:
            True if successful, False otherwise
        """
        with self._lock:
            cabin = self.cabins.get(cabin_id)
            if not cabin:
                logger.error(f"[CABIN-MANAGER] Cabin {cabin_id} not found for port update")
                return False
            
            cabin.sfu_send_port = sfu_port
            
            # Update expected consumer SSRC if provided
            if consumer_ssrc is not None:
                old_ssrc = cabin.ssrc
                cabin.expected_consumer_ssrc = consumer_ssrc
                
                # FIX: Also update the SSRC used for RTP packet creation
                cabin.ssrc = consumer_ssrc
                cabin._rtp_ssrc = consumer_ssrc  # Reset so next send uses new SSRC
                
                logger.info(f"[CABIN-MANAGER] ✅ Updated cabin {cabin_id} SSRC: {consumer_ssrc} (was: {old_ssrc})")
                
                # Also update SharedSocketManager's SSRC routing if cabin is using shared socket
                if cabin._shared_socket_manager and cabin._shared_socket_id:
                    cabin._shared_socket_manager.update_cabin_ssrc(cabin._shared_socket_id, consumer_ssrc)
            
            logger.info(f"[CABIN-MANAGER] ✅ Updated cabin {cabin_id} SFU port: {sfu_port}, consumer SSRC: {consumer_ssrc}")
            return True

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
            "ssrc": cabin.ssrc,  # FIX: Add missing SSRC field
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
