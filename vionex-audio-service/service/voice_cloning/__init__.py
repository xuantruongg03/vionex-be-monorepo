"""
Voice Cloning Module

Handles progressive voice cloning for TTS personalization:
- Audio collection from speech
- Quality assessment 
- Embedding extraction using XTTS-v2
- Cache management for performance
"""

from .voice_clone_manager import get_voice_clone_manager
from .audio_quality import assess_audio_quality, should_use_for_voice_clone

__all__ = ['get_voice_clone_manager', 'assess_audio_quality', 'should_use_for_voice_clone']
