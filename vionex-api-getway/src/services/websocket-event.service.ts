// services/websocket-event.service.ts
import { Injectable } from '@nestjs/common';
import { Socket } from 'socket.io';

@Injectable()
export class WebSocketEventService {
  emitError(client: Socket, error: string, code: string, details?: any) {
    client.emit('sfu:error', {
      message: error,
      code,
      ...details,
    });
  }

  emitSuccess(client: Socket, event: string, data: any) {
    client.emit(event, data);
  }

  broadcastToRoom(client: Socket, roomId: string, event: string, data: any) {
    // Check if client is still in the room
    if (client.rooms.has(roomId)) {
      client.to(roomId).emit(event, data);
    } else {
      client.broadcast.to(roomId).emit(event, data);
    }
  }

  emitToClient(client: Socket, event: string, data: any) {
    client.emit(event, data);
  }

  // Standardized error responses
  roomNotFound(client: Socket) {
    this.emitError(client, 'Room not found', 'ROOM_NOT_FOUND');
  }

  participantNotFound(client: Socket) {
    this.emitError(client, 'Participant not found', 'PARTICIPANT_NOT_FOUND');
  }

  unauthorized(client: Socket, reason: string) {
    this.emitError(client, reason, 'UNAUTHORIZED');
  }

  internalError(client: Socket, details?: string) {
    this.emitError(client, 'Internal server error', 'INTERNAL_ERROR', { details });
  }
}
