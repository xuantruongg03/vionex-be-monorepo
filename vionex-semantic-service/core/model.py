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

# Load MarianMT models for each language pair
translation_models = {}
translation_tokenizers = {}

# Vietnamese to English - Using VinAI model (better quality than MarianMT)
logger.info("[TRANSLATION] Loading vi-en model (VinAI)...")
from transformers import AutoTokenizer, AutoModelForSeq2SeqLM

vi_en_model_name = "vinai/vinai-translate-vi2en-v2"
translation_tokenizers["vi-en"] = AutoTokenizer.from_pretrained(vi_en_model_name, src_lang="vi_VN")
translation_models["vi-en"] = AutoModelForSeq2SeqLM.from_pretrained(vi_en_model_name)
if TYPE_ENGINE == "cuda":
    translation_models["vi-en"] = translation_models["vi-en"].to("cuda")
logger.info("[TRANSLATION] vi-en model (VinAI) loaded successfully")

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

# ============================================================================
# VIETNAMESE TEXT CORRECTION MODEL
# ============================================================================
# Model for correcting Vietnamese text (OCR errors, typos, diacritics, etc.)
# before sending to machine translation for better translation quality
logger.info("[TEXT-CORRECTION] Loading Vietnamese text correction model (ProtonX)...")

vi_correction_model = None
vi_correction_tokenizer = None

try:
    import torch
    
    vi_correction_model_path = "protonx-models/protonx-legal-tc"
    vi_correction_tokenizer = AutoTokenizer.from_pretrained(vi_correction_model_path)
    vi_correction_model = AutoModelForSeq2SeqLM.from_pretrained(vi_correction_model_path)
    
    # Move to appropriate device
    vi_correction_device = torch.device("cuda" if TYPE_ENGINE == "cuda" and torch.cuda.is_available() else "cpu")
    vi_correction_model.to(vi_correction_device)
    vi_correction_model.eval()
    
    logger.info(f"[TEXT-CORRECTION] Vietnamese correction model loaded on {vi_correction_device}")
except Exception as e:
    logger.warning(f"[TEXT-CORRECTION] Failed to load Vietnamese correction model: {e}")
    logger.warning("[TEXT-CORRECTION] Vietnamese text correction will be disabled")