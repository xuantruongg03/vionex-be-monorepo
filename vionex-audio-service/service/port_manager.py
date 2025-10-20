"""
Port Manager

Centralized port management for RTP transports:
- Smart port allocation with fallback strategies
- Port usage tracking and statistics
- Thread-safe port operations
"""

import logging
import socket
import threading
from typing import Dict, Any, Tuple, Set
from core.config import PORT_MAX, PORT_MIN

logger = logging.getLogger(__name__)


class PortManager:
    """
    Centralized port manager for RTP transport allocation
    
    Features:
    - Smart allocation with fallback strategies
    - Thread-safe operations with locking
    - Port usage tracking and statistics
    - Configurable port ranges
    - Automatic port release on cleanup
    """

    def __init__(self, port_range: Tuple[int, int] = (PORT_MIN, PORT_MAX)):
        """
        Initialize port manager
        
        Args:
            port_range: Tuple of (start_port, end_port) for allocation range
        """
        self._port_range = port_range
        self._used_ports: Set[int] = set()
        self._lock = threading.Lock()
        
        start_port, end_port = port_range
        total_ports = end_port - start_port + 1
        logger.info(f"Port Manager initialized with range {start_port}-{end_port} ({total_ports} ports)")
    
    def allocate_port(self, requested_port: int = 0, local_ip: str = "0.0.0.0") -> int:
        """
        Smart port allocation with fallback strategy
        
        Thread-safe allocation with the following strategy:
        1. If requested_port != 0: Try requested port first
        2. If failed or auto-assign (0): Find next available port in range
        3. If range exhausted: Use OS auto-assignment (port 0)
        
        Args:
            requested_port: Requested port (0 = auto-assign)
            local_ip: Local IP to bind for availability testing
            
        Returns:
            Port number to use for binding
        """
        with self._lock:
            # Strategy 1: Try requested port if specified
            if requested_port != 0:
                if self._is_port_available_unsafe(local_ip, requested_port):
                    self._mark_port_used_unsafe(requested_port)
                    logger.info(f"Allocated requested port {requested_port}")
                    return requested_port
                logger.warning(f"Requested port {requested_port} not available, finding alternative...")
            
            # Strategy 2: Find available port in range
            start_port, end_port = self._port_range
            logger.debug(f"Searching for available port in range {start_port}-{end_port}, currently used: {len(self._used_ports)} ports")
            
            for port in range(start_port, end_port + 1):
                if port not in self._used_ports and self._is_port_available_unsafe(local_ip, port):
                    self._mark_port_used_unsafe(port)
                    logger.info(f"Allocated available port {port} (used ports: {len(self._used_ports)})")
                    return port
            
            # Strategy 3: Fallback to OS auto-assignment
            logger.error(f"❌ No ports available in range {start_port}-{end_port}! Used: {len(self._used_ports)}/{end_port-start_port+1}")
            logger.error(f"Currently used ports: {sorted(list(self._used_ports))[:20]}..." if len(self._used_ports) > 20 else f"Currently used ports: {sorted(list(self._used_ports))}")
            return 0
    
    def release_port(self, port: int) -> None:
        """
        Release port for reuse
        
        Args:
            port: Port number to release
        """
        with self._lock:
            if port in self._used_ports:
                self._used_ports.remove(port)
                logger.debug(f"Released port {port}")
            else:
                logger.debug(f"Port {port} was not tracked (auto-assigned or already released)")
    
    def is_port_available(self, local_ip: str, port: int) -> bool:
        """
        Thread-safe check if a port is available for binding
        
        Args:
            local_ip: Local IP to test binding
            port: Port number to test
            
        Returns:
            True if port is available
        """
        with self._lock:
            return self._is_port_available_unsafe(local_ip, port)
    
    def _is_port_available_unsafe(self, ip: str, port: int) -> bool:
        """
        Internal method to check port availability (not thread-safe)
        
        Args:
            ip: IP address to bind
            port: Port number to test
            
        Returns:
            True if port is available
        """
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as test_sock:
                test_sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                test_sock.bind((ip, port))
                return True
        except OSError:
            return False
    
    def _mark_port_used_unsafe(self, port: int) -> None:
        """
        Internal method to mark port as used (not thread-safe)
        
        Args:
            port: Port number to mark as used
        """
        if port != 0:  # Don't track auto-assigned ports
            self._used_ports.add(port)
    
    def get_usage_stats(self) -> Dict[str, Any]:
        """
        Get port usage statistics
        
        Returns:
            Dictionary with usage statistics
        """
        with self._lock:
            start_port, end_port = self._port_range
            total_ports = end_port - start_port + 1
            used_count = len(self._used_ports)
            available_count = total_ports - used_count
            
            return {
                'port_range': f"{start_port}-{end_port}",
                'total_ports': total_ports,
                'used_ports_count': used_count,
                'available_ports_count': available_count,
                'usage_percentage': (used_count / total_ports) * 100 if total_ports > 0 else 0,
                'used_ports': sorted(list(self._used_ports))
            }
    
    def get_port_range(self) -> Tuple[int, int]:
        """
        Get current port range
        
        Returns:
            Tuple of (start_port, end_port)
        """
        return self._port_range
    
    def set_port_range(self, start_port: int, end_port: int) -> None:
        """
        Update port range (will not affect already allocated ports)
        
        Args:
            start_port: New start port
            end_port: New end port
        """
        with self._lock:
            old_range = self._port_range
            self._port_range = (start_port, end_port)
            total_ports = end_port - start_port + 1
            logger.info(f"Port range updated from {old_range[0]}-{old_range[1]} to {start_port}-{end_port} ({total_ports} ports)")
    
    def cleanup_all_ports(self) -> int:
        """
        Release all tracked ports (emergency cleanup)
        
        Returns:
            Number of ports released
        """
        with self._lock:
            released_count = len(self._used_ports)
            released_ports = list(self._used_ports)
            self._used_ports.clear()
            
            if released_count > 0:
                logger.info(f"Emergency cleanup: released {released_count} ports: {released_ports}")
            
            return released_count
    
    def is_port_in_range(self, port: int) -> bool:
        """
        Check if port is within managed range
        
        Args:
            port: Port number to check
            
        Returns:
            True if port is in range
        """
        start_port, end_port = self._port_range
        return start_port <= port <= end_port


# Global port manager instance
port_manager = PortManager()
