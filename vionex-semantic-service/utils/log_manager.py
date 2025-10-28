from datetime import datetime
import logging
import os

# Flag to ensure setup only runs once
_logger_initialized = False
_logger_instance = None

def setup_logger():
    """
    Sets up a centralized logger for the service.
    Creates one log file per day with the format: semantic_service_YYYY-MM-DD.log
    This function will only execute once, even if called multiple times.
    """
    global _logger_initialized, _logger_instance
    
    # Return existing logger if already initialized
    if _logger_initialized and _logger_instance:
        return _logger_instance
    
    # Create logs directory if it doesn't exist
    log_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'logs')
    if not os.path.exists(log_dir):
        os.makedirs(log_dir)
    
    # Create log file with current date
    date_str = datetime.now().strftime("%Y-%m-%d")
    log_file = os.path.join(log_dir, f'semantic_service_{date_str}.log')
    
    # Get the service logger
    logger = logging.getLogger('SemanticService')
    logger.setLevel(logging.INFO)

    # Prevent adding handlers multiple times
    if not logger.hasHandlers():
        # Create a simple file handler for the daily log file
        handler = logging.FileHandler(log_file, encoding='utf-8')
        
        # Create a logging format
        formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
        handler.setFormatter(formatter)
        
        # Add the handler to the logger
        logger.addHandler(handler)
    
    # Disable propagation to root logger to prevent duplicate logs
    logger.propagate = False
    
    # Configure external library loggers to only write to file, not console
    # This prevents them from creating their own handlers
    for lib_name in ['sentence_transformers', 'httpx', 'transformers', 'torch', 'qdrant_client', 'urllib3']:
        lib_logger = logging.getLogger(lib_name)
        lib_logger.setLevel(logging.WARNING)  # Only log warnings and errors
        lib_logger.propagate = False
        
        # Add file handler to library loggers if they don't have one
        if not lib_logger.hasHandlers():
            lib_handler = logging.FileHandler(log_file, encoding='utf-8')
            lib_handler.setFormatter(formatter)
            lib_logger.addHandler(lib_handler)
    
    _logger_initialized = True
    _logger_instance = logger
    
    return logger

# Create a single logger instance to be used across the service
logger = setup_logger()
