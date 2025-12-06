import numpy as np
import io
import os
import logging
from scipy.io.wavfile import write as write_wav
import torch

# REPLACE MODEL: CosyVoice2 for voice cloning
from core.model import tts_model

logger = logging.getLogger(__name__)

# Voice cloning availability check (lazy)
_voice_cloning_available = None

def _check_voice_cloning_availability():
    """Check if voice cloning is available (lazy check)"""
    global _voice_cloning_available
    if _voice_cloning_available is None:
        try:
            from ..voice_cloning.voice_clone_manager import get_voice_clone_manager
            _voice_cloning_available = True
        except ImportError as e:
            _voice_cloning_available = False
            logger.warning(f"[TTS] Voice cloning not available: {e}")
    return _voice_cloning_available

# Default speaker configuration
DOCKER_SPEAKER_WAV = "/root/.local/share/tts/tts_models--multilingual--multi-dataset--xtts_v2/samples/en_sample.wav"
_current_dir = os.path.dirname(os.path.abspath(__file__))
_service_root = os.path.dirname(os.path.dirname(_current_dir))
LOCAL_SPEAKER_WAV = os.path.join(_service_root, "models", "XTTS-v2", "samples", "en_sample.wav")
DEFAULT_SPEAKER_WAV = DOCKER_SPEAKER_WAV if os.path.exists(DOCKER_SPEAKER_WAV) else LOCAL_SPEAKER_WAV
TARGET_SR = 16000

# ===== TTS Entry Point =====
def tts(text: str, language: str = "en", user_id: str = None, room_id: str = None,
        speaker_embedding: np.ndarray = None, speaker_wav_path: str = None,
        return_format: str = "wav") -> bytes:
    """
    Text-to-Speech with XTTS-v2 voice cloning
    
    Args:
        text: Text to synthesize
        language: Target language for TTS
        user_id: User ID for voice cloning lookup
        room_id: Room ID for voice cloning lookup
        speaker_embedding: (Deprecated, kept for compatibility)
        speaker_wav_path: Custom speaker audio path
        return_format: "wav" or "pcm16"
        
    Returns:
        Audio data in requested format
    """
    return _tts_cosyvoice(text, language, user_id, room_id, speaker_embedding, speaker_wav_path, return_format)

def _tts_cosyvoice(text, language, user_id, room_id, speaker_embedding, speaker_wav_path, return_format):
    """
    XTTS-v2 TTS with voice cloning
    """
    try:
        if not text or not text.strip():
            raise ValueError("Text input is empty")
        text = text.strip()
        
        # ===== 1) Voice selection - Get speaker wav path =====
        selected_speaker_wav = None
        
        if speaker_wav_path and os.path.exists(speaker_wav_path):
            selected_speaker_wav = speaker_wav_path
        elif user_id and room_id and _check_voice_cloning_availability():
            try:
                from ..voice_cloning.voice_clone_manager import get_voice_clone_manager
                voice_manager = get_voice_clone_manager()
                
                # Get audio path
                cloned_path = voice_manager.get_user_audio_path(user_id, room_id)
                if cloned_path and os.path.exists(cloned_path):
                    selected_speaker_wav = cloned_path
                    logger.info(f"[XTTS] Using cloned voice from: {cloned_path}")
                        
            except Exception as e:
                logger.warning(f"[XTTS] Failed to get cloned voice: {e}")
        
        if not selected_speaker_wav:
            selected_speaker_wav = DEFAULT_SPEAKER_WAV
            
        if not os.path.exists(selected_speaker_wav):
            raise FileNotFoundError(f"Speaker audio file not found: {selected_speaker_wav}")
        
        # ===== 2) XTTS-v2 inference =====
        logger.info(f"[XTTS] Generating speech: '{text[:50]}...'")
        logger.info(f"[XTTS] Speaker audio: {selected_speaker_wav}")
        logger.info(f"[XTTS] Language: {language}")
        
        # Use tts_to_file or tts method
        wav = tts_model.tts(
            text=text,
            speaker_wav=selected_speaker_wav,
            language=language
        )
        
        # Debug: Check raw TTS output
        logger.info(f"[XTTS-DEBUG] Raw wav type: {type(wav)}, len: {len(wav) if hasattr(wav, '__len__') else 'N/A'}")
        
        # Convert to numpy array if needed
        if isinstance(wav, list):
            final_audio = np.array(wav, dtype=np.float32)
        elif hasattr(wav, 'cpu'):
            final_audio = wav.cpu().numpy().astype(np.float32)
        else:
            final_audio = np.array(wav, dtype=np.float32)
        
        src_sr = 24000  # XTTS-v2 outputs at 24kHz
        
        # Debug: Check audio stats
        logger.info(f"[XTTS-DEBUG] Audio shape: {final_audio.shape}, min: {final_audio.min():.4f}, max: {final_audio.max():.4f}, mean: {final_audio.mean():.4f}")
        
        # Check if audio is silent (all zeros or very low amplitude)
        if final_audio.size == 0:
            logger.error("[XTTS-DEBUG] Audio is EMPTY!")
            return None
        
        audio_rms = np.sqrt(np.mean(final_audio**2))
        logger.info(f"[XTTS-DEBUG] Audio RMS: {audio_rms:.6f}")
        
        if audio_rms < 0.001:
            logger.warning(f"[XTTS-DEBUG] Audio is nearly SILENT! RMS={audio_rms}")
        
        # Amplification if needed
        peak = float(np.max(np.abs(final_audio))) if final_audio.size else 1.0
        if peak < 0.3 and peak > 0:
            final_audio = final_audio * min(0.7 / peak, 3.0)
            logger.info(f"[XTTS-DEBUG] Amplified audio, new peak: {np.max(np.abs(final_audio)):.4f}")
        
        # Convert to PCM16
        final_audio = np.clip(final_audio, -1.0, 1.0)
        pcm16 = (final_audio * 32767.0).astype(np.int16)
        
        # Debug: Check PCM16 stats
        logger.info(f"[XTTS-DEBUG] PCM16 min: {pcm16.min()}, max: {pcm16.max()}, non-zero samples: {np.count_nonzero(pcm16)}/{len(pcm16)}")
        
        if return_format.lower() == "pcm16":
            return pcm16.tobytes()
        
        buf = io.BytesIO()
        write_wav(buf, rate=src_sr, data=pcm16)
        wav_bytes = buf.getvalue()
        logger.info(f"[XTTS-DEBUG] Final WAV size: {len(wav_bytes)} bytes, duration: {len(pcm16)/src_sr:.2f}s")
        return wav_bytes
        
    except Exception as e:
        logger.error(f"[XTTS] TTS Error: {type(e).__name__}: {str(e)}")
        raise

# ===== Voice Cloning Helpers =====
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
        logger.info(f"[CLONE] Extracting embedding from: {audio_path}")
        
        speaker_embedding = None
        
        # Try XTTS v2 standard method first
        if hasattr(tts_model, 'get_conditioning_latents'):
            gpt_cond_latent, speaker_embedding = tts_model.get_conditioning_latents(audio_path)
            logger.info(f"[CLONE] Used get_conditioning_latents method")
        # Fallback methods
        elif hasattr(tts_model, 'get_speaker_embedding'):
            speaker_embedding = tts_model.get_speaker_embedding(audio_path)
            logger.info(f"[CLONE] Used get_speaker_embedding method")
        elif hasattr(tts_model, 'speaker_manager'):
            speaker_embedding = tts_model.speaker_manager.get_speaker_embedding(audio_path)
            logger.info(f"[CLONE] Used speaker_manager method")
        else:
            raise RuntimeError("TTS model doesn't support speaker embedding extraction")
            
        if speaker_embedding is None:
            raise RuntimeError("Embedding extraction returned None")
            
        # Convert to numpy if needed
        if hasattr(speaker_embedding, 'numpy'):
            speaker_embedding = speaker_embedding.numpy()
        speaker_embedding = np.array(speaker_embedding)
        
        logger.info(f"[CLONE] Successfully extracted embedding shape: {speaker_embedding.shape}")
        np.save(embedding_path, speaker_embedding)
        return speaker_embedding
        
    except Exception as e:
        logger.error(f"[CLONE] Error cloning speaker embedding: {e}")
        raise

