"""
Vionex Audio Service

gRPC service for audio processing and translation:
- Audio transcription using Whisper
- Translation cabin port allocation
- Translation producer creation
"""

import grpc
import logging
import sys
import time
from concurrent import futures
from typing import Dict, Any

# Setup logging FIRST before importing other modules
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Import after logging is configured
from core.config import GRPC_PORT
from proto import audio_pb2_grpc, audio_pb2
from service.audio_processor import AudioProcessor
from service.translation_cabin import cabin_manager

class AudioService(audio_pb2_grpc.AudioServiceServicer):
    """
    Main gRPC Audio Service
    
    Handles:
    - Audio transcription using Whisper model
    - Translation cabin port allocation for plainRTP
    - Translation producer creation for client consumption
    """
    
    def __init__(self):
        """Initialize the audio service with processor and statistics"""
        logger.info("Initializing Audio Service...")
        
        # Initialize audio processor for Whisper transcription
        self.audio_processor = AudioProcessor()
        
        # Initialize service statistics tracking
        self._init_stats()
        
        logger.info("Audio Service initialized successfully")

    def _init_stats(self) -> None:
        """Initialize service statistics counters"""
        self.stats = {
            'total_requests': 0,          # Total audio processing requests
            'successful_transcripts': 0,  # Successfully transcribed audio
            'failed_transcripts': 0,      # Failed transcriptions
            'no_speech_detected': 0       # Audio with no detectable speech
        }

    def ProcessAudioBuffer(self, request, context):
        """
        Process audio buffer and perform transcription
        
        This is the main transcription endpoint called by the Gateway service.
        
        Args:
            request: ProcessAudioBufferRequest containing:
                - userId: ID of the user sending audio
                - roomId: ID of the room/meeting
                - buffer: Raw PCM audio data (bytes)
                - duration: Audio duration in milliseconds
                - sampleRate: Audio sample rate (default: 16000Hz)
                - channels: Number of audio channels (default: 1 - mono)
            context: gRPC context
            
        Returns:
            ProcessAudioBufferResponse:
                - success: Whether processing succeeded
                - transcript: Empty (transcript saved to file only)
                - confidence: Always 0.0 (not returned)
                - message: Status message
        """
        try:
            # Increment total request counter
            self.stats['total_requests'] += 1
            
            # Validate the incoming audio request
            if not self._validate_audio_request(request):
                return self._create_error_response("Invalid audio request")

            logger.info(f"Processing audio from {request.userId} in room {request.roomId}" + 
                       (f" for organization {request.organizationId}" if hasattr(request, 'organizationId') and request.organizationId else ""))
            
            # Get organization_id from request if provided
            organization_id = getattr(request, 'organizationId', None) if hasattr(request, 'organizationId') else None
            
            # Process audio asynchronously using the audio processor
            # This runs Whisper transcription in a thread executor
            import asyncio
            result = asyncio.run(self.audio_processor.process_buffer(
                buffer=request.buffer,
                room_id=request.roomId,
                user_id=request.userId,
                sample_rate=request.sampleRate or 16000,  # Default to 16kHz if not specified
                channels=request.channels or 1,           # Default to mono if not specified
                duration=request.duration,
                organization_id=organization_id
            ))
            
            # Update statistics based on processing result
            self._update_stats(result)
            
            # Return response - transcript is saved to file, not returned in response
            return audio_pb2.ProcessAudioBufferResponse(
                success=result['success'],
                transcript="",  # Always empty - transcript saved to JSON file only
                confidence=0.0, # Not used anymore
                message=result['message']
            )
            
        except Exception as e:
            logger.error(f"ProcessAudioBuffer error: {e}")
            self.stats['failed_transcripts'] += 1
            return self._create_error_response(f"Processing error: {str(e)}")

    def _validate_audio_request(self, request) -> bool:
        """
        Validate audio buffer request
        
        Checks if the audio buffer contains valid data
        
        Args:
            request: ProcessAudioBufferRequest to validate
            
        Returns:
            bool: True if request is valid, False otherwise
        """
        if not request.buffer or len(request.buffer) == 0:
            logger.warning("Empty audio buffer received")
            self.stats['failed_transcripts'] += 1
            return False
        return True

    def _update_stats(self, result: Dict[str, Any]) -> None:
        """
        Update processing statistics based on result
        
        Args:
            result: Processing result dictionary from audio_processor
        """
        if result['success']:
            if result.get('transcript_saved', False):
                self.stats['successful_transcripts'] += 1
            else:
                self.stats['no_speech_detected'] += 1
        else:
            self.stats['failed_transcripts'] += 1

    def _create_error_response(self, message: str):
        """
        Create standardized error response
        
        Args:
            message: Error message to include in response
            
        Returns:
            ProcessAudioBufferResponse with error state
        """
        return audio_pb2.ProcessAudioBufferResponse(
            success=False,
            transcript="",
            confidence=0.0,
            message=message
        )

    def AllocateTranslationPort(self, request, context):
        """
        Function to allocate translation port for a user in a room
        Returns:
            PortReply: Response containing port allocation details
                - success: Whether port allocation succeeded
                - port: Allocated UDP port number for plainRTP
                - send_port: Port for sending audio to SFU
                - ready: Whether the port is ready for use
                - ssrc: SSRC for the producer
        """
        try:
            # Create translation cabin using the cabin manager with default languages
            # sourceLanguage and targetLanguage will be provided in CreateTranslationProduce step
            cabin_info = cabin_manager.create_cabin(
                room_id=request.roomId,
                user_id=request.userId,
                source_language='vi',  # Default, will be updated in B3
                target_language='en'   # Default, will be updated in B3
            )
            
            # Check if cabin creation failed (returns None on failure)
            if not cabin_info:
                logger.error(f"Failed to create cabin for room={request.roomId}, user={request.userId}")
                return audio_pb2.PortReply(
                    success=False,
                    port=0,
                    send_port=0,
                    ready=False,
                    ssrc=0
                )
            
            logger.info(f"✅ Cabin created: room={request.roomId}, user={request.userId}, "
                       f"ports=({cabin_info['rtp_port']}, {cabin_info['send_port']}), ssrc={cabin_info['ssrc']}")
            
            return audio_pb2.PortReply(
                success=True,
                port=cabin_info['rtp_port'],      # Receive port
                send_port=cabin_info['send_port'], # Send port
                ssrc=cabin_info['ssrc'],           # SSRC for the producer
                ready=True
            )
            
        except Exception as e:
            logger.error(f"AllocateTranslationPort error: {e}")
            import traceback
            logger.error(f"Traceback: {traceback.format_exc()}")
            return audio_pb2.PortReply(
                success=False,
                port=0,
                send_port=0,
                ready=False,
                ssrc=0
            )

    def CreateTranslationProduce(self, request, context):
        """
        Create a translation producer for client consumption
        """
        try:
            # logger.info(f"CreateTranslationProduce request from {request.userId} in room {request.roomId}")
            
            # Find existing cabin created in B1 step (by room and user)
            existing_cabin_id = cabin_manager.find_cabin_by_user(request.roomId, request.userId)
            if not existing_cabin_id:
                return audio_pb2.CreateTranslationCabinResponse(
                    success=False,
                    message="No cabin found. Please call AllocateTranslationPort first.",
                    streamId=""
                )
            
            # Update cabin with actual languages from request
            if not cabin_manager.update_cabin_languages(
                existing_cabin_id, 
                request.sourceLanguage, 
                request.targetLanguage
            ):
                return audio_pb2.CreateTranslationCabinResponse(
                    success=False,
                    message="Failed to update cabin languages",
                    streamId=""
                )
            
            # Generate new cabin ID after language update
            cabin_key = f"{request.roomId}_{request.userId}_{request.sourceLanguage}_{request.targetLanguage}"
            
            # Start the translation cabin's RTP listener
            # This begins the plainRTP → STT → Translation → TTS → SFU pipeline
            if not cabin_manager.start_cabin(cabin_key):
                return audio_pb2.CreateTranslationCabinResponse(
                    success=False,
                    message="Failed to start translation cabin",
                    streamId=""
                )
            
            # Generate streamId for client consumption in B4 step
            # Client will use this streamId to consume the translated audio stream
            stream_id = f"translation_{request.userId}_{int(time.time())}"
            
            logger.info(f"Translation producer created with streamId: {stream_id}")
            
            return audio_pb2.CreateTranslationCabinResponse(
                success=True,
                message="Translation producer created successfully",
                streamId=stream_id
            )
            
        except Exception as e:
            logger.error(f"CreateTranslationProduce error: {e}")
            return audio_pb2.CreateTranslationCabinResponse(
                success=False,
                message=f"Failed to create translation producer: {str(e)}",
                streamId=""
            )

    def DestroyCabin(self, request, context):
        """
            Function to destroy cabin
        """
        try:
            # Destroy the cabin using the cabin manager
            if not cabin_manager.destroy_cabin(
                room_id=request.room_id,
                user_id=request.target_user_id,
                source_language=request.source_language,
                target_language=request.target_language
            ):
                return audio_pb2.DestroyCabinResponse(
                    success=False,
                    message="Failed to destroy cabin - not found"
                )
            
            return audio_pb2.DestroyCabinResponse(
                success=True,
                message="Cabin destroyed successfully"
            )
            
        except Exception as e:
            logger.error(f"DestroyCabin error: {e}")
            return audio_pb2.DestroyCabinResponse(
                success=False,
                message=f"Failed to destroy cabin: {str(e)}"
            )

def serve():
    """Start the gRPC server"""
    try:
        logger.info("Starting Audio Service gRPC server...")
        
        server = grpc.server(futures.ThreadPoolExecutor(max_workers=10))
        
        # Add service
        audio_service = AudioService()
        audio_pb2_grpc.add_AudioServiceServicer_to_server(audio_service, server)
        
        # Start server
        listen_addr = f'[::]:{GRPC_PORT}'
        server.add_insecure_port(listen_addr)
        server.start()
        
        logger.info(f"Audio Service running on {listen_addr}")
        server.wait_for_termination()
        
    except Exception as e:
        logger.error(f"Failed to start server: {e}")
        raise


def main():
    """Main function"""
    # Initialize file-based logging
    from core.logger_setup import setup_file_logger
    log_file = setup_file_logger()
    logger.info(f"File logging initialized: {log_file}")
    
    try:
        serve()
    except KeyboardInterrupt:
        logger.info("Received shutdown signal")
    except Exception as e:
        logger.error(f"Service error: {e}")
        sys.exit(1)


if __name__ == '__main__':
    main()
