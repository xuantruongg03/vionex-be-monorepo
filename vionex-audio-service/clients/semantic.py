"""
Semantic Service Client

Client for interacting with the Semantic Service for transcript storage
"""

import grpc
import logging
from typing import Dict, Any
from proto import semantic_pb2_grpc, semantic_pb2
from core.config import SEMANTIC_SERVICE_HOST, SEMANTIC_SERVICE_PORT

logger = logging.getLogger(__name__)


class SemanticClient:
    """Client for interacting with the Semantic Service"""
    
    def __init__(self):
        """Initialize the Semantic Client"""
        try:
            self.channel = grpc.insecure_channel(f'{SEMANTIC_SERVICE_HOST}:{SEMANTIC_SERVICE_PORT}')
            self.stub = semantic_pb2_grpc.SemanticServiceStub(self.channel)
            logger.info("Semantic Client initialized")
        except Exception as e:
            logger.error(f"Failed to initialize Semantic Client: {e}")
            self.stub = None

    async def save_transcript(self, data: Dict[str, Any]) -> bool:
        """Save a transcript using the semantic service"""
        try:
            if not self.stub:
                logger.error("Semantic client not initialized")
                return False

            # Prepare request with organization_id support
            request_params = {
                'room_id': data.get('room_id', ''),
                'speaker': data.get('user_id', ''),
                'text': data.get('text', ''),
                'timestamp': data.get('timestamp', ''),
                'language': data.get('language', 'unknown')
            }
            
            # Add organization_id if provided
            if data.get('organization_id'):
                request_params['organization_id'] = data.get('organization_id')

            request = semantic_pb2.SaveTranscriptRequest(**request_params)
            
            response = self.stub.SaveTranscript(request)
            
            if response.success:
                logger.info(f"Transcript saved for room {data.get('room_id')}" + 
                           (f" (org: {data.get('organization_id')})" if data.get('organization_id') else ""))
                return True
            else:
                logger.error(f"Failed to save transcript: {response}")
                return False
            
        except Exception as e:
            logger.error(f"Error calling semantic service: {e}")
            return False

    def close(self):
        """Close the gRPC channel"""
        try:
            if hasattr(self, 'channel'):
                self.channel.close()
                logger.info("Semantic client channel closed")
        except Exception as e:
            logger.error(f"Error closing semantic client: {e}")
