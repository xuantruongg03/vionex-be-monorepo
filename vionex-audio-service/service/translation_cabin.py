import asyncio
import logging
import threading
import time
import queue
from typing import Dict, Optional, Any, TYPE_CHECKING
from dataclasses import dataclass, field
from enum import Enum
from service.pipline_processor.VAD import VoiceActivityDetector
from service.pipline_processor.sliding_windows import SmartAudioBuffer
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
class TranslationCabin:
   
    cabin_id: str
    source_language: str
    target_language: str
    receive_port: int = 0  # Port riêng cho receive
    send_port: int = 0     # Port riêng cho send  
    status: CabinStatus = CabinStatus.IDLE
    room_id: Optional[str] = None
    user_id: Optional[str] = None
    running: bool = False
    
    # Audio processing pipeline components
    audio_buffer: SmartAudioBuffer = field(default_factory=SmartAudioBuffer)
    vad: VoiceActivityDetector = field(default_factory=VoiceActivityDetector)
    
    # Threading and queue management
    audio_queue: queue.Queue = field(default_factory=queue.Queue)
    processor_thread: Optional[threading.Thread] = None
    
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
                
                # Step 7: Start audio processing thread for real-time translation
                cabin.processor_thread = threading.Thread(
                    target=self._audio_processor,
                    args=(cabin,),
                    daemon=True
                )
                cabin.processor_thread.start()
                
                # Brief wait to ensure thread startup
                time.sleep(0.1)
                
                # Step 8: Register cabin in manager's tracking registry
                self.cabins[cabin_id] = cabin
                
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
        Process RTP packet received from SharedSocketManager router
        This replaces the old _audio_receiver thread approach
        
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

            # Add to FIFO queue for translation processing
            cabin.audio_queue.put(pcm_16k_mono, block=False)
            
        except Exception as e:
            logger.error(f"[AUDIO-CALLBACK] Error processing RTP packet for {cabin.cabin_id}: {e}")

    def _audio_processor(self, cabin: TranslationCabin):
        """
        Audio processor thread - continuously processes audio data from FIFO queue
        """
        # Import here to avoid circular imports
        from service.pipline_processor.translation_pipeline import TranslationPipeline
        
        # Step 1: Setup dedicated asyncio event loop for this thread
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        
        # Step 2: Initialize translation pipeline for language pair
        try:
            pipeline = TranslationPipeline(
                source_language=cabin.source_language,
                target_language=cabin.target_language
            )
        except Exception as e:
            logger.error(f"[PROCESSOR] Failed to initialize translation pipeline: {e}")
            return
        
        # Processing statistics
        processing_count = 0
        bypass_vad = False  # Skip VAD for faster processing
        
        # Step 3: Main audio processing loop
        try:
            while cabin.running:
                try:
                    # Get queued audio data (with timeout for clean shutdown)
                    try:
                        audio_data = cabin.audio_queue.get(timeout=1.0)
                        processing_count += 1
                    except queue.Empty:
                        logger.debug(f"[PROCESSOR] Audio queue empty")
                        processing_count += 1
                        continue
                    
                    # VAD speech detection
                    has_speech = bypass_vad or cabin.vad.detect_speech(audio_data)
                    
                    # Debug VAD performance every 500 audio chunks
                    if processing_count % 500 == 0:
                        buffer_info = cabin.audio_buffer.get_processing_stats() if hasattr(cabin.audio_buffer, 'get_processing_stats') else {}
                        logger.info(f"[VAD-DEBUG] Processing #{processing_count}: speech={has_speech}, bypass={bypass_vad}, buffer_size={buffer_info.get('buffer_size', 0)} bytes")
                    
                    if not has_speech:
                        # No speech detected → Send original audio as passthrough
                        try:
                            loop.run_until_complete(self._send_audio_to_sfu(cabin, audio_data, "passthrough"))
                        except Exception as e:
                            logger.debug(f"[PASSTHROUGH] Error sending passthrough audio: {e}")
                        continue
                    else:
                        # Speech detected → Process through translation pipeline
                        window_info = cabin.audio_buffer.add_audio_chunk(audio_data)
                        
                        buffer_stats = cabin.audio_buffer.get_processing_stats()

                        if window_info:
                            processing_count += 1
                            cabin.status = CabinStatus.TRANSLATING
                            try:
                                loop.run_until_complete(
                                    self._process_audio_window(cabin, pipeline, window_info['audio_data'])
                                )
                            except Exception as e:
                                logger.error(f"[DEBUG] Error processing window: {e}")
                            
                            cabin.status = CabinStatus.LISTENING
                        else:
                            buffer_stats = cabin.audio_buffer.get_processing_stats()
                            if buffer_stats['buffer_duration_seconds'] > 6.0:
                                force_window = cabin.audio_buffer.force_process_current_buffer("long_accumulation")
                                if force_window:
                                    processing_count += 1
                                    cabin.status = CabinStatus.TRANSLATING
                                    
                                    try:
                                        loop.run_until_complete(
                                            self._process_audio_window(cabin, pipeline, force_window['audio_data'])
                                        )
                                    except Exception as e:
                                        logger.error(f"[DEBUG] Error processing forced window: {e}")
                                    
                                    cabin.status = CabinStatus.LISTENING
                    
                    # Mark task as done
                    cabin.audio_queue.task_done()

                except Exception as e:
                    if cabin.running:
                        logger.error(f"[PROCESSOR] Error in processing loop: {e}")
                    break

        except Exception as e:
            cabin.status = CabinStatus.ERROR

        finally:
            # Close the event loop before thread exits
            try:
                loop.close()
            except Exception as e:
                logger.error(f"[PROCESSOR] Error closing event loop: {e}")

    async def _process_audio_window(
        self, 
        cabin: TranslationCabin, 
        pipeline: 'TranslationPipeline', 
        audio_window: bytes
    ):
        """
        Process audio window through complete translation pipeline.
        
        Handles the core translation workflow:
        - Audio format conversion (PCM → WAV)
        - Pipeline processing (STT → Translation → TTS)  
        - SFU transmission of translated audio
        - Performance monitoring and error handling
        
        Args:
            cabin: Translation cabin instance
            pipeline: Translation pipeline for STT/Translation/TTS
            audio_window: Raw PCM audio data to process
            
        Process:
            1. Convert PCM audio to WAV format for pipeline
            2. Process through translation pipeline
            3. Send translated audio to SFU for distribution
            4. Monitor processing time and handle errors
        """
        start_time = time.time()
        
        try:
            # Step 1: Convert PCM to WAV format for pipeline processing
            wav_data = AudioProcessingUtils.pcm_to_wav_bytes(audio_window)
            result = await pipeline.process_audio(wav_data)
            
            processing_time = (time.time() - start_time) * 1000
            
            # Step 2: Handle successful translation result
            if result['success'] and result.get('translated_audio'):
                translated_audio = result['translated_audio']
                success = await self._send_audio_to_sfu(cabin, translated_audio, "translated")
                
                if success:
                    pass  # Successfully transmitted to SFU
                else:
                    logger.error(f"[PROCESSING] FAILED to send translated audio to SFU")
            else:
                logger.error(f"[PROCESSING] Translation failed or no audio generated: {result}")
            
        except Exception as e:
            processing_time = (time.time() - start_time) * 1000
            import traceback
            logger.error(f"[PROCESSING] ERROR in {processing_time:.2f}ms: {e}")
            logger.error(f"[PROCESSING] Traceback: {traceback.format_exc()}")

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
                ok = self.socket_manager.send_rtp_to_sfu(rtp_packet, sfu_host, sfu_port)
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
        Send audio back to SFU via RTP packets
        Works for both translated audio and passthrough audio
        """
        try:
            # Use chunked streaming for better audio quality
            success = self._send_rtp_chunks_to_sfu(cabin, audio_data)
            return success
            
        except Exception as e:
            logger.error(f"[{audio_type.upper()}] Error sending {audio_type} audio: {e}")
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
            if cabin.thread and cabin.thread.is_alive():
                cabin.thread.join(timeout=2.0)
            
            if cabin.processor_thread and cabin.processor_thread.is_alive():
                cabin.processor_thread.join(timeout=2.0)
            
            # Step 3: Release allocated network ports back to port manager
            if cabin.rtp_port:
                port_manager.release_port(cabin.rtp_port)
            
            if cabin.send_port:
                port_manager.release_port(cabin.send_port)
            
            # Step 4: Clear audio processing buffers
            cabin.audio_buffer.clear()
            
            # Step 5: Empty audio queue to prevent memory leaks
            while not cabin.audio_queue.empty():
                try:
                    cabin.audio_queue.get_nowait()
                except queue.Empty:
                    break
            
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
                
                # Step 4: Cleanup OPUS codec resources
                opus_codec_manager.cleanup_cabin(cabin_id)
                
                # Clear audio buffers and queue
                cabin.audio_buffer.clear()
                while not cabin.audio_queue.empty():
                    try:
                        cabin.audio_queue.get_nowait()
                    except queue.Empty:
                        break
                
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
