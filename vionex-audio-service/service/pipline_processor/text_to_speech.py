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
    Text-to-Speech with CosyVoice2 zero-shot voice cloning
    
    Args:
        text: Text to synthesize
        language: Target language (not used in CosyVoice2, auto-detected)
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
    REPLACE MODEL: CosyVoice2 zero-shot voice cloning with streaming
    Reference: https://huggingface.co/FunAudioLLM/CosyVoice2-0.5B
    """
    try:
        if not text or not text.strip():
            raise ValueError("Text input is empty")
        text = text.strip()
        
        # ===== 1) Voice selection - Get prompt speech path =====
        prompt_speech_path = None
        prompt_text = ""  # Transcript of prompt audio
        
        if speaker_wav_path and os.path.exists(speaker_wav_path):
            prompt_speech_path = speaker_wav_path
        elif user_id and room_id and _check_voice_cloning_availability():
            try:
                from ..voice_cloning.voice_clone_manager import get_voice_clone_manager
                voice_manager = get_voice_clone_manager()
                
                # Get audio path (16kHz WAV)
                cloned_path = voice_manager.get_user_audio_path(user_id, room_id)
                if cloned_path and os.path.exists(cloned_path):
                    prompt_speech_path = cloned_path
                    
                    # Get transcript (if available)
                    transcript = voice_manager.get_user_transcript(user_id, room_id)
                    if transcript:
                        prompt_text = transcript
                        logger.info(f"[CosyVoice] Using cloned voice with transcript: '{prompt_text[:50]}...'")
                    else:
                        logger.info(f"[CosyVoice] Using cloned voice without transcript")
                        
            except Exception as e:
                logger.warning(f"[CosyVoice] Failed to get cloned voice: {e}")
        
        if not prompt_speech_path:
            prompt_speech_path = DEFAULT_SPEAKER_WAV
            
        if not os.path.exists(prompt_speech_path):
            raise FileNotFoundError(f"Speaker audio file not found: {prompt_speech_path}")
        
        # ===== 2) CosyVoice2 zero-shot inference =====
        logger.info(f"[CosyVoice] Generating speech: '{text[:50]}...'")
        logger.info(f"[CosyVoice] Prompt audio: {prompt_speech_path}")
        logger.info(f"[CosyVoice] Prompt text: '{prompt_text[:30]}...' (length: {len(prompt_text)})")
        
        # Use inference_zero_shot for voice cloning (correct API)
        # For realtime: stream=True processes in chunks
        audio_chunks = []
        for i, chunk_dict in enumerate(tts_model.inference_zero_shot(
            tts_text=text,                       # Text to synthesize
            prompt_text=prompt_text,             # Transcript of prompt audio (empty OK, better if available)
            prompt_speech_16k=prompt_speech_path, # 16kHz prompt audio path
            stream=True                          # Enable streaming for low latency
        )):
            # chunk_dict is {'tts_speech': tensor}
            if isinstance(chunk_dict, dict) and 'tts_speech' in chunk_dict:
                audio_tensor = chunk_dict['tts_speech']
                
                # Convert tensor to numpy
                if hasattr(audio_tensor, 'cpu'):
                    audio_tensor = audio_tensor.cpu()
                audio_np = audio_tensor.numpy() if hasattr(audio_tensor, 'numpy') else np.array(audio_tensor)
                audio_chunks.append(audio_np.squeeze())
        
        if not audio_chunks:
            raise RuntimeError("CosyVoice2 returned no audio chunks")
            
        final_audio = np.concatenate(audio_chunks).astype(np.float32)
        src_sr = 16000  # CosyVoice2 outputs at 16kHz
        
        # Amplification if needed
        peak = float(np.max(np.abs(final_audio))) if final_audio.size else 1.0
        if peak < 0.3 and peak > 0:
            final_audio = final_audio * min(0.7 / peak, 3.0)
        
        # Convert to PCM16
        final_audio = np.clip(final_audio, -1.0, 1.0)
        pcm16 = (final_audio * 32767.0).astype(np.int16)
        
        if return_format.lower() == "pcm16":
            return pcm16.tobytes()
        
        buf = io.BytesIO()
        write_wav(buf, rate=src_sr, data=pcm16)
        return buf.getvalue()
        
    except Exception as e:
        logger.error(f"[CosyVoice] TTS Error: {type(e).__name__}: {str(e)}")
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

