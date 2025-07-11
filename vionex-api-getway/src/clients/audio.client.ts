import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs/internal/firstValueFrom';

import { Observable } from 'rxjs';

interface AudioGRPCService {
  // Legacy methods
  allocatePort(data: {
    roomId: string;
    userId: string;
  }): Observable<{ success: boolean; port: number }>;

  releasePort(data: {
    roomId: string;
    userId: string;
  }): Observable<{ success: boolean }>;

  // New audio buffer processing methods
  processAudioBuffer(data: {
    userId: string;
    roomId: string;
    timestamp: number;
    buffer: Uint8Array;
    duration: number;
    sampleRate: number;
    channels: number;
  }): Observable<{
    success: boolean;
    transcript?: string;
    confidence?: number;
    message?: string;
  }>;

  processAudioChunk(data: {
    roomId: string;
    userId: string;
    timestamp: number;
    audioBuffer: Uint8Array;
    duration: number;
  }): Observable<{ success: boolean; message: string }>;

  getTranscripts(data: {
    roomId: string;
    fromTimestamp?: number;
    toTimestamp?: number;
  }): Observable<{ success: boolean; message: string; transcripts: string }>;
}

@Injectable()
export class AudioClientService implements OnModuleInit {
  private audioService: AudioGRPCService;

  constructor(@Inject('AUDIO_SERVICE') private client: ClientGrpc) {}

  onModuleInit() {
    this.audioService =
      this.client.getService<AudioGRPCService>('AudioService');
  }

  // Legacy methods
  async allocatePort(roomId: string, userId: string) {
    const data = { roomId, userId };
    const rs = await firstValueFrom(this.audioService.allocatePort(data));
    return rs;
  }

  async releasePort(roomId: string, userId: string) {
    const data = { roomId, userId };
    return await firstValueFrom(this.audioService.releasePort(data));
  }

  // New audio buffer processing - SIMPLIFIED ARCHITECTURE
  async processAudioBuffer(data: {
    userId: string;
    roomId: string;
    timestamp: number;
    buffer: Uint8Array;
    duration: number;
    sampleRate: number;
    channels: number;
  }) {
    try {
      // Add timeout to prevent hanging calls
      const response = await Promise.race([
        firstValueFrom(this.audioService.processAudioBuffer(data)),
        new Promise(
          (_, reject) =>
            setTimeout(() => reject(new Error('Audio service timeout')), 10000), // 10 second timeout
        ),
      ]);
      return response;
    } catch (error) {
      console.error('[AudioClientService] processAudioBuffer error:', error);
      return {
        success: false,
        message:
          error.message === 'Audio service timeout'
            ? 'Audio service timeout'
            : 'Audio service unavailable',
        transcript: '',
        confidence: 0,
      };
    }
  }

  // Legacy audio chunk processing
  async processAudioChunk(data: {
    roomId: string;
    userId: string;
    timestamp: number;
    audioBuffer: Uint8Array;
    duration: number;
  }) {
    try {
      const response = await firstValueFrom(
        this.audioService.processAudioChunk(data),
      );
      return response;
    } catch (error) {
      console.error('[AudioClientService] processAudioChunk error:', error);
      return { success: false, message: 'Audio service unavailable' };
    }
  }

  async getTranscripts(
    roomId: string,
    fromTimestamp?: number,
    toTimestamp?: number,
  ) {
    try {
      const data = { roomId, fromTimestamp, toTimestamp };
      const response = await firstValueFrom(
        this.audioService.getTranscripts(data),
      );
      return response;
    } catch (error) {
      console.error('[AudioClientService] getTranscripts error:', error);
      return {
        success: false,
        message: 'Audio service unavailable',
        transcripts: '[]',
      };
    }
  }
}
