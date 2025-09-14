import { Socket } from 'socket.io';
import { Injectable } from '@nestjs/common';
import { WebSocketEventService } from '../services/websocket-event.service';
import { AudioClientService } from '../clients/audio.client';
import { SfuClientService } from '../clients/sfu.client';

@Injectable()
export class TranslationHandler {
    constructor(
        private readonly audioClient: AudioClientService,
        private readonly sfuClient: SfuClientService,
        private readonly eventService: WebSocketEventService,
    ) {
        console.log(
            '[TranslationHandler] TranslationHandler initialized as service',
        );
    }

    /**
     * Create translation cabin
     */
    async handleCreateTranslationCabin(
        client: Socket,
        data: {
            roomId: string;
            sourceUserId: string;
            targetUserId: string;
            sourceLanguage: string;
            targetLanguage: string;
        },
    ) {
        try {
            // Validate data
            if (
                !data.roomId ||
                !data.sourceUserId ||
                !data.targetUserId ||
                !data.sourceLanguage ||
                !data.targetLanguage
            ) {
                this.eventService.emitError(
                    client,
                    'Missing required fields for creating translation cabin',
                    'INVALID_TRANSLATION_DATA',
                );
                return { success: false, error: 'Missing required fields' };
            }

            // B1. Allocate RTP port from Audio Service
            const audioPortResponse =
                await this.audioClient.allocateTranslationPort(
                    data.roomId,
                    data.targetUserId,
                );

            if (!audioPortResponse.success) {
                this.eventService.emitError(
                    client,
                    'Failed to allocate RTP port',
                    'ALLOCATE_PORT_FAILED',
                );
                return { success: false, error: 'Failed to allocate RTP port' };
            }

            // B2. Create RTP connection in SFU
            const sfuPortResponse =
                await this.sfuClient.establishPlainRtpConnection(
                    data.roomId,
                    data.sourceUserId,
                    data.targetUserId,
                    data.sourceLanguage,
                    data.targetLanguage,
                    audioPortResponse.port,
                    audioPortResponse.send_port,
                    audioPortResponse.ssrc,
                );

            if (!sfuPortResponse.success) {
                this.eventService.emitError(
                    client,
                    sfuPortResponse.message ||
                        'Failed to establish RTP connection',
                    'SFU_CONNECTION_FAILED',
                );
                return { success: false, error: sfuPortResponse.message };
            }

            // B3. Start translation cabin processing
            const translationProduceResponse =
                await this.audioClient.createTranslationProduce(
                    data.roomId,
                    data.targetUserId,
                    data.sourceLanguage,
                    data.targetLanguage,
                );

            if (!translationProduceResponse.success) {
                this.eventService.emitError(
                    client,
                    translationProduceResponse.message ||
                        'Failed to start translation processing',
                    'TRANSLATION_START_FAILED',
                );
                return {
                    success: false,
                    error: translationProduceResponse.message,
                };
            }

            console.log('=== Create Translation Cabin Success ===');
            console.log('Translation Cabin Response:', {
                streamId: sfuPortResponse.streamId,
                success: true,
            });

            // Emit success event to client
            client.emit('translation:created', {
                success: true,
                data: {
                    streamId: sfuPortResponse.streamId,
                },
                message: 'Translation cabin created successfully',
            });

            // Notify other users in the room about new translation cabin
            client.to(data.roomId).emit('translation:cabin-update', {
                action: 'created',
                roomId: data.roomId,
                sourceUserId: data.sourceUserId,
                targetUserId: data.targetUserId,
                sourceLanguage: data.sourceLanguage,
                targetLanguage: data.targetLanguage,
            });

            return { success: true };
        } catch (error) {
            console.error(
                '[TranslationHandler] Error creating translation cabin:',
                error,
            );
            this.eventService.emitError(
                client,
                'Internal server error',
                'CREATE_TRANSLATION_ERROR',
            );
            return { success: false, error: error.message };
        }
    }

    /**
     * Destroy translation cabin
     */
    async handleDestroyTranslationCabin(
        client: Socket | null,
        data: {
            roomId: string;
            sourceUserId: string;
            targetUserId: string;
            sourceLanguage: string;
            targetLanguage: string;
        },
    ) {
        try {
            // Validate data
            if (
                !data.roomId ||
                !data.targetUserId ||
                !data.sourceLanguage ||
                !data.targetLanguage
            ) {
                if (client) {
                    this.eventService.emitError(
                        client,
                        'Missing required fields for destroying translation cabin',
                        'INVALID_DESTROY_DATA',
                    );
                }
                return { success: false, error: 'Missing required fields' };
            }

            const destroyResponse =
                await this.sfuClient.destroyTranslationCabin(
                    data.roomId,
                    data.sourceUserId,
                    data.targetUserId,
                    data.sourceLanguage,
                    data.targetLanguage,
                );

            if (!destroyResponse.success) {
                if (client) {
                    this.eventService.emitError(
                        client,
                        destroyResponse.message ||
                            'Failed to destroy translation cabin',
                        'DESTROY_TRANSLATION_FAILED',
                    );
                }
                return { success: false, error: destroyResponse.message };
            } else {
                // 10001 is code in message from sfu to mark cabin is not use and destroy success
                if (destroyResponse.message === '10001') {
                    const destroyCabinTranslationResponse =
                        await this.audioClient.destroyTranslationCabin(
                            data.roomId,
                            data.targetUserId,
                            data.sourceLanguage,
                            data.targetLanguage,
                        );

                    if (!destroyCabinTranslationResponse.success) {
                        if (client) {
                            this.eventService.emitError(
                                client,
                                destroyCabinTranslationResponse.message ||
                                    'Failed to destroy translation cabin',
                                'AUDIO_DESTROY_FAILED',
                            );
                        }
                        return {
                            success: false,
                            error: destroyCabinTranslationResponse.message,
                        };
                    }
                }
            }

            // Only emit events if client exists (not auto-destroy)
            if (client) {
                // Emit success event to client
                client.emit('translation:destroyed', {
                    success: true,
                    message: 'Translation cabin destroyed successfully',
                });

                // Notify other users in the room about destroyed translation cabin
                client.to(data.roomId).emit('translation:cabin-update', {
                    action: 'destroyed',
                    roomId: data.roomId,
                    sourceUserId: data.sourceUserId,
                    targetUserId: data.targetUserId,
                    sourceLanguage: data.sourceLanguage,
                    targetLanguage: data.targetLanguage,
                });
            }

            return { success: true };
        } catch (error) {
            console.error(
                '[TranslationHandler] Error destroying translation cabin:',
                error,
            );
            if (client) {
                this.eventService.emitError(
                    client,
                    'Internal server error',
                    'DESTROY_TRANSLATION_ERROR',
                );
            }
            return { success: false, error: error.message };
        }
    }

    /**
     * List translation cabins
     */
    async handleListTranslationCabins(
        client: Socket,
        data: {
            roomId: string;
            userId: string;
        },
    ) {
        try {
            // Validate data
            if (!data.roomId || !data.userId) {
                this.eventService.emitError(
                    client,
                    'Missing required fields for listing translation cabins',
                    'INVALID_LIST_DATA',
                );
                return { success: false, error: 'Missing required fields' };
            }

            const listResponse = await this.sfuClient.listTranslationCabin(
                data.roomId,
                data.userId,
            );

            if (!listResponse.success) {
                this.eventService.emitError(
                    client,
                    'Failed to list translation cabins',
                    'LIST_TRANSLATION_FAILED',
                );
                return {
                    success: false,
                    error: 'Failed to list translation cabins',
                };
            }

            // Emit list of translation cabins to client
            client.emit('translation:list', {
                success: true,
                data: listResponse.cabins,
                message: 'Translation cabins listed successfully',
            });

            return { success: true };
        } catch (error) {
            console.error(
                '[TranslationHandler] Error listing translation cabins:',
                error,
            );
            this.eventService.emitError(
                client,
                'Internal server error',
                'LIST_TRANSLATION_ERROR',
            );
            return { success: false, error: error.message };
        }
    }
}
