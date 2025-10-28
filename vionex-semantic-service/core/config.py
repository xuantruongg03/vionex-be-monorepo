import os
from dotenv import load_dotenv

load_dotenv()

# Server configuration
GRPC_PORT = int(os.getenv("SEMANTIC_GRPC_PORT", 30006))

# Qdrant processing configuration
URL_QDRANT = os.getenv("URL_QDRANT", "localhost:6333") 
API_KEY_QDRANT = os.getenv("API_KEY_QDRANT", "localkey")
COLLECTION_NAME = os.getenv("COLLECTION_NAME", "conversations")
MAX_SEARCH_RESULTS = int(os.getenv("MAX_SEARCH_RESULTS", 10))

# Model configuration
MODEL_VECTOR = os.getenv("MODEL_VECTOR", "intfloat/e5-small-v2")  # Default model for vectorization

# Logging configuration
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")

TYPE_ENGINE = os.getenv("TYPE_ENGINE", "cpu")  # 'cpu' or 'cuda'
