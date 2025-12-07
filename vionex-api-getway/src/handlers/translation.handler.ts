import { Socket } from 'socket.io';
import { Injectable } from '@nestjs/common';
import { WebSocketEventService } from '../services/websocket-event.service';
import { AudioClientService } from '../clients/audio.client';
import { SfuClientService } from '../clients/sfu.client';
import { logger } from '../utils/log-manager';

@Injectable()
export class TranslationHandler {
    constructor(
        private readonly audioClient: AudioClientService,
        private readonly sfuClient: SfuClientService,
        private readonly eventService: WebSocketEventService,
    ) {
        logger.log(
            'TranslationHandler',
            'TranslationHandler initialized as service',
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

            // Prevent user from creating cabin with themselves
            if (data.sourceUserId === data.targetUserId) {
                this.eventService.emitError(
                    client,
                    'Cannot create translation cabin with yourself',
                    'SAME_USER_ERROR',
                );
                return {
                    success: false,
                    error: 'Cannot create translation cabin with yourself',
                };
            }

            // B1. Allocate RTP port from Audio Service
            let audioPortResponse;
            try {
                audioPortResponse =
                    await this.audioClient.allocateTranslationPort(
                        data.roomId,
                        data.targetUserId,
                    );
            } catch (error) {
                logger.error(
                    '[TranslationHandler] Error calling Audio Service:',
                    error,
                );
                this.eventService.emitError(
                    client,
                    'Audio Service is not available',
                    'AUDIO_SERVICE_UNAVAILABLE',
                );
                return {
                    success: false,
                    error: 'Audio Service is not available',
                };
            }

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

            // B2.5. Update Audio Service with SFU listen port and consumer SSRC (NAT FIX + SSRC FIX)
            if (sfuPortResponse.sfuListenPort) {
                try {
                    await this.audioClient.updateTranslationPort(
                        data.roomId,
                        data.targetUserId,
                        sfuPortResponse.sfuListenPort,
                        sfuPortResponse.consumerSsrc, // Pass actual consumer SSRC for RTP routing
                    );
                    logger.log(
                        'TranslationHandler',
                        `Updated Audio Service with SFU port: ${sfuPortResponse.sfuListenPort}, consumer SSRC: ${sfuPortResponse.consumerSsrc}`,
                    );
                } catch (error) {
                    logger.error(
                        'TranslationHandler',
                        'Error updating Audio Service port:',
                        error,
                    );
                    // Non-critical error - continue
                }
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
            logger.error(
                'TranslationHandler',
                'Error creating translation cabin:',
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
     * @param client Socket client (null for auto-destroy scenarios)
     * @param data Cabin data to destroy
     * @param server Optional Socket.IO server for broadcasting when client is null
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
        server?: any,
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
            } else if (server) {
                // Auto-destroy scenario: use server to broadcast to room
                logger.info(
                    'TranslationHandler',
                    `Auto-destroy: Broadcasting cabin update to room ${data.roomId}`,
                );
                server.to(data.roomId).emit('translation:cabin-update', {
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
            logger.error(
                'TranslationHandler',
                'Error destroying translation cabin:',
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
            logger.error(
                'TranslationHandler',
                'Error listing translation cabins:',
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
