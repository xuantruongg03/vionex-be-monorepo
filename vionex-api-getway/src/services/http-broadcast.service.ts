import { Injectable } from '@nestjs/common';
import { Server } from 'socket.io';

@Injectable()
export class HttpBroadcastService {
  private io: Server | null = null;

  setSocketServer(io: Server) {
    this.io = io;
    console.log('[HTTP Broadcast] Socket.IO server set successfully');
  }

  broadcastToUser(clientId: string, event: string, data: any) {
    if (this.io) {
      this.io.to(clientId).emit(event, data);
      console.log(`[HTTP Broadcast] ${event} to user ${clientId}:`, data);
    } else {
      console.warn('[HTTP Broadcast] Socket.IO server not available');
    }
  }

  broadcastToRoom(roomId: string, event: string, data: any) {
    if (this.io) {
      this.io.to(roomId).emit(event, data);
      console.log(`[HTTP Broadcast] ${event} to room ${roomId}:`, data);
    } else {
      console.warn('[HTTP Broadcast] Socket.IO server not available');
    }
  }
  broadcastToRoomExcept(
    roomId: string,
    excludeSocketId: string,
    event: string,
    data: any,
  ) {
    if (this.io) {
      this.io.to(roomId).except(excludeSocketId).emit(event, data);
      console.log(
        `[HTTP Broadcast] ${event} to room ${roomId} except ${excludeSocketId}:`,
        data,
      );
    } else {
      console.warn('[HTTP Broadcast] Socket.IO server not available');
    }
  }

  emitToAll(event: string, data: any) {
    if (this.io) {
      this.io.emit(event, data);
      console.log(`[HTTP Broadcast] ${event} to all clients:`, data);
    } else {
      console.warn('[HTTP Broadcast] Socket.IO server not available');
    }
  }
}
