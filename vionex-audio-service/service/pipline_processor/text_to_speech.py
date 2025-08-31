import numpy as np
from core.model import tts_model 
import io
from scipy.io.wavfile import write as write_wav
import os
from scipy.signal import resample_poly
import logging

logger = logging.getLogger(__name__)
# Default speaker audio file path - prioritize Docker mount path, fallback to local
# Docker mount path where XTTS-v2 model is mounted
DOCKER_SPEAKER_WAV = "/root/.local/share/tts/tts_models--multilingual--multi-dataset--xtts_v2/samples/en_sample.wav"
TARGET_SR = 16000
# Local development path
_current_dir = os.path.dirname(os.path.abspath(__file__))
_service_root = os.path.dirname(os.path.dirname(_current_dir))  # Go up 2 levels to vionex-audio-service
LOCAL_SPEAKER_WAV = os.path.join(_service_root, "models", "XTTS-v2", "samples", "en_sample.wav")

# Use Docker path if exists, otherwise fallback to local path
DEFAULT_SPEAKER_WAV = DOCKER_SPEAKER_WAV if os.path.exists(DOCKER_SPEAKER_WAV) else LOCAL_SPEAKER_WAV

def get_default_speaker_embedding():
    """
    Get default speaker embedding from default audio file
    Returns:
        np.ndarray: Default speaker embedding
    """
    try:
        if not os.path.exists(DEFAULT_SPEAKER_WAV):
            raise FileNotFoundError(f"Default speaker audio file not found: {DEFAULT_SPEAKER_WAV}")
        
        # Check if TTS model has the method
        if hasattr(tts_model, 'get_speaker_embedding'):
            speaker_embedding = tts_model.get_speaker_embedding(DEFAULT_SPEAKER_WAV)
        elif hasattr(tts_model, 'speaker_manager'):
            # Alternative method for newer versions
            speaker_embedding = tts_model.speaker_manager.get_speaker_embedding(DEFAULT_SPEAKER_WAV)
        else:
            print("TTS model doesn't support speaker embedding extraction")
            return None
            
        return speaker_embedding
    except Exception as e:
        print(f"Error getting default speaker embedding: {e}")
        return None

def tts(text: str, language: str = "en", speaker_embedding: np.ndarray = None, speaker_wav_path: str = None, return_format: str = "wav") -> bytes:
    """
    Convert text to speech using a text-to-speech model.
    Args:
        text (str): The text to convert to speech.
        language (str): Target language for TTS (en, vi, lo, etc.)
        speaker_embedding (np.ndarray, optional): Speaker embedding for personalized voice synthesis.
        speaker_wav_path (str, optional): Path to speaker audio file for voice cloning.
            If both are None, uses a default approach.
    Returns:
        bytes: The audio data in WAV format.
    """
    try:
        # Validate input
        if not text or not text.strip():
            raise ValueError("Text input is empty or None")
        
        # Language mapping for XTTS
        xtts_lang_map = {
            "vi": "vi",
            "en": "en", 
            "lo": "en"  # Fallback to English for Lao (XTTS may not support Lao directly)
        }
        
        xtts_language = xtts_lang_map.get(language, "en")
        
        # Generate waveform từ text
        if speaker_embedding is not None:
            wav = tts_model.tts(text=text, speaker_embedding=speaker_embedding, language=xtts_language)
        else:
            # Check if default speaker file exists
            if not os.path.exists(DEFAULT_SPEAKER_WAV):
                raise FileNotFoundError(f"Default speaker audio file not found: {DEFAULT_SPEAKER_WAV}")
            
            wav = tts_model.tts(text=text, speaker_wav=DEFAULT_SPEAKER_WAV, language=xtts_language)

        if wav is None:
            raise RuntimeError("TTS model returned None")
        
        # Check waveform type and convert properly
        if hasattr(wav, 'numpy'):  # If it's a tensor
            wav = wav.numpy()
            
        wav = np.array(wav)
        
        # **Important **: Return to Native Sample Rate from TTS to avoid Resampling unnecessary
        src_sr = getattr(tts_model, "output_sample_rate", None)
        if not src_sr:
            # **Actual test **: log to determine the actual sample rate
            estimated_sr = len(wav) / 4.0  # Rough estimate based on typical 4s audio
            if 20000 <= estimated_sr <= 25000:
                src_sr = 22050  # Common XTTS rate
                logger.info(f"[TTS] Detected likely sample rate: {src_sr}Hz (estimated from length)")
            elif 23000 <= estimated_sr <= 25000:
                src_sr = 24000
                logger.info(f"[TTS] Detected likely sample rate: {src_sr}Hz (estimated from length)")
            else:
                src_sr = 22050  # Safe fallback
                logger.warning(f"[TTS] Unable to detect sample rate, using fallback: {src_sr}Hz (audio length: {len(wav)})")
        
        logger.info(f"[TTS] Audio info: {len(wav)} samples @ {src_sr}Hz = {len(wav)/src_sr:.2f}s")
        
        # # **KIỂM TRA CHẤT LƯỢNG AUDIO TỪ TTS**
        # wav_stats = {
        #     'min': float(np.min(wav)),
        #     'max': float(np.max(wav)),
        #     'mean': float(np.mean(wav)),
        #     'std': float(np.std(wav)),
        #     'zeros': int(np.sum(np.abs(wav) < 1e-6)),
        #     'low_energy': int(np.sum(np.abs(wav) < 0.01))  # Very quiet samples
        # }
        # logger.info(f"[TTS] Audio quality: min={wav_stats['min']:.3f}, max={wav_stats['max']:.3f}, std={wav_stats['std']:.3f}, zeros={wav_stats['zeros']}/{len(wav)}, low_energy={wav_stats['low_energy']}/{len(wav)}")
        
        # if wav_stats['std'] < 0.01:
        #     logger.warning(f"[TTS] Audio seems too quiet (std={wav_stats['std']:.3f})")
        # if wav_stats['zeros'] > len(wav) * 0.05:  # More than 5% silence
        #     logger.warning(f"[TTS] Too many silent samples: {wav_stats['zeros']}/{len(wav)} ({wav_stats['zeros']/len(wav)*100:.1f}%)")
        # if wav_stats['low_energy'] > len(wav) * 0.15:  # More than 15% low energy
        #     logger.warning(f"[TTS] Too many low-energy samples: {wav_stats['low_energy']}/{len(wav)} ({wav_stats['low_energy']/len(wav)*100:.1f}%)")
        
        # **TUNE 4**: Audio Post-Processing to improve Quality
        # Gentle amplification for quiet audio
        max_abs = np.max(np.abs(wav))
        if max_abs < 0.3:  # Audio too quiet
            amplification = min(0.7 / max_abs, 3.0)  # Max 3x amplification
            wav = wav * amplification
            # logger.info(f"[TTS] Applied amplification: {amplification:.2f}x (max was {max_abs:.3f})")

        # **Important **: Normalize, not resample here
        # Let Audio Service decide to Sample Rate Processing
        wav = np.clip(wav, -1.0, 1.0)
        pcm16 = (wav * 32767.0).astype(np.int16)

        if return_format == "pcm16":
            return pcm16.tobytes()
        
        # Returns wav with Native Sample Rate (not Force 16KHz)
        buf = io.BytesIO()
        write_wav(buf, rate=src_sr, data=pcm16) 
        out = buf.getvalue()
        buf.close()
        return out
        
    except Exception as e:
        print(f"TTS Error Details: {type(e).__name__}: {str(e)}")
        raise 

def clone_and_save_embedding(audio_path: str, embedding_path: str):
    """
    Clone voice from audio file and save embedding
    Args:
        audio_path (str): Path to the audio file for cloning.
        embedding_path (str): Path to save the speaker embedding.
    Returns:
        np.ndarray: The speaker embedding extracted from the audio file.
    """
    try:
        # Check if TTS model has the method
        if hasattr(tts_model, 'get_speaker_embedding'):
            speaker_embedding = tts_model.get_speaker_embedding(audio_path)
        elif hasattr(tts_model, 'speaker_manager'):
            # Alternative method for newer versions
            speaker_embedding = tts_model.speaker_manager.get_speaker_embedding(audio_path)
        else:
            raise RuntimeError("TTS model doesn't support speaker embedding extraction")
            
        np.save(embedding_path, speaker_embedding)
        return speaker_embedding
    except Exception as e:
        print(f"Error cloning speaker embedding: {e}")
        raise

