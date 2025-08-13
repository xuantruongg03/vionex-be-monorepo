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
    Shared socket manager với RTP packet routing
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
        
    def initialize_shared_sockets(self, audio_rx_port=35000, tx_source_port=0):
        """
        Starting Shared Sockets with RTP Packet Routing
        
        ARGS:
            Audio_rx_port: Fixed port to receive all RTP Packets from SFU (Default: 35000)
            TX_Source_port: Source Port for TX Socket (0 = Ephemeral)
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
            return True
            
        except Exception as e:
            logger.error(f"[SHARED-SOCKET] ❌ Failed to initialize: {e}")
            return False
    
    def register_cabin_for_routing(self, cabin_id: str, ssrc: int, callback: Callable[[bytes], None]) -> Optional[tuple]:
        """
        Register the cabin for RTP Packet Routing
        
        ARGS:
            Cabin_ID: Cabin's ID
            SSRC: SSRC of Cabin to Routing Packets
            Callback: Function is called when receiving packet for this cabin
            
        Returns:
            tuple: (allocated_rx_port, allocated_tx_port) for compatibility with existing code
        """
        from .port_manager import port_manager
        
        with self._lock:
            if cabin_id in self.cabin_to_ssrc:
                return self.cabin_to_ports.get(cabin_id)

            # Allocate ports from port manager for compatibility
            allocated_rx_port = port_manager.allocate_port()
            allocated_tx_port = port_manager.allocate_port()

            # Release ports if allocation failed
            if allocated_rx_port == 0 or allocated_tx_port == 0:
                for port in [allocated_rx_port, allocated_tx_port]:
                    if port != 0:
                        port_manager.release_port(port)
                logger.error(f"[SHARED-SOCKET] Failed to allocate ports for cabin {cabin_id}")
                return None
            
            # Register routing
            self.ssrc_to_cabin[ssrc] = cabin_id
            self.cabin_to_ssrc[cabin_id] = ssrc
            self.cabin_callbacks[cabin_id] = callback
            self.cabin_to_ports[cabin_id] = (allocated_rx_port, allocated_tx_port)
            
            logger.info(f"[SHARED-SOCKET] Registered cabin {cabin_id}: SSRC={ssrc}, allocated_ports=({allocated_rx_port}, {allocated_tx_port})")
            return (allocated_rx_port, allocated_tx_port)
    
    def unregister_cabin(self, cabin_id: str) -> bool:
        """Cancel registration from routing system """
        from .port_manager import port_manager
        
        with self._lock:
            # Get cabin info
            ssrc = self.cabin_to_ssrc.pop(cabin_id, None)
            ports = self.cabin_to_ports.pop(cabin_id, None)
            callback = self.cabin_callbacks.pop(cabin_id, None)
            
            if ssrc is not None:
                self.ssrc_to_cabin.pop(ssrc, None)
            
            # Release allocated ports back to port manager
            if ports:
                allocated_rx_port, allocated_tx_port = ports
                port_manager.release_port(allocated_rx_port)
                port_manager.release_port(allocated_tx_port)
                logger.debug(f"[SHARED-SOCKET] Released ports {allocated_rx_port}, {allocated_tx_port} for cabin {cabin_id}")
            
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
        RTP packet router - Receive packets and routes to the correct cabin
        """
        logger.info("[RTP-ROUTER] Starting RTP packet routing...")
        packet_count = 0
        last_log_time = time.time()
        
        while self.running:
            try:
                if not self.rx_sock:
                    time.sleep(0.1)
                    continue
                
                # Receive RTP packet from SFU
                data, addr = self.rx_sock.recvfrom(4096)
                packet_count += 1
                
                # Log every 10 seconds for debugging
                # current_time = time.time()
                # if current_time - last_log_time >= 10.0:
                #     logger.info(f"[RTP-ROUTER] Received {packet_count} packets in 10s from {addr}")
                #     last_log_time = current_time
                #     packet_count = 0
                
                if len(data) < 12:  # Minimum RTP header size
                    logger.debug(f"[RTP-ROUTER] Packet too small: {len(data)} bytes from {addr}")
                    continue
                
                # Extract SSRC from RTP header (bytes 8-11)
                ssrc = struct.unpack('!I', data[8:12])[0]
                
                # Log first few packets for debugging
                # if packet_count <= 5:
                #     logger.info(f"[RTP-ROUTER] Packet #{packet_count}: {len(data)}B from {addr}, SSRC={ssrc}")
                
                # Route packet to correct cabin
                with self._lock:
                    cabin_id = self.ssrc_to_cabin.get(ssrc)
                    if cabin_id and cabin_id in self.cabin_callbacks:
                        callback = self.cabin_callbacks[cabin_id]
                        try:
                            # Call cabin's audio processing callback
                            callback(data)
                            if packet_count <= 5:
                                logger.info(f"[RTP-ROUTER] Routed to cabin {cabin_id}")
                        except Exception as e:
                            logger.error(f"[RTP-ROUTER] Error in callback for {cabin_id}: {e}")
                    else:
                        # Auto-learn SSRC if only 1 cabin registered and SSRC mismatch
                        if len(self.cabin_to_ssrc) == 1:
                            cabin_id = next(iter(self.cabin_to_ssrc))
                            old_ssrc = self.cabin_to_ssrc[cabin_id]
                            if old_ssrc != ssrc:
                                logger.info(f"[RTP-ROUTER] Auto-learning SSRC for {cabin_id}: {old_ssrc} -> {ssrc}")

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
                                        logger.info(f"[RTP-ROUTER] Auto-routed to cabin {cabin_id} with learned SSRC {ssrc}")
                                    except Exception as e:
                                        logger.error(f"[RTP-ROUTER] Error in auto-routed callback for {cabin_id}: {e}")
                                continue
                        
                        # Multiple cabins or no auto-learning possible
                        # if packet_count <= 10:  # Log more details initially
                        #     logger.info(f"[RTP-ROUTER] No cabin registered for SSRC {ssrc}")
                        #     logger.info(f"[RTP-ROUTER] Available SSRC mappings: {dict(self.ssrc_to_cabin)}")
                        #     logger.info(f"[RTP-ROUTER] Cabin to SSRC mappings: {dict(self.cabin_to_ssrc)}")
                        #     logger.info(f"[RTP-ROUTER] Total registered cabins: {len(self.cabin_to_ssrc)}")
                        # elif packet_count % 100 == 0:  # Periodic logging for unmatched packets
                        #     logger.warning(f"[RTP-ROUTER] Still receiving unmatched SSRC {ssrc} after {packet_count} packets")
                        
            except socket_module.timeout:
                # Log timeout periodically to confirm router is still alive
                # current_time = time.time()
                # if current_time - last_log_time >= 30.0:
                #     logger.info(f"[RTP-ROUTER] Still listening on port, no packets received in 30s")
                #     last_log_time = current_time
                continue  # Normal timeout, keep running
            except Exception as e:
                if self.running:  # Only log if we should be running
                    logger.error(f"[RTP-ROUTER] Error: {e}")
                time.sleep(0.1)
        
        logger.info("[RTP-ROUTER] RTP packet router stopped")
    
    def send_rtp_to_sfu(self, rtp_packet: bytes, sfu_host: str, sfu_port: int) -> bool:
        """
        Send RTP Packet to SFU using Shared TX Socket
        
        Args:
            rtp_packet: Complete RTP packet (header + payload)  
            sfu_host: SFU server address
            sfu_port: SFU server port
            
        Returns:
            bool: True if sent successfully
        """
        if not self.tx_sock:
            logger.error(f"[SHARED-SOCKET] TX socket not initialized!")
            return False
        
        try:
            bytes_sent = self.tx_sock.sendto(rtp_packet, (sfu_host, sfu_port))
            
            # DEBUG: Log details for debugging
            if len(rtp_packet) >= 12:
                ssrc = struct.unpack('!I', rtp_packet[8:12])[0]
                logger.debug(f"[SHARED-SOCKET] Sent {bytes_sent}B to {sfu_host}:{sfu_port}, SSRC={ssrc}")
            else:
                logger.debug(f"[SHARED-SOCKET] Sent {bytes_sent}B to {sfu_host}:{sfu_port}")
                
            return bytes_sent > 0
            
        except Exception as e:
            logger.error(f"[SHARED-SOCKET] Error sending to {sfu_host}:{sfu_port}: {e}")
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
        """Get shared socket manager statistics"""
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
    """Get or create shared socket manager"""
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
