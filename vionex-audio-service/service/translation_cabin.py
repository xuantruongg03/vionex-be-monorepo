import asyncio
import logging
import threading
import time
import queue
from typing import Dict, Optional, Any, TYPE_CHECKING, List
from dataclasses import dataclass, field
from enum import Enum
import time
import logging
import asyncio
import threading
import queue
import wave
import os
from datetime import datetime
from service.pipline_processor.VAD import VoiceActivityDetector
from core.config import SFU_SERVICE_HOST

if TYPE_CHECKING:
    from service.pipline_processor.translation_pipeline import TranslationPipeline

from .port_manager import port_manager
from .socket_pool import get_shared_socket_manager
from .codec_utils import opus_codec_manager, AudioProcessingUtils, RTPUtils

logger = logging.getLogger(__name__)

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
    - Giai đoạn khởi động: cần ít nhất 2s audio mới xuất chunk đầu tiên
    - Sau đó: cửa sổ 1.0s, bước 0.7s (overlap 0.3s)
    - Mọi tính toán dựa trên độ dài buffer, không dùng clock
    """

    init_buffer: float = 0.5       # 0.5s đầu tiên để lấy ngữ cảnh
    window_duration: float = 2.0   # mỗi chunk dài 0.8s
    step_duration: float = 1.0     # overlap 0.4s
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
        """Thêm PCM vào buffer, trả về một cửa sổ khi sẵn sàng."""
        if not audio_data:
            return None

        self._buffer.extend(audio_data)

        # Chưa đủ 2s → chưa phát
        if not self._started:
            if len(self._buffer) >= self._init_bytes:
                self._started = True
            else:
                return None

        # Sau khi start: kiểm tra có đủ dữ liệu cho 1 window
        if (len(self._buffer) - self._next_start_bytes) >= self._window_bytes:
            start = self._next_start_bytes
            end = start + self._window_bytes
            window = bytes(self._buffer[start:end])

            # Slide buffer: tiến 0.7s
            self._next_start_bytes += self._step_bytes

            # Dọn buffer định kỳ để tránh phình
            if self._next_start_bytes >= self._step_bytes * 4:
                self._buffer = bytearray(self._buffer[self._next_start_bytes:])
                self._next_start_bytes = 0

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
    """
    def __init__(self, cabin_id: str, save_dir: str = "debug_audio"):
        self.cabin_id = cabin_id
        self.save_dir = save_dir
        self.current_file = None
        self.wav_writer = None
        self.packet_count = 0
        
        # Create save directory
        os.makedirs(save_dir, exist_ok=True)
        
        # Start new recording file
        self._start_new_file()
    
    def _start_new_file(self):
        """Start a new WAV file"""
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"{self.cabin_id}_{timestamp}.wav"
        filepath = os.path.join(self.save_dir, filename)
        
        # Close previous file if exists
        if self.wav_writer:
            self.wav_writer.close()
        
        # Open new WAV file: 16kHz, mono, 16-bit PCM
        self.current_file = filepath
        self.wav_writer = wave.open(filepath, 'wb')
        self.wav_writer.setnchannels(1)  # Mono
        self.wav_writer.setsampwidth(2)  # 16-bit = 2 bytes
        self.wav_writer.setframerate(16000)  # 16kHz
        self.packet_count = 0
        
        logger.info(f"[AUDIO-RECORDER] 🎙️ Started recording: {filepath}")
    
    def write_audio(self, pcm_16k_mono: bytes):
        """Write PCM audio to WAV file"""
        if self.wav_writer:
            self.wav_writer.writeframes(pcm_16k_mono)
            self.packet_count += 1
            
            # Rotate file every 100 packets (~60 seconds)
            if self.packet_count >= 100:
                self._start_new_file()
    
    def close(self):
        """Close WAV file"""
        if self.wav_writer:
            self.wav_writer.close()
            self.wav_writer = None
            logger.info(f"[AUDIO-RECORDER] ✅ Closed recording: {self.current_file}")
        self._started = False

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
    thread: Optional[threading.Thread] = None
    
    # Audio recorder for debugging
    audio_recorder: Optional[AudioRecorder] = None
    _event_loop: Optional[asyncio.AbstractEventLoop] = None


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
        
        # Memory monitoring settings
        self.enable_memory_monitoring = True  # Set to False to disable monitoring

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
                
                # Step 2: Check for existing cabin (reuse pattern)
                if cabin_id in self.cabins:
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

                # Start single processor thread for this cabin
                self._start_processor_thread(cabin)
                
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
        Process RTP packet with realtime chunk processing
        Flow: RTP → decode → downsample → chunk buffer → process immediately
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
                return

            # Downsample từ 48kHz stereo → 16kHz mono for translation processing
            pcm_16k_mono = AudioProcessingUtils.downsample_48k_to_16k(pcm_48k_stereo)
            if not pcm_16k_mono:
                return

            # 🎙️ SAVE AUDIO TO FILE for debugging
            if cabin.audio_recorder:
                cabin.audio_recorder.write_audio(pcm_16k_mono)

            # Cleanup intermediate data immediately
            del pcm_48k_stereo

            # REALTIME PROCESSING: Add to sliding buffer and enqueue when ready
            complete_chunk = cabin.audio_buffer.add_audio_chunk(pcm_16k_mono)
            if complete_chunk:
                try:
                    cabin.chunk_queue.put_nowait(complete_chunk)
                except queue.Full:
                    # Drop oldest by getting once and pushing again
                    try:
                        _ = cabin.chunk_queue.get_nowait()
                    except Exception:
                        pass
                    try:
                        cabin.chunk_queue.put_nowait(complete_chunk)
                    except Exception:
                        pass
            
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

    async def _process_chunk_realtime(self, cabin: TranslationCabin, audio_chunk: bytes):
        """
        Process audio chunk in realtime: STT → Translation → TTS → Send
        
        Args:
            cabin: Translation cabin instance
            audio_chunk: Complete 0.8s audio chunk ready for processing
            
        Flow:
            1. VAD check - if no speech, send passthrough
            2. STT → Translation → TTS pipeline
            3. Send translated audio to SFU immediately
        """
        start_time = time.time()
        
        try:
            # Step 1: VAD speech detection
            has_speech = cabin.vad.detect_speech(audio_chunk)
            
            if not has_speech:
                # No speech: forward as Opus (encoded) to keep stream smooth
                await self._send_audio_to_sfu(cabin, audio_chunk, "passthrough")
                return
            
            # Step 2: Speech detected → process through translation pipeline
            cabin.status = CabinStatus.TRANSLATING
            
            # Get cached pipeline to avoid recreation overhead
            pipeline = self.get_or_create_pipeline(cabin)
            
            # Step 3: Convert PCM to WAV and process
            wav_data = AudioProcessingUtils.pcm_to_wav_bytes(audio_chunk)
            
            # Fire-and-forget: pipeline sẽ tự xử lý và gửi kết quả
            asyncio.create_task(self._process_and_send(cabin, wav_data, start_time))
            cabin.status = CabinStatus.LISTENING
            
            # processing_time = (time.time() - start_time) * 1000
            
            # # Step 4: Send translated audio if successful
            # if result['success'] and result.get('translated_audio'):
            #     translated_audio = result['translated_audio']

            #     # Stream out in small parts if possible to improve smoothness
            #     streamed = await self._stream_tts_in_parts(cabin, result.get('translated_text', ''), translated_audio)
            #     if not streamed:
            #         success = await self._send_audio_to_sfu(cabin, translated_audio, "translated")
            #         if success:
            #             logger.debug(f"[REALTIME] Processed chunk in {processing_time:.2f}ms")
            #         else:
            #             logger.error(f"[REALTIME] Failed to send translated audio")
            # else:
            #     logger.warning(f"[REALTIME] Translation failed: {result}")
            
            cabin.status = CabinStatus.LISTENING
            
        except Exception as e:
            processing_time = (time.time() - start_time) * 1000
            cabin.status = CabinStatus.ERROR
            logger.error(f"[REALTIME] Error processing chunk in {processing_time:.2f}ms: {e}")
            import traceback
            logger.error(f"[REALTIME] Traceback: {traceback.format_exc()}")
            
            # Reset status for next chunk
            cabin.status = CabinStatus.LISTENING

    async def _process_and_send(self, cabin: TranslationCabin, wav_data: bytes, start_time: float):
        try:
            pipeline = self.get_or_create_pipeline(cabin)
            result = await pipeline.process_audio(wav_data)

            processing_time = (time.time() - start_time) * 1000

            if result['success'] and result.get('translated_audio'):
                translated_audio = result['translated_audio']

                # Stream out in small parts if possible to improve smoothness
                streamed = await self._stream_tts_in_parts(
                    cabin, result.get('translated_text', ''), translated_audio
                )
                if not streamed:
                    success = await self._send_audio_to_sfu(cabin, translated_audio, "translated")
                    if success:
                        logger.debug(f"[REALTIME] Processed chunk in {processing_time:.2f}ms")
                    else:
                        logger.error(f"[REALTIME] Failed to send translated audio")
            else:
                logger.warning(f"[REALTIME] Translation failed: {result}")

        except Exception as e:
            logger.error(f"[REALTIME] Error in _process_and_send: {e}")

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
            
            logger.warning(f"[RTP-CHUNKS] Sending audio to SFU: {sfu_host}:{sfu_port} (real_port: {cabin.sfu_send_port}, allocated: {cabin.send_port})")

            # --- 0) Chuẩn hoá input: WAV -> PCM16 mono + sample_rate ---
            # Nếu là WAV (bắt đầu "RIFF"), bóc PCM và lấy sample_rate
            src_sr = 16000
            if audio_data.startswith(b"RIFF"):
                # Dùng util sẵn có để extract
                pcm_arr, sr = AudioProcessingUtils.extract_pcm_from_wav(audio_data)
                if sr == 0 or len(pcm_arr) == 0:
                    logger.error("[RTP-CHUNKS] Invalid WAV data")
                    return False
                src_sr = sr
                pcm16 = pcm_arr.astype(np.int16)

                max_val = np.max(pcm16)
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
            noise_threshold = 500  # Threshold để coi là noise
            mask = np.abs(pcm16) > noise_threshold
            
            from scipy.ndimage import binary_dilation
            mask_expanded = binary_dilation(mask, iterations=480)  # ~10ms expansion @ 48kHz
            
            # Apply noise gate
            pcm16_clean = pcm16.copy()
            pcm16_clean[~mask_expanded] = 0
            
            pcm16 = pcm16_clean

            # --- 3) Chia 20ms @48kHz mono (960 samples) ---
            samples_per_chunk = 960  # 20ms at 48kHz mono
            bytes_per_chunk = samples_per_chunk * 2
            raw = pcm16.tobytes()

            chunks = []
            for i in range(0, len(raw), bytes_per_chunk):
                chunk = raw[i:i + bytes_per_chunk]
                if len(chunk) < bytes_per_chunk:
                    # Pad với last sample thay vì zeros để tránh click
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
                
                # Precise timing thay vì sleep cố định
                current_time = time.time()
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

    async def _send_audio_to_sfu(
        self, 
        cabin: TranslationCabin, 
        audio_data: bytes,
        audio_type: str = "translated"
    ) -> bool:
        """
        Send audio back to SFU via RTP packets (Opus @48kHz stereo, 20ms frames).
        Accepts PCM16 mono @16kHz or WAV; handles resampling/encoding internally.
        """
        try:
            # Always send as encoded RTP chunks for consistency
            success = self._send_rtp_chunks_to_sfu(cabin, audio_data)
            return success
            
        except Exception as e:
            logger.error(f"[{audio_type.upper()}] Error sending {audio_type} audio: {e}")
            return False

    async def _stream_tts_in_parts(self, cabin: TranslationCabin, text: str, fallback_audio: Optional[bytes]) -> bool:
        """
        Try to stream TTS in smaller parts to improve perceived latency.
        If splitting is not beneficial, return False and caller will send fallback in one go.
        """
        try:
            if not text:
                return False

            # Simple heuristic: if text is short, don't split
            words = text.split()
            if len(words) <= 8:
                return False

            parts: List[str] = []
            current: List[str] = []
            for w in words:
                current.append(w)
                if len(current) >= 6 or w.endswith(('.', '!', '?', ',')):
                    parts.append(' '.join(current))
                    current = []
            if current:
                parts.append(' '.join(current))

            # If splitting produced only one part, skip streaming
            if len(parts) <= 1:
                return False

            # Generate TTS per part sequentially (keeps order and pacing)
            from service.pipline_processor.text_to_speech import tts as tts_func
            loop = cabin._event_loop or asyncio.get_event_loop()
            for idx, part in enumerate(parts):
                try:
                    audio_part = await loop.run_in_executor(
                        None,
                        tts_func,
                        part,
                        cabin.target_language,
                        cabin.user_id,
                        cabin.room_id,
                    )
                    if audio_part:
                        _ = await self._send_audio_to_sfu(cabin, audio_part, "translated-part")
                except Exception as e:
                    logger.warning(f"[STREAM-TTS] Part {idx} failed: {e}")
                    continue
            return True
        except Exception as e:
            logger.debug(f"[STREAM-TTS] Fallback to single audio due to error: {e}")
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
        
    async def _cleanup_cabin_resources(self, cabin_id: str):
        """
        Enhanced cleanup for translation cabin resources.
        
        Performs comprehensive resource cleanup including:
        - Thread termination (processor and audio threads)
        - Port deallocation (RTP receive and send ports)
        - Memory cleanup (audio buffers and queues)
        - Resource release to prevent memory leaks
        
        Args:
            cabin_id: Cabin identifier for resource cleanup
            
        Process:
            1. Stop cabin processing gracefully
            2. Join threads with timeout to prevent hanging
            3. Release allocated network ports
            4. Clear audio buffers and queues
            5. Cleanup any remaining queue items
        """
        try:
            cabin = self.cabins.get(cabin_id)
            if not cabin:
                return
            
            # Step 1: Stop cabin processing gracefully
            cabin.running = False
            
            # Step 2: Wait for processing threads to finish with timeout
            if getattr(cabin, 'thread', None) and cabin.thread.is_alive():
                cabin.thread.join(timeout=2.0)
            
            if getattr(cabin, 'processor_thread', None) and cabin.processor_thread.is_alive():
                cabin.processor_thread.join(timeout=2.0)
            
            # Step 3: Release allocated network ports back to port manager
            if getattr(cabin, 'receive_port', None):
                port_manager.release_port(cabin.receive_port)
            
            if cabin.send_port:
                port_manager.release_port(cabin.send_port)
            
            # Step 4: Clear audio processing buffers
            cabin.audio_buffer.clear()
            
            # Step 5: No audio queue in realtime mode - nothing to clear
            
            # Step 6: Close optimized network resources
            if hasattr(cabin, '_send_socket') and cabin._send_socket:
                try:
                    cabin._send_socket.close()
                    cabin._send_socket = None
                except Exception as e:
                    logger.error(f"[CLEANUP] Error closing send socket: {e}")
            
            # Step 7: Cleanup OPUS encoder resources
            if hasattr(cabin, '_opus_encoder') and cabin._opus_encoder:
                try:
                    cabin._opus_encoder = None
                except Exception as e:
                    logger.error(f"[CLEANUP] Error cleaning up Opus encoder: {e}")
            
            # Note: SharedSocketManager handles socket lifecycle, no manual cleanup needed
            # Step 8: Remove cabin from tracking registry
            del self.cabins[cabin_id]
            
            # Step 9: Force garbage collection after cleanup
            try:
                import gc
                collected = gc.collect()
                logger.debug(f"[CLEANUP] Garbage collected {collected} objects after cabin cleanup")
            except Exception as gc_error:
                logger.warning(f"[CLEANUP] Garbage collection error: {gc_error}")
            
        except Exception as e:
            logger.error(f"[CLEANUP] Error in cabin cleanup: {e}")

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
