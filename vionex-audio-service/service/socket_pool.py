import logging
import socket as socket_module
import threading
import time
import struct
from typing import Dict, Optional, Callable, Any
from dataclasses import dataclass
from enum import Enum

logger = logging.getLogger(__name__)

class SocketPoolStatus(Enum):
    """Socket pool operational status"""
    INITIALIZING = "initializing"
    RUNNING = "running"
    STOPPING = "stopping" 
    STOPPED = "stopped"
    ERROR = "error"

@dataclass
class SocketPoolStats:
    """Socket pool statistics and metrics"""
    total_packets_received: int = 0
    total_packets_sent: int = 0
    active_cabins: int = 0
    packets_routed_successfully: int = 0
    packets_dropped: int = 0
    routing_errors: int = 0
    uptime_seconds: float = 0.0
    
    def get_success_rate(self) -> float:
        """Calculate packet routing success rate"""
        total = self.packets_routed_successfully + self.packets_dropped
        if total == 0:
            return 100.0
        return (self.packets_routed_successfully / total) * 100.0

class SharedSocketManager:
    """
    Shared Socket Manager for RTP Packet Routing
    
    Manages centralized RTP packet routing between SFU and translation cabins.
    Uses single RX/TX sockets with SSRC-based packet routing.
    """
    
    def __init__(self):
        # RX socket: Receive all RTP Packets from SFU
        self.rx_sock: Optional[socket_module.socket] = None

        # TX socket: Send all RTP packets to SFU
        self.tx_sock: Optional[socket_module.socket] = None
        
        # Routing tables
        self.ssrc_to_cabin: Dict[int, str] = {}  # SSRC → cabin_id
        self.cabin_to_ssrc: Dict[str, int] = {}  # cabin_id → SSRC
        self.cabin_callbacks: Dict[str, Callable] = {}  # cabin_id → callback function
        
        # Port tracking (for compatibility/debugging)
        self.cabin_to_ports: Dict[str, tuple] = {}  # cabin_id → (virtual_rx_port, tx_port)
        
        self._lock = threading.Lock()
        self.running = False
        self._rx_thread: Optional[threading.Thread] = None
        
    def initialize_shared_sockets(self, audio_rx_port=None, tx_source_port=0):
        """
        Initialize shared RX/TX sockets for RTP packet routing
        
        Args:
            audio_rx_port: Port to receive RTP packets from SFU (default: from config.SHARED_SOCKET_PORT)
            tx_source_port: TX socket source port (0 = ephemeral)
            
        Returns:
            bool: True if initialization successful
        """
        # Use config value if not specified
        if audio_rx_port is None:
            from core.config import SHARED_SOCKET_PORT
            audio_rx_port = SHARED_SOCKET_PORT
        
        try:
            # RX socket: Receive all RTP Packets from SFU on a single port
            self.rx_sock = socket_module.socket(socket_module.AF_INET, socket_module.SOCK_DGRAM)
            self.rx_sock.setsockopt(socket_module.SOL_SOCKET, socket_module.SO_REUSEADDR, 1)
            self.rx_sock.setsockopt(socket_module.SOL_SOCKET, socket_module.SO_RCVBUF, 1 << 20)  # 1MB buffer
            self.rx_sock.bind(("0.0.0.0", audio_rx_port))
            self.rx_sock.settimeout(1.0)

            # TX socket: Use SAME socket as RX for NAT traversal (replies from same port)
            # This ensures client NAT router allows incoming packets (same connection)
            self.tx_sock = self.rx_sock  # Reuse RX socket for sending
            logger.info(f"[SHARED-SOCKET] Using single socket for RX/TX (port {audio_rx_port}) for NAT compatibility")

            self.running = True
            self._start_rtp_router()
            time.sleep(0.1)
            
            logger.info(f"[SHARED-SOCKET] Initialized (RX port: {audio_rx_port})")
            return True
            
        except Exception as e:
            logger.error(f"[SHARED-SOCKET] Failed to initialize: {e}")
            return False
    
    def register_cabin_for_routing(self, cabin_id: str, ssrc: int, callback: Callable[[bytes], None]) -> Optional[tuple]:
        """
        Register cabin for RTP packet routing
        
        Args:
            cabin_id: Unique cabin identifier
            ssrc: RTP SSRC for packet routing
            callback: Function called when packets received for this cabin
            
        Returns:
            tuple: (rx_port, tx_port) - VIRTUAL ports for compatibility only, None if failed
            
        IMPORTANT: Returned ports are VIRTUAL (tracking only), NOT used for actual RTP
                   All RTP communication uses SHARED_SOCKET_PORT with SSRC-based routing
        """
        # ============================================================================
        # DEPRECATED: Port allocation removed - all cabins use SHARED_SOCKET_PORT
        # ============================================================================
        # Old code allocated virtual ports for tracking, but they were never used
        # Now we just use SHARED_SOCKET_PORT for everything
        from core.config import SHARED_SOCKET_PORT
        # from .port_manager import port_manager  # DEPRECATED
        
        with self._lock:
            if cabin_id in self.cabin_to_ssrc:
                return self.cabin_to_ports.get(cabin_id)

            # DEPRECATED: Virtual port allocation removed
            # allocated_rx_port = port_manager.allocate_port()
            # allocated_tx_port = port_manager.allocate_port()
            # if allocated_rx_port == 0 or allocated_tx_port == 0:
            #     for port in [allocated_rx_port, allocated_tx_port]:
            #         if port != 0:
            #             port_manager.release_port(port)
            #     logger.error(f"[SHARED-SOCKET] Failed to allocate VIRTUAL ports for cabin {cabin_id}")
            #     return None
            
            # Use SHARED_SOCKET_PORT for all cabins
            allocated_rx_port = SHARED_SOCKET_PORT
            allocated_tx_port = SHARED_SOCKET_PORT
            
            # ============================================================================
            # CORE ROUTING: Register SSRC-based routing (THIS IS WHAT MATTERS)
            # ============================================================================
            self.ssrc_to_cabin[ssrc] = cabin_id
            self.cabin_to_ssrc[cabin_id] = ssrc
            self.cabin_callbacks[cabin_id] = callback
            
            # Store ports for compatibility (now just SHARED_SOCKET_PORT)
            self.cabin_to_ports[cabin_id] = (allocated_rx_port, allocated_tx_port)
            
            logger.info(
                f"[SHARED-SOCKET] Registered cabin {cabin_id}: "
                f"SSRC={ssrc} (routing key), "
                f"port={SHARED_SOCKET_PORT}"
            )
            return (allocated_rx_port, allocated_tx_port)
    
    def unregister_cabin(self, cabin_id: str) -> bool:
        """
        Unregister cabin from routing system and cleanup resources
        
        Args:
            cabin_id: Cabin identifier to unregister
            
        Returns:
            bool: True if successfully unregistered
        """
        # ============================================================================
        # DEPRECATED: Port cleanup removed - using SHARED_SOCKET_PORT for all cabins
        # ============================================================================
        # from .port_manager import port_manager  # DEPRECATED
        
        with self._lock:
            # Get cabin info
            ssrc = self.cabin_to_ssrc.pop(cabin_id, None)
            ports = self.cabin_to_ports.pop(cabin_id, None)
            callback = self.cabin_callbacks.pop(cabin_id, None)
            
            if ssrc is not None:
                self.ssrc_to_cabin.pop(ssrc, None)
            
            if ssrc is None:
                logger.warning(f"[SHARED-SOCKET] Cabin {cabin_id} was not registered")
                return False
            
            logger.info(f"[SHARED-SOCKET] Unregistered cabin {cabin_id}: SSRC={ssrc}")
            return True
    
    def update_cabin_ssrc(self, cabin_id: str, new_ssrc: int) -> bool:
        """
        Update SSRC routing for a cabin (SSRC FIX)
        
        This is called when we receive the actual consumer SSRC from SFU,
        which may differ from the generated SSRC we used during registration.
        
        Args:
            cabin_id: Cabin identifier
            new_ssrc: Actual consumer SSRC from SFU
            
        Returns:
            bool: True if successfully updated
        """
        with self._lock:
            if cabin_id not in self.cabin_to_ssrc:
                logger.warning(f"[SHARED-SOCKET] Cannot update SSRC: cabin {cabin_id} not registered")
                return False
            
            old_ssrc = self.cabin_to_ssrc[cabin_id]
            if old_ssrc == new_ssrc:
                logger.info(f"[SHARED-SOCKET] SSRC unchanged for {cabin_id}: {new_ssrc}")
                return True
            
            # Remove old SSRC mapping
            if old_ssrc in self.ssrc_to_cabin:
                del self.ssrc_to_cabin[old_ssrc]
            
            # Add new SSRC mapping
            self.ssrc_to_cabin[new_ssrc] = cabin_id
            self.cabin_to_ssrc[cabin_id] = new_ssrc
            
            logger.info(f"[SHARED-SOCKET] ✅ Updated SSRC routing for {cabin_id}: {old_ssrc} -> {new_ssrc}")
            return True
    
    def _start_rtp_router(self):
        """Start RTP packet routing thread"""
        if self._rx_thread and self._rx_thread.is_alive():
            logger.warning("[SHARED-SOCKET] RTP router thread already running")
            return
        
        self._rx_thread = threading.Thread(
            target=self._rtp_packet_router,
            daemon=True,
            name="RTPRouter"
        )
        self._rx_thread.start()
    
    def _rtp_packet_router(self):
        """
        Main RTP packet routing loop
        
        Receives RTP packets from SFU and routes them to appropriate 
        cabin callbacks based on SSRC mapping.
        """
        logger.info("[RTP-ROUTER] Started")
        packet_count = 0
        
        while self.running:
            try:
                if not self.rx_sock:
                    logger.error("[RTP-ROUTER] ❌ RX socket is None!")
                    time.sleep(0.1)
                    continue
                
                # Receive RTP packet from SFU/client
                data, addr = self.rx_sock.recvfrom(4096)
                packet_count += 1
                
                # Log first packet only
                if packet_count == 1:
                    logger.info(f"[RTP-RX] First packet from {addr[0]}:{addr[1]}")
                
                if len(data) < 12:  # Minimum RTP header size
                    logger.warning(f"[RTP-RX] Packet too small: {len(data)} bytes")
                    continue
                
                # Extract SSRC from RTP header (bytes 8-11)
                ssrc = struct.unpack('!I', data[8:12])[0]
                
                # Route packet to correct cabin
                with self._lock:
                    cabin_id = self.ssrc_to_cabin.get(ssrc)
                    if cabin_id and cabin_id in self.cabin_callbacks:
                        callback = self.cabin_callbacks[cabin_id]
                        try:
                            # Call cabin's audio processing callback
                            callback(data)
                        except Exception as e:
                            logger.error(f"[RTP-ROUTER] Error in callback for {cabin_id}: {e}")
                    else:
                        # Auto-learn SSRC if only 1 cabin registered and SSRC mismatch
                        if len(self.cabin_to_ssrc) == 1:
                            cabin_id = next(iter(self.cabin_to_ssrc))
                            old_ssrc = self.cabin_to_ssrc[cabin_id]
                            if old_ssrc != ssrc:
                                # logger.info(f"[RTP-ROUTER] Auto-learning SSRC for {cabin_id}: {old_ssrc} -> {ssrc}")

                                # Clean up old SSRC mapping
                                if old_ssrc in self.ssrc_to_cabin:
                                    del self.ssrc_to_cabin[old_ssrc]

                                # Update with new SSRC
                                self.cabin_to_ssrc[cabin_id] = ssrc
                                self.ssrc_to_cabin[ssrc] = cabin_id

                                # Route current packet immediately
                                if cabin_id in self.cabin_callbacks:
                                    try:
                                        self.cabin_callbacks[cabin_id](data)
                                    except Exception as e:
                                        logger.error(f"[RTP-ROUTER] Error in auto-routed callback for {cabin_id}: {e}")
                                continue
                        
            except socket_module.timeout:
                continue  # Normal timeout, keep running
            except Exception as e:
                if self.running:  # Only log if we should be running
                    logger.error(f"[RTP-ROUTER] Error: {e}")
                time.sleep(0.1)
        
        # logger.info("[RTP-ROUTER] RTP packet router stopped")
    
    def send_rtp_to_sfu(self, rtp_packet: bytes, sfu_host: str, sfu_port: int, cabin_id: str = None) -> bool:
        """
        Send RTP packet to SFU using shared TX socket
        
        Args:
            rtp_packet: Complete RTP packet data
            sfu_host: SFU server hostname/IP
            sfu_port: SFU server port (receiveTransport port)
            cabin_id: Cabin identifier (unused, kept for compatibility)
            
        Returns:
            bool: True if packet sent successfully
        """
        if not self.tx_sock:
            logger.error(f"[SHARED-SOCKET] TX socket not initialized!")
            return False
        
        try:
            # Always send to configured SFU address (receiveTransport port)
            target_addr = (sfu_host, sfu_port)
            
            # Log first send with detailed info
            if not hasattr(self, '_first_send_logged'):
                local_addr = self.tx_sock.getsockname()
                logger.info(f"[RTP-TX] ========== AUDIO → SFU RTP SEND ==========")
                logger.info(f"[RTP-TX] Local (Audio):  {local_addr[0]}:{local_addr[1]}")
                logger.info(f"[RTP-TX] Target (SFU):   {sfu_host}:{sfu_port}")
                logger.info(f"[RTP-TX] Packet size:    {len(rtp_packet)} bytes")
                if len(rtp_packet) >= 12:
                    ssrc = int.from_bytes(rtp_packet[8:12], 'big')
                    logger.info(f"[RTP-TX] SSRC:           {ssrc}")
                logger.info(f"[RTP-TX] =============================================")
                self._first_send_logged = True
            
            bytes_sent = self.tx_sock.sendto(rtp_packet, target_addr)
            
            # Track statistics
            if not hasattr(self, '_tx_packet_count'):
                self._tx_packet_count = 0
            
            self._tx_packet_count += 1
            
            # Log every 100 packets
            if self._tx_packet_count % 100 == 0:
                logger.info(f"[RTP-TX] Sent {self._tx_packet_count} packets to SFU {sfu_host}:{sfu_port}")
            
            return bytes_sent > 0
            
        except Exception as e:
            logger.error(f"[SHARED-SOCKET] Error sending: {e}")
            return False

    def stop(self):
        """Stop shared socket manager and cleanup resources"""
        self.running = False
        
        # Wait for router thread to finish
        if self._rx_thread and self._rx_thread.is_alive():
            self._rx_thread.join(timeout=2.0)
        
        # Close sockets
        if self.rx_sock:
            try:
                self.rx_sock.close()
            except:
                pass
            self.rx_sock = None
            
        # TX socket is same as RX socket, so just set to None
        self.tx_sock = None
        
        # Clear routing tables
        with self._lock:
            self.ssrc_to_cabin.clear()
            self.cabin_to_ssrc.clear()
            self.cabin_callbacks.clear()
            self.cabin_to_ports.clear()
        
        logger.info("[SHARED-SOCKET] Stopped and cleaned up")

    def get_stats(self) -> Dict[str, Any]:
        """
        Get current statistics and status of the socket manager
        
        Returns:
            dict: Statistics including running status, cabin count, etc.
        """
        with self._lock:
            return {
                "running": self.running,
                "registered_cabins": len(self.cabin_to_ssrc),
                "ssrc_mappings": len(self.ssrc_to_cabin),
                "router_thread_alive": self._rx_thread.is_alive() if self._rx_thread else False,
                "rx_socket_connected": self.rx_sock is not None,
                "tx_socket_connected": self.tx_sock is not None,
                "cabin_list": list(self.cabin_to_ssrc.keys())
            }

# Global shared socket manager
shared_socket_manager: Optional[SharedSocketManager] = None

def get_shared_socket_manager() -> SharedSocketManager:
    """
    Get or create the global shared socket manager instance
    
    Returns:
        SharedSocketManager: Global socket manager instance
        
    Raises:
        RuntimeError: If initialization fails
    """
    global shared_socket_manager
    if shared_socket_manager is None:
        shared_socket_manager = SharedSocketManager()
        if not shared_socket_manager.initialize_shared_sockets():
            logger.error("[SHARED-SOCKET] Failed to initialize!")
            raise RuntimeError("Failed to initialize shared socket manager")
    return shared_socket_manager
