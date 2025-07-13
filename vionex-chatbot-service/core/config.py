import os
from dotenv import load_dotenv

load_dotenv()

# Server configuration
GRPC_PORT = int(os.getenv("CHATBOT_GRPC_PORT", 30007))

# Logging configuration
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")
