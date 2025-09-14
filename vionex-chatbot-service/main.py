
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
    from proto import chatbot_pb2_grpc, chatbot_pb2
    from services.chatbot_processor import ChatBotProcessor
    logger.info("Successfully imported semantic service components")
except Exception as e:
    logger.error(f"Error importing components: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)


class VionexChatBotService(chatbot_pb2_grpc.ChatbotServiceServicer):
    """
    Main gRPC chat bot service
    """
    
    def __init__(self):
        """Initialize the chat bot service"""
        logger.info("Initializing Vionex Chat Bot Service...")

        # Initialize chat bot processor
        self.chatbot_processor = ChatBotProcessor()

        logger.info("Vionex Chat Bot Service initialized successfully")

    def AskChatBot(self, request, context):
        """
        Ask the chat bot a question
        
        Args:
            request: AskChatBotRequest containing the prompt and optional parameters
            context: gRPC context

        Returns:
            AskChatBotResponse with the bot's answer
        """
        try:
            logger.info(f"AskChatBot request: {request.question} in room {request.room_id}")

            # Process the question using the chat bot processor
            response = self.chatbot_processor.ask(request.question, request.room_id)

            return chatbot_pb2.AskChatBotResponse(
                answer=response
            )

        except Exception as e:
            logger.error(f"AskChatBot error: {e}")
            return chatbot_pb2.AskChatBotResponse(
                answer="Error processing request"
            )

def serve():
    """Start the gRPC server"""
    try:
        logger.info("Starting Vionex Semantic Service gRPC server...")
        
        # Create gRPC server
        server = grpc.server(futures.ThreadPoolExecutor(max_workers=10))
        
        # Add service
        semantic_service = VionexChatBotService()
        chatbot_pb2_grpc.add_ChatbotServiceServicer_to_server(semantic_service, server)

        # Start server
        listen_addr = f'[::]:{GRPC_PORT}'
        server.add_insecure_port(listen_addr)
        
        server.start()
        logger.info(f"Vionex Chat Bot Service running on {listen_addr}")

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
