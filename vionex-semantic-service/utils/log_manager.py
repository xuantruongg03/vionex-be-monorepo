import logging
import os
from logging.handlers import RotatingFileHandler

def setup_logger():
    """
    Sets up a centralized, rotating logger for the service.
    """
    # Create logs directory if it doesn't exist
    log_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'logs')
    if not os.path.exists(log_dir):
        os.makedirs(log_dir)

    log_file = os.path.join(log_dir, 'semantic_service.log')
    
    # Get the root logger and configure it
    logger = logging.getLogger('SemanticService')
    logger.setLevel(logging.INFO)

    # Prevent adding handlers multiple times in case of re-imports
    if logger.hasHandlers():
        logger.handlers.clear()

    # Create a rotating file handler: 1MB per file, keep the last 5 files
    handler = RotatingFileHandler(log_file, maxBytes=1024*1024, backupCount=5, encoding='utf-8')
    
    # Create a logging format
    formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
    handler.setFormatter(formatter)
    
    # Add the handler to the logger
    logger.addHandler(handler)
    
    # Disable propagation to root logger to prevent duplicate logs
    logger.propagate = False
    
    # Silence external library loggers - only log errors
    logging.getLogger('sentence_transformers').setLevel(logging.ERROR)
    logging.getLogger('httpx').setLevel(logging.ERROR)
    logging.getLogger('transformers').setLevel(logging.ERROR)
    logging.getLogger('torch').setLevel(logging.ERROR)
    logging.getLogger('qdrant_client').setLevel(logging.ERROR)
    
    # Disable root logger to prevent any console output
    root_logger = logging.getLogger()
    root_logger.setLevel(logging.CRITICAL)
    root_logger.handlers.clear()
    
    return logger

# Create a single logger instance to be used across the service
logger = setup_logger()
