"""
 * Copyright (c) 2025 xuantruongg003
 *
 * This software is licensed for non-commercial use only.
 * You may use, study, and modify this code for educational and research purposes.
 *
 * Commercial use of this code, in whole or in part, is strictly prohibited
 * without prior written permission from the author.
 *
 * Author Contact: lexuantruong098@gmail.com
 */
"""

import logging
# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)
from core.model import vector_model  # Import pre-loaded model
from core.vectordb import qdrant_client  # Import Qdrant client
from core.config import COLLECTION_NAME
from qdrant_client.http.models import PointStruct, Filter, FieldCondition, MatchValue, SearchRequest
import uuid
import time
from typing import List

class SemanticProcessor:
    def __init__(self):
        """Initialize audio processor with pre-loaded Whisper model"""
        # Use pre-loaded model from core.model
        self.model = vector_model
        self.qdrant_client = qdrant_client
        
        # Verify model is loaded
        if self.model is None:
            logger.error("Cannot load model")
        else:
            logger.info(f"Loaded model")


    def save(self, room_id, speaker, text, timestamp, language="vi", organization_id=None):
        try:
            # Convert text to vector
            vector = self.model.encode(text).tolist()  # Convert to list for Qdrant compatibility

            # Parse timestamp - handle both string and numeric formats, including None
            parsed_timestamp = timestamp
            if timestamp is None:
                parsed_timestamp = int(time.time())
            elif isinstance(timestamp, str):
                try:
                    parsed_timestamp = int(timestamp)
                except (ValueError, TypeError):
                    parsed_timestamp = int(time.time())
            elif isinstance(timestamp, (int, float)):
                parsed_timestamp = int(timestamp)
            else:
                parsed_timestamp = int(time.time())

            # Prepare payload with organization_id
            payload = {
                "text": text,
                "room_id": room_id,
                "speaker": speaker,
                "timestamp": parsed_timestamp,
                "language": language
            }
            
            # Add organization_id to payload if provided
            if organization_id:
                payload["organization_id"] = organization_id

            # Save vector to Qdrant
            point = PointStruct(
                id=str(uuid.uuid4()),
                vector=vector,
                payload=payload
            )

            self.qdrant_client.upsert(collection_name=COLLECTION_NAME, points=[point])

            logger.info(f"Saved transcript for room {room_id}, speaker {speaker} at {parsed_timestamp} in language {language}" + 
                       (f" for organization {organization_id}" if organization_id else ""))
            return True
            
        except Exception as e:
            logger.error(f"Error saving transcript: {e}")
            return False
    
    def search(self, query, room_id, limit=10, organization_id=None) -> List[dict]:
        # Vectorize the query
        vector = self.model.encode(query).tolist()  # Convert to list for Qdrant compatibility

        query_filter = None
        filter_conditions = []
        
        # Add room_id filter if provided
        if room_id:
            filter_conditions.append(
                FieldCondition(key="room_id", match=MatchValue(value=room_id))
            )
        
        # Add organization_id filter if provided
        if organization_id:
            filter_conditions.append(
                FieldCondition(key="organization_id", match=MatchValue(value=organization_id))
            )
        
        # Create filter if any conditions exist
        if filter_conditions:
            query_filter = Filter(must=filter_conditions)

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
    
    def get_text_by_room_id(self, room_id: str, organization_id: str = None) -> List[dict]:
        """
        Get all transcripts for a specific room ID.
        
        Args:
            room_id (str): The room ID to filter transcripts.
            organization_id (str, optional): The organization ID for multi-tenant isolation.
        
        Returns:
            List[dict]: List of transcripts with text, speaker, and timestamp.
        """
        filter_conditions = [
            FieldCondition(key="room_id", match=MatchValue(value=room_id))
        ]
        
        # Add organization filter if provided
        if organization_id:
            filter_conditions.append(
                FieldCondition(key="organization_id", match=MatchValue(value=organization_id))
            )
        
        query_filter = Filter(must=filter_conditions)

        results = self.qdrant_client.scroll(
            collection_name=COLLECTION_NAME,
            query_filter=query_filter,
            with_payload=True
        )

        return [
            {
                "text": hit.payload.get("speaker") + ": " + hit.payload.get("text"),
                "speaker": hit.payload.get("speaker"),
                "timestamp": hit.payload.get("timestamp")
            }
            for hit in results
        ]
