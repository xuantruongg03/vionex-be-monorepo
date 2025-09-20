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

 Call the semantic service to search data
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

    async def search(self, room_id: str, text: str, organization_id: str = None):
        """Search for a transcript using the semantic service."""
        try:
            # Create request with required fields
            request_params = {
                'room_id': room_id,
                'query': text,
            }
            
            # Add organization_id if provided
            if organization_id:
                request_params['organization_id'] = organization_id
            
            request = semantic_pb2.SearchTranscriptsRequest(**request_params)
            
            response = self.stub.SearchTranscripts(request)
            return response.results
            
        except Exception as e:
            print(f"Error calling semantic service: {e}")
            return []
    