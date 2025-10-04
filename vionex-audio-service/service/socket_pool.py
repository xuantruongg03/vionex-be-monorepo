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
        
        # DEV: Test mode support for local testing with NAT traversal
        # DEV: When ENABLE_TEST_MODE=true, learn client addresses from incoming RTP
        from core.config import ENABLE_TEST_MODE
        self.test_mode = ENABLE_TEST_MODE  # DEV: Test mode flag
        self.cabin_to_client_address: Dict[str, tuple] = {}  # DEV: cabin_id → (client_ip, client_port)
        
        self._lock = threading.Lock()
        self.running = False
        self._rx_thread: Optional[threading.Thread] = None
        
    def initialize_shared_sockets(self, audio_rx_port=35000, tx_source_port=0):
        """
        Initialize shared RX/TX sockets for RTP packet routing
        
        Args:
            audio_rx_port: Port to receive RTP packets from SFU (default: 35000)
            tx_source_port: TX socket source port (0 = ephemeral)
            
        Returns:
            bool: True if initialization successful
        """
        try:
            # RX socket: Receive all RTP Packets from SFU on a single port
            self.rx_sock = socket_module.socket(socket_module.AF_INET, socket_module.SOCK_DGRAM)
            self.rx_sock.setsockopt(socket_module.SOL_SOCKET, socket_module.SO_REUSEADDR, 1)
            self.rx_sock.setsockopt(socket_module.SOL_SOCKET, socket_module.SO_RCVBUF, 1 << 20)  # 1MB buffer
            self.rx_sock.bind(("0.0.0.0", audio_rx_port))
            self.rx_sock.settimeout(1.0)
            logger.info(f"[SHARED-SOCKET] RX socket bound to 0.0.0.0:{audio_rx_port}")

            # TX socket: Send all RTP packets to SFU
            self.tx_sock = socket_module.socket(socket_module.AF_INET, socket_module.SOCK_DGRAM)
            self.tx_sock.setsockopt(socket_module.SOL_SOCKET, socket_module.SO_REUSEADDR, 1)

            if tx_source_port > 0:  # Bind source port if SFU requires comedia:false
                self.tx_sock.bind(("0.0.0.0", tx_source_port))
                logger.info(f"[SHARED-SOCKET] TX socket bound to 0.0.0.0:{tx_source_port}")
            else:
                logger.info(f"[SHARED-SOCKET] TX socket created with ephemeral port")

            self.running = True
            
            # Start RTP packet routing thread
            logger.info(f"[SHARED-SOCKET] Starting RTP router thread...")
            self._start_rtp_router()
            
            # Wait a moment to ensure router thread started
            time.sleep(0.1)
            
            logger.info(f"[SHARED-SOCKET] Initialized RX:{audio_rx_port}, TX source:{tx_source_port or 'ephemeral'}")
            
            # DEV: Log test mode status
            if self.test_mode:
                logger.warning(f"[SHARED-SOCKET] TEST MODE ENABLED - Will learn client addresses from incoming RTP")
                logger.warning(f"[SHARED-SOCKET] Translated audio will be sent back to learned addresses")
            else:
                logger.info(f"[SHARED-SOCKET] Production mode - Using configured SFU addresses")
            
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
            tuple: (rx_port, tx_port) for compatibility, None if failed
        """
        from .port_manager import port_manager
        
        with self._lock:
            if cabin_id in self.cabin_to_ssrc:
                return self.cabin_to_ports.get(cabin_id)

            allocated_rx_port = port_manager.allocate_port()
            allocated_tx_port = port_manager.allocate_port()

            # Release ports if allocation failed
            if allocated_rx_port == 0 or allocated_tx_port == 0:
                for port in [allocated_rx_port, allocated_tx_port]:
                    if port != 0:
                        port_manager.release_port(port)
                logger.error(f"[SHARED-SOCKET] Failed to allocate ports for cabin {cabin_id}")
                return None
            
            # Register SSRC-based routing
            self.ssrc_to_cabin[ssrc] = cabin_id
            self.cabin_to_ssrc[cabin_id] = ssrc
            self.cabin_callbacks[cabin_id] = callback
            self.cabin_to_ports[cabin_id] = (allocated_rx_port, allocated_tx_port)
            
            logger.info(f"[SHARED-SOCKET] Registered cabin {cabin_id}: SSRC={ssrc}, allocated_ports=({allocated_rx_port}, {allocated_tx_port})")
            return (allocated_rx_port, allocated_tx_port)
    
    def unregister_cabin(self, cabin_id: str) -> bool:
        """
        Unregister cabin from routing system and cleanup resources
        
        Args:
            cabin_id: Cabin identifier to unregister
            
        Returns:
            bool: True if successfully unregistered
        """
        from .port_manager import port_manager
        
        with self._lock:
            # Get cabin info
            ssrc = self.cabin_to_ssrc.pop(cabin_id, None)
            ports = self.cabin_to_ports.pop(cabin_id, None)
            callback = self.cabin_callbacks.pop(cabin_id, None)
            
            if ssrc is not None:
                self.ssrc_to_cabin.pop(ssrc, None)
            
            if ports:
                allocated_rx_port, allocated_tx_port = ports
                port_manager.release_port(allocated_rx_port)
                port_manager.release_port(allocated_tx_port)
            
            # DEV: Cleanup learned client address in test mode
            if cabin_id in self.cabin_to_client_address:  # DEV: Remove learned address
                del self.cabin_to_client_address[cabin_id]
            
            if ssrc is None:
                logger.warning(f"[SHARED-SOCKET] Cabin {cabin_id} was not registered")
                return False
            
            logger.info(f"[SHARED-SOCKET] Unregistered cabin {cabin_id}: SSRC={ssrc}")
            return True
    
    def _start_rtp_router(self):
        """Start RTP packet routing thread"""
        if self._rx_thread and self._rx_thread.is_alive():
            return
        
        self._rx_thread = threading.Thread(
            target=self._rtp_packet_router,
            daemon=True,
            name="RTPRouter"
        )
        self._rx_thread.start()
        logger.info("[SHARED-SOCKET] Started RTP packet router thread")
    
    def _rtp_packet_router(self):
        """
        Main RTP packet routing loop
        
        Receives RTP packets from SFU and routes them to appropriate 
        cabin callbacks based on SSRC mapping.
        """
        packet_count = 0
        
        while self.running:
            try:
                if not self.rx_sock:
                    time.sleep(0.1)
                    continue
                
                # Receive RTP packet from SFU/client
                data, addr = self.rx_sock.recvfrom(4096)
                packet_count += 1
                
                # DEV: Log first packet and every 100 packets
                if packet_count == 1 or packet_count % 100 == 0:
                    logger.info(f"[RTP-RX] 📥 Packet #{packet_count} from {addr[0]}:{addr[1]}, size={len(data)} bytes")
                
                if len(data) < 12:  # Minimum RTP header size
                    logger.warning(f"[RTP-RX] Packet too small: {len(data)} bytes")
                    continue
                
                # Extract SSRC from RTP header (bytes 8-11)
                ssrc = struct.unpack('!I', data[8:12])[0]
                
                # Route packet to correct cabin
                with self._lock:
                    cabin_id = self.ssrc_to_cabin.get(ssrc)
                    if cabin_id and cabin_id in self.cabin_callbacks:
                        # DEV: Learn client address in test mode for NAT traversal
                        # DEV: This allows sending RTP back to test clients behind NAT
                        if self.test_mode and cabin_id not in self.cabin_to_client_address:
                            self.cabin_to_client_address[cabin_id] = addr  # DEV: Store (ip, port)
                            logger.info(f"[TEST-MODE] ✅ Learned client address for cabin {cabin_id}")
                            logger.info(f"[TEST-MODE]    Client: {addr[0]}:{addr[1]}")
                            logger.info(f"[TEST-MODE]    RTP packets will be sent back to this address")
                        
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
    
    def send_rtp_to_sfu(self, rtp_packet: bytes, sfu_host: str, sfu_port: int, cabin_id: str = None) -> bool:  # DEV: Added cabin_id param
        """
        Send RTP packet to SFU/client using shared TX socket
        
        DEV: In test mode, if cabin_id provided and client address learned,
        DEV: sends to learned client address instead of configured SFU.
        DEV: This enables test clients behind NAT to receive RTP packets.
        
        Args:
            rtp_packet: Complete RTP packet data
            sfu_host: SFU server hostname/IP (fallback for production)
            sfu_port: SFU server port (fallback for production)
            cabin_id: Cabin identifier (optional, for test mode address lookup)  # DEV: New param
            
        Returns:
            bool: True if packet sent successfully
        """
        if not self.tx_sock:
            logger.error(f"[SHARED-SOCKET] TX socket not initialized!")
            return False
        
        try:
            # DEV: Test mode - try learned client address first
            target_addr = None
            using_learned = False  # DEV: Track if using learned address
            
            if self.test_mode and cabin_id:  # DEV: Check test mode and cabin_id
                with self._lock:
                    target_addr = self.cabin_to_client_address.get(cabin_id)  # DEV: Get learned address
                if target_addr:
                    using_learned = True  # DEV: Mark as using learned address
                    logger.debug(f"[RTP-TX] Using learned address for {cabin_id}: {target_addr[0]}:{target_addr[1]}")
            
            # DEV: Fallback to configured SFU (production mode or no learned address)
            if not target_addr:
                target_addr = (sfu_host, sfu_port)  # DEV: Use config for production
                if self.test_mode and cabin_id:
                    logger.warning(f"[RTP-TX] No learned address for {cabin_id}, using config: {sfu_host}:{sfu_port}")
                else:
                    logger.debug(f"[RTP-TX] Sending to configured SFU: {sfu_host}:{sfu_port}")
            
            bytes_sent = self.tx_sock.sendto(rtp_packet, target_addr)
            
            # DEV: Log successful send (every 100 packets)
            if not hasattr(self, '_tx_packet_count'):
                self._tx_packet_count = 0
            self._tx_packet_count += 1
            if self._tx_packet_count % 100 == 0:
                mode = "learned" if using_learned else "configured"
                logger.info(f"[RTP-TX] Sent packet #{self._tx_packet_count} to {target_addr[0]}:{target_addr[1]} ({mode})")
            
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
            
        if self.tx_sock:
            try:
                self.tx_sock.close()
            except:
                pass
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
        logger.info("[SHARED-SOCKET] Creating new SharedSocketManager instance...")
        shared_socket_manager = SharedSocketManager()
        if not shared_socket_manager.initialize_shared_sockets():
            logger.error("[SHARED-SOCKET] Failed to initialize shared socket manager!")
            raise RuntimeError("Failed to initialize shared socket manager")
        logger.info("[SHARED-SOCKET] SharedSocketManager created and initialized successfully")
    else:
        logger.info("[SHARED-SOCKET] Using existing SharedSocketManager instance")
    return shared_socket_manager
