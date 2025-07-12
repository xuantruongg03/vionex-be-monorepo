"""
/*!
 * Copyright (c) 2025 xuantruongg003
 *
 * This software is licensed for non-commercial use only.
 * You may use, study, and modify this code for educational and research purposes.
 *
 * Commercial use of this code, in whole or in part, is strictly prohibited
 * without prior written permission from the author.
 *
 * Author Contact: lexuantruong098@gmail.com
 */

VIONEX AUDIO SERVICE

Audio transcription service với gRPC:
- Receive audio buffer from Gateway via gRPC
- Process audio buffer to transcribe by Whisper model  
- Send to semantic service to save transcript
"""

import grpc
import logging
import sys
from concurrent import futures
from dotenv import load_dotenv

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Load environment
load_dotenv()

try:
    from core.config import GRPC_PORT
    from proto import audio_pb2_grpc, audio_pb2
    from service.audio_processor import AudioProcessor
    logger.info("Successfully imported audio service components")
except Exception as e:
    logger.error(f"Error importing components: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)


class VionexAudioService(audio_pb2_grpc.AudioServiceServicer):
    """
    Main gRPC audio service
    """
    
    def __init__(self):
        """Initialize the audio service"""
        logger.info("Initializing Vionex Audio Service...")
        
        # Initialize audio processor
        self.audio_processor = AudioProcessor()
        
        # Statistics
        self.stats = {
            'total_requests': 0,
            'successful_transcripts': 0,
            'failed_transcripts': 0,
            'no_speech_detected': 0
        }
        
        logger.info("Vionex Audio Service initialized successfully")

    def ProcessAudioBuffer(self, request, context):
        """
        Process audio buffer, transcribe, and save to JSON file
        
        Args:
            request: ProcessAudioBufferRequest containing:
                - userId: User ID
                - roomId: Room ID  
                - timestamp: Timestamp
                - buffer: Audio data as bytes
                - duration: Duration in ms
                - sampleRate: Sample rate (default 16000)
                - channels: Channels (default 1)
            context: gRPC context
            
        Returns:
            ProcessAudioBufferResponse containing:
                - success: Whether processing was successful
                - message: Status message
                - transcript: Empty (transcript is saved to file)
        """
        try:
            # Update stats
            self.stats['total_requests'] += 1
            
            user_id = request.userId
            room_id = request.roomId
            duration = request.duration
            
            logger.info(f"Processing audio buffer from {user_id} in {room_id} - {duration:.0f}ms")
            
            # Validate request
            if not request.buffer or len(request.buffer) == 0:
                logger.warning("Empty audio buffer received")
                self.stats['failed_transcripts'] += 1
                
                return audio_pb2.ProcessAudioBufferResponse(
                    success=False,
                    transcript="",
                    confidence=0.0,
                    message="Empty audio buffer"
                )

            # Process with audio processor (run async method in sync context)
            import asyncio
            result = asyncio.run(self.audio_processor.process_buffer(
                buffer=request.buffer,
                room_id=room_id,
                user_id=user_id,
                sample_rate=request.sampleRate or 16000,
                channels=request.channels or 1,
                duration=duration
            ))
            
            # Update stats based on result
            if result['success']:
                if result.get('transcript_saved', False):
                    self.stats['successful_transcripts'] += 1
                    logger.info(f"Transcription saved successfully for {user_id} in {room_id}")
                else:
                    self.stats['no_speech_detected'] += 1
                    logger.info("No speech detected or not saved")
            else:
                self.stats['failed_transcripts'] += 1
                logger.error(f"Transcription failed: {result['message']}")
            
            # Return gRPC response (NO TRANSCRIPT INCLUDED)
            from proto import audio_pb2
            return audio_pb2.ProcessAudioBufferResponse(
                success=result['success'],
                transcript="",  # Always empty - transcript is saved to file
                confidence=0.0,  # Not returned anymore
                message=result['message']
            )
            
        except Exception as e:
            logger.error(f"ProcessAudioBuffer error: {e}")
            self.stats['failed_transcripts'] += 1
            
            return audio_pb2.ProcessAudioBufferResponse(
                success=False,
                transcript="",
                confidence=0.0,
                message=f"Stats error: {str(e)}"
            )

    def AllocatePort(self, request, context):
        """
        Legacy method - Allocate port for audio processing
        This is a compatibility method for the old architecture
        
        Args:
            request: PortRequest containing roomId and userId
            context: gRPC context
            
        Returns:
            PortReply with success=True, port=30005, ready=True
        """
        try:
            logger.info(f"AllocatePort request from {request.userId} in room {request.roomId}")
            
            # For compatibility, always return success with a dummy port
            # The actual audio processing will happen via ProcessAudioBuffer
            return audio_pb2.PortReply(
                success=True,
                port=30005,  # Dummy port for compatibility
                ready=True
            )
            
        except Exception as e:
            logger.error(f"AllocatePort error: {e}")
            return audio_pb2.PortReply(
                success=False,
                port=0,
                ready=False
            )

    def ReleasePort(self, request, context):
        """
        Legacy method - Release port after audio processing
        This is a compatibility method for the old architecture
        
        Args:
            request: PortRequest containing roomId and userId
            context: gRPC context
            
        Returns:
            Empty with success=True
        """
        try:
            logger.info(f"ReleasePort request from {request.userId} in room {request.roomId}")
            
            # For compatibility, always return success
            return audio_pb2.Empty(
                success=True
            )
            
        except Exception as e:
            logger.error(f"ReleasePort error: {e}")
            return audio_pb2.Empty(
                success=False
            )

    def ProcessAudioChunk(self, request, context):
        """
        Legacy method - Process audio chunk
        This method forwards to ProcessAudioBuffer for compatibility
        
        Args:
            request: ProcessAudioRequest containing roomId, userId, timestamp, audioBuffer, duration
            context: gRPC context
            
        Returns:
            ProcessAudioResponse with success status
        """
        try:
            logger.info(f"ProcessAudioChunk from {request.userId} in room {request.roomId} - {request.duration:.0f}ms")
            
            # Convert ProcessAudioRequest to ProcessAudioBufferRequest format
            buffer_request = audio_pb2.ProcessAudioBufferRequest(
                userId=request.userId,
                roomId=request.roomId,
                timestamp=request.timestamp,
                buffer=request.audioBuffer,
                duration=request.duration,
                sampleRate=16000,  # Default sample rate
                channels=1         # Default mono
            )
            
            # Process using the main ProcessAudioBuffer method
            buffer_response = self.ProcessAudioBuffer(buffer_request, context)
            
            # Convert response format
            return audio_pb2.ProcessAudioResponse(
                success=buffer_response.success,
                message=buffer_response.message if buffer_response.message else (
                    f"Processed audio chunk - transcript available" if buffer_response.success else "Processing failed"
                )
            )
            
        except Exception as e:
            logger.error(f"ProcessAudioChunk error: {e}")
            return audio_pb2.ProcessAudioResponse(
                success=False,
                message=f"Audio chunk processing failed: {str(e)}"
            )

    def GetTranscripts(self, request, context):
        """
        Legacy method - Get transcripts for a room
        
        Args:
            request: GetTranscriptsRequest containing roomId, fromTimestamp, toTimestamp
            context: gRPC context
            
        Returns:
            GetTranscriptsResponse with transcripts JSON
        """
        try:
            logger.info(f"📝 GetTranscripts request for room {request.roomId}")
            
            # This is a placeholder implementation
            # In a real implementation, you would read from the JSON files created by audio_processor
            return audio_pb2.GetTranscriptsResponse(
                success=True,
                message="Transcripts retrieved successfully",
                transcripts="[]"  # Empty array for now - implement file reading if needed
            )
            
        except Exception as e:
            logger.error(f"GetTranscripts error: {e}")
            return audio_pb2.GetTranscriptsResponse(
                success=False,
                message=f"Failed to get transcripts: {str(e)}",
                transcripts="[]"
            )

def serve():
    """Start the gRPC server"""
    try:
        logger.info("Starting Vionex Audio Service gRPC server...")
        
        # Create gRPC server
        server = grpc.server(futures.ThreadPoolExecutor(max_workers=10))
        
        # Add service
        audio_service = VionexAudioService()
        audio_pb2_grpc.add_AudioServiceServicer_to_server(audio_service, server)
        
        # Start server
        listen_addr = f'[::]:{GRPC_PORT}'
        server.add_insecure_port(listen_addr)
        
        server.start()
        logger.info(f"Vionex Audio Service running on {listen_addr}")
        
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
