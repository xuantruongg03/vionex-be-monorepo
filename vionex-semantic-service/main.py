
import grpc
import logging
import sys
from concurrent import futures

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

try:
    from core.config import GRPC_PORT
    from proto import semantic_pb2_grpc, semantic_pb2
    from services.semantic_processor import SemanticProcessor
    logger.info("Successfully imported semantic service components")
except Exception as e:
    logger.error(f"Error importing components: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)


class VionexSemanticService(semantic_pb2_grpc.SemanticServiceServicer):
    """
    Main gRPC semantic service
    """
    
    def __init__(self):
        """Initialize the semantic service"""
        logger.info("Initializing Vionex Semantic Service...")

        # Initialize semantic processor
        self.semantic_processor = SemanticProcessor()

        logger.info("Vionex Semantic Service initialized successfully")

    def SaveTranscript(self, request, context):
        """
        Save transcript to semantic service
        
        Args:
            request: SaveTranscriptRequest containing room_id, speaker, text, timestamp, language, organization_id
            context: gRPC context
            
        Returns:
            SaveTranscriptResponse with success=True/False, message
        """
        try:
            logger.info(f"SaveTranscript request: '{request.text}' from {request.speaker} in room {request.room_id}")

            # Handle optional fields properly
            timestamp = request.timestamp if request.HasField('timestamp') else None
            language = request.language if request.HasField('language') else "vi"
            organization_id = request.organization_id if request.HasField('organization_id') else None

            result = self.semantic_processor.save(
                room_id=request.room_id, 
                speaker=request.speaker, 
                text=request.text, 
                timestamp=timestamp, 
                language=language,
                organization_id=organization_id
            )
            
            if result:
                return semantic_pb2.SaveTranscriptResponse(
                    success=True,
                    message="Transcript saved successfully"
                )
            else:
                return semantic_pb2.SaveTranscriptResponse(
                    success=False,
                    message="Failed to save transcript"
                )
            
        except Exception as e:
            logger.error(f"SaveTranscript error: {e}")
            return semantic_pb2.SaveTranscriptResponse(
                success=False,
                message=f"Error: {str(e)}"
            )

    def SearchTranscripts(self, request, context):
        """
        Search for transcripts based on semantic similarity
        
        Args:
            request: SearchRequest containing the query text and optional parameters
            context: gRPC context
            
        Returns:
            SearchTranscriptsResponse with search results
        """
        try:
            logger.info(f"SearchTranscripts request: {request.query}")

            # Handle optional organization_id field
            organization_id = request.organization_id if request.HasField('organization_id') else None

            search_results = []
            # Process when ask "summary" or "tóm tắt"
            if "summary" in request.query.lower() or "tóm tắt" in request.query.lower():
                search_results = self.semantic_processor.get_text_by_room_id(request.room_id, organization_id)
            else:
                # Process the search query using the semantic processor
                search_results = self.semantic_processor.search(
                    request.query, 
                    request.room_id, 
                    request.limit or 10, 
                    organization_id
                )
            
            # Convert search results to proto format
            proto_results = []
            for result in search_results:
                transcript_result = semantic_pb2.TranscriptResult(
                    room_id=result.get("room_id", ""),
                    text=result.get("text", ""),
                    timestamp=str(result.get("timestamp", "")),
                    score=result.get("score", 0.0)
                )
                proto_results.append(transcript_result)
            
            # Create a reply with the search results
            return semantic_pb2.SearchTranscriptsResponse(
                results=proto_results
            )
            
        except Exception as e:
            logger.error(f"SearchTranscripts error: {e}")
            return semantic_pb2.SearchTranscriptsResponse(
                results=[]
            )
        
def serve():
    """Start the gRPC server"""
    try:
        logger.info("Starting Vionex Semantic Service gRPC server...")
        
        # Create gRPC server
        server = grpc.server(futures.ThreadPoolExecutor(max_workers=10))
        
        # Add service
        semantic_service = VionexSemanticService()
        semantic_pb2_grpc.add_SemanticServiceServicer_to_server(semantic_service, server)

        # Start server
        listen_addr = f'[::]:{GRPC_PORT}'
        server.add_insecure_port(listen_addr)
        
        server.start()
        logger.info(f"Vionex Semantic Service running on {listen_addr}")

        # Wait for termination
        server.wait_for_termination()
        
    except Exception as e:
        logger.error(f"Failed to start server: {e}")
        import traceback
        traceback.print_exc()
        raise


def main():
    """Main function"""
    try:
        import asyncio
        asyncio.run(serve())
    except KeyboardInterrupt:
        logger.info("Received shutdown signal")
    except Exception as e:
        logger.error(f"Service error: {e}")
        sys.exit(1)


if __name__ == '__main__':
    main()
