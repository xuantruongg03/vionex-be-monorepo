from sentence_transformers import SentenceTransformer
from core.config import MODEL_VECTOR, TYPE_ENGINE
import warnings
import os

# Suppress warnings from transformers and sentence_transformers
warnings.filterwarnings('ignore')
os.environ['TRANSFORMERS_VERBOSITY'] = 'error'
os.environ['TOKENIZERS_PARALLELISM'] = 'false'

# Import logger after setting environment
from utils.log_manager import logger

vector_model = SentenceTransformer(MODEL_VECTOR, trust_remote_code=True)

logger.info("[DETECT MODEL] Loading FastText language detection model...")

import fasttext
import urllib.request

# Download FastText model if not exists
fasttext_model_path = "lid.176.ftz"
if not os.path.exists(fasttext_model_path):
    logger.info("[DETECT MODEL] Downloading lid.176.ftz from FastText...")
    url = "https://dl.fbaipublicfiles.com/fasttext/supervised-models/lid.176.ftz"
    try:
        urllib.request.urlretrieve(url, fasttext_model_path)
        logger.info("[DETECT MODEL] Download completed!")
    except Exception as e:
        logger.error(f"[DETECT MODEL] Failed to download: {e}")
        raise

detect_model = fasttext.load_model(fasttext_model_path)
logger.info("[DETECT MODEL] FastText model loaded successfully")

logger.info("[TRANSLATION] Loading MarianMT models (Helsinki-NLP)")

from transformers import MarianMTModel, MarianTokenizer
import torch

# Load MarianMT models for each language pair
translation_models = {}
translation_tokenizers = {}

# Vietnamese to English
logger.info("[TRANSLATION] Loading vi-en model...")
vi_en_model_name = "Helsinki-NLP/opus-mt-vi-en"
translation_tokenizers["vi-en"] = MarianTokenizer.from_pretrained(vi_en_model_name)
translation_models["vi-en"] = MarianMTModel.from_pretrained(vi_en_model_name)
if TYPE_ENGINE == "cuda":
    translation_models["vi-en"] = translation_models["vi-en"].to("cuda")
logger.info("[TRANSLATION] vi-en model loaded successfully")

# Lao to English - URL will be provided later
logger.info("[TRANSLATION] Loading lo-en model...")
lo_en_model_name = "PLACEHOLDER_LO_EN_MODEL"  # Will be updated with actual model URL
# translation_tokenizers["lo-en"] = MarianTokenizer.from_pretrained(lo_en_model_name)
# translation_models["lo-en"] = MarianMTModel.from_pretrained(lo_en_model_name)
# if TYPE_ENGINE == "cuda":
#     translation_models["lo-en"] = translation_models["lo-en"].to("cuda")
logger.info("[TRANSLATION] lo-en model - waiting for model URL")

# English to English (no translation needed)
translation_models["en-en"] = None
translation_tokenizers["en-en"] = None
logger.info("[TRANSLATION] en-en - no translation needed")

logger.info(f"[TRANSLATION] MarianMT models loaded successfully: {list(translation_models.keys())}")

# # Comment out NLLB model
# logger.info("[TRANSLATION] Loading NLLB-Distilled (facebook/nllb-200-distilled-600M)")
# from transformers import AutoModelForSeq2SeqLM, AutoTokenizer
# import torch

# # Suppress the torch_dtype warning
# nllb_model = AutoModelForSeq2SeqLM.from_pretrained(
#     "facebook/nllb-200-distilled-600M",
#     dtype=torch.float16 if TYPE_ENGINE == "cuda" else torch.float32
# )

# nllb_tokenizer = AutoTokenizer.from_pretrained("facebook/nllb-200-distilled-600M")

# if TYPE_ENGINE == "cuda":
#     nllb_model = nllb_model.to("cuda")

# # Create unified interface
# translation_models = {"nllb": nllb_model}
# translation_tokenizers = {"nllb": nllb_tokenizer}

# logger.info("[TRANSLATION] NLLB-Distilled loaded successfully (supports 200+ languages)")