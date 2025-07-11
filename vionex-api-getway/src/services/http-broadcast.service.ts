import { Injectable } from '@nestjs/common';
import { Server } from 'socket.io';

@Injectable()
export class HttpBroadcastService {
  private io: Server | null = null;

  setSocketServer(io: Server) {
    this.io = io;
  }

  broadcastToUser(clientId: string, event: string, data: any) {
    if (this.io) {
      this.io.to(clientId).emit(event, data);
    } else {
      console.warn('[HTTP Broadcast] Socket.IO server not available');
    }
  }

  broadcastToRoom(roomId: string, event: string, data: any) {
    if (this.io) {
      this.io.to(roomId).emit(event, data);
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
    } else {
      console.warn('[HTTP Broadcast] Socket.IO server not available');
    }
  }

  emitToAll(event: string, data: any) {
    if (this.io) {
      this.io.emit(event, data);
    } else {
      console.warn('[HTTP Broadcast] Socket.IO server not available');
    }
  }
}
