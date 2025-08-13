from faster_whisper import WhisperModel
from core.config import WHISPER_MODEL, WHISPER_DEVICE
# Load model whsper
whisper_model = WhisperModel(WHISPER_MODEL, device=WHISPER_DEVICE, compute_type="int8")

from transformers import MarianTokenizer, MarianMTModel

# Load translation model from local directory in container
model_vi_en_link = "/app/models/Helsinki-NLP-opus-mt-vi-en"
# model_vi_en_link = "models/Helsinki-NLP-opus-mt-vi-en"
tokenizer = MarianTokenizer.from_pretrained(model_vi_en_link)
model_vi_en = MarianMTModel.from_pretrained(model_vi_en_link)

# Load model tts
from TTS.api import TTS

tts_model = TTS(model_name="tts_models/multilingual/multi-dataset/xtts_v2").to("cpu")
tts_model.temperature = 0.75  # Giảm từ 1.0 → more consistent
tts_model.length_penalty = 1.2  # Tăng → encourage longer utterances
tts_model.repetition_penalty = 5.0  # Tăng → giảm lặp lại