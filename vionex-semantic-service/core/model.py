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

logger.info("[TRANSLATION] Loading NLLB-Distilled (facebook/nllb-200-distilled-600M)")

from transformers import AutoModelForSeq2SeqLM, AutoTokenizer
import torch

# Suppress the torch_dtype warning
nllb_model = AutoModelForSeq2SeqLM.from_pretrained(
    "facebook/nllb-200-distilled-600M",
    dtype=torch.float16 if TYPE_ENGINE == "cuda" else torch.float32
)

nllb_tokenizer = AutoTokenizer.from_pretrained("facebook/nllb-200-distilled-600M")

if TYPE_ENGINE == "cuda":
    nllb_model = nllb_model.to("cuda")

# Create unified interface
translation_models = {"nllb": nllb_model}
translation_tokenizers = {"nllb": nllb_tokenizer}

logger.info("[TRANSLATION] NLLB-Distilled loaded successfully (supports 200+ languages)")