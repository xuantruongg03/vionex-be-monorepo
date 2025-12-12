
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams
from core.config import URL_QDRANT, API_KEY_QDRANT, COLLECTION_NAME, VECTOR_DIMENSION
from qdrant_client.http.exceptions import UnexpectedResponse
from utils.log_manager import logger

qdrant_client = QdrantClient(
    url=URL_QDRANT,
    api_key=API_KEY_QDRANT,
)

def create_collection_if_not_exists(collection_name):
    try:
        qdrant_client.get_collection(collection_name)
        logger.info(f"Collection '{collection_name}' already exists.")
    except UnexpectedResponse as e:
        if e.status_code == 404:
            logger.info(f"Collection '{collection_name}' not found. Creating new with dimension {VECTOR_DIMENSION}...")
            qdrant_client.create_collection(
                collection_name=collection_name,
                vectors_config=VectorParams(size=VECTOR_DIMENSION, distance=Distance.COSINE)
            )
            logger.info(f"Collection '{collection_name}' created with dimension {VECTOR_DIMENSION}.")
        else:
            logger.error(f"Unexpected error: {e.status_code} - {e.content}")
            raise
# Create the collection
create_collection_if_not_exists(COLLECTION_NAME)
