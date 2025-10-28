"""
Centralized Logging Setup for Audio Service
Configures file-based logging with detailed format including timestamp, level, action, file, line number, and errors.
"""
import logging
import os
from datetime import datetime
from pathlib import Path
import sys

def setup_file_logger():
    """
    Setup file-based logging for the entire audio service
    
    Log format: [timestamp] [level] [logger_name] [file:line] message
    Creates daily log files with automatic rotation
    """
    from core.config import LOG_LEVEL, LOG_TO_FILE, LOG_DIR, LOG_FILE_PREFIX
    
    # Create logs directory
    log_dir = Path(LOG_DIR)
    log_dir.mkdir(exist_ok=True)
    
    # Create log file with date prefix
    today = datetime.now().strftime("%Y-%m-%d")
    log_file = log_dir / f"{today}_{LOG_FILE_PREFIX}.log"
    
    # Root logger configuration
    root_logger = logging.getLogger()
    root_logger.setLevel(getattr(logging, LOG_LEVEL.upper(), logging.INFO))
    
    # Clear existing handlers
    root_logger.handlers.clear()
    
    # File handler with detailed format
    if LOG_TO_FILE:
        file_handler = logging.FileHandler(log_file, mode='a', encoding='utf-8')
        file_handler.setLevel(logging.DEBUG)
        
        # Detailed format with file and line number
        file_formatter = logging.Formatter(
            fmt='[%(asctime)s] [%(levelname)-8s] [%(name)-25s] [%(filename)s:%(lineno)4d] %(message)s',
            datefmt='%Y-%m-%d %H:%M:%S'
        )
        file_handler.setFormatter(file_formatter)
        root_logger.addHandler(file_handler)
        
        # Log startup message
        root_logger.info("=" * 120)
        root_logger.info(f"Audio Service Logger Initialized - Log file: {log_file}")
        root_logger.info(f"Log Level: {LOG_LEVEL}, Log to File: {LOG_TO_FILE}")
        root_logger.info("=" * 120)
    
    # Optional: Console handler for critical errors
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(logging.ERROR)  # Only show errors on console
    console_formatter = logging.Formatter(
        fmt='[%(asctime)s] [%(levelname)s] %(message)s',
        datefmt='%H:%M:%S'
    )
    console_handler.setFormatter(console_formatter)
    root_logger.addHandler(console_handler)
    
    return log_file


def get_logger(name: str) -> logging.Logger:
    """
    Get a logger instance for a specific module
    
    Args:
        name: Logger name (usually __name__)
        
    Returns:
        logging.Logger: Configured logger instance
    """
    return logging.getLogger(name)
