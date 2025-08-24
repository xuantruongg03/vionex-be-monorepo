import { Injectable } from '@nestjs/common';
import { Server } from 'socket.io';

@Injectable()
export class HttpBroadcastService {
  private io: Server | null = null;

  setSocketServer(io: Server) {
    this.io = io;
    console.log('[HTTP Broadcast] Socket.IO server set successfully');
  }

  isSocketServerAvailable(): boolean {
    return this.io !== null;
  }

  broadcastToUser(clientId: string, event: string, data: any) {
    if (this.io) {
      this.io.to(clientId).emit(event, data);
      console.log(`[HTTP Broadcast] Sent event '${event}' to user ${clientId}`);
    } else {
      console.error('[HTTP Broadcast] Socket.IO server not available - cannot send to user');
      console.error('[HTTP Broadcast] Event:', event, 'ClientId:', clientId);
    }
  }

  broadcastToRoom(roomId: string, event: string, data: any) {
    if (this.io) {
      this.io.to(roomId).emit(event, data);
      console.log(`[HTTP Broadcast] Sent event '${event}' to room ${roomId}`);
    } else {
      console.error('[HTTP Broadcast] Socket.IO server not available - cannot broadcast to room');
      console.error('[HTTP Broadcast] Event:', event, 'RoomId:', roomId);
      console.error('[HTTP Broadcast] This usually means the WebSocket gateway has not been initialized yet');
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
    } else {
      console.warn('[HTTP Broadcast] Socket.IO server not available 3');
    }
  }

  emitToAll(event: string, data: any) {
    if (this.io) {
      this.io.emit(event, data);
    } else {
      console.warn('[HTTP Broadcast] Socket.IO server not available 4');
    }
  }
}
