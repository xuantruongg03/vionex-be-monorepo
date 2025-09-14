"""
Voice Clone Manager

Core voice cloning logic with focus on:
- Easy to understand and maintain
- Performance optimization  
- Proper cleanup
- Tận dụng existing functions
"""

import asyncio
import logging
import numpy as np
import os
import tempfile
import time
import gc
from typing import Optional
from collections import OrderedDict
from scipy.io import wavfile

from .audio_quality import assess_audio_quality, should_use_for_voice_clone, compare_audio_quality
from ..pipline_processor.text_to_speech import clone_and_save_embedding

logger = logging.getLogger(__name__)

class VoiceCloneManager:
    """
    Quản lý voice cloning với progressive learning
    
    Features:
    - Progressive voice cloning (10s+ audio)
    - Quality-based updates
    - Memory cache for performance
    - Proper cleanup
    """
    
    def __init__(self):
        """Initialize voice clone manager"""
        self.audio_buffers = {}      # {user_room_key: [audio_chunks]}
        self.embeddings_cache = OrderedDict()   # {user_room_key: embedding} - LRU cache
        self.quality_cache = {}      # {user_room_key: quality_info}
        self.processing_locks = {}   # {user_room_key: lock} - Prevent concurrent processing
        self.cache_timestamps = {}   # {user_room_key: timestamp} - TTL tracking
        
        # Memory management settings
        self.MAX_CACHE_SIZE = 50     # Max 50 cached embeddings
        self.CACHE_TTL = 1800        # 30 minutes TTL
        self.MAX_BUFFER_SIZE = 600   # Max 600 chunks (~12 seconds)
        self.MAX_BUFFER_DURATION = 15.0  # Max 15 seconds audio buffer
        
        # Storage paths
        self.embeddings_dir = "voice_clones/embeddings"
        self._ensure_directories()
        
        # Background task reference
        self._background_task = None
        self._task_started = False
        
    def _ensure_directories(self):
        """Tạo directories nếu chưa có"""
        try:
            os.makedirs(self.embeddings_dir, exist_ok=True)
        except Exception as e:
            logger.error(f"Failed to create voice clone directories: {e}")
    
    def _ensure_background_task(self):
        """Ensure background cleanup task is running"""
        try:
            if not self._task_started and asyncio.get_running_loop():
                self._background_task = asyncio.create_task(self._background_cleanup_task())
                self._task_started = True
        except RuntimeError:
            # No running event loop, task will be started when needed
            pass
        except Exception as e:
            logger.warning(f"Failed to start background task: {e}")
    
    def collect_audio(self, user_id: str, room_id: str, audio_chunk: bytes) -> None:
        """
        Thu thập audio chunk cho voice cloning với memory management
        
        Args:
            user_id: User identifier
            room_id: Room identifier  
            audio_chunk: Audio data bytes
        """
        try:
            key = f"{user_id}_{room_id}"
            
            # Ensure background task is running
            self._ensure_background_task()
            
            # Initialize buffer if needed
            if key not in self.audio_buffers:
                self.audio_buffers[key] = []
                logger.info(f"[VOICE-CLONE] Started collecting audio for {key}")
                
            # Memory management: limit buffer size
            if len(self.audio_buffers[key]) >= self.MAX_BUFFER_SIZE:
                # Keep only recent chunks, remove oldest
                self.audio_buffers[key] = self.audio_buffers[key][-int(self.MAX_BUFFER_SIZE * 0.7):]
                logger.debug(f"[VOICE-CLONE] Trimmed audio buffer for {key} to prevent memory overflow")
                
            # Add chunk to buffer
            self.audio_buffers[key].append(audio_chunk)
            
            # Check if we have enough audio (estimate ~10 seconds)
            total_chunks = len(self.audio_buffers[key])
            estimated_duration = total_chunks * 0.02  # Assume 20ms chunks
            
            # Log every 50 chunks to track progress
            if total_chunks % 50 == 0:
                logger.info(f"[VOICE-CLONE] {key}: collected {total_chunks} chunks (~{estimated_duration:.1f}s)")
            
            if estimated_duration >= 10.0:
                logger.info(f"[VOICE-CLONE] {key}: enough audio collected ({estimated_duration:.1f}s), starting processing")
                # Process in background (non-blocking)
                try:
                    # Check if event loop is available
                    try:
                        loop = asyncio.get_running_loop()
                        asyncio.create_task(self._process_voice_clone(key))
                        logger.info(f"[VOICE-CLONE] {key}: Background processing task created successfully")
                    except RuntimeError:
                        # No event loop running, try alternative approach
                        logger.warning(f"[VOICE-CLONE] {key}: No event loop running, attempting alternative processing")
                        # Run processing in a thread
                        import threading
                        thread = threading.Thread(target=self._run_voice_clone_sync, args=(key,))
                        thread.daemon = True
                        thread.start()
                        logger.info(f"[VOICE-CLONE] {key}: Started processing in separate thread")
                except Exception as e:
                    logger.error(f"[VOICE-CLONE] {key}: Failed to start processing: {e}")
                
        except Exception as e:
            logger.error(f"Error collecting audio for {user_id}_{room_id}: {e}")
    
    def _run_voice_clone_sync(self, key: str):
        """Run voice clone processing synchronously in thread"""
        try:
            # Create new event loop for this thread
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            
            # Run the async processing
            loop.run_until_complete(self._process_voice_clone(key))
            
        except Exception as e:
            logger.error(f"[VOICE-CLONE] Sync processing error for {key}: {e}")
        finally:
            try:
                loop.close()
            except:
                pass
    
    async def _process_voice_clone(self, key: str) -> None:
        """
        Xử lý voice cloning cho user
        
        Args:
            key: user_room_key (userId_roomId)
        """
        try:
            logger.info(f"[VOICE-CLONE] Starting voice clone processing for {key}")
            
            # Prevent concurrent processing for same user
            if key in self.processing_locks:
                logger.warning(f"[VOICE-CLONE] Processing already in progress for {key}")
                return
                
            self.processing_locks[key] = True
            
            # Combine audio chunks
            audio_buffer = await self._combine_audio_chunks(key)
            if audio_buffer is None:
                logger.warning(f"❌ [VOICE-CLONE] Failed to combine audio chunks for {key}")
                return
                
            logger.info(f"🎵 [VOICE-CLONE] Combined audio buffer: {len(audio_buffer)} samples for {key}")
                
            # Quality check - skip if not good enough
            if not should_use_for_voice_clone(audio_buffer):
                logger.warning(f"🔇 [VOICE-CLONE] Audio quality too low for voice cloning: {key}")
                self._reset_buffer(key)
                return
                
            # Check if we should update (compare with existing)
            current_quality = assess_audio_quality(audio_buffer)
            if not self._should_update_embedding(key, current_quality):
                logger.info(f"♻️ [VOICE-CLONE] Keeping existing voice clone for {key}")
                self._reset_buffer(key)
                return
                
            # Extract embedding using existing function
            embedding = await self._extract_embedding(audio_buffer, key)
            if embedding is None:
                logger.warning(f"❌ [VOICE-CLONE] Failed to extract embedding for {key}")
                self._reset_buffer(key)
                return
                
            # Update cache and save to file
            self._update_voice_cache(key, embedding, current_quality)
            logger.info(f"[VOICE-CLONE] Updated cache for {key}")
            
            # Save to persistent storage
            await self._save_embedding_to_file(key, embedding)
            
            # Reset buffer for next collection
            self._reset_buffer(key)
            
            # Force garbage collection after processing
            gc.collect()
            
            logger.info(f"[VOICE-CLONE] Voice clone completed for {key}")
            
        except Exception as e:
            logger.error(f"Voice cloning processing error for {key}: {e}")
        finally:
            # Always cleanup lock
            self.processing_locks.pop(key, None)
    
    async def _combine_audio_chunks(self, key: str) -> Optional[np.ndarray]:
        """
        Combine audio chunks thành single numpy array
        
        Args:
            key: user_room_key
            
        Returns:
            Combined audio as numpy array or None if failed
        """
        try:
            chunks = self.audio_buffers.get(key, [])
            if not chunks:
                return None
                
            # Convert all chunks to numpy arrays
            audio_arrays = []
            for chunk in chunks:
                try:
                    # Assume PCM 16-bit mono audio
                    audio_array = np.frombuffer(chunk, dtype=np.int16)
                    if len(audio_array) > 0:
                        audio_arrays.append(audio_array)
                except Exception as e:
                    logger.warning(f"Failed to convert audio chunk: {e}")
                    continue
                    
            if not audio_arrays:
                return None
                
            # Combine all arrays
            combined_audio = np.concatenate(audio_arrays)
            
            # Cleanup intermediate arrays immediately
            del audio_arrays
            
            return combined_audio
            
        except Exception as e:
            logger.error(f"Error combining audio chunks for {key}: {e}")
            return None
    
    def _should_update_embedding(self, key: str, new_quality: dict) -> bool:
        """
        Kiểm tra có nên update embedding không
        
        Args:
            key: user_room_key
            new_quality: Quality info of new audio
            
        Returns:
            bool: True if should update
        """
        try:
            # No existing embedding - always update
            if key not in self.quality_cache:
                return True
                
            # Compare with existing quality
            old_quality = self.quality_cache[key]
            return compare_audio_quality(old_quality, new_quality)
            
        except Exception as e:
            logger.error(f"Error checking update condition for {key}: {e}")
            return False
    
    async def _extract_embedding(self, audio_buffer: np.ndarray, key: str) -> Optional[np.ndarray]:
        """
        Extract speaker embedding using existing function với memory optimization
        
        Args:
            audio_buffer: Audio data as numpy array
            key: user_room_key for logging
            
        Returns:
            Speaker embedding or None if failed
        """
        temp_path = None
        try:
            logger.info(f"[VOICE-CLONE] {key}: Starting embedding extraction, audio buffer shape: {audio_buffer.shape}")
            
            # Create temporary WAV file (required by XTTS)
            with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as temp_file:
                temp_path = temp_file.name
                
            logger.debug(f"[VOICE-CLONE] {key}: Created temp WAV file: {temp_path}")
                
            # Write audio to temp file
            wavfile.write(temp_path, 16000, audio_buffer)
            logger.debug(f"[VOICE-CLONE] {key}: Wrote audio to temp file, size: {os.path.getsize(temp_path)} bytes")
            
            # Clear audio_buffer from memory immediately after writing
            del audio_buffer
            
            # Use existing clone_and_save_embedding function với simplified approach
            temp_embedding_path = temp_path.replace('.wav', '_embed.npy')
            
            logger.info(f"[VOICE-CLONE] {key}: Calling clone_and_save_embedding")
            embedding = clone_and_save_embedding(temp_path, temp_embedding_path)
            
            if embedding is not None:
                logger.info(f"[VOICE-CLONE] {key}: Successfully extracted embedding, shape: {embedding.shape}")
                # Clean up temp embedding file immediately  
                if os.path.exists(temp_embedding_path):
                    os.remove(temp_embedding_path)
            else:
                logger.warning(f"[VOICE-CLONE] {key}: clone_and_save_embedding returned None")
                
            return embedding
                
        except Exception as e:
            logger.error(f"[VOICE-CLONE] {key}: Error extracting embedding: {e}")
            import traceback
            logger.error(f"[VOICE-CLONE] {key}: Traceback: {traceback.format_exc()}")
            return None
        finally:
            # Always cleanup temp file
            if temp_path and os.path.exists(temp_path):
                try:
                    os.unlink(temp_path)
                    logger.debug(f"[VOICE-CLONE] {key}: Cleaned up temp WAV file: {temp_path}")
                except Exception as cleanup_error:
                    logger.warning(f"[VOICE-CLONE] {key}: Failed to cleanup temp file {temp_path}: {cleanup_error}")
    
    def _update_voice_cache(self, key: str, embedding: np.ndarray, quality: dict) -> None:
        """
        Update in-memory cache với LRU management
        
        Args:
            key: user_room_key
            embedding: Speaker embedding
            quality: Quality information
        """
        try:
            current_time = time.time()
            
            # Evict old entries if cache is full
            while len(self.embeddings_cache) >= self.MAX_CACHE_SIZE:
                oldest_key = next(iter(self.embeddings_cache))
                self._evict_cache_entry(oldest_key)
                
            # Update cache (LRU: remove if exists, then add to end)
            self.embeddings_cache.pop(key, None)
            self.embeddings_cache[key] = embedding
            self.cache_timestamps[key] = current_time
            self.quality_cache[key] = quality
            
        except Exception as e:
            logger.error(f"Error updating voice cache for {key}: {e}")
    
    def _evict_cache_entry(self, key: str) -> None:
        """
        Remove entry from all caches
        
        Args:
            key: user_room_key to evict
        """
        try:
            self.embeddings_cache.pop(key, None)
            self.cache_timestamps.pop(key, None)
            self.quality_cache.pop(key, None)
            logger.debug(f"Evicted cache entry: {key}")
        except Exception as e:
            logger.error(f"Error evicting cache entry {key}: {e}")
    
    async def _save_embedding_to_file(self, key: str, embedding: np.ndarray) -> None:
        """
        Save embedding to persistent file
        
        Args:
            key: user_room_key (format: userId_roomId)
            embedding: Speaker embedding to save
        """
        try:
            embedding_file = os.path.join(self.embeddings_dir, f"{key}.npy")
            
            logger.info(f"[SAVE-EMBEDDING] Saving embedding for {key}")
            logger.info(f"[SAVE-EMBEDDING] File path: {embedding_file}")
            logger.info(f"[SAVE-EMBEDDING] Embedding shape: {embedding.shape}, size: {embedding.size}")
            
            # Run file I/O in thread to avoid blocking
            await asyncio.get_event_loop().run_in_executor(
                None, np.save, embedding_file, embedding
            )
            
            # Verify file was created successfully
            if os.path.exists(embedding_file):
                file_size = os.path.getsize(embedding_file)
                logger.info(f"[SAVE-EMBEDDING] Successfully saved {key} - File size: {file_size} bytes")
            else:
                logger.error(f"[SAVE-EMBEDDING] File not found after save: {embedding_file}")
            
        except Exception as e:
            logger.error(f"[SAVE-EMBEDDING] Error saving embedding to file for {key}: {e}")
    
    def _reset_buffer(self, key: str) -> None:
        """
        Reset audio buffer sau khi xử lý
        
        Args:
            key: user_room_key
        """
        try:
            self.audio_buffers.pop(key, None)
        except Exception as e:
            logger.error(f"Error resetting buffer for {key}: {e}")
    
    def get_user_embedding(self, user_id: str, room_id: str) -> Optional[np.ndarray]:
        """
        Lấy embedding cho user với TTL và LRU cache
        
        Args:
            user_id: User identifier
            room_id: Room identifier
            
        Returns:
            Speaker embedding or None if not available
        """
        try:
            key = f"{user_id}_{room_id}"
            current_time = time.time()
            
            logger.debug(f"[VOICE-CLONE] Requesting embedding for {key}")
            
            # Check TTL first
            if key in self.cache_timestamps:
                if current_time - self.cache_timestamps[key] > self.CACHE_TTL:
                    self._evict_cache_entry(key)
                    logger.debug(f"[VOICE-CLONE] Evicted expired cache for {key}")
                    
            # Check cache first (O(1) lookup with LRU update)
            if key in self.embeddings_cache:
                # Move to end (most recently used)
                embedding = self.embeddings_cache.pop(key)
                self.embeddings_cache[key] = embedding
                self.cache_timestamps[key] = current_time
                logger.info(f"[CACHE-HIT] Found cached embedding for {key}")
                return embedding
                
            # Try loading from file (lazy loading)
            embedding_file = os.path.join(self.embeddings_dir, f"{key}.npy")
            if os.path.exists(embedding_file):
                logger.info(f"[LOAD-EMBEDDING] Found embedding file for {key}: {embedding_file}")
                try:
                    embedding = np.load(embedding_file)
                    
                    # Validate embedding shape and dimensions
                    if embedding is None or len(embedding.shape) == 0:
                        logger.warning(f"[LOAD-EMBEDDING] Invalid embedding shape for {key}, removing file")
                        os.remove(embedding_file)
                        return None
                    
                    # Check for reasonable embedding size (typical XTTS embeddings are 512-dim)
                    if embedding.size < 100 or embedding.size > 2048:
                        logger.warning(f"[LOAD-EMBEDDING] Embedding size {embedding.size} seems unusual for {key}, removing file")
                        os.remove(embedding_file)
                        return None
                        
                    # Check for NaN or infinite values
                    if np.any(np.isnan(embedding)) or np.any(np.isinf(embedding)):
                        logger.warning(f"[LOAD-EMBEDDING] Embedding contains NaN/Inf values for {key}, removing file")
                        os.remove(embedding_file)
                        return None
                    
                    # Add to cache với LRU management
                    self._add_to_cache(key, embedding, current_time)
                    logger.info(f"[LOAD-EMBEDDING] Loaded valid embedding from file for {key} (shape: {embedding.shape})")
                    return embedding
                    
                except Exception as e:
                    logger.error(f"[LOAD-EMBEDDING] Failed to load embedding for {key}: {e}, removing file")
                    try:
                        os.remove(embedding_file)
                    except:
                        pass
                    return None
                
            logger.debug(f"[LOAD-EMBEDDING] No embedding available for {key}")
            return None
            
        except Exception as e:
            logger.error(f"Error getting user embedding for {user_id}_{room_id}: {e}")
            return None
    
    def _add_to_cache(self, key: str, embedding: np.ndarray, timestamp: float) -> None:
        """
        Add embedding to cache with LRU eviction
        
        Args:
            key: user_room_key
            embedding: Speaker embedding
            timestamp: Current timestamp
        """
        try:
            # Evict oldest if cache full
            while len(self.embeddings_cache) >= self.MAX_CACHE_SIZE:
                oldest_key = next(iter(self.embeddings_cache))
                self._evict_cache_entry(oldest_key)
                
            self.embeddings_cache[key] = embedding
            self.cache_timestamps[key] = timestamp
            
        except Exception as e:
            logger.error(f"Error adding to cache for {key}: {e}")
    
    def cleanup_user_voice(self, user_id: str, room_id: str) -> None:
        """
        Cleanup voice data khi user leave room với memory optimization
        
        Args:
            user_id: User identifier
            room_id: Room identifier
        """
        try:
            key = f"{user_id}_{room_id}"
            
            # Clear memory cache
            self.audio_buffers.pop(key, None)
            self.processing_locks.pop(key, None)
            self._evict_cache_entry(key)
            
            # Force garbage collection
            gc.collect()
            
            # NOTE: Keep embedding files for future sessions
            # Only remove temporary/cache data
            
            logger.info(f"🧹 [CLEANUP] Cleaned up voice data for {key}")
            
        except Exception as e:
            logger.error(f"Error cleaning up voice data for {user_id}_{room_id}: {e}")
    
    def cleanup_room_voices(self, room_id: str) -> None:
        """
        Cleanup tất cả voice data cho room
        
        Args:
            room_id: Room identifier
        """
        try:
            # Find all keys for this room
            keys_to_remove = [key for key in self.audio_buffers.keys() if key.endswith(f"_{room_id}")]
            
            for key in keys_to_remove:
                # Extract user_id from key
                user_id = key.replace(f"_{room_id}", "")
                self.cleanup_user_voice(user_id, room_id)
                
            logger.info(f"Cleaned up all voice data for room {room_id}")
            
        except Exception as e:
            logger.error(f"Error cleaning up room voices for {room_id}: {e}")
    
    def get_stats(self) -> dict:
        """
        Get voice cloning statistics
        
        Returns:
            dict: Statistics information
        """
        try:
            return {
                'active_buffers': len(self.audio_buffers),
                'cached_embeddings': len(self.embeddings_cache),
                'processing_locks': len(self.processing_locks),
                'storage_directory': self.embeddings_dir,
                'cache_timestamps': len(self.cache_timestamps),
                'max_cache_size': self.MAX_CACHE_SIZE,
                'cache_ttl_seconds': self.CACHE_TTL
            }
        except Exception as e:
            logger.error(f"Error getting voice cloning stats: {e}")
            return {}
    
    async def _background_cleanup_task(self):
        """Background task for memory cleanup"""
        while True:
            try:
                await asyncio.sleep(300)  # Every 5 minutes
                
                current_time = time.time()
                
                # Cleanup expired cache entries
                expired_keys = [
                    key for key, timestamp in self.cache_timestamps.items()
                    if current_time - timestamp > self.CACHE_TTL
                ]
                
                for key in expired_keys:
                    self._evict_cache_entry(key)
                    
                if expired_keys:
                    logger.info(f"Background cleanup: evicted {len(expired_keys)} expired cache entries")
                
                # Cleanup stale processing locks (safety mechanism)
                if self.processing_locks:
                    logger.warning(f"Found {len(self.processing_locks)} stale processing locks, clearing")
                    self.processing_locks.clear()
                
                # Cleanup oversized audio buffers
                oversized_buffers = [
                    key for key, buffer in self.audio_buffers.items()
                    if len(buffer) > self.MAX_BUFFER_SIZE
                ]
                
                for key in oversized_buffers:
                    self.audio_buffers[key] = self.audio_buffers[key][-int(self.MAX_BUFFER_SIZE * 0.5):]
                    logger.warning(f"Trimmed oversized audio buffer for {key}")
                
                # Force garbage collection
                collected = gc.collect()
                if collected > 0:
                    logger.debug(f"Background cleanup: collected {collected} objects")
                
            except Exception as e:
                logger.error(f"Background cleanup error: {e}")
                
            except asyncio.CancelledError:
                logger.info("Background cleanup task cancelled")
                break
    
    def shutdown(self):
        """Shutdown the voice clone manager and cleanup resources"""
        try:
            if self._background_task and not self._background_task.done():
                self._background_task.cancel()
            self._task_started = False
            
            # Clear all caches
            self.audio_buffers.clear()
            self.embeddings_cache.clear()
            self.quality_cache.clear()
            self.processing_locks.clear()
            self.cache_timestamps.clear()
            
            # Force garbage collection
            gc.collect()
            
            logger.info("Voice clone manager shutdown completed")
            
        except Exception as e:
            logger.error(f"Error during voice clone manager shutdown: {e}")

# Global instance cho easy access
_voice_clone_manager = None

def get_voice_clone_manager() -> VoiceCloneManager:
    """Get global voice clone manager instance"""
    global _voice_clone_manager
    if _voice_clone_manager is None:
        _voice_clone_manager = VoiceCloneManager()
    return _voice_clone_manager
