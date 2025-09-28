import numpy as np
import io
import os
import logging
from scipy.io.wavfile import write as write_wav

from core.model import tts_model

# Import voice cloning manager - lazy import to avoid circular dependencies
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

# Initialize logger if not already done
if 'logger' not in locals():
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

def tts(text: str, language: str = "en", user_id: str = None, room_id: str = None,
        speaker_embedding: np.ndarray = None, speaker_wav_path: str = None,
        return_format: str = "wav") -> bytes:
    """
    Chunked TTS với progressive voice cloning + crossfade để mượt hơn.
    """

    import numpy as np
    import io
    from scipy.io.wavfile import write as write_wav

    try:
        # ===== 0) Validate =====
        if not text or not text.strip():
            raise ValueError("Text input is empty or None")
        text = text.strip()

        # ===== 1) Config =====
        xtts_lang_map = {"vi": "vi", "en": "en", "lo": "lo"}
        xtts_language = xtts_lang_map.get(language, "en")

        MAX_WORDS_PER_CHUNK = 10
        MAX_CHARS_PER_CHUNK = 200
        FADE_MS = 60
        src_sr = getattr(tts_model, "output_sample_rate", None) or 22050

        # ===== 2) Voice selection =====
        selected_embedding = None
        voice_kwargs = {}
        if speaker_embedding is not None:
            selected_embedding = speaker_embedding
            voice_kwargs["speaker_embedding"] = selected_embedding
        elif user_id and room_id and _check_voice_cloning_availability():
            try:
                from ..voice_cloning.voice_clone_manager import get_voice_clone_manager
                voice_manager = get_voice_clone_manager()
                user_embedding = voice_manager.get_user_embedding(user_id, room_id)
                if user_embedding is not None:
                    selected_embedding = user_embedding
                    voice_kwargs["speaker_embedding"] = selected_embedding
            except Exception as e:
                logger.warning(f"[TTS] Failed to get cloned voice for {user_id}_{room_id}: {e}")
        if selected_embedding is None:
            wav_path = speaker_wav_path if (speaker_wav_path and os.path.exists(speaker_wav_path)) else DEFAULT_SPEAKER_WAV
            if not os.path.exists(wav_path):
                raise FileNotFoundError(f"Default speaker audio file not found: {wav_path}")
            voice_kwargs["speaker_wav"] = wav_path

        # ===== 3) Helper: split text =====
        def _split_text_into_chunks(s: str):
            words = s.split()
            chunks, curr = [], []
            for w in words:
                curr.append(w)
                if len(curr) >= MAX_WORDS_PER_CHUNK or len(" ".join(curr)) > MAX_CHARS_PER_CHUNK or w.endswith((".", "!", "?", ",")):
                    chunks.append(" ".join(curr))
                    curr = []
            if curr:
                chunks.append(" ".join(curr))
            return chunks

        def _to_float32(x):
            if hasattr(x, "numpy"):
                x = x.numpy()
            return np.asarray(x, dtype=np.float32).squeeze()

        def _float32_to_pcm16(x: np.ndarray) -> np.ndarray:
            return (np.clip(x, -1.0, 1.0) * 32767.0).astype(np.int16)

        def _crossfade_concat(dst: np.ndarray, src: np.ndarray, fade_ms: int, sr: int) -> np.ndarray:
            if dst.size == 0:
                return src
            fade_len = max(1, int(fade_ms * sr / 1000))
            if src.size <= fade_len or dst.size <= fade_len:
                return np.concatenate([dst, src])
            dst_tail = dst[-fade_len:].astype(np.float32)
            src_head = src[:fade_len].astype(np.float32)
            ramp = np.linspace(0.0, 1.0, fade_len, dtype=np.float32)
            mixed = (dst_tail * (1 - ramp) + src_head * ramp).astype(np.int16)
            return np.concatenate([dst[:-fade_len], mixed, src[fade_len:]])

        # ===== 4) Chunked synthesis =====
        chunks = _split_text_into_chunks(text)
        final_pcm = np.zeros(0, dtype=np.int16)

        for idx, chunk in enumerate(chunks):
            wav = tts_model.tts(text=chunk, language=xtts_language, **voice_kwargs)
            x = _to_float32(wav)
            peak = float(np.max(np.abs(x))) if x.size else 1.0
            if peak < 0.3 and peak > 0:
                x = x * min(0.7 / peak, 3.0)
            chunk_pcm = _float32_to_pcm16(x)
            final_pcm = _crossfade_concat(final_pcm, chunk_pcm, FADE_MS, src_sr)

        # ===== 5) Return =====
        if return_format.lower() == "pcm16":
            return final_pcm.tobytes()
        buf = io.BytesIO()
        write_wav(buf, rate=src_sr, data=final_pcm)
        return buf.getvalue()

    except Exception as e:
        logger.error(f"TTS Error (chunked): {type(e).__name__}: {str(e)}")
        raise

# def tts(text: str, language: str = "en", user_id: str = None, room_id: str = None,
#         speaker_embedding: np.ndarray = None, speaker_wav_path: str = None, 
#         return_format: str = "wav") -> bytes:
#     """
#     Enhanced TTS với progressive voice cloning
    
#     Args:
#         text (str): The text to convert to speech.
#         language (str): Target language for TTS (en, vi, lo, etc.)
#         user_id (str, optional): User ID for voice cloning lookup
#         room_id (str, optional): Room ID for voice cloning lookup
#         speaker_embedding (np.ndarray, optional): Explicit speaker embedding
#         speaker_wav_path (str, optional): Path to speaker audio file for voice cloning
#         return_format (str): Output format ("wav" or "pcm16")
    
#     Returns:
#         bytes: The audio data in specified format
        
#     Voice Selection Priority:
#         1. Explicit speaker_embedding parameter
#         2. User's cloned voice (user_id + room_id) 
#         3. speaker_wav_path parameter
#         4. Default speaker
#     """
#     try:
#         # Validate input
#         if not text or not text.strip():
#             raise ValueError("Text input is empty or None")
        
#         # Language mapping for XTTS
#         xtts_lang_map = {"vi": "vi", "en": "en", "lo": "lo"}
#         xtts_language = xtts_lang_map.get(language, "en")
        
#         # VOICE SELECTION LOGIC
#         selected_embedding = None
#         voice_source = "default"
        
#         # Priority 1: Explicit embedding
#         if speaker_embedding is not None:
#             selected_embedding = speaker_embedding
#             voice_source = "explicit_embedding"
#             logger.debug("[TTS] Using explicit speaker embedding")
            
#         # Priority 2: User's cloned voice
#         elif user_id and room_id and _check_voice_cloning_availability():
#             try:
#                 from ..voice_cloning.voice_clone_manager import get_voice_clone_manager
#                 voice_manager = get_voice_clone_manager()
#                 user_embedding = voice_manager.get_user_embedding(user_id, room_id)
#                 if user_embedding is not None:
#                     selected_embedding = user_embedding
#                     voice_source = "cloned_voice"
#                     logger.info(f"[TTS] Using cloned voice for user {user_id} (embedding size: {user_embedding.shape})")
#                 else:
#                     logger.debug(f"[TTS] No cloned voice found for user {user_id}_{room_id}")
#             except Exception as e:
#                 logger.warning(f"[TTS] Failed to get cloned voice for {user_id}_{room_id}: {e}")
        
#         # Limit text length to prevent TTS errors (max 200 chars for stability)
#         if len(text) > 200:
#             text = text[:200]
#             logger.warning(f"[TTS] Text truncated to 200 characters to prevent errors")
        
#         # Generate waveform từ text
#         if selected_embedding is not None:
#             try:
#                 wav = tts_model.tts(text=text, speaker_embedding=selected_embedding, language=xtts_language)
#             except Exception as e:
#                 logger.warning(f"[TTS] Voice cloning failed ({e}), falling back to default voice")
#                 selected_embedding = None  # Fallback to default
        
#         if selected_embedding is None:
#             if speaker_wav_path and os.path.exists(speaker_wav_path):
#                 wav = tts_model.tts(text=text, speaker_wav=speaker_wav_path, language=xtts_language)
#                 voice_source = "speaker_wav"
#             else:
#                 # Fallback to default speaker
#                 if not os.path.exists(DEFAULT_SPEAKER_WAV):
#                     raise FileNotFoundError(f"Default speaker audio file not found: {DEFAULT_SPEAKER_WAV}")
#                 wav = tts_model.tts(text=text, speaker_wav=DEFAULT_SPEAKER_WAV, language=xtts_language)
#                 voice_source = "default"

#         if wav is None:
#             raise RuntimeError("TTS model returned None")
        
#         # Check waveform type and convert properly
#         if hasattr(wav, 'numpy'):  # If it's a tensor
#             wav = wav.numpy()
            
#         wav = np.array(wav)
        
#         # **Important **: Return to Native Sample Rate from TTS to avoid Resampling unnecessary
#         src_sr = getattr(tts_model, "output_sample_rate", None)
#         if not src_sr:
#             # XTTS v2 standard rate
#             src_sr = 22050
#             logger.info(f"[TTS] Using XTTS v2 standard sample rate: {src_sr}Hz")
        
#         logger.debug(f"[TTS] Audio info: {len(wav)} samples @ {src_sr}Hz = {len(wav)/src_sr:.2f}s, voice: {voice_source}")
        
#         # Gentle amplification for quiet audio
#         max_abs = np.max(np.abs(wav))
#         if max_abs < 0.3:  # Audio too quiet
#             amplification = min(0.7 / max_abs, 3.0)  # Max 3x amplification
#             wav = wav * amplification

#         wav = np.clip(wav, -1.0, 1.0)
#         pcm16 = (wav * 32767.0).astype(np.int16)

#         if return_format == "pcm16":
#             return pcm16.tobytes()
        
#         # Returns wav with Native Sample Rate (not Force 16KHz)
#         buf = io.BytesIO()
#         write_wav(buf, rate=src_sr, data=pcm16) 
#         out = buf.getvalue()
#         buf.close()
#         return out
        
#     except Exception as e:
        logger.error(f"TTS Error Details: {type(e).__name__}: {str(e)}")
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

