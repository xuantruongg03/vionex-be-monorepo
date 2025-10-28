from utils.log_manager import logger
import time
import uuid
from typing import List
from concurrent.futures import ThreadPoolExecutor

from qdrant_client.http.models import (FieldCondition, Filter, MatchValue,
                                       PointStruct, PointVectors)

from core.config import COLLECTION_NAME
from core.model import vector_model
from core.vectordb import qdrant_client
from services.translate_process import TranslateProcess

class SemanticProcessor:
    def __init__(self):
        """Initialize the Semantic Processor."""
        self.model = vector_model
        self.qdrant_client = qdrant_client
        self.translation_service = TranslateProcess()
        
        # Create thread pool for background translation
        self.executor = ThreadPoolExecutor(max_workers=5, thread_name_prefix="translation")

        if self.model is None:
            logger.error("Cannot load vector model")
        else:
            logger.info("Vector model loaded successfully")

    def _translate_and_update_in_background(self, point_id: str, original_text: str):
        """
        A background function to translate text and update the vector point.
        """
        try:
            logger.info(
                f"Starting background translation for point_id: {point_id}")

            # 1. Translate the original text to English
            english_text = self.translation_service.translate(original_text)

            if not english_text or english_text == original_text:
                logger.warning(
                    f"Translation skipped or failed for point_id: {point_id}.")
                return

            # 2. Create a vector from the English text
            english_vector = self.model.encode(english_text).tolist()

            # 3. Update the vector point in Qdrant with the translation and the new vector
            self.qdrant_client.set_payload(
                collection_name=COLLECTION_NAME,
                payload={"english_text": english_text},
                points=[point_id],
                wait=True
            )

            # Update the vector itself - use PointVectors instead of PointStruct
            self.qdrant_client.update_vectors(
                collection_name=COLLECTION_NAME,
                points=[PointVectors(id=point_id, vector=english_vector)],
                wait=True
            )

            logger.info(
                f"Successfully translated and updated point_id: {point_id}")

        except Exception as e:
            logger.error(
                f"Error in background translation for point_id {point_id}: {e}")

    def save(self, room_id: str, speaker: str, original_text: str, original_language: str, timestamp: int, organization_id: str = None, room_key: str = None):
        """
        Saves the original text and triggers a background translation.
        The initial vector is created from the original text for immediate searchability.
        
        Args:
            room_id: Room ID (for display/backward compatibility)
            speaker: Speaker name
            original_text: Original text to save
            original_language: Language code
            timestamp: Timestamp
            organization_id: Organization ID (optional)
            room_key: Unique room key for context isolation (NEW, replaces room_id for indexing)
        """
        try:
            # The initial vector is created from the original text
            initial_vector = self.model.encode(original_text).tolist()

            # Parse timestamp - handle both Unix timestamp (int) and ISO string
            parsed_timestamp = int(time.time())
            if timestamp:
                try:
                    # Try parsing as int (Unix timestamp)
                    parsed_timestamp = int(timestamp)
                except (ValueError, TypeError):
                    # Try parsing as ISO datetime string
                    try:
                        from datetime import datetime
                        dt = datetime.fromisoformat(str(timestamp).replace('Z', '+00:00'))
                        parsed_timestamp = int(dt.timestamp())
                        logger.debug(f"Parsed ISO timestamp {timestamp} to {parsed_timestamp}")
                    except Exception as e:
                        logger.warning(f"Could not parse timestamp '{timestamp}': {e}. Using current time.")
                        parsed_timestamp = int(time.time())

            # Use room_key for indexing if provided, otherwise fallback to room_id
            index_key = room_key if room_key else room_id

            payload = {
                "original_text": original_text,
                "original_language": original_language,
                "room_id": room_id,  # Keep for backward compatibility
                "room_key": index_key,  # NEW: Primary indexing field
                "speaker": speaker,
                "timestamp": parsed_timestamp,
            }

            if organization_id:
                payload["organization_id"] = organization_id

            point_id = str(uuid.uuid4())
            point = PointStruct(
                id=point_id,
                vector=initial_vector,  # Use the vector from the original text
                payload=payload
            )

            self.qdrant_client.upsert(
                collection_name=COLLECTION_NAME, points=[point], wait=True)
            logger.info(f"Saved original transcript for point_id: {point_id}, room_key: {index_key}")

            # Submit translation task to thread pool (non-blocking)
            logger.info(f"Submitting background translation task for point_id: {point_id}")
            self.executor.submit(self._translate_and_update_in_background, point_id, original_text)

            return True

        except Exception as e:
            logger.error(f"Error saving transcript: {e}")
            return False

    def search(self, query: str, room_id: str, limit: int = 10, organization_id: str = None, room_key: str = None) -> List[dict]:
        """
        Translates the search query to English and searches based on the English vector.
        
        Args:
            query: Search query text
            room_id: Room ID (for backward compatibility, fallback if room_key not provided)
            limit: Maximum number of results
            organization_id: Organization ID for filtering
            room_key: Unique room key for context isolation (NEW, preferred over room_id)
        """
        try:
            # Translate the search query to English
            english_query = self.translation_service.translate(query)

            # Vectorize the English query
            vector = self.model.encode(english_query).tolist()

            # Build filter conditions - prioritize room_key over room_id
            filter_conditions = []
            if room_key:
                # Use room_key for filtering (preferred)
                filter_conditions.append(
                    FieldCondition(key="room_key", match=MatchValue(value=room_key)))
                logger.info(f"Searching with room_key: {room_key}")
            elif room_id:
                # Fallback to room_id for backward compatibility
                filter_conditions.append(
                    FieldCondition(key="room_id", match=MatchValue(value=room_id)))
                logger.info(f"Searching with room_id (fallback): {room_id}")
            
            if organization_id:
                filter_conditions.append(
                    FieldCondition(key="organization_id", match=MatchValue(value=organization_id)))

            query_filter = Filter(
                must=filter_conditions) if filter_conditions else None

            # Perform search in Qdrant
            results = self.qdrant_client.search(
                collection_name=COLLECTION_NAME,
                query_vector=vector,
                query_filter=query_filter,
                with_payload=True,
                limit=limit
            )

            score_threshold = 0.8  # Score threshold for filtering results
            filtered_results = [r for r in results if r.score >= score_threshold]

            # Process and return results
            return [
                {
                    "text": hit.payload.get("speaker") + ": " + hit.payload.get("text"), # Format: "Speaker: Text"
                    "room_id": hit.payload.get("room_id"),
                    "timestamp": hit.payload.get("timestamp"),
                    "score": hit.score
                }
                for hit in filtered_results
            ]
        except Exception as e:
            logger.error(f"Error during search: {e}")
            return []

    def get_text_by_room_id(self, room_id: str, organization_id: str = None, room_key: str = None) -> List[dict]:
        """
        Get all transcripts for a specific room ID or room_key.
        
        Args:
            room_id: Room ID (for backward compatibility)
            organization_id: Organization ID for filtering
            room_key: Unique room key for context isolation (NEW, preferred over room_id)
        """
        # Build filter conditions - prioritize room_key over room_id
        filter_conditions = []
        if room_key:
            filter_conditions.append(
                FieldCondition(key="room_key", match=MatchValue(value=room_key))
            )
            logger.info(f"Retrieving all transcripts with room_key: {room_key}")
        elif room_id:
            filter_conditions.append(
                FieldCondition(key="room_id", match=MatchValue(value=room_id))
            )
            logger.info(f"Retrieving all transcripts with room_id (fallback): {room_id}")

        if organization_id:
            filter_conditions.append(
                FieldCondition(key="organization_id",
                               match=MatchValue(value=organization_id))
            )

        query_filter = Filter(must=filter_conditions)

        # Use scroll to retrieve all matching points
        results, _ = self.qdrant_client.scroll(
            collection_name=COLLECTION_NAME,
            scroll_filter=query_filter,
            with_payload=True,
            limit=1000  # Adjust limit as needed
        )

        return [
            {
                "text": f'{hit.payload.get("speaker")}: {hit.payload.get("original_text")}',
                "speaker": hit.payload.get("speaker"),
                "timestamp": hit.payload.get("timestamp")
            }
            for hit in results
        ]
