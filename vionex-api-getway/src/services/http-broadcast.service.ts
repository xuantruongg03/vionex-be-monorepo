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
        }
    }

    broadcastToRoom(roomId: string, event: string, data: any) {
        if (this.io) {
            this.io.to(roomId).emit(event, data);
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
