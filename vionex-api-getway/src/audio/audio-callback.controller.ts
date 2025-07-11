/**
 * 📡 AUDIO TRANSCRIPT CALLBACK CONTROLLER
 *
 * HTTP endpoint để nhận transcript callbacks từ Audio Service
 * - Nhận transcript data qua HTTP POST
 * - Broadcast đến clients qua WebSocket
 * - Validate và log transcript data
 */

import {
  Body,
  Controller,
  Post,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { WebSocketServer } from '@nestjs/websockets';
import { Server } from 'socket.io';

interface TranscriptCallbackData {
  id: string;
  userId: string;
  roomId: string;
  text: string;
  timestamp: number;
  confidence: number;
  duration: number;
  language?: string;
  language_probability?: number;
}

@Controller('api/audio')
export class AudioCallbackController {
  private readonly logger = new Logger(AudioCallbackController.name);

  @WebSocketServer()
  private io: Server;

  // Inject WebSocket server from main gateway
  setSocketServer(server: Server) {
    this.io = server;
  }

  @Post('transcript-callback')
  @HttpCode(HttpStatus.OK)
  async receiveTranscriptCallback(@Body() data: TranscriptCallbackData) {
    try {
      this.logger.log(`📥 Received transcript callback from Audio Service`);
      this.logger.log(`User: ${data.userId}, Room: ${data.roomId}`);
      this.logger.log(`Text: "${data.text}"`);
      this.logger.log(
        `Confidence: ${data.confidence}, Duration: ${data.duration}ms`,
      );

      // Validate transcript data
      if (!this.validateTranscriptData(data)) {
        this.logger.error('❌ Invalid transcript data received');
        return { success: false, message: 'Invalid transcript data' };
      }

      // Broadcast transcript to all clients in the room
      if (this.io) {
        this.io.to(data.roomId).emit('audio:transcript', data);
        this.logger.log(`📡 Broadcasted transcript to room ${data.roomId}`);
      } else {
        this.logger.error('❌ WebSocket server not available');
        return { success: false, message: 'WebSocket server not available' };
      }

      return {
        success: true,
        message: 'Transcript broadcasted successfully',
        timestamp: Date.now(),
      };
    } catch (error) {
      this.logger.error(`💥 Error processing transcript callback:`, error);
      return {
        success: false,
        message: 'Internal server error',
      };
    }
  }

  private validateTranscriptData(data: TranscriptCallbackData): boolean {
    // Check required fields
    if (!data.id || typeof data.id !== 'string') {
      this.logger.warn('Missing or invalid transcript id');
      return false;
    }

    if (!data.userId || typeof data.userId !== 'string') {
      this.logger.warn('Missing or invalid userId');
      return false;
    }

    if (!data.roomId || typeof data.roomId !== 'string') {
      this.logger.warn('Missing or invalid roomId');
      return false;
    }

    if (
      !data.text ||
      typeof data.text !== 'string' ||
      data.text.trim().length === 0
    ) {
      this.logger.warn('Missing or invalid transcript text');
      return false;
    }

    if (!data.timestamp || typeof data.timestamp !== 'number') {
      this.logger.warn('Missing or invalid timestamp');
      return false;
    }

    if (typeof data.confidence !== 'number') {
      this.logger.warn('Missing or invalid confidence score');
      return false;
    }

    if (
      !data.duration ||
      typeof data.duration !== 'number' ||
      data.duration <= 0
    ) {
      this.logger.warn('Missing or invalid duration');
      return false;
    }

    // Check reasonable values
    if (data.text.length > 10000) {
      this.logger.warn('Transcript text too long');
      return false;
    }

    if (data.duration > 30000) {
      // 30 seconds max
      this.logger.warn('Duration too long');
      return false;
    }

    const now = Date.now();
    if (data.timestamp > now || data.timestamp < now - 3600000) {
      // 1 hour ago max
      this.logger.warn('Invalid timestamp range');
      return false;
    }

    return true;
  }

  @Post('health-check')
  @HttpCode(HttpStatus.OK)
  async healthCheck() {
    return {
      success: true,
      message: 'Audio callback endpoint is healthy',
      timestamp: Date.now(),
      websocket_connected: !!this.io,
    };
  }
}

export default AudioCallbackController;
