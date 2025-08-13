"""
SFU Client

Handles communication with SFU service for translation cabin:
- Creates plainRTP transports for receiving/sending audio
- Manages producers and consumers for translation streams
- Integrates with mediasoup via gRPC
"""

import logging
import grpc
from typing import Dict, Any, Optional

from core.config import (
    MEDIASOUP_WORKER_HOST, MEDIASOUP_WORKER_PORT
)

logger = logging.getLogger(__name__)


class SFUClient:
    """
    Client for communicating with SFU service
    """
    
    def __init__(self):
        self.channel = None
        self.stub = None
        self._connected = False
        
    async def connect(self) -> bool:
        """
        Connect to SFU service
        
        Returns:
            True if connected successfully
        """
        try:
            # Import gRPC stub (you'll need to generate this from sfu.proto)
            # For now, this is a placeholder
            
            sfu_address = f"{MEDIASOUP_WORKER_HOST}:{MEDIASOUP_WORKER_PORT}"
            self.channel = grpc.aio.insecure_channel(sfu_address)
            
            # self.stub = SfuServiceStub(self.channel)  # You'll need to import this
            
            # Test connection
            # await self.stub.GetIceServers(...)  # Test call
            
            self._connected = True
            logger.info(f"Connected to SFU service at {sfu_address}")
            return True
            
        except Exception as e:
            logger.error(f"Failed to connect to SFU service: {e}")
            self._connected = False
            return False

    async def disconnect(self):
        """Disconnect from SFU service"""
        try:
            if self.channel:
                await self.channel.close()
                self._connected = False
                logger.info("Disconnected from SFU service")
        except Exception as e:
            logger.error(f"Error disconnecting from SFU service: {e}")

    async def create_translation_transport(
        self, 
        room_id: str, 
        cabin_id: str,
        direction: str = "receive",  # "receive" or "send"
        source_peer_id: str = None,
        source_language: str = None,
        target_language: str = None,
        rtp_port: int = None
    ) -> Optional[Dict[str, Any]]:
        """
        Create a plainRTP transport for translation cabin
        
        Args:
            room_id: Room identifier
            cabin_id: Translation cabin identifier
            direction: "receive" to get audio from room, "send" to send translated audio
            source_peer_id: Source peer ID (for receive transport)
            source_language: Source language (for send transport)
            target_language: Target language (for send transport)
            rtp_port: RTP port for the transport
            
        Returns:
            Transport information with RTP parameters
        """
        try:
            if not self._connected:
                await self.connect()
            
            logger.info(f"Creating {direction} transport for cabin {cabin_id} in room {room_id}")
            
            if direction == "receive":
                # Create receive transport to get audio from source peer
                # This would be an actual gRPC call to SFU service
                response = {
                    "success": True,
                    "transport_id": f"translation_receive_{cabin_id}",
                    "consumer_id": f"translation_consumer_{cabin_id}",
                    "rtp_parameters": {
                        "ip": "127.0.0.1",
                        "port": rtp_port,
                        "rtcp_port": rtp_port + 1,
                        "payload_type": 111,
                        "clock_rate": 48000,
                        "channels": 2
                    }
                }
            else:  # send
                # Create send transport to send translated audio to room
                response = {
                    "success": True,
                    "transport_id": f"translation_send_{cabin_id}",
                    "producer_id": f"translation_producer_{cabin_id}",
                    "stream_id": f"translation_stream_{cabin_id}_{target_language}",
                    "rtp_parameters": {
                        "ip": "127.0.0.1",
                        "port": rtp_port,
                        "rtcp_port": rtp_port + 1,
                        "payload_type": 111,
                        "clock_rate": 48000,
                        "channels": 2
                    }
                }
            
            return response
            
        except Exception as e:
            logger.error(f"Failed to create translation transport: {e}")
            return None

    async def create_translation_consumer(
        self, 
        room_id: str, 
        cabin_id: str,
        source_user_id: str,
        rtp_port: int
    ) -> Optional[Dict[str, Any]]:
        """
        Create a consumer to receive audio from a specific user for translation
        
        Args:
            room_id: Room identifier
            cabin_id: Translation cabin identifier  
            source_user_id: User whose audio to consume for translation
            rtp_port: RTP port for the consumer
            
        Returns:
            Consumer information
        """
        try:
            if not self._connected:
                await self.connect()
            
            logger.info(f"Creating consumer for user {source_user_id} in cabin {cabin_id}")
            
            # This would be an actual gRPC call to SFU service
            # await self.stub.CreateTranslationReceiveTransport(...)
            
            consumer_info = {
                "success": True,
                "consumer_id": f"translation_consumer_{cabin_id}_{source_user_id}",
                "transport_id": f"translation_receive_{cabin_id}",
                "rtp_parameters": {
                    "ip": "127.0.0.1",
                    "port": rtp_port,
                    "rtcp_port": rtp_port + 1,
                    "payload_type": 111,
                    "clock_rate": 48000,
                    "channels": 2
                }
            }
            
            return consumer_info
            
        except Exception as e:
            logger.error(f"Failed to create translation consumer: {e}")
            return None

    async def create_translation_producer(
        self, 
        room_id: str, 
        cabin_id: str,
        target_language: str,
        rtp_port: int
    ) -> Optional[Dict[str, Any]]:
        """
        Create a producer to send translated audio back to the room
        
        Args:
            room_id: Room identifier
            cabin_id: Translation cabin identifier
            target_language: Target language for the translation stream
            rtp_port: RTP port for the producer
            
        Returns:
            Producer information
        """
        try:
            if not self._connected:
                await self.connect()
            
            logger.info(f"Creating translation producer for cabin {cabin_id} (target: {target_language})")
            
            # This would be an actual gRPC call to SFU service
            # await self.stub.CreateTranslationSendTransport(...)
            
            producer_info = {
                "success": True,
                "producer_id": f"translation_producer_{cabin_id}_{target_language}",
                "stream_id": f"translation_stream_{cabin_id}_{target_language}",
                "transport_id": f"translation_send_{cabin_id}",
                "rtp_parameters": {
                    "ip": "127.0.0.1",
                    "port": rtp_port,
                    "rtcp_port": rtp_port + 1,
                    "payload_type": 111,
                    "clock_rate": 48000,
                    "channels": 2
                },
                "metadata": {
                    "type": "translation",
                    "cabin_id": cabin_id,
                    "source_language": "auto",
                    "target_language": target_language,
                    "display_name": f"Translation ({target_language.upper()})"
                }
            }
            
            return producer_info
            
        except Exception as e:
            logger.error(f"Failed to create translation producer: {e}")
            return None

    async def send_rtp_audio(
        self, 
        transport_id: str, 
        audio_data: bytes,
        rtp_parameters: Dict[str, Any]
    ) -> bool:
        """
        Send audio data via RTP to mediasoup
        
        Args:
            transport_id: Transport identifier
            audio_data: PCM audio data
            rtp_parameters: RTP parameters for the transport
            
        Returns:
            True if sent successfully
        """
        try:
            # This would implement actual RTP packet sending
            # For now, this is a placeholder
            
            logger.info(f"Sending {len(audio_data)} bytes of audio via transport {transport_id}")
            
            # In real implementation:
            # 1. Convert PCM to appropriate codec (Opus)
            # 2. Create RTP packets with proper headers
            # 3. Send via UDP to mediasoup plainRTP transport
            
            return True
            
        except Exception as e:
            logger.error(f"Failed to send RTP audio: {e}")
            return False

    async def remove_translation_stream(
        self, 
        room_id: str, 
        cabin_id: str
    ) -> bool:
        """
        Remove translation stream from room
        
        Args:
            room_id: Room identifier
            cabin_id: Translation cabin identifier
            
        Returns:
            True if removed successfully
        """
        try:
            if not self._connected:
                await self.connect()
            
            logger.info(f"Removing translation stream for cabin {cabin_id} from room {room_id}")
            
            # This would be actual gRPC call to SFU service
            # await self.stub.RemoveTranslationCabin(...)
            
            return True
            
        except Exception as e:
            logger.error(f"Failed to remove translation stream: {e}")
            return False

    async def notify_translation_available(
        self, 
        room_id: str, 
        cabin_id: str,
        source_language: str,
        target_language: str
    ) -> bool:
        """
        Notify room participants that translation is available
        
        Args:
            room_id: Room identifier
            cabin_id: Translation cabin identifier
            source_language: Source language
            target_language: Target language
            
        Returns:
            True if notification sent successfully
        """
        try:
            logger.info(f"Notifying room {room_id} about translation {source_language}→{target_language}")
            
            # This would send a notification to all room participants
            # about the new translation stream being available
            
            notification = {
                "type": "translation_available",
                "cabin_id": cabin_id,
                "source_language": source_language,
                "target_language": target_language,
                "stream_id": f"translation_stream_{cabin_id}_{target_language}"
            }
            
            # Send to room participants via WebSocket or other mechanism
            
            return True
            
        except Exception as e:
            logger.error(f"Failed to notify translation availability: {e}")
            return False


# Global SFU client instance
sfu_client = SFUClient()
