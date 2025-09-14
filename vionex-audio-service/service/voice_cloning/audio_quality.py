"""
Audio Quality Assessment

Simple and efficient audio quality checking for voice cloning.
Focus: Easy to understand, maintain, and fast execution.
"""

import numpy as np
import logging

logger = logging.getLogger(__name__)

def assess_audio_quality(audio_data: np.ndarray, sample_rate: int = 16000) -> dict:
    """
    Đánh giá chất lượng audio đơn giản nhưng hiệu quả
    
    Args:
        audio_data: Audio numpy array (int16 or float32)
        sample_rate: Sample rate (default 16000)
    
    Returns:
        dict: {
            'overall_quality': float (0.0-1.0),
            'has_speech': bool,
            'speech_ratio': float,
            'signal_level': float
        }
    """
    try:
        if len(audio_data) == 0:
            return _empty_quality_result()
            
        # Normalize to float32
        if audio_data.dtype == np.int16:
            audio = audio_data.astype(np.float32) / 32767.0
        else:
            audio = audio_data.astype(np.float32)
            
        # Normalize amplitude
        max_abs = np.max(np.abs(audio))
        if max_abs > 0:
            audio = audio / max_abs
        else:
            return _empty_quality_result()
            
        quality_scores = []
        
        # 1. Signal Level Check (30%) - Âm thanh có đủ mạnh không
        rms_level = np.sqrt(np.mean(audio**2))
        if rms_level < 0.02:  # Too quiet
            level_score = 0.0
        elif rms_level > 0.2:  # Good level
            level_score = 1.0
        else:
            level_score = rms_level / 0.2
        quality_scores.append(level_score * 0.3)
        
        # 2. Dynamic Range Check (25%) - Kiểm tra biến thiên âm thanh
        dynamic_range = np.max(audio) - np.min(audio)
        if dynamic_range < 0.1:  # Too flat
            range_score = 0.0
        else:
            range_score = min(dynamic_range / 0.8, 1.0)
        quality_scores.append(range_score * 0.25)
        
        # 3. Speech Activity Detection (30%) - Phát hiện speech
        frame_size = int(0.025 * sample_rate)  # 25ms frames
        hop_size = int(0.01 * sample_rate)     # 10ms hop
        
        speech_frames = 0
        total_frames = 0
        
        for i in range(0, len(audio) - frame_size, hop_size):
            frame = audio[i:i + frame_size]
            energy = np.mean(frame**2)
            
            # Simple energy-based speech detection
            if energy > 0.01:  # Speech threshold
                speech_frames += 1
            total_frames += 1
            
        speech_ratio = speech_frames / max(total_frames, 1)
        has_speech = speech_ratio > 0.3  # At least 30% speech
        
        if has_speech:
            speech_score = min(speech_ratio / 0.7, 1.0)  # Normalize to 70% optimum
        else:
            speech_score = 0.0
        quality_scores.append(speech_score * 0.3)
        
        # 4. Noise Level Check (15%) - Kiểm tra background noise
        # Estimate noise from quiet segments
        quiet_threshold = 0.005
        quiet_segments = audio[np.abs(audio) < quiet_threshold]
        
        if len(quiet_segments) > 0:
            noise_level = np.std(quiet_segments)
            noise_score = max(0, 1 - noise_level * 100)  # Lower noise = higher score
        else:
            noise_score = 0.5  # Moderate score if no quiet segments
        quality_scores.append(noise_score * 0.15)
        
        # Calculate overall quality
        overall_quality = sum(quality_scores)
        overall_quality = min(max(overall_quality, 0.0), 1.0)
        
        return {
            'overall_quality': overall_quality,
            'has_speech': has_speech,
            'speech_ratio': speech_ratio,
            'signal_level': rms_level
        }
        
    except Exception as e:
        logger.error(f"Audio quality assessment error: {e}")
        return _empty_quality_result()

def should_use_for_voice_clone(audio_data: np.ndarray, 
                              sample_rate: int = 16000,
                              min_quality: float = 0.6) -> bool:
    """
    Kiểm tra audio có đủ tốt để dùng cho voice cloning không
    
    Args:
        audio_data: Audio numpy array
        sample_rate: Sample rate
        min_quality: Minimum quality threshold (0.0-1.0)
        
    Returns:
        bool: True if audio is good enough for voice cloning
    """
    try:
        quality_info = assess_audio_quality(audio_data, sample_rate)
        
        # Criteria for voice cloning:
        # 1. Must have speech
        # 2. Good speech ratio (>40%)
        # 3. Overall quality above threshold
        # 4. Decent signal level
        
        return (quality_info['has_speech'] and 
                quality_info['speech_ratio'] > 0.4 and
                quality_info['overall_quality'] >= min_quality and
                quality_info['signal_level'] > 0.05)
                
    except Exception as e:
        logger.error(f"Voice clone quality check error: {e}")
        return False

def compare_audio_quality(old_quality: dict, new_quality: dict) -> bool:
    """
    So sánh chất lượng audio cũ vs mới
    
    Args:
        old_quality: Quality dict from old audio
        new_quality: Quality dict from new audio
        
    Returns:
        bool: True if new audio is significantly better
    """
    try:
        # New audio must be meaningfully better
        quality_improvement = new_quality['overall_quality'] - old_quality['overall_quality']
        speech_improvement = new_quality['speech_ratio'] - old_quality['speech_ratio']
        
        # Require at least 10% improvement in overall quality
        # OR significant speech ratio improvement
        return (quality_improvement > 0.1 or 
                (quality_improvement > 0.05 and speech_improvement > 0.2))
                
    except Exception as e:
        logger.error(f"Audio quality comparison error: {e}")
        return False

def _empty_quality_result() -> dict:
    """Return empty quality result for error cases"""
    return {
        'overall_quality': 0.0,
        'has_speech': False,
        'speech_ratio': 0.0,
        'signal_level': 0.0
    }
