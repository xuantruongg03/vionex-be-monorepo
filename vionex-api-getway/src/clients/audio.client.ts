import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs/internal/firstValueFrom';
import { AudioGRPCService } from 'src/interfaces';

@Injectable()
export class AudioClientService implements OnModuleInit {
    private audioService: AudioGRPCService;

    constructor(@Inject('AUDIO_SERVICE') private client: ClientGrpc) {}

    onModuleInit() {
        this.audioService =
            this.client.getService<AudioGRPCService>('AudioService');
    }

    /**
     * Allocate translation ports (bidirectional) for a user in a specific room.
     * @param roomId The ID of the room.
     * @param userId The ID of the user.
     * @param sourceLanguage Source language code (e.g., "vi")
     * @param targetLanguage Target language code (e.g., "en")
     * @returns An observable with the result of the allocation including both ports.
     */
    async allocateTranslationPort(roomId: string, userId: string) {
        const data = {
            roomId,
            userId,
        };

        const rs = await firstValueFrom(
            this.audioService.allocateTranslationPort(data),
        );
        return rs;
    }

    /**
     * Legacy method for backward compatibility
     */
    async allocateTranslationPortLegacy(roomId: string, userId: string) {
        return this.allocateTranslationPort(roomId, userId);
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
        organizationId?: string; // Organization ID for multi-tenant isolation
    }) {
        try {
            // Add timeout to prevent hanging calls
            const response = await Promise.race([
                firstValueFrom(this.audioService.processAudioBuffer(data)),
                new Promise(
                    (_, reject) =>
                        setTimeout(
                            () => reject(new Error('Audio service timeout')),
                            10000,
                        ), // 10 second timeout
                ),
            ]);
            return response;
        } catch (error) {
            console.error(
                '[AudioClientService] processAudioBuffer error:',
                error,
            );
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
            console.error(
                '[AudioClientService] processAudioChunk error:',
                error,
            );
            return { success: false, message: 'Audio service unavailable' };
        }
    }

    /**
     * Establish a plain RTP connection for audio streaming.
     * @param roomId The ID of the room.
     * @param targetUserId The ID of the target user.
     * @param sourceLanguage The source language of the audio.
     * @param targetLanguage The target language for translation.
     * @returns A promise with the result of the operation.
     */
    // Translation Cabin methods
    async createTranslationProduce(
        roomId: string,
        targetUserId: string,
        sourceLanguage: string,
        targetLanguage: string,
    ) {
        try {
            return await firstValueFrom(
                this.audioService.createTranslationProduce({
                    roomId,
                    userId: targetUserId,
                    sourceLanguage,
                    targetLanguage,
                }),
            );
        } catch (error) {
            return { success: false, message: 'Audio service unavailable' };
        }
    }

    /**
     * Function to call audio service to destroy a translation cabin.
     * @param roomId The ID of the room.
     * @param targetUserId The ID of the target user.
     * @param sourceLanguage The source language of the audio.
     * @param targetLanguage The target language for translation.
     * @returns A promise with the result of the operation.
     */
    async destroyTranslationCabin(
        roomId: string,
        targetUserId: string,
        sourceLanguage: string,
        targetLanguage: string,
    ) {
        try {
            const response = await firstValueFrom(
                this.audioService.DestroyCabin({
                    room_id: roomId,
                    target_user_id: targetUserId,
                    source_language: sourceLanguage,
                    target_language: targetLanguage,
                }),
            );
            return response;
        } catch (error) {
            console.error(
                '[AudioClientService] destroyTranslationCabin error:',
                error,
            );
            return {
                success: false,
                message: 'Audio service unavailable',
            };
        }
    }
}
