import logging
import struct
import io
import wave
from typing import Optional, Tuple
import numpy as np
import opuslib
from scipy.signal import resample
from scipy.signal import resample_poly

logger = logging.getLogger(__name__)

class OpusCodecManager:
    """Centralized Opus encoder/decoder management"""
    
    def __init__(self):
        self._decoders = {}  # cabin_id -> decoder
        self._encoders = {}  # cabin_id -> encoder
    
    def get_decoder(self, cabin_id: str, sample_rate: int = 48000, channels: int = 2) -> opuslib.Decoder:
        """Get or create Opus decoder for cabin"""
        if cabin_id not in self._decoders:
            self._decoders[cabin_id] = opuslib.Decoder(sample_rate, channels)
            logger.debug(f"[CODEC] Created Opus decoder for {cabin_id}: {sample_rate}Hz, {channels}ch")
        return self._decoders[cabin_id]

    def get_encoder(self, cabin_id: str, sample_rate: int = 48000, channels: int = 2) -> opuslib.Encoder:
        """Get or Create Opus Encoder - SIMPLIFIED for SFU compatibility"""
        if cabin_id not in self._encoders:
            # Create basic encoder matching SFU expectations
            enc = opuslib.Encoder(48000, 2, opuslib.APPLICATION_AUDIO)

            try:
                enc.bitrate = 128000  # 128kbps as shown in logs
            except Exception as e:
                logger.warning(f"[CODEC] Basic Opus creation failed for {cabin_id}: {e}")
                
            self._encoders[cabin_id] = enc
        return self._encoders[cabin_id]
    
    def decode_opus(self, cabin_id: str, opus_payload: bytes) -> bytes:
        """Decode Opus payload to PCM"""
        try:
            if len(opus_payload) == 0:
                logger.warning("[DECODE] ⚠️ Empty Opus payload")
                return b''
            
            if len(opus_payload) < 3 or len(opus_payload) > 1276:
                logger.warning(f"[DECODE] ⚠️ Invalid payload size: {len(opus_payload)} bytes")
                return b''
            
            decoder = self.get_decoder(cabin_id)
            
            # Try decode with 20ms frame size (960 samples per channel at 48kHz)
            try:
                pcm_data = decoder.decode(opus_payload, 960)
                # Only log failures and first success
                if not hasattr(self, '_first_decode_logged'):
                    logger.info(f"[DECODE] ✅ First decode: {len(opus_payload)} bytes → {len(pcm_data)} PCM bytes")
                    self._first_decode_logged = True
                return pcm_data
            except opuslib.OpusError as e:
                # Try other common frame sizes
                for frame_size in [480, 1920, 2880]:
                    try:
                        pcm_data = decoder.decode(opus_payload, frame_size)
                        logger.info(f"[DECODE] ✅ Success with frame_size={frame_size}: {len(pcm_data)} PCM bytes")
                        return pcm_data
                    except opuslib.OpusError:
                        continue
                
                logger.error(f"[DECODE] ❌ All frame sizes failed: {len(opus_payload)} bytes, error: {e}")
                return b''
                
        except Exception as e:
            logger.error(f"[DECODE] ❌ Unexpected error: {e}")
            return b''
    
    def encode_pcm_to_opus(self, cabin_id: str, pcm_data: bytes, sample_rate: int = 48000) -> bytes:
        """Encode PCM to Opus"""
        try:
            if not pcm_data or len(pcm_data) == 0:
                return b''
            
            encoder = self.get_encoder(cabin_id)
            
            # Frame size for 20ms at 48kHz stereo
            frame_size = 960
            stereo_frame_size = frame_size * 2  # 2 channels
            frame_size_bytes = stereo_frame_size * 2  # 2 bytes per sample
            
            if len(pcm_data) >= frame_size_bytes:
                frame_data = pcm_data[:frame_size_bytes]
                opus_frame = encoder.encode(frame_data, frame_size)
                return opus_frame
            else:
                # Pad to minimum frame size
                padded_data = pcm_data + b'\x00' * (frame_size_bytes - len(pcm_data))
                opus_frame = encoder.encode(padded_data, frame_size)
                return opus_frame
                
        except Exception as e:
            logger.error(f"[ENCODE] Error encoding for {cabin_id}: {e}")
            return b''
    
    def cleanup_cabin(self, cabin_id: str):
        """Cleanup codec resources for cabin"""
        if cabin_id in self._decoders:
            del self._decoders[cabin_id]
        if cabin_id in self._encoders:
            del self._encoders[cabin_id]
        logger.debug(f"[CODEC] Cleaned up codec resources for {cabin_id}")

class AudioProcessingUtils:
    """Audio processing utilities"""
    
    @staticmethod
    def pcm_to_wav_bytes(pcm_data: bytes, sample_rate: int = 16000, channels: int = 1, sample_width: int = 2) -> bytes:
        """Convert raw PCM data to WAV format in memory"""
        wav_buffer = io.BytesIO()
        with wave.open(wav_buffer, 'wb') as wav_file:
            wav_file.setnchannels(channels)
            wav_file.setsampwidth(sample_width)
            wav_file.setframerate(sample_rate)
            wav_file.writeframes(pcm_data)
        return wav_buffer.getvalue()
    
    @staticmethod
    def extract_pcm_from_wav(wav_data: bytes) -> Tuple[np.ndarray, int]:
        """Extract PCM samples and sample rate from WAV data"""
        try:
            wav_buffer = io.BytesIO(wav_data)
            with wave.open(wav_buffer, 'rb') as wav_file:
                sample_rate = wav_file.getframerate()
                num_channels = wav_file.getnchannels()
                sample_width = wav_file.getsampwidth()
                
                frames = wav_file.readframes(wav_file.getnframes())
                
                if sample_width == 2:  # 16-bit
                    pcm_data = np.frombuffer(frames, dtype=np.int16)
                else:
                    raise ValueError(f"Unsupported sample width: {sample_width}")
                
                # Convert stereo to mono if needed
                if num_channels == 2:
                    pcm_data = pcm_data.reshape(-1, 2)
                    pcm_data = np.mean(pcm_data, axis=1).astype(np.int16)
                
                return pcm_data, sample_rate
                
        except Exception as e:
            logger.error(f"[WAV-PARSE] Error extracting PCM from WAV: {e}")
            return np.array([]), 0
    
    @staticmethod
    def downsample_48k_to_16k(pcm_bytes: bytes) -> bytes:
        """Downsample stereo PCM audio from 48kHz to 16kHz and convert to mono"""
        try:
            if not pcm_bytes or len(pcm_bytes) == 0:
                return b''
                
            # Parse as stereo (2 channels) 16-bit PCM
            pcm_stereo = np.frombuffer(pcm_bytes, dtype=np.int16)
            if len(pcm_stereo) == 0:
                return b''
            
            # Check if we have valid stereo data (even number of samples)
            if len(pcm_stereo) % 2 != 0:
                pcm_stereo = pcm_stereo[:-1]
                
            if len(pcm_stereo) == 0:
                return b''
            
            # Reshape to stereo format [samples, 2]
            pcm_2ch = pcm_stereo.reshape(-1, 2)
            pcm_mono_48k = np.mean(pcm_2ch, axis=1).astype(np.int16)
            
            # Calculate target length for 16kHz
            target_length = int(len(pcm_mono_48k) * 16000 / 48000)
            if target_length == 0:
                return b''
                
            # Downsample from 48kHz to 16kHz
            resampled = resample(pcm_mono_48k, target_length)
            return resampled.astype(np.int16).tobytes()
            
        except Exception as e:
            logger.error(f"[DOWNSAMPLE] Error processing stereo audio: {e}")
            return b''
    @staticmethod
    def upsample_to_48k_stereo(pcm_data: bytes, source_sample_rate: int) -> bytes:
        """
        Upsample mono PCM to 48kHz stereo với chất lượng cao, tránh artifacts
        """
        try:
            if not pcm_data:
                return b''

            # Processing WAV vs Raw PCM
            if pcm_data.startswith(b'RIFF'):
                pcm_samples, actual_sr = AudioProcessingUtils.extract_pcm_from_wav(pcm_data)
                source_sample_rate = actual_sr
            else:
                pcm_samples = np.frombuffer(pcm_data, dtype=np.int16)

            if len(pcm_samples) == 0:
                return b''

            # **Important **: Only Resample if really necessary
            if source_sample_rate == 48000:
                pcm_48k_mono = pcm_samples
                logger.debug(f"[UPSAMPLE] No resampling needed: already 48kHz")
            else:
               # Use High-quality Resampling with anti-aliasing
                from scipy.signal import butter, sosfilt
                
                # Convert to float for processing
                x = pcm_samples.astype(np.float32) / 32767.0
                
                # Apply anti-aliasing filter nếu upsampling
                if source_sample_rate < 48000:
                    # Low-pass filter at source Nyquist để tránh aliasing
                    nyquist = source_sample_rate / 2
                    cutoff = nyquist * 0.95  # 95% of Nyquist frequency
                    sos = butter(6, cutoff / (48000/2), btype='low', output='sos')
                    x = sosfilt(sos, x)
                
                # Resample with proper windowing
                x_48k = resample_poly(x, 48000, source_sample_rate, window=('kaiser', 8.0))
                
                # Normalize to prevent clipping
                max_val = np.max(np.abs(x_48k))
                if max_val > 1.0:
                    x_48k = x_48k / max_val
                    logger.debug(f"[UPSAMPLE] Normalized by factor {max_val:.3f}")
                
                pcm_48k_mono = (x_48k * 32767.0).astype(np.int16)
                logger.debug(f"[UPSAMPLE] Resampled {source_sample_rate}Hz → 48kHz")

            # Convert mono to stereo (duplicate channels)
            pcm_48k_stereo = np.column_stack((pcm_48k_mono, pcm_48k_mono)).reshape(-1)

            # Ensure Opus frame alignment (960 samples/channel * 2 channels = 1920 total)
            opus_frame_samples = 1920
            current_length = len(pcm_48k_stereo)
            remainder = current_length % opus_frame_samples
            
            if remainder != 0:
                # Pad with fade-out thay vì zeros để tránh clicks
                pad_length = opus_frame_samples - remainder
                if pad_length <= 480:  # Short padding - use fade
                    last_samples = pcm_48k_stereo[-min(480, current_length):]
                    fade_samples = np.linspace(1.0, 0.0, len(last_samples))
                    faded = (last_samples * fade_samples).astype(np.int16)
                    padding = np.tile(faded[-1], pad_length)  # Repeat last sample
                else:
                    padding = np.zeros(pad_length, dtype=np.int16)  # Long padding - use zeros
                
                pcm_48k_stereo = np.concatenate([pcm_48k_stereo, padding])
                logger.debug(f"[UPSAMPLE] Padded {pad_length} samples for Opus alignment")

            return pcm_48k_stereo.astype(np.int16).tobytes()

        except Exception as e:
            logger.error(f"[UPSAMPLE] Error upsampling audio: {e}")
            import traceback
            logger.error(f"[UPSAMPLE] Traceback: {traceback.format_exc()}")
            return b''
        
class RTPUtils:
    """RTP packet utilities"""
    
    @staticmethod
    def parse_rtp_header(rtp_data: bytes) -> Optional[dict]:
        """Parse RTP header and return payload"""
        try:
            if len(rtp_data) < 12:
                return None
            
            header = struct.unpack('!BBHII', rtp_data[:12])
            version = (header[0] >> 6) & 0x3
            padding = (header[0] >> 5) & 0x1
            extension = (header[0] >> 4) & 0x1
            cc = header[0] & 0xF  # CSRC count
            marker = (header[1] >> 7) & 0x1
            payload_type = header[1] & 0x7F
            sequence = header[2]
            timestamp = header[3]
            ssrc = header[4]
            
            if version != 2:
                return None
            
            # Calculate header length
            header_length = 12 + (cc * 4)
            
            if extension:
                if len(rtp_data) < header_length + 4:
                    return None
                ext_header = struct.unpack('!HH', rtp_data[header_length:header_length+4])
                ext_length = ext_header[1] * 4
                header_length += 4 + ext_length
            
            # Handle padding
            payload_end = len(rtp_data)
            if padding and len(rtp_data) > header_length:
                padding_length = rtp_data[-1]
                if padding_length <= len(rtp_data) - header_length:
                    payload_end -= padding_length
            
            if header_length >= payload_end:
                return None
            
            payload = rtp_data[header_length:payload_end]
            
            return {
                'version': version,
                'padding': padding,
                'extension': extension,
                'marker': marker,
                'payload_type': payload_type,
                'sequence': sequence,
                'timestamp': timestamp,
                'ssrc': ssrc,
                'payload': payload
            }
            
        except Exception as e:
            logger.error(f"[RTP-PARSE] Error parsing RTP header: {e}")
            return None
    
    @staticmethod
    def create_rtp_packet(payload: bytes, payload_type: int, sequence: int, timestamp: int, ssrc: int) -> bytes:
        """Create RTP packet with payload"""
        try:
            rtp_header = struct.pack(
                '!BBHII',
                0x80,           # V=2, P=0, X=0, CC=0
                payload_type,   # M=0, PT=payload_type
                sequence,       # Sequence number
                timestamp,      # Timestamp
                ssrc           # SSRC
            )
            return rtp_header + payload
            
        except Exception as e:
            logger.error(f"[RTP-CREATE] Error creating RTP packet: {e}")
            return b''

# Global instances
opus_codec_manager = OpusCodecManager()
