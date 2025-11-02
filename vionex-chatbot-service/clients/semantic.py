
import grpc
from proto import semantic_pb2_grpc, semantic_pb2
from core.config import SEMANTIC_SERVICE_HOST, SEMANTIC_SERVICE_PORT
from utils import logger

class SemanticClient:
    """Client for interacting with the Semantic Service"""
    
    def __init__(self):
        """Initialize the Semantic Client"""
        # Delay channel creation until first use (lazy initialization)
        self.channel = None
        self.stub = None
        self.service_host = SEMANTIC_SERVICE_HOST
        self.service_port = SEMANTIC_SERVICE_PORT
        logger.info("Semantic Client initialized")

    def _ensure_connection(self):
        """Ensure gRPC channel and stub are created (lazy initialization)"""
        if self.channel is None:
            self.channel = grpc.aio.insecure_channel(f'{self.service_host}:{self.service_port}')
            self.stub = semantic_pb2_grpc.SemanticServiceStub(self.channel)

    async def search(self, room_id: str, text: str, organization_id: str = None, room_key: str = None):
        """
        Search for a transcript using the semantic service.
        
        Args:
            room_id: Room ID (for backward compatibility)
            text: Search query text
            organization_id: Organization ID for filtering
            room_key: Unique room key for context isolation (NEW, preferred over room_id)
        """
        try:
            # Ensure connection is established
            self._ensure_connection()
            
            # Create request with required fields
            request_params = {
                'room_id': room_id,
                'query': text,
            }
            
            # Add organization_id if provided
            if organization_id:
                request_params['organization_id'] = organization_id
            
            # Add room_key if provided (NEW)
            if room_key:
                request_params['room_key'] = room_key
            
            request = semantic_pb2.SearchTranscriptsRequest(**request_params)

            logger.info(f"Calling semantic service with room_id={room_id}, room_key={room_key}, query={text}, org={organization_id}")

            # Await the async gRPC call
            response = await self.stub.SearchTranscripts(request)

            logger.info(f"Semantic service response: {response}")
            logger.info(f"Results count: {len(response.results)}")
            if response.results:
                logger.info(f"First result: {response.results[0]}")

            return response.results
            
        except Exception as e:
            logger.error(f"Error calling semantic service: {e}")
            import traceback
            traceback.print_exc()
            return []