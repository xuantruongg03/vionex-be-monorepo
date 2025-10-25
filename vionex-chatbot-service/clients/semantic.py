
import grpc
from proto import semantic_pb2_grpc, semantic_pb2
from core.config import SEMANTIC_SERVICE_HOST, SEMANTIC_SERVICE_PORT

class SemanticClient:
    """Client for interacting with the Semantic Service"""
    
    def __init__(self):
        """Initialize the Semantic Client"""
        # Create async channel and stub
        self.channel = grpc.aio.insecure_channel(f'{SEMANTIC_SERVICE_HOST}:{SEMANTIC_SERVICE_PORT}')
        self.stub = semantic_pb2_grpc.SemanticServiceStub(self.channel)
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
            
            # Await the async gRPC call
            response = await self.stub.SearchTranscripts(request)
            return response.results
            
        except Exception as e:
            print(f"Error calling semantic service: {e}")
            return []