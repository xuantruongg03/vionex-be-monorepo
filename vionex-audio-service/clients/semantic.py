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

import grpc
from proto import semantic_pb2_grpc, semantic_pb2
from core.config import SEMANTIC_SERVICE_HOST, SEMANTIC_SERVICE_PORT

channel = grpc.insecure_channel(f'{SEMANTIC_SERVICE_HOST}:{SEMANTIC_SERVICE_PORT}')
stub = semantic_pb2_grpc.SemanticServiceStub(channel)

class SemanticClient:
    """Client for interacting with the Semantic Service"""
    
    def __init__(self):
        """Initialize the Semantic Client"""
        self.stub = stub
        print("Semantic Client initialized")

    async def save_transcript(self, room_id: str, speaker: str, text: str, language: str, timestamp: str):
        """Save a transcript using the semantic service."""
        try:
            # Create request with required fields
            request = semantic_pb2.SaveTranscriptRequest(
                room_id=room_id,
                speaker=speaker,
                text=text
            )
            
            # Set optional fields only if provided
            if timestamp:
                request.timestamp = timestamp
            if language:
                request.language = language
            
            # Run gRPC call in executor since it's synchronous
            response = self.stub.SaveTranscript(request)
            return response.success
            
        except Exception as e:
            print(f"Error calling semantic service: {e}")
            return False
    