import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';
import { SfuGrpcService } from 'src/interfaces';

@Injectable()
export class SfuClientService implements OnModuleInit {
    private sfuService: SfuGrpcService;

    constructor(@Inject('SFU_SERVICE') private client: ClientGrpc) {}

    onModuleInit() {
        this.sfuService = this.client.getService<SfuGrpcService>('SfuService');
    }

    async createMediaRoom(roomId: string) {
        return firstValueFrom(
            this.sfuService.createMediaRoom({ room_id: roomId }),
        );
    }

    async getRouterRtpCapabilities(roomId: string) {
        const result: any = await firstValueFrom(
            this.sfuService.getMediaRouter({ room_id: roomId }),
        );

        if (result && result.router_data) {
            const capabilities = JSON.parse(result.router_data);
            return capabilities;
        }

        throw new Error('No router capabilities returned from SFU service');
    }

    async createTransport(roomId: string, peerId: string, isProducer: boolean) {
        // Current proto only supports room_id, so we'll use what's available
        return firstValueFrom(
            this.sfuService.createTransport({
                room_id: roomId,
                is_producer: isProducer,
            }),
        );
    }

    async connectTransport(
        transportId: string,
        dtlsParameters: any,
        roomId: string,
        peerId: string,
    ) {
        return firstValueFrom(
            this.sfuService.connectTransport({
                transport_id: transportId,
                dtls_parameters: JSON.stringify(dtlsParameters),
                participant_data: JSON.stringify({
                    room_id: roomId,
                    peer_id: peerId,
                }),
            }),
        );
    }

    async createProducer(
        transportId: string,
        kind: string,
        rtpParameters: any,
        metadata: any,
        roomId: string,
        peerId: string,
    ) {
        return firstValueFrom(
            this.sfuService.createProducer({
                transport_id: transportId,
                kind,
                rtp_parameters: JSON.stringify(rtpParameters),
                metadata: JSON.stringify(metadata),
                room_id: roomId,
                participant_data: JSON.stringify({ peer_id: peerId }),
            }),
        );
    }

    async createConsumer(
        streamId: string,
        transportId: string,
        roomId: string,
        peerId: string,
        rtpCapabilities?: any,
        participantData?: any,
    ) {
        return firstValueFrom(
            this.sfuService.createConsumer({
                stream_id: streamId,
                transport_id: transportId,
                room_id: roomId,
                peer_id: peerId,
                rtp_capabilities: JSON.stringify(rtpCapabilities || {}),
                participant_data: JSON.stringify(
                    participantData || { peer_id: peerId },
                ),
            }),
        );
    }

    async resumeConsumer(consumerId: string, roomId: string, peerId: string) {
        return firstValueFrom(
            this.sfuService.resumeConsumer({
                consumer_id: consumerId,
                room_id: roomId,
                peer_id: peerId,
            }),
        );
    }

    async getStreams(roomId: string) {
        return firstValueFrom(this.sfuService.getStreams({ room_id: roomId }));
    }

    async setRtpCapabilities(
        peerId: string,
        rtpCapabilities: any,
        roomId: string,
    ) {
        // Since setRtpCapabilities is not in proto, we can use getMediaRouter to get capabilities
        // and store them locally or use createMediaRoom to ensure room exists
        try {
            await this.createMediaRoom(roomId);
            return { success: true };
        } catch (error) {
            // Room might already exist, that's fine
            return { success: true };
        }
    }

    async handlePresence(roomId: string, peerId: string, metadata: any) {
        return firstValueFrom(
            this.sfuService.handlePresence({
                room_id: roomId,
                peer_id: peerId,
                metadata: JSON.stringify(metadata),
            }),
        );
    }

    async removeParticipantMedia(data: {
        room_id: string;
        participant_id: string;
    }) {
        return firstValueFrom(this.sfuService.removeParticipantMedia(data));
    }

    async updateStream(data: {
        stream_id: string;
        participant_id: string;
        metadata: string;
        room_id: string;
    }) {
        return firstValueFrom(this.sfuService.updateStream(data));
    }

    // Method aliases for compatibility with gateway handlers
    async produce(
        transportId: string,
        kind: string,
        rtpParameters: any,
        metadata: any,
        roomId: string,
        peerId: string,
    ) {
        return this.createProducer(
            transportId,
            kind,
            rtpParameters,
            metadata,
            roomId,
            peerId,
        );
    }

    async consume(
        streamId: string,
        transportId: string,
        roomId: string,
        peerId: string,
        rtpCapabilities?: any,
        participantData?: any,
    ) {
        return this.createConsumer(
            streamId,
            transportId,
            roomId,
            peerId,
            rtpCapabilities,
            participantData,
        );
    }

    // async sendPresence(roomId: string, peerId: string, metadata: any) {
    //     return this.handlePresence(roomId, peerId, metadata);
    // }

    async pinUser(
        roomId: string,
        pinnerPeerId: string,
        pinnedPeerId: string,
        transportId: string,
        rtpCapabilities?: any,
    ) {
        return firstValueFrom(
            this.sfuService.pinUser({
                room_id: roomId,
                pinner_peer_id: pinnerPeerId,
                pinned_peer_id: pinnedPeerId,
                transport_id: transportId,
                rtp_capabilities: JSON.stringify(rtpCapabilities || {}),
            }),
        );
    }

    /**
     * Unpin a user in a media room
     * @param roomId is the ID of the room.
     * @param unpinnerPeerId is the ID of the user unpinning.
     * @param unpinnedPeerId is the ID of the user being unpinned.
     * @returns A promise with the result of the operation.
     */
    async unpinUser(
        roomId: string,
        unpinnerPeerId: string,
        unpinnedPeerId: string,
    ) {
        return firstValueFrom(
            this.sfuService.unpinUser({
                room_id: roomId,
                unpinner_peer_id: unpinnerPeerId,
                unpinned_peer_id: unpinnedPeerId,
            }),
        );
    }

    /**
     * Handle speaking for a participant
     * @param roomId is the ID of the room.
     * @param peerId is the ID of the participant.
     * @param port is the port for audio.
     * @returns A promise with the result of the operation.
     */
    async handleSpeaking(roomId: string, peerId: string, port: number) {
        try {
            return await firstValueFrom(
                this.sfuService.handleSpeaking({
                    room_id: roomId,
                    peer_id: peerId,
                    port: port,
                }),
            );
        } catch (error) {
            console.error('[SFU Client] Error handling speaking:', error);
            throw error;
        }
    }

    /**
     * Handle stopping speaking for a participant
     * @param roomId is the ID of the room.
     * @param peerId is the ID of the participant.
     * @returns A promise with the result of the operation.
     */
    async handleStopSpeaking(roomId: string, peerId: string) {
        try {
            return await firstValueFrom(
                this.sfuService.handleStopSpeaking({
                    room_id: roomId,
                    peer_id: peerId,
                }),
            );
        } catch (error) {
            console.error('[SFU Client] Error handling stop speaking:', error);
            throw error;
        }
    }

    /**
     * Get the list of active speakers in a room
     * @param roomId is the ID of the room.
     * @returns A promise with the result of the operation.
     */
    async getActiveSpeakers(roomId: string) {
        try {
            return await firstValueFrom(
                this.sfuService.getActiveSpeakers({
                    room_id: roomId,
                }),
            );
        } catch (error) {
            console.error('[SFU Client] Error getting active speakers:', error);
            throw error;
        }
    }

    /**
     * Establish a plain RTP connection for audio streaming (Enhanced for bidirectional).
     * @param roomId The ID of the room.
     * @param targetPeerId The ID of the target peer.
     * @param sourceLanguage The source language of the audio.
     * @param targetLanguage The target language for translation.
     * @param receivePort The port for receiving audio from SFU.
     * @param sendPort The port for sending translated audio back to SFU.
     * @returns A promise with the result of the operation including streamId.
     */
    // async establishBidirectionalTranslation(
    //     roomId: string,
    //     targetPeerId: string,
    //     sourceLanguage: string,
    //     targetLanguage: string,
    //     receivePort: number,
    //     sendPort: number,
    // ): Promise<{ success: boolean; message?: string; streamId?: string }> {
    //     try {
    //         return await firstValueFrom(
    //             this.sfuService.createBidirectionalTranslation({
    //                 room_id: roomId,
    //                 target_peer_id: targetPeerId,
    //                 source_language: sourceLanguage,
    //                 target_language: targetLanguage,
    //                 receive_port: receivePort,
    //                 send_port: sendPort,
    //             }),
    //         );
    //     } catch (error) {
    //         console.error(
    //             '[SFU Client] Error establishing bidirectional translation:',
    //             error,
    //         );
    //         throw error;
    //     }
    // }

    /**
     * Function to allocate a port for plain RTP connection.
     * @param roomId is the ID of the room.
     * @param targetPeerId is the ID of the target peer.
     * @param sourceLanguage is the source language for audio.
     * @param targetLanguage is the target language for audio.
     * @param audioPort is the port for audio.
     * @param sendPort is the port for sending audio.
     * @param ssrc is the synchronization source identifier.
     * @returns A promise with the result of the operation including streamId.
     */
    async establishPlainRtpConnection(
        roomId: string,
        sourceUserId: string,
        targetPeerId: string,
        sourceLanguage: string,
        targetLanguage: string,
        audioPort: number,
        sendPort: number,
        ssrc: number,
    ): Promise<{ success: boolean; message?: string; streamId?: string; sfuListenPort?: number }> {
        try {
            const response = await firstValueFrom(
                this.sfuService.allocatePort({
                    room_id: roomId,
                    source_user_id: sourceUserId,
                    target_user_id: targetPeerId,
                    source_language: sourceLanguage,
                    target_language: targetLanguage,
                    audio_port: audioPort,
                    send_port: sendPort,
                    ssrc: ssrc,
                }),
            );

            // Map proto response to expected format
            return {
                success: response.success,
                streamId: response.stream_id, // Map stream_id to streamId
                message: response.message,
                sfuListenPort: response.sfu_listen_port, // NAT FIX: Return SFU listen port
            };
        } catch (error) {
            console.error(
                '[SFU Client] Error establishing plain RTP connection:',
                error,
            );
            throw error;
        }
    }

    /**
     * Destroys a plain RTP connection for audio streaming.
     * @param roomId The ID of the room.
     * @param targetUserId The ID of the target user.
     * @param sourceLanguage The source language of the audio.
     * @param targetLanguage The target language for translation.
     * @returns A promise with the result of the operation.
     */
    async destroyTranslationCabin(
        roomId: string,
        sourceUserId: string,
        targetUserId: string,
        sourceLanguage: string,
        targetLanguage: string,
    ): Promise<{ success: boolean; message?: string }> {
        try {
            return await firstValueFrom(
                this.sfuService.destroyTranslationCabin({
                    room_id: roomId,
                    source_user_id: sourceUserId,
                    target_user_id: targetUserId,
                    source_language: sourceLanguage,
                    target_language: targetLanguage,
                }),
            );
        } catch (error) {
            console.error(
                '[SFU Client] Error destroying translation cabin:',
                error,
            );
            throw error;
        }
    }

    async listTranslationCabin(
        roomId: string,
        userId: string,
    ): Promise<{
        success: boolean;
        cabins: {
            targetUserId: string;
            sourceLanguage: string;
            targetLanguage: string;
        }[];
    }> {
        try {
            const response = await firstValueFrom(
                this.sfuService.listTranslationCabin({
                    room_id: roomId,
                    user_id: userId,
                }),
            );
            return {
                success: response.success,
                cabins: (response.cabins || []).map((cabin) => ({
                    targetUserId: cabin.target_user_id,
                    sourceLanguage: cabin.source_language,
                    targetLanguage: cabin.target_language,
                })),
            };
        } catch (error) {
            console.error(
                '[SFU Client] Error listing translation cabins:',
                error,
            );
            throw error;
        }
    }

    async removeStream(data: { stream_id: string }) {
        try {
            return await firstValueFrom(this.sfuService.removeStream(data));
        } catch (error) {
            console.error('[SFU Client] Error removing stream:', error);
            throw error;
        }
    }

    async unpublishStream(data: {
        room_id: string;
        stream_id: string;
        participant_id: string;
    }) {
        try {
            return await firstValueFrom(this.sfuService.unpublishStream(data));
        } catch (error) {
            console.error('[SFU Client] Error unpublishing stream:', error);
            throw error;
        }
    }
}
