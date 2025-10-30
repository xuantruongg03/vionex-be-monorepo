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
            room_key: Unique room key for context isolation (REQUIRED, must be UUID format)
        """
        try:
            # VALIDATE room_key - MUST be provided and in UUID format
            if not room_key:
                error_msg = f"room_key is required but not provided. room_id={room_id}, speaker={speaker}"
                logger.error(error_msg)
                raise ValueError(error_msg)
            
            # Validate UUID format (8-4-4-4-12 characters)
            import re
            uuid_pattern = r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            if not re.match(uuid_pattern, room_key.lower()):
                error_msg = f"room_key must be in UUID format, got: {room_key}"
                logger.error(error_msg)
                raise ValueError(error_msg)
            
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

            payload = {
                "original_text": original_text,
                "original_language": original_language,
                "room_id": room_id,  # Keep for backward compatibility and display
                "room_key": room_key,  # Primary indexing field (UUID)
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
            logger.info(f"Saved original transcript for point_id: {point_id}, room_key: {room_key}")

            # Submit translation task to thread pool (non-blocking)
            logger.info(f"Submitting background translation task for point_id: {point_id}")
            self.executor.submit(self._translate_and_update_in_background, point_id, original_text)

            return True

        except Exception as e:
            logger.error(f"Error saving transcript: {e}")
            return False

    def search(self, query: str, room_id: str, limit: int = 10, organization_id: str = None, room_key: str = None) -> List[dict]:
        """
        Multi-language semantic search: searches using both original query and English translation.
        
        Args:
            query: Search query text
            room_id: Room ID (for display only, not used for filtering)
            limit: Maximum number of results
            organization_id: Organization ID for filtering
            room_key: Unique room key for context isolation (REQUIRED, must be UUID)
        """
        try:
            # VALIDATE room_key - MUST be provided and in UUID format
            if not room_key:
                error_msg = f"room_key is required for search but not provided. room_id={room_id}"
                logger.error(error_msg)
                raise ValueError(error_msg)
            
            # Validate UUID format
            import re
            uuid_pattern = r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            if not re.match(uuid_pattern, room_key.lower()):
                error_msg = f"room_key must be in UUID format, got: {room_key}"
                logger.error(error_msg)
                raise ValueError(error_msg)
            
            # Build filter conditions - ONLY use room_key (no fallback)
            filter_conditions = [
                FieldCondition(key="room_key", match=MatchValue(value=room_key))
            ]
            logger.info(f"Searching with room_key: {room_key}, query: '{query}'")
            
            if organization_id:
                filter_conditions.append(
                    FieldCondition(key="organization_id", match=MatchValue(value=organization_id)))

            query_filter = Filter(must=filter_conditions)

            # STRATEGY 1: Search with original query (better for same-language matches)
            original_vector = self.model.encode(query).tolist()
            results_original = self.qdrant_client.search(
                collection_name=COLLECTION_NAME,
                query_vector=original_vector,
                query_filter=query_filter,
                with_payload=True,
                limit=limit
            )
            
            # STRATEGY 2: Translate and search with English query (better for cross-language)
            english_query = self.translation_service.translate(query)
            logger.info(f"Translated query: '{query}' → '{english_query}'")
            
            english_vector = self.model.encode(english_query).tolist()
            results_english = self.qdrant_client.search(
                collection_name=COLLECTION_NAME,
                query_vector=english_vector,
                query_filter=query_filter,
                with_payload=True,
                limit=limit
            )
            
            # Merge and deduplicate results (keep highest score for each document)
            results_dict = {}
            for hit in results_original + results_english:
                doc_id = hit.id
                if doc_id not in results_dict or hit.score > results_dict[doc_id].score:
                    results_dict[doc_id] = hit
            
            # Sort by score descending
            merged_results = sorted(results_dict.values(), key=lambda x: x.score, reverse=True)[:limit]

            score_threshold = 0.60  # Lowered threshold for better recall (original was 0.8)
            filtered_results = [r for r in merged_results if r.score >= score_threshold]
            
            # Log search results for debugging
            logger.info(f"Original query results: {len(results_original)}, English query results: {len(results_english)}")
            logger.info(f"Merged: {len(merged_results)} total, {len(filtered_results)} after filtering (threshold: {score_threshold})")
            if merged_results:
                logger.info(f"Top result score: {merged_results[0].score:.4f}")
                if not filtered_results:
                    logger.warning(f"All results filtered out. Top score was {merged_results[0].score:.4f}. Consider lowering threshold.")

            # Process and return results with safe null handling
            return [
                {
                    "text": f"{hit.payload.get('speaker', 'Unknown')}: {hit.payload.get('original_text', '')}", # Safe formatting
                    "room_id": hit.payload.get("room_id"),
                    "timestamp": hit.payload.get("timestamp"),
                    "score": hit.score
                }
                for hit in filtered_results
                if hit.payload.get("original_text")  # Only include if text exists
            ]
        except Exception as e:
            logger.error(f"Error during search: {e}")
            return []

    def get_text_by_room_id(self, room_id: str, organization_id: str = None, room_key: str = None) -> List[dict]:
        """
        Get all transcripts for a specific room_key.
        
        Args:
            room_id: Room ID (for display only, not used for filtering)
            organization_id: Organization ID for filtering
            room_key: Unique room key for context isolation (REQUIRED, must be UUID)
        """
        # VALIDATE room_key - MUST be provided and in UUID format
        if not room_key:
            error_msg = f"room_key is required for get_text_by_room_id but not provided. room_id={room_id}"
            logger.error(error_msg)
            raise ValueError(error_msg)
        
        # Validate UUID format
        import re
        uuid_pattern = r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        if not re.match(uuid_pattern, room_key.lower()):
            error_msg = f"room_key must be in UUID format, got: {room_key}"
            logger.error(error_msg)
            raise ValueError(error_msg)
        
        # Build filter conditions - ONLY use room_key (no fallback)
        filter_conditions = [
            FieldCondition(key="room_key", match=MatchValue(value=room_key))
        ]
        logger.info(f"Retrieving all transcripts with room_key: {room_key}")

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
