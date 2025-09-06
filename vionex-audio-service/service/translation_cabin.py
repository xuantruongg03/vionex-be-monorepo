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
    
    # Enhanced processing components
    audio_buffer: SmartAudioBuffer = field(default_factory=SmartAudioBuffer)
    vad: VoiceActivityDetector = field(default_factory=VoiceActivityDetector)
    
    # FIFO queue for audio data processing
    audio_queue: queue.Queue = field(default_factory=queue.Queue)
    processor_thread: Optional[threading.Thread] = None
    
    # Audio timing validation for SFU synchronization
    first_packet_time: Optional[float] = None
    last_packet_time: Optional[float] = None
    total_audio_duration: float = 0.0  # Total audio duration received (in seconds)
    
    # Bidirectional transport support
    send_port: Optional[int] = None
    sfu_send_port: Optional[int] = None  # Real SFU port for outbound RTP
    ssrc: Optional[int] = None  # SSRC for SFU producer
    
    # RTP state (moved from being created dynamically)
    _rtp_seq_num: int = 0
    _rtp_timestamp: int = 0
    _rtp_ssrc: Optional[int] = None


class TranslationCabinManager:
    """
    Manages multiple translation cabins using SharedSocketManager
    """
    
    def __init__(self):
        """
        Initialize translation cabin manager với shared socket
        """
        self.cabins: Dict[str, TranslationCabin] = {}
        self._lock = threading.Lock()
        
        # Get shared socket manager
        self.socket_manager = get_shared_socket_manager()

    def create_cabin(
        self, 
        room_id: str, 
        user_id: str,
        source_language: str = "vi",
        target_language: str = "en",
        sfu_send_port: Optional[int] = None  # Real SFU port for outbound RTP
    ) -> Optional[Dict[str, Any]]:
        try:
            with self._lock:
                # Generate deterministic cabin ID from room/user/language combination
                cabin_id = f"{room_id}_{user_id}_{source_language}_{target_language}"
                
                # Check for existing cabin with same parameters
                if cabin_id in self.cabins:
                    return self.get_cabin_info(cabin_id)
                
                # Create cabin instance first
                cabin = TranslationCabin(
                    cabin_id=cabin_id,
                    source_language=source_language,
                    target_language=target_language,
                    room_id=room_id,
                    user_id=user_id
                )
                
                # Generate SSRC for SFU producer
                cabin_ssrc = hash(cabin_id) & 0xFFFFFFFF
                cabin.ssrc = cabin_ssrc

                # Register cabin với SharedSocketManager for RTP routing
                def audio_callback(rtp_data: bytes):
                    """Callback to process RTP Packets from the router"""
                    self._process_rtp_packet(cabin, rtp_data)
                
                ports = self.socket_manager.register_cabin_for_routing(
                    cabin_id, cabin_ssrc, audio_callback
                )
                if not ports:
                    logger.error(f"[CABIN-MANAGER] Failed to register cabin {cabin_id} for routing")
                    return None
                
                receive_port, send_port = ports
                cabin.receive_port = receive_port
                cabin.send_port = send_port
                
                # Store real SFU port for outbound RTP if provided
                cabin.sfu_send_port = sfu_send_port
                # logger.info(f"[CABIN-MANAGER] Real SFU port: {sfu_send_port}, allocated send port: {send_port}")

                # Start cabin
                cabin.running = True
                cabin.status = CabinStatus.LISTENING
                
                # logger.info(f"[CABIN-MANAGER] Registered cabin {cabin_id} for RTP routing with SSRC={cabin_ssrc}")
                
                # Start audio processor thread for FIFO queue processing
                # ENABLE: Real audio processing from SFU
                cabin.processor_thread = threading.Thread(
                    target=self._audio_processor,
                    args=(cabin,),
                    daemon=True
                )
                
                # COMMENTED OUT: Sample data mode for testing
                # logger.warning(f"[CABIN-MANAGER] USING SAMPLE DATA MODE - Real audio from SFU will be IGNORED")
                # cabin.processor_thread = threading.Thread(
                #     target=self._process_audio_with_sample_data,
                #     args=(cabin,),  # Pipeline will be created inside the method
                #     daemon=True
                # )
                
                cabin.processor_thread.start()
                # logger.info(f"[CABIN-MANAGER] Started REAL audio processor thread for cabin {cabin_id}")
                
                # Wait a moment to ensure threads started
                time.sleep(0.1)
                
                # Register cabin in manager's tracking registry
                self.cabins[cabin_id] = cabin
                
                # logger.info(f"[CABIN-MANAGER] Successfully created cabin:")
                # logger.info(f"  Cabin ID: {cabin_id}")
                # logger.info(f"  Receive Port: {receive_port}, Send Port: {send_port}")
                # logger.info(f"  Languages: {source_language} -> {target_language}")
                # logger.info(f"  Status: {cabin.status.value}")
                # logger.info(f"  Using SharedSocketManager (2 shared sockets total)")
                
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
        
        # COMMENTED OUT: Sample data testing mode
        # logger.debug(f"[AUDIO-CALLBACK] Ignoring RTP packet for sample data testing: {len(rtp_data)} bytes")
        # return
        #     
        # except Exception as e:
        #     logger.error(f"[AUDIO-CALLBACK] Error processing RTP packet for {cabin.cabin_id}: {e}")

    def _audio_processor(self, cabin: TranslationCabin):
        """
        Audio processor thread - continuously processes audio data from FIFO queue
        """
        # Import here to avoid circular imports
        from service.pipline_processor.translation_pipeline import TranslationPipeline
        
        # logger.info(f"[PROCESSOR] Starting audio processor thread for cabin {cabin.cabin_id}")
        
        # Create new event loop for this thread
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        
        # Initialize translation pipeline
        # logger.info(f"[PROCESSOR] Initializing translation pipeline: {cabin.source_language} -> {cabin.target_language}")
        try:
            pipeline = TranslationPipeline(
                source_language=cabin.source_language,
                target_language=cabin.target_language
            )
            # logger.info(f"[PROCESSOR] Translation pipeline initialized successfully")
        except Exception as e:
            logger.error(f"[PROCESSOR] Failed to initialize translation pipeline: {e}")
            return
        
        processing_count = 0
        bypass_vad = True
        last_log_time = time.time()
        
        try:
            while cabin.running:
                try:
                    # Get audio data from queue (with timeout to allow checking cabin.running)
                    try:
                        audio_data = cabin.audio_queue.get(timeout=1.0)
                        processing_count += 1
                        # if processing_count % 100 == 0:
                        #     logger.info(f"[PROCESSOR] Processing packet #{processing_count}: {len(audio_data)} bytes, queue size: {cabin.audio_queue.qsize()}")
                    except queue.Empty:
                        # if processing_count % 10 == 0:
                        #     current_time = time.time()
                        #     logger.info(f"[PROCESSOR] Queue empty for {processing_count} checks. Last audio: {current_time - cabin.last_packet_time if cabin.last_packet_time else 'never'}s ago")
                        processing_count += 1
                        continue
                    
                    # VAD speech detection
                    has_speech = bypass_vad or cabin.vad.detect_speech(audio_data)
                    
                    # if processing_count % 500 == 0:
                    #     logger.info(f"[DEBUG] VAD result: has_speech={has_speech}, bypass_vad={bypass_vad}, buffer_size={len(cabin.audio_buffer.buffer)} bytes")
                    
                    if not has_speech:
                        # No speech detected → Send original audio as passthrough
                        try:
                            # Convert 16kHz mono back to format suitable for SFU
                            loop.run_until_complete(self._send_audio_to_sfu(cabin, audio_data, "passthrough"))
                        except Exception as e:
                            logger.debug(f"[PASSTHROUGH] Error sending passthrough audio: {e}")
                        continue
                    else:
                        window_info = cabin.audio_buffer.add_audio_chunk(audio_data)
                        
                        buffer_stats = cabin.audio_buffer.get_processing_stats()
                        # if processing_count % 500 == 0:
                        #     logger.info(f"[DEBUG] Buffer stats: {buffer_stats}")

                        if window_info:
                            processing_count += 1
                            cabin.status = CabinStatus.TRANSLATING
                            
                            # logger.info(f"[DEBUG] Processing window #{window_info['window_id']}: {window_info['window_duration']:.2f}s audio")

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
                                # logger.info(f"[DEBUG] Force processing due to long buffer: {buffer_stats['buffer_duration_seconds']:.2f}s")
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
                    
                    # current_time = time.time()
                    # if current_time - last_log_time >= 30.0:
                    #     buffer_stats = cabin.audio_buffer.get_processing_stats()
                    #     logger.info(f"[CABIN-{cabin.cabin_id}] Processing stats (30s interval):")
                    #     logger.info(f"  Packets processed: {processing_count}")
                    #     logger.info(f"  Buffer stats: {buffer_stats}")
                    #     logger.info(f"  Cabin status: {cabin.status.value}")
                    #     logger.info(f"  Queue size: {cabin.audio_queue.qsize()}")
                        
                    #     last_log_time = current_time
                    #     processing_count = 0

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

    # ===============================================================
    # COMMENTED OUT: Sample audio helper methods for testing
    # ===============================================================
    # def _load_sample_audio_from_wav(self, wav_file_path: str) -> bytes:
    #     """Load sample audio from WAV file for testing pipeline"""
    #     import wave
    #     import numpy as np
    #     
    #     try:
    #         logger.info(f"[SAMPLE] Loading audio from WAV file: {wav_file_path}")
    #         
    #         with wave.open(wav_file_path, 'rb') as wav_file:
    #             # Get WAV properties
    #             channels = wav_file.getnchannels()
    #             sample_width = wav_file.getsampwidth()
    #             framerate = wav_file.getframerate()
    #             n_frames = wav_file.getnframes()
    #             duration = n_frames / framerate
    #             
    #             logger.info(f"[SAMPLE] WAV file properties:")
    #             logger.info(f"  Channels: {channels}")
    #             logger.info(f"  Sample width: {sample_width} bytes")
    #             logger.info(f"  Frame rate: {framerate} Hz")
    #             logger.info(f"  Duration: {duration:.2f} seconds")
    #             logger.info(f"  Total frames: {n_frames}")
    #             
    #             # Read all frames
    #             audio_data = wav_file.readframes(n_frames)
    #             
    #             # Convert to numpy array
    #             if sample_width == 1:
    #                 dtype = np.uint8
    #             elif sample_width == 2:
    #                 dtype = np.int16
    #             elif sample_width == 4:
    #                 dtype = np.int32
    #             else:
    #                 raise ValueError(f"Unsupported sample width: {sample_width}")
    #             
    #             audio_array = np.frombuffer(audio_data, dtype=dtype)
    #             
    #             # Convert to mono if stereo
    #             if channels == 2:
    #                 audio_array = audio_array.reshape(-1, 2)
    #                 audio_array = np.mean(audio_array, axis=1).astype(dtype)
    #                 logger.info(f"[SAMPLE] Converted stereo to mono")
    #             
    #             # Resample to 16kHz if needed
    #             if framerate != 16000:
    #                 from scipy import signal
    #                 target_length = int(len(audio_array) * 16000 / framerate)
    #                 audio_array = signal.resample(audio_array, target_length).astype(dtype)
    #                 logger.info(f"[SAMPLE] Resampled from {framerate}Hz to 16000Hz")
    #             
    #             # Ensure 16-bit PCM
    #             if dtype != np.int16:
    #                 if dtype == np.uint8:
    #                     audio_array = ((audio_array.astype(np.float32) - 128) * 256).astype(np.int16)
    #                 elif dtype == np.int32:
    #                     audio_array = (audio_array / 65536).astype(np.int16)
    #                 logger.info(f"[SAMPLE] Converted to 16-bit PCM")
    #             
    #             final_audio_bytes = audio_array.tobytes()
    #             
    #             logger.info(f"[SAMPLE] Loaded and processed audio: {len(audio_array)} samples, {len(final_audio_bytes)} bytes")
    #             return final_audio_bytes
    #             
    #     except Exception as e:
    #         logger.error(f"[SAMPLE] Error loading WAV file {wav_file_path}: {e}")
    #         # Fallback to generated audio
    #         return self._generate_fallback_audio()
    
    # def _generate_fallback_audio(self, duration_seconds: float = 5.0, sample_rate: int = 16000) -> bytes:
    #     """Generate fallback sine wave audio if WAV loading fails"""
    #     import numpy as np
    #     
    #     logger.warning(f"[SAMPLE] Generating fallback sine wave audio ({duration_seconds}s)")
    #     
    #     # Generate multiple tones for more interesting audio
    #     num_samples = int(duration_seconds * sample_rate)
    #     time_array = np.linspace(0, duration_seconds, num_samples, False)
    #     
    #     # Create a mix of frequencies
    #     frequency1 = 440  # A4 note
    #     frequency2 = 554  # C#5 note
    #     frequency3 = 659  # E5 note
    #     amplitude = 0.2   # 20% volume to avoid clipping
    #     
    #     # Generate chord
    #     sine_wave1 = amplitude * np.sin(2 * np.pi * frequency1 * time_array)
    #     sine_wave2 = amplitude * np.sin(2 * np.pi * frequency2 * time_array)
    #     sine_wave3 = amplitude * np.sin(2 * np.pi * frequency3 * time_array)
    #     
    #     # Mix the waves
    #     mixed_wave = (sine_wave1 + sine_wave2 + sine_wave3) / 3
    #     
    #     # Add some volume variation (fade in/out)
    #     fade_duration = 0.5  # 500ms fade
    #     fade_samples = int(fade_duration * sample_rate)
    #     
    #     # Fade in
    #     for i in range(fade_samples):
    #         mixed_wave[i] *= i / fade_samples
    #     
    #     # Fade out
    #     for i in range(fade_samples):
    #         mixed_wave[-(i+1)] *= i / fade_samples
    #     
    #     # Convert to 16-bit PCM
    #     audio_int16 = (mixed_wave * 32767).astype(np.int16)
    #     
    #     logger.warning(f"[SAMPLE] Generated {duration_seconds}s chord audio: {len(audio_int16)} samples, {len(audio_int16.tobytes())} bytes")
    #     return audio_int16.tobytes()
    # ===============================================================

    # COMMENTED OUT: Sample data processor for testing
    # def _process_audio_with_sample_data(self, cabin: TranslationCabin):
    #     """Process using sample audio from WAV file instead of real data - for testing"""
    #     import asyncio
    #     import time
    #     import os
    #     
    #     # Create event loop for this thread
    #     loop = asyncio.new_event_loop()
    #     asyncio.set_event_loop(loop)
    #     
    #     try:
    #         logger.warning(f"[SAMPLE-PROCESSOR] SAMPLE MODE ACTIVATED for cabin {cabin.cabin_id}")
    #         logger.warning(f"[SAMPLE-PROCESSOR] Real audio from SFU will be IGNORED")
    #         
    #         # Initialize translation pipeline (same as in _audio_processor)
    #         logger.info(f"[SAMPLE-PROCESSOR] Initializing translation pipeline: {cabin.source_language} -> {cabin.target_language}")
    #         try:
    #             from service.pipline_processor.translation_pipeline import TranslationPipeline
    #             pipeline = TranslationPipeline(
    #                 source_language=cabin.source_language,
    #                 target_language=cabin.target_language
    #             )
    #             logger.info(f"[SAMPLE-PROCESSOR] Translation pipeline initialized successfully")
    #         except Exception as e:
    #             logger.error(f"[SAMPLE-PROCESSOR] Failed to initialize translation pipeline: {e}")
    #             return
    #         
    #         # Wait a bit for cabin to be ready
    #         time.sleep(2)
    #         
    #         # Try to find WAV file (you can put your WAV file in one of these locations)
    #         possible_wav_paths = [
    #             "/app/sample.wav",  # Inside Docker container
    #             "/tmp/sample.wav",  # Temp directory
    #             "./sample.wav",     # Current directory
    #             "../sample.wav",    # Parent directory
    #             "../../test_script/sample.wav",  # Test script directory (if converted from webm)
    #             "/app/test.wav",    # Alternative names
    #             "/app/audio_sample.wav",
    #             "./test_audio.wav",
    #             "../test_audio.wav",
    #         ]
    #         
    #         sample_audio_data = None
    #         wav_file_used = None
    #         
    #         # Try to load from WAV file first
    #         for wav_path in possible_wav_paths:
    #             if os.path.exists(wav_path):
    #                 logger.info(f"[SAMPLE-PROCESSOR] Found WAV file at: {wav_path}")
    #                 sample_audio_data = self._load_sample_audio_from_wav(wav_path)
    #                 wav_file_used = wav_path
    #                 break
    #         
    #         # If no WAV file found, use fallback
    #         if sample_audio_data is None:
    #             logger.warning(f"[SAMPLE-PROCESSOR] No WAV file found in: {possible_wav_paths}")
    #             logger.warning(f"[SAMPLE-PROCESSOR] Using fallback generated audio (5 seconds)")
    #             sample_audio_data = self._generate_fallback_audio(duration_seconds=5.0)  # Tăng lên 5 giây
    #             wav_file_used = "fallback_generated_5s"
    #         
    #         logger.warning(f"[SAMPLE-PROCESSOR] Processing sample audio from {wav_file_used}: {len(sample_audio_data)} bytes")
    #         
    #         # Set cabin to translating
    #         cabin.status = CabinStatus.TRANSLATING
    #         
    #         # Process the sample audio through pipeline
    #         try:
    #             logger.warning(f"[SAMPLE-PROCESSOR] Starting pipeline processing...")
    #             loop.run_until_complete(
    #                 self._process_audio_window(cabin, pipeline, sample_audio_data)
    #             )
    #             logger.warning(f"[SAMPLE-PROCESSOR] Sample audio processing completed successfully")
    #         except Exception as e:
    #             logger.error(f"[SAMPLE-PROCESSOR] Error processing sample audio: {e}")
    #             import traceback
    #             logger.error(f"[SAMPLE-PROCESSOR] Traceback: {traceback.format_exc()}")
    #             
    #         cabin.status = CabinStatus.LISTENING
    #         
    #         # Keep cabin alive for testing
    #         while cabin.running:
    #             time.sleep(5)
    #             logger.info(f"[SAMPLE-PROCESSOR] Cabin {cabin.cabin_id} still running with sample data from {wav_file_used}...")
    #             
    #     except Exception as e:
    #         logger.error(f"[SAMPLE-PROCESSOR] Error in sample processing: {e}")
    #         cabin.status = CabinStatus.ERROR
    #     finally:
    #         try:
    #             loop.close()
    #         except Exception as e:
    #             logger.error(f"[SAMPLE-PROCESSOR] Error closing event loop: {e}")

    async def _process_audio_window(
        self, 
        cabin: TranslationCabin, 
        pipeline: 'TranslationPipeline', 
        audio_window: bytes
    ):
        """
        Process audio window through translation pipeline
        """
        start_time = time.time()
        
        try:
            # logger.info(f"[PROCESSING] REAL MODE: Starting window processing: {len(audio_window)} bytes")
            
            wav_data = AudioProcessingUtils.pcm_to_wav_bytes(audio_window)
            # logger.info(f"[PROCESSING] Converted to WAV: {len(wav_data)} bytes")
            
            # logger.info(f"[PROCESSING] Sending to translation pipeline...")
            result = await pipeline.process_audio(wav_data)
            
            processing_time = (time.time() - start_time) * 1000
            
            # logger.info(f"[PROCESSING] Pipeline result: success={result.get('success')}, has_audio={bool(result.get('translated_audio'))}")
            
            if result['success'] and result.get('translated_audio'):
                translated_audio = result['translated_audio']
                # logger.info(f"[PROCESSING] Got translated audio: {len(translated_audio)} bytes")
                
                # Debug audio format
                # import struct
                # if len(translated_audio) >= 10:
                #     try:
                #         first_samples = struct.unpack('<5h', translated_audio[:10])
                #         logger.info(f"[PROCESSING] First 5 samples of translated audio: {first_samples}")
                        
                #         # Check if audio contains actual signal (not silence)
                #         max_sample = max(abs(s) for s in first_samples)
                #         logger.info(f"[PROCESSING] Max sample value: {max_sample} (normal range: 0-32767)")
                        
                #         if max_sample < 100:
                #             logger.warning(f"[PROCESSING] Audio seems very quiet or silent! Max sample: {max_sample}")
                        
                #     except Exception as e:
                #         logger.error(f"[PROCESSING] Error analyzing audio samples: {e}")
                
                # logger.info(f"[PROCESSING] Sending to SFU...")
                success = await self._send_audio_to_sfu(cabin, translated_audio, "translated")
                
                if success:
                    # logger.info(f"[PROCESSING] REAL MODE SUCCESS: Translated and sent audio in {processing_time:.2f}ms")
                    pass
                else:
                    logger.error(f"[PROCESSING] FAILED to send translated audio to SFU")
            else:
                logger.error(f"[PROCESSING] Translation failed or no audio generated: {result}")
            
        except Exception as e:
            processing_time = (time.time() - start_time) * 1000
            import traceback
            logger.error(f"[PROCESSING] ERROR in {processing_time:.2f}ms: {e}")
            logger.error(f"[PROCESSING] Traceback: {traceback.format_exc()}")

    # def _send_rtp_to_sfu(self, cabin: TranslationCabin, pcm_audio_data: bytes) -> bool:
    #     """
    #     Send RTP packets to SFU using SharedSocketManager
    #     """
    #     try:
    #         # Get SFU connection details
    #         # Use send_port (which is the port SFU receiveTransport listens on)
    #         sfu_host = "192.168.1.10"
    #         sfu_port = cabin.send_port  # This is where SFU is expecting RTP packets
            
    #         # logger.warning(f"[RTP-SEND] SENDING SAMPLE AUDIO to SFU at {sfu_host}:{sfu_port}")
    #         # logger.info(f"[RTP-SEND] Input PCM data: {len(pcm_audio_data)} bytes")
            
    #         # Initialize RTP state if not exists
    #         if not cabin._rtp_ssrc:
    #             cabin._rtp_timestamp = int(time.time() * 48000)
    #             cabin._rtp_ssrc = cabin.ssrc or (hash(cabin.cabin_id) & 0xFFFFFFFF)
    #             # logger.info(f"[RTP-SEND] Initialized RTP state for cabin {cabin.cabin_id}, SSRC: {cabin._rtp_ssrc}")
            
    #         # Convert and encode PCM to Opus using codec utils
    #         # logger.warning(f"[RTP-SEND] Step 1: Upsampling {len(pcm_audio_data)} bytes PCM 16kHz to 48kHz stereo...")
    #         # logger.info(f"[RTP-SEND] Input audio analysis: {len(pcm_audio_data)} bytes = {len(pcm_audio_data)/2} samples = {len(pcm_audio_data)/2/16000:.2f}s")
            
    #         pcm_48k_stereo = AudioProcessingUtils.upsample_to_48k_stereo(pcm_audio_data, 16000)
    #         if not pcm_48k_stereo:
    #             logger.error("[RTP-SEND] Failed to upsample PCM")
    #             return False
    #         # logger.info(f"[RTP-SEND] Step 1 SUCCESS: Upsampled to {len(pcm_48k_stereo)} bytes")
    #         # logger.info(f"[RTP-SEND] 48kHz stereo analysis: {len(pcm_48k_stereo)} bytes = {len(pcm_48k_stereo)/4} samples = {len(pcm_48k_stereo)/4/48000:.2f}s")
            
    #         # Check first few samples of audio data
    #         # import struct
    #         # if len(pcm_audio_data) >= 10:
    #         #     first_samples = struct.unpack('<5h', pcm_audio_data[:10])
    #         #     logger.info(f"[RTP-SEND] First 5 samples of 16kHz PCM: {first_samples}")
            
    #         # if len(pcm_48k_stereo) >= 20:
    #         #     first_samples_48k = struct.unpack('<5h', pcm_48k_stereo[:10])
    #         #     logger.info(f"[RTP-SEND] First 5 samples of 48kHz stereo: {first_samples_48k}")
            
    #         # logger.info(f"[RTP-SEND] Step 2: Encoding {len(pcm_48k_stereo)} bytes PCM to Opus...")
    #         opus_payload = opus_codec_manager.encode_pcm_to_opus(cabin.cabin_id, pcm_48k_stereo)
    #         if not opus_payload:
    #             logger.error("[RTP-SEND] Failed to encode PCM to Opus")
    #             return False
    #         # logger.warning(f"[RTP-SEND] Step 2 SUCCESS: Encoded to {len(opus_payload)} bytes Opus (compression ratio: {len(pcm_48k_stereo)/len(opus_payload):.1f}:1)")
            
    #         # Increment sequence number and timestamp
    #         cabin._rtp_seq_num = (cabin._rtp_seq_num + 1) & 0xFFFF
    #         cabin._rtp_timestamp = (cabin._rtp_timestamp + 960) & 0xFFFFFFFF
            
    #         # logger.info(f"[RTP-SEND] Step 3: Creating RTP packet (seq={cabin._rtp_seq_num}, ts={cabin._rtp_timestamp}, ssrc={cabin._rtp_ssrc})...")
    #         # Create RTP packet using utility
    #         rtp_packet = RTPUtils.create_rtp_packet(
    #             opus_payload, 100, cabin._rtp_seq_num, cabin._rtp_timestamp, cabin._rtp_ssrc
    #         )
    #         # logger.info(f"[RTP-SEND] Step 3 SUCCESS: Created RTP packet {len(rtp_packet)} bytes")
            
    #         # Send using SharedSocketManager
    #         # logger.info(f"[RTP-SEND] Step 4: Sending RTP packet via SharedSocketManager...")
    #         success = self.socket_manager.send_rtp_to_sfu(rtp_packet, sfu_host, sfu_port)
    #         # if success:
    #         #     logger.warning(f"[RTP-SEND] SENT SAMPLE AUDIO via SharedSocketManager ({len(opus_payload)} bytes Opus payload)")
    #         # else:
    #         #     logger.error(f"[RTP-SEND] Failed to send via SharedSocketManager")
    #         return success
            
    #     except Exception as e:
    #         logger.error(f"[RTP-SEND] Error sending to SFU: {e}")
    #         import traceback
    #         logger.error(f"[RTP-SEND] Traceback: {traceback.format_exc()}")
    #         return False

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
                # logger.info(f"[RTP-CHUNKS] Extracted WAV: {len(pcm16)} samples @ {src_sr}Hz")
                
                # **QUAN TRỌNG**: Kiểm tra audio quality
                # max_abs = np.max(np.abs(pcm16))
                # min_val = np.min(pcm16)
                max_val = np.max(pcm16)
                # zero_count = np.sum(pcm16 == 0)
                
                # logger.info(f"[RTP-CHUNKS] Audio analysis: max_abs={max_abs}, range=[{min_val}, {max_val}], zeros={zero_count}/{len(pcm16)}")
                
                # if max_abs < 1000:
                #     logger.warning(f"[RTP-CHUNKS] Audio seems very quiet (max={max_abs})")
                # if zero_count > len(pcm16) * 0.1:
                #     logger.warning(f"[RTP-CHUNKS] Too many zero samples: {zero_count}/{len(pcm16)} ({zero_count/len(pcm16)*100:.1f}%)")
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
                    # logger.info(f"[RTP-CHUNKS] Normalized by factor {max_val:.3f}")
                
                pcm16 = (x_48k * 32767.0).astype(np.int16)
                # logger.info(f"[RTP-CHUNKS] DIRECT resample: {src_sr}Hz → 48kHz, samples: {len(pcm_arr)} → {len(pcm16)}")
            else:
                # logger.info(f"[RTP-CHUNKS] No resample needed: already 48kHz")
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
            
            # Log noise reduction stats
            # silenced = np.sum(~mask_expanded)
            # logger.info(f"[RTP-CHUNKS] Noise gate: silenced {silenced}/{len(pcm16)} samples ({silenced/len(pcm16)*100:.1f}%)")
            
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

            # logger.warning(f"[RTP-CHUNKS] Streaming {len(chunks)} x 20ms chunks ({len(pcm16)/48000:.2f}s)")

            # --- 4) RTP state ---
            if not cabin._rtp_ssrc:
                cabin._rtp_timestamp = int(time.time() * 48000)
                cabin._rtp_ssrc = cabin.ssrc or (hash(cabin.cabin_id) & 0xFFFFFFFF)

            success_count = 0
            
            encoded_chunks = []
            # logger.info(f"[RTP-CHUNKS] Pre-encoding {len(chunks)} chunks...")
            
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
                # if idx % 50 == 0:
                #     logger.info(f"[RTP-CHUNKS] Pre-encoded {idx}/{len(chunks)}")
            
            # logger.info(f"[RTP-CHUNKS] Starting real-time streaming...")
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
                    # if idx % 50 == 0:
                    #     logger.info(f"[RTP-CHUNKS] Progress {idx}/{len(chunks)}")
                
                # Precise timing thay vì sleep cố định
                current_time = time.time()
                if current_time < expected_time:
                    sleep_time = expected_time - current_time
                    if sleep_time > 0.001:  
                        time.sleep(sleep_time)
                elif current_time > expected_time + 0.010:
                    # logger.debug(f"[RTP-CHUNKS] Chunk {idx} late by {(current_time - expected_time)*1000:.1f}ms")
                    pass

            # logger.warning(f"[RTP-CHUNKS] Streamed {success_count}/{len(chunks)} chunks")
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
            # if not success:
            #     logger.error(f"[{audio_type.upper()}] Failed to send {audio_type} audio via chunks")
            #     # Fallback to original method
            #     success = self._send_rtp_to_sfu(cabin, audio_data)
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
        Update cabin's languages (used in B3 step)
        """
        try:
            cabin = self.cabins.get(cabin_id)
            if not cabin:
                logger.error(f"[CABIN-MANAGER] Cabin {cabin_id} not found for language update")
                return False
            
            # Update languages
            cabin.source_language = source_language
            cabin.target_language = target_language
            
            # Update cabin ID if needed
            new_cabin_id = f"{cabin.room_id}_{cabin.user_id}_{source_language}_{target_language}"
            if new_cabin_id != cabin_id:
                # Move cabin to new ID
                cabin.cabin_id = new_cabin_id
                self.cabins[new_cabin_id] = cabin
                del self.cabins[cabin_id]
                # logger.info(f"[CABIN-MANAGER] Updated cabin ID: {cabin_id} → {new_cabin_id}")
            
            # logger.info(f"[CABIN-MANAGER] Updated cabin languages: {source_language} → {target_language}")
            return True
            
        except Exception as e:
            logger.error(f"[CABIN-MANAGER] Error updating cabin languages: {e}")
            return False

    def update_cabin_sfu_port(self, cabin_id: str, sfu_send_port: int) -> bool:
        """
        Update cabin's real SFU send port (called after SFU creates receiveTransport)
        """
        try:
            cabin = self.cabins.get(cabin_id)
            if not cabin:
                logger.error(f"[CABIN-MANAGER] Cabin {cabin_id} not found for port update")
                return False
            
            cabin.sfu_send_port = sfu_send_port
            # logger.info(f"[CABIN-MANAGER] Updated cabin {cabin_id} SFU port to {sfu_send_port}")
            return True
            
        except Exception as e:
            logger.error(f"[CABIN-MANAGER] Error updating SFU port for cabin {cabin_id}: {e}")
            return False
        
    async def _cleanup_cabin_resources(self, cabin_id: str):
        """
        Enhanced cleanup for translation cabin resources
        """
        try:
            cabin = self.cabins.get(cabin_id)
            if not cabin:
                return
            
            # Stop cabin processing
            cabin.running = False
            
            # Wait for both threads to finish
            if cabin.thread and cabin.thread.is_alive():
                cabin.thread.join(timeout=2.0)
            
            if cabin.processor_thread and cabin.processor_thread.is_alive():
                cabin.processor_thread.join(timeout=2.0)
            
            # Release both allocated ports
            if cabin.rtp_port:
                port_manager.release_port(cabin.rtp_port)
            
            if cabin.send_port:
                port_manager.release_port(cabin.send_port)
            
            # Clear audio buffers and queue
            cabin.audio_buffer.clear()
            
            # Clear remaining items in audio queue
            while not cabin.audio_queue.empty():
                try:
                    cabin.audio_queue.get_nowait()
                except queue.Empty:
                    break
            
            # Close optimized send socket if exists
            if hasattr(cabin, '_send_socket') and cabin._send_socket:
                try:
                    cabin._send_socket.close()
                    cabin._send_socket = None
                except Exception as e:
                    logger.error(f"[CLEANUP] Error closing send socket: {e}")
            
            # Close Opus encoder if exists
            if hasattr(cabin, '_opus_encoder') and cabin._opus_encoder:
                try:
                    cabin._opus_encoder = None
                except Exception as e:
                    logger.error(f"[CLEANUP] Error cleaning up Opus encoder: {e}")
            
            # Shared socket managed by SharedSocketManager, không cần đóng
            # Remove from cabin tracking
            del self.cabins[cabin_id]
            
        except Exception as e:
            logger.error(f"[CLEANUP] Error in cabin cleanup: {e}")

    def destroy_cabin(self, room_id: str, 
        user_id: str,
        source_language: str = "vi",
        target_language: str = "en",) -> bool:
        """
        Destroy cabin and cleanup resources using SharedSocketManager
        """
        cabin_id = f"{room_id}_{user_id}_{source_language}_{target_language}"
        try:
            with self._lock:
                cabin = self.cabins.pop(cabin_id, None)
                if not cabin:
                    logger.warning(f"[CABIN-MANAGER] Cabin {cabin_id} not found for destruction")
                    return False
                
                # Stop cabin processing
                cabin.running = False
                
                # Wait for processor thread to finish
                if cabin.processor_thread and cabin.processor_thread.is_alive():
                    cabin.processor_thread.join(timeout=2.0)
                
                # Unregister from SharedSocketManager routing system
                self.socket_manager.unregister_cabin(cabin_id)
                
                # Cleanup codec resources using codec_utils
                opus_codec_manager.cleanup_cabin(cabin_id)
                
                # Clear audio buffers and queue
                cabin.audio_buffer.clear()
                while not cabin.audio_queue.empty():
                    try:
                        cabin.audio_queue.get_nowait()
                    except queue.Empty:
                        break
                
                # logger.info(f"[CABIN-MANAGER] Destroyed cabin {cabin_id}")
                return True
                
        except Exception as e:
            logger.error(f"[CABIN-MANAGER] Error destroying cabin {cabin_id}: {e}")
            return False

    def get_cabin_info(self, cabin_id: str) -> Optional[Dict[str, Any]]:
        """
        Get information about a specific cabin
        """
        cabin = self.cabins.get(cabin_id)
        if not cabin:
            return None
        
        # Calculate timing metrics if available
        timing_info = {}
        if cabin.first_packet_time and cabin.last_packet_time:
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
            "sfu_send_port": cabin.sfu_send_port,  # Real SFU port
            "source_language": cabin.source_language,
            "target_language": cabin.target_language,
            "status": cabin.status.value,
            "room_id": cabin.room_id,
            "user_id": cabin.user_id,
            "running": cabin.running,
            "timing_validation": timing_info
        }

cabin_manager = TranslationCabinManager()
