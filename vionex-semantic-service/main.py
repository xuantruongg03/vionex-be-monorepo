
import grpc
import sys
from concurrent import futures

# Import the centralized logger first
from utils.log_manager import logger

try:
    from core.config import GRPC_PORT
    from proto import semantic_pb2_grpc, semantic_pb2
    from services.semantic_processor import SemanticProcessor
    logger.info("Successfully imported semantic service components")
except Exception as e:
    logger.error(f"Error importing components: {e}")
    import traceback
    logger.error(traceback.format_exc())
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
            request: SaveTranscriptRequest containing room_id, speaker, text, timestamp, language, organization_id, room_key
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
            room_key = request.room_key if request.HasField('room_key') else None  # NEW

            result = self.semantic_processor.save(
                room_id=request.room_id, 
                speaker=request.speaker, 
                original_text=request.text,
                original_language=language,
                timestamp=timestamp, 
                organization_id=organization_id,
                room_key=room_key  # NEW: Pass room_key
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
            request: SearchRequest containing the query text and optional parameters (room_id, room_key, organization_id)
            context: gRPC context
            
        Returns:
            SearchTranscriptsResponse with search results
        """
        try:
            logger.info(f"SearchTranscripts request: {request.query}")

            # Handle optional fields
            organization_id = request.organization_id if request.HasField('organization_id') else None
            room_key = request.room_key if request.HasField('room_key') else None  # NEW

            search_results = []
            # Process when ask "summary" or "tóm tắt"
            if "summary" in request.query.lower() or "tóm tắt" in request.query.lower():
                search_results = self.semantic_processor.get_text_by_room_id(
                    request.room_id, 
                    organization_id,
                    room_key  # NEW: Pass room_key
                )
            else:
                # Process the search query using the semantic processor
                # Default limit = 10 for bilingual context (OpenChat 3.5 8K context)
                search_results = self.semantic_processor.search(
                    request.query, 
                    request.room_id, 
                    request.limit or 10, 
                    organization_id,
                    room_key  # NEW: Pass room_key
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
    import signal
    import time
    import os
    
    server = None
    shutdown_requested = False
    
    def handle_shutdown(signum, frame):
        nonlocal shutdown_requested
        if shutdown_requested:
            logger.warning("Shutdown already in progress, ignoring duplicate signal")
            return
        
        shutdown_requested = True
        logger.info(f"[SHUTDOWN] Received signal: {signum} (PID: {os.getpid()})")
        logger.info(f"[SHUTDOWN] Signal name: {signal.Signals(signum).name if signum else 'UNKNOWN'}")
        
        if server:
            logger.info("[SHUTDOWN] Stopping gRPC server gracefully (10s grace period)...")
            server.stop(grace=10)
            logger.info("[SHUTDOWN] Server stopped successfully")
        else:
            logger.warning("[SHUTDOWN] Server not initialized yet")
    
    try:
        logger.info(f"Starting Vionex Semantic Service gRPC server (PID: {os.getpid()})...")
        
        # Register signal handlers
        signal.signal(signal.SIGTERM, handle_shutdown)
        signal.signal(signal.SIGINT, handle_shutdown)
        
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
        try:
            while not shutdown_requested:
                time.sleep(1)  # Sleep in shorter intervals to check shutdown flag
        except KeyboardInterrupt:
            logger.info("[SHUTDOWN] Keyboard interrupt received")
            handle_shutdown(signal.SIGINT, None)
        
    except Exception as e:
        logger.error(f"Failed to start server: {e}")
        import traceback
        logger.error(traceback.format_exc())
        raise


def main():
    """Main function"""
    try:
        serve()
    except KeyboardInterrupt:
        logger.info("Main received shutdown signal")
    except Exception as e:
        logger.error(f"Service error: {e}")
        sys.exit(1)


if __name__ == '__main__':
    main()
