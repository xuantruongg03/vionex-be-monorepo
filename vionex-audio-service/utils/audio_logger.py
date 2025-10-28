"""
Audio Logger Utility - Simplified Version

Centralized audio recording functionality for debugging.
Logs metadata to terminal, saves audio to WAV files.
"""

import os
import wave
import logging
import numpy as np
from datetime import datetime
from typing import Optional, Dict, Any

logger = logging.getLogger(__name__)


class AudioLogger:
    """
    Simple audio logger - saves audio to WAV files, logs info to terminal
    """
    
    def __init__(self, base_dir: str, sample_rate: int = 16000, channels: int = 1):
        """
        Initialize audio logger
        
        Args:
            base_dir: Directory for saving audio files
            sample_rate: Audio sample rate (16000 or 48000)
            channels: Number of channels (1=mono, 2=stereo)
        """
        self.base_dir = base_dir
        self.sample_rate = sample_rate
        self.channels = channels
        self.packet_count = 0
        
        os.makedirs(base_dir, exist_ok=True)
        logger.info(f"[AudioLogger] Initialized: {base_dir} ({sample_rate}Hz, {channels}ch)")
    
    def save_audio(self, audio_data: bytes, prefix: str = "audio", metadata: Optional[Dict[str, Any]] = None):
        """
        Save audio to WAV file with timestamp
        
        Args:
            audio_data: PCM audio bytes
            prefix: Filename prefix
            metadata: Optional metadata dict to log
        """
        try:
            # Generate filename
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")[:-3]
            filename = f"{prefix}_{timestamp}.wav"
            filepath = os.path.join(self.base_dir, filename)
            
            # Save WAV
            with wave.open(filepath, 'wb') as wav_file:
                wav_file.setnchannels(self.channels)
                wav_file.setsampwidth(2)
                wav_file.setframerate(self.sample_rate)
                wav_file.writeframes(audio_data)
            
            # Calculate duration
            audio_array = np.frombuffer(audio_data, dtype=np.int16)
            if self.channels == 2:
                audio_array = audio_array.reshape(-1, 2)
            duration = len(audio_array) / self.sample_rate
            size_kb = len(audio_data) / 1024
            
            self.packet_count += 1
            
            # Log to terminal
            log_msg = f"[AudioLogger] Saved {filename}: {duration:.2f}s, {size_kb:.1f}KB"
            if metadata:
                meta_str = ", ".join([f"{k}={v}" for k, v in metadata.items()])
                log_msg += f" | {meta_str}"
            logger.info(log_msg)
            
            return filepath
            
        except Exception as e:
            logger.error(f"[AudioLogger] Failed to save audio: {e}")
            return None
    
    def close(self):
        """Close logger"""
        logger.info(f"[AudioLogger] Closed: {self.base_dir} ({self.packet_count} files saved)")


def save_audio_chunk(
    audio_data: bytes,
    filename: str,
    sample_rate: int = 16000,
    channels: int = 1,
    metadata: Optional[Dict[str, Any]] = None
) -> bool:
    """
    Quick utility to save single audio chunk
    
    Args:
        audio_data: PCM audio bytes
        filename: Full path to save
        sample_rate: Sample rate
        channels: Number of channels
        metadata: Optional metadata
        
    Returns:
        True if successful
    """
    try:
        os.makedirs(os.path.dirname(filename), exist_ok=True)
        
        # Save WAV
        with wave.open(filename, 'wb') as wav_file:
            wav_file.setnchannels(channels)
            wav_file.setsampwidth(2)
            wav_file.setframerate(sample_rate)
            wav_file.writeframes(audio_data)
        
        # Calculate info
        audio_array = np.frombuffer(audio_data, dtype=np.int16)
        if channels == 2:
            audio_array = audio_array.reshape(-1, 2)
        duration = len(audio_array) / sample_rate
        size_kb = len(audio_data) / 1024
        
        # Log
        log_msg = f"[AudioLogger] Saved {os.path.basename(filename)}: {duration:.2f}s, {size_kb:.1f}KB"
        if metadata:
            meta_str = ", ".join([f"{k}={v}" for k, v in metadata.items()])
            log_msg += f" | {meta_str}"
        logger.info(log_msg)
        
        return True
        
    except Exception as e:
        logger.error(f"[AudioLogger] Failed: {e}")
        return False
