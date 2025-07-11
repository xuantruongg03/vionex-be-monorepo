/**
 * 🎙️ AUDIO RELAY HANDLER
 *
 * Gateway module để xử lý audio chunks từ client
 * - Nhận audio buffer từ WebSocket
 * - Validate user và room
 * - Forward đến Audio Service qua gRPC
 * - Không dùng PlainRTP/MediaSoup cho audio transcription
 */

import { Injectable, Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import { Socket } from 'socket.io';

interface AudioChunk {
  userId: string;
  roomId: string;
  timestamp: number;
  buffer: ArrayBuffer;
  duration: number;
}

interface ProcessAudioRequest {
  room_id: string;
  user_id: string;
  timestamp: number;
  audio_buffer: Uint8Array;
  duration: number;
}

@Injectable()
export class AudioRelayHandler {
  private readonly logger = new Logger(AudioRelayHandler.name);
  private audioServiceClient: any; // Audio service gRPC client

  constructor(
    audioServiceClient: any, // Audio service gRPC client
    private roomClient: any, // Room service client
    private connectionMap: Map<string, string>, // socketId -> peerId mapping
  ) {
    this.audioServiceClient = audioServiceClient;
  }

  /**
   * Xử lý audio chunk từ client
   */
  @SubscribeMessage('audio:chunk')
  async handleAudioChunk(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: AudioChunk,
  ): Promise<void> {
    try {
      const { userId, roomId, timestamp, buffer, duration } = data;

      // Validate data
      if (!this.validateAudioChunk(data)) {
        this.logger.error(`[AudioRelay] Invalid audio chunk from ${client.id}`);
        client.emit('audio:error', { message: 'Invalid audio chunk data' });
        return;
      }

      // Verify user is in room
      const isAuthorized = await this.verifyUserInRoom(
        client.id,
        userId,
        roomId,
      );
      if (!isAuthorized) {
        this.logger.error(
          `[AudioRelay] Unauthorized audio chunk from ${userId} in room ${roomId}`,
        );
        client.emit('audio:error', { message: 'Unauthorized audio access' });
        return;
      }

      // Convert ArrayBuffer to Uint8Array for gRPC
      const audioBuffer = new Uint8Array(buffer);

      this.logger.debug(
        `[AudioRelay] Processing audio chunk: ${audioBuffer.length} bytes from ${userId}`,
      );

      // Forward to Audio Service via gRPC
      await this.forwardToAudioService({
        room_id: roomId,
        user_id: userId,
        timestamp,
        audio_buffer: audioBuffer,
        duration,
      });

      // Optional: Send acknowledgment to client
      client.emit('audio:chunk-received', {
        timestamp,
        status: 'processing',
      });
    } catch (error) {
      this.logger.error(`[AudioRelay] Error processing audio chunk:`, error);
      client.emit('audio:error', {
        message: 'Failed to process audio chunk',
        timestamp: data.timestamp,
      });
    }
  }

  /**
   * Validate audio chunk data
   */
  private validateAudioChunk(data: AudioChunk): boolean {
    if (!data.userId || typeof data.userId !== 'string') {
      return false;
    }

    if (!data.roomId || typeof data.roomId !== 'string') {
      return false;
    }

    if (!data.timestamp || typeof data.timestamp !== 'number') {
      return false;
    }

    if (!data.buffer || !(data.buffer instanceof ArrayBuffer)) {
      return false;
    }

    if (
      !data.duration ||
      typeof data.duration !== 'number' ||
      data.duration <= 0
    ) {
      return false;
    }

    // Check reasonable audio buffer size (100ms to 2s of 16kHz 16-bit mono)
    const minSize = 16000 * 2 * 0.1; // 100ms = 3,200 bytes
    const maxSize = 16000 * 2 * 2; // 2s = 64,000 bytes

    if (data.buffer.byteLength < minSize || data.buffer.byteLength > maxSize) {
      this.logger.warn(
        `[AudioRelay] Audio buffer size out of range: ${data.buffer.byteLength} bytes`,
      );
      return false;
    }

    return true;
  }

  /**
   * Verify user is authorized to send audio for this room
   */
  private async verifyUserInRoom(
    socketId: string,
    userId: string,
    roomId: string,
  ): Promise<boolean> {
    try {
      // Check if socket is mapped to this user
      const mappedPeerId = this.connectionMap.get(socketId);
      if (mappedPeerId !== userId) {
        this.logger.warn(
          `[AudioRelay] Socket ${socketId} not mapped to user ${userId}`,
        );
        return false;
      }

      // Verify user is participant in room
      const participant = await this.roomClient.getParticipantByPeerId(
        roomId,
        userId,
      );
      if (!participant) {
        this.logger.warn(
          `[AudioRelay] User ${userId} not found in room ${roomId}`,
        );
        return false;
      }

      // Check if participant's socket matches
      if (participant.socket_id !== socketId) {
        this.logger.warn(
          `[AudioRelay] Socket mismatch for user ${userId} in room ${roomId}`,
        );
        return false;
      }

      return true;
    } catch (error) {
      this.logger.error(`[AudioRelay] Error verifying user in room:`, error);
      return false;
    }
  }

  /**
   * Forward audio data to Audio Service via gRPC
   */
  private async forwardToAudioService(
    request: ProcessAudioRequest,
  ): Promise<void> {
    try {
      // Call gRPC method to process audio
      const response = await this.audioServiceClient.processAudioChunk({
        roomId: request.room_id,
        userId: request.user_id,
        timestamp: request.timestamp,
        audioBuffer: request.audio_buffer,
        duration: request.duration,
      });

      this.logger.debug(`[AudioRelay] Audio service response:`, response);
    } catch (error) {
      this.logger.error(
        `[AudioRelay] Failed to forward to audio service:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Handle transcription result from Audio Service
   * This would be called by the audio service when transcription is complete
   */
  async handleTranscriptionResult(data: {
    roomId: string;
    userId: string;
    transcript: string;
    timestamp: number;
    confidence: number;
    duration: number;
  }): Promise<void> {
    try {
      // Broadcast transcript to all users in the room
      const transcriptData = {
        id: `${data.userId}_${data.timestamp}`,
        userId: data.userId,
        roomId: data.roomId,
        text: data.transcript,
        timestamp: data.timestamp,
        confidence: data.confidence,
        duration: data.duration,
      };

      // Send to all clients in the room
      // Assuming we have access to the main gateway instance
      this.broadcastToRoom(data.roomId, 'audio:transcript', transcriptData);

      this.logger.log(
        `[AudioRelay] Broadcasted transcript for user ${data.userId} in room ${data.roomId}`,
      );
    } catch (error) {
      this.logger.error(
        `[AudioRelay] Error handling transcription result:`,
        error,
      );
    }
  }

  /**
   * Broadcast message to all clients in room
   */
  private broadcastToRoom(roomId: string, event: string, data: any): void {
    // This would need to be injected from the main gateway
    // For now, this is a placeholder
    console.log(`[AudioRelay] Broadcasting ${event} to room ${roomId}:`, data);
  }

  /**
   * Clean up resources when client disconnects
   */
  async handleClientDisconnect(socketId: string): Promise<void> {
    try {
      const userId = this.connectionMap.get(socketId);
      if (userId) {
        this.logger.log(
          `[AudioRelay] Cleaning up audio resources for user ${userId}`,
        );
        // Any cleanup logic for audio processing
      }
    } catch (error) {
      this.logger.error(`[AudioRelay] Error during audio cleanup:`, error);
    }
  }
}

export default AudioRelayHandler;
