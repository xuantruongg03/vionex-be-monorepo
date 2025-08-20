import { Controller } from '@nestjs/common';
import { GrpcMethod, RpcException } from '@nestjs/microservices';
import { SfuService } from './sfu.service';
import { Stream } from './interface';
import * as mediasoupTypes from 'mediasoup/node/lib/types';

@Controller()
export class SfuController {
    constructor(private readonly sfuService: SfuService) {}

    private ensureParticipantMaps(participant: any): void {
        // Convert transports to Map if it's a plain object
        if (
            participant.transports &&
            typeof participant.transports === 'object' &&
            !(participant.transports instanceof Map)
        ) {
            participant.transports = new Map(
                Object.entries(participant.transports),
            );
        } else if (!participant.transports) {
            participant.transports = new Map();
        }

        // Convert producers to Map if it's a plain object
        if (
            participant.producers &&
            typeof participant.producers === 'object' &&
            !(participant.producers instanceof Map)
        ) {
            participant.producers = new Map(
                Object.entries(participant.producers),
            );
        } else if (!participant.producers) {
            participant.producers = new Map();
        }

        // Convert consumers to Map if it's a plain object
        if (
            participant.consumers &&
            typeof participant.consumers === 'object' &&
            !(participant.consumers instanceof Map)
        ) {
            participant.consumers = new Map(
                Object.entries(participant.consumers),
            );
        } else if (!participant.consumers) {
            participant.consumers = new Map();
        }
    }

    @GrpcMethod('SfuService', 'CreateMediaRoom')
    async handleCreateMediaRoom(data: {
        room_id: string;
    }): Promise<{ status: string; data: string }> {
        try {
            const router = await this.sfuService.createMediaRoom(data.room_id);
            if (!router) {
                throw new RpcException('Failed to create media room');
            }

            // Log specific payload types
            const codecs = router.rtpCapabilities.codecs;

            const routerData = {
                id: router.id,
                closed: router.closed,
                rtpCapabilities: router.rtpCapabilities,
            };
            return {
                status: 'success',
                data: JSON.stringify({ router: routerData }),
            };
        } catch (error) {
            console.error('Error creating media room:', error);
            throw new RpcException('Failed to create media room');
        }
    }

    @GrpcMethod('SfuService', 'GetStreams')
    async handleGetStreams(data: {
        room_id: string;
    }): Promise<{ status: string; streams: any[] }> {
        const streams = await this.sfuService.getStreamsByRoom(data.room_id);

        // Convert Stream objects to proto format (snake_case field names)
        const protoStreams = streams.map((stream) => ({
            stream_id: stream.streamId,
            publisher_id: stream.publisherId,
            producer_id: stream.producerId,
            metadata: JSON.stringify(stream.metadata),
            rtp_parameters: JSON.stringify(stream.rtpParameters),
            room_id: stream.roomId,
        }));

        return { status: 'success', streams: protoStreams };
    }

    @GrpcMethod('SfuService', 'ConnectTransport')
    async handleConnectTransport(data: {
        transport_id: string;
        dtls_parameters: string;
        participant_data: string;
    }): Promise<{ message: string; success: boolean; transport?: string }> {
        try {
            const { transport_id, dtls_parameters } = data;
            const dtlsParameters = JSON.parse(dtls_parameters);

            // Get transport from SFU service registry
            const transport = this.sfuService.getTransport(transport_id);
            if (!transport) {
                console.error(`Transport ${transport_id} not found`);
                throw new RpcException(`Transport ${transport_id} not found`);
            }

            // Check if already connected
            if (transport.appData?.connected) {
                return {
                    message: 'Transport already connected',
                    success: false,
                };
            }

            // Connect the transport
            await transport.connect({ dtlsParameters });

            // Mark as connected
            transport.appData = {
                ...transport.appData,
                connected: true,
            };

            return {
                message: 'Transport connected successfully',
                success: true,
                transport: JSON.stringify(transport),
            };
        } catch (error) {
            console.error('Error connecting transport:', error);
            throw new RpcException('Failed to connect transport');
        }
    }
    @GrpcMethod('SfuService', 'RemoveUserMedia')
    async handleRemoveUserMedia(data: {
        room_id: string;
        peer_id: string;
    }): Promise<{ removed_stream_ids: string[] }> {
        const removedStreamIds: string[] = [];
        const streams = await this.sfuService.getStreamsByRoom(data.room_id);
        for (const { streamId, publisherId } of streams) {
            if (publisherId === data.peer_id) {
                await this.sfuService.removeProducer(data.room_id, streamId);
                this.sfuService.deleteStream(streamId);
                removedStreamIds.push(streamId);
            }
        }
        return { removed_stream_ids: removedStreamIds };
    }

    @GrpcMethod('SfuService', 'CreateTransport')
    async handleCreateTransport(data: {
        room_id: string;
    }): Promise<{ status: string; transport_data: string }> {
        try {
            const transport = await this.sfuService.createWebRtcTransport(
                data.room_id,
            );

            // Properly serialize transport data with all required WebRTC parameters
            const transportData = {
                id: transport.id,
                iceParameters: transport.iceParameters,
                iceCandidates: transport.iceCandidates,
                dtlsParameters: transport.dtlsParameters,
                sctpParameters: transport.sctpParameters,
            };

            return {
                status: 'success',
                transport_data: JSON.stringify({ transport: transportData }),
            };
        } catch (error) {
            console.error('Error creating WebRTC transport:', error);
            throw new RpcException('Failed to create WebRTC transport');
        }
    }

    @GrpcMethod('SfuService', 'GetIceServers')
    async handleGetIceServers(): Promise<{
        status: string;
        ice_servers: Array<{
            urls: string;
            username: string;
            credential: string;
        }>;
    }> {
        try {
            const iceServers = await this.sfuService.getIceServers();
            return {
                status: 'success',
                ice_servers: iceServers,
            };
        } catch (error) {
            console.error('Error getting ICE servers:', error);
            throw new RpcException('Failed to get ICE servers');
        }
    }

    @GrpcMethod('SfuService', 'SaveStream')
    async handleSaveStream(data: {
        stream: Stream;
        room_id: string;
    }): Promise<{ success: boolean; message: string }> {
        const result = this.sfuService.saveStream(data.stream);
        if (!result) {
            console.error(
                '[SFU CONTROLLER] Failed to save stream:',
                data.stream.streamId,
            );
            throw new RpcException('Failed to save stream');
        }
        return { success: true, message: 'Stream saved successfully' };
    }

    @GrpcMethod('SfuService', 'GetStreamById')
    async handleGetStreamById(data: {
        stream_id: string;
    }): Promise<{ status: string; stream: Stream }> {
        const stream = this.sfuService.getStream(data.stream_id);
        if (!stream) {
            throw new RpcException('Stream not found');
        }
        return { status: 'success', stream };
    }

    @GrpcMethod('SfuService', 'RemoveStream')
    async handleRemoveStream(data: {
        room_id: string;
        stream_id: string;
    }): Promise<{ status: string }> {
        const result = this.sfuService.removeStream(
            data.room_id,
            data.stream_id,
        );
        if (!result) {
            throw new RpcException('Failed to remove stream');
        }
        return { status: 'success' };
    }

    @GrpcMethod('SfuService', 'SaveProducerToStream')
    async handleSaveProducerToStream(data: {
        room_id: string;
        producer_id: string;
        stream: Stream;
    }): Promise<{ status: string }> {
        const result = this.sfuService.saveProducerToStream(
            data.producer_id,
            data.stream,
        );
        if (!result) {
            throw new RpcException('Failed to save producer to stream');
        }
        return { status: 'success' };
    }

    @GrpcMethod('SfuService', 'GetStreamByProducer')
    async getStreamByProducerId(data: {
        producer_id: string;
    }): Promise<{ status: string; stream: Stream }> {
        const stream = this.sfuService.getStreamByProducerId(data.producer_id);
        if (!stream) {
            throw new RpcException('Failed to get stream by producer');
        }
        return { status: 'success', stream };
    }

    @GrpcMethod('SfuService', 'RemoveProducer')
    async handleRemoveProducer(data: {
        room_id: string;
        stream_id: string;
    }): Promise<{ status: string }> {
        const result = this.sfuService.removeProducer(
            data.room_id,
            data.stream_id,
        );
        if (!result) {
            throw new RpcException('Failed to remove producer');
        }
        return { status: 'success' };
    }

    @GrpcMethod('SfuService', 'CreateConsumer')
    async handleCreateConsumer(data: {
        room_id: string;
        stream_id: string;
        transport_id: string;
        rtp_capabilities: string;
        participant_data: string;
    }): Promise<{ status: string; consumer_data: string }> {
        try {
            if (!data.stream_id || data.stream_id === 'undefined') {
                throw new RpcException(
                    `Invalid streamId: ${data.stream_id}. StreamId cannot be undefined or null.`,
                );
            }

            if (!data.transport_id) {
                throw new RpcException(
                    `Invalid transportId: ${data.transport_id}`,
                );
            }

            if (!data.room_id) {
                console.error(`[SFU] Invalid roomId: ${data.room_id}`);
                throw new RpcException(`Invalid roomId: ${data.room_id}`);
            }

            // Parse RTP capabilities, handle empty case
            let rtpCapabilities = {};
            try {
                rtpCapabilities = JSON.parse(data.rtp_capabilities || '{}');
            } catch (error) {
                console.warn(
                    '[SFU] Invalid RTP capabilities, using empty object',
                );
                rtpCapabilities = {};
            }

            // Parse participant data
            let participant = {};
            try {
                participant = JSON.parse(data.participant_data || '{}');
            } catch (error) {
                console.warn(
                    '[SFU] Invalid participant data, using empty object',
                );
                participant = {};
            }

            // Ensure Maps are properly initialized before passing to SFU service
            this.ensureParticipantMaps(participant);

            const result = await this.sfuService.createConsumer(
                data.room_id,
                data.stream_id,
                data.transport_id,
                rtpCapabilities,
                participant,
            );

            // Extract serializable data from the result
            const consumerData: any = {
                consumerId: result.consumerId,
                kind: result.kind,
                rtpParameters: result.rtpParameters,
                streamId: result.streamId,
                producerId: result.producerId,
            };

            // Include message if present (for non-priority streams)
            if (result.message) {
                consumerData.message = result.message;
            }
            return {
                status: 'success',
                consumer_data: JSON.stringify(consumerData),
            };
        } catch (error) {
            console.error('Error creating consumer:', error);
            throw new RpcException(
                error.message || 'Failed to create consumer',
            );
        }
    }

    @GrpcMethod('SfuService', 'GetMediaRouter')
    async handleGetMediaRouter(data: {
        room_id: string;
    }): Promise<{ status: string; router_data: string }> {
        try {
            const router = await this.sfuService.createMediaRoom(data.room_id);
            if (!router) {
                throw new RpcException('Failed to get media router');
            }
            return {
                status: 'success',
                router_data: JSON.stringify(router.rtpCapabilities),
            };
        } catch (error) {
            console.error('Error getting media router:', error);
            throw new RpcException('Failed to get media router');
        }
    }

    @GrpcMethod('SfuService', 'ResumeConsumer')
    async handleResumeConsumer(data: {
        room_id: string;
        consumer_id: string;
        participant_id: string;
    }): Promise<{ status: string; message: string }> {
        try {
            await this.sfuService.resumeConsumer(
                data.room_id,
                data.consumer_id,
                data.participant_id,
            );

            return {
                status: 'success',
                message: 'Consumer resumed successfully',
            };
        } catch (error) {
            console.error('Error resuming consumer:', error);
            throw new RpcException(
                error.message || 'Failed to resume consumer',
            );
        }
    }

    @GrpcMethod('SfuService', 'UnpublishStream')
    async handleUnpublishStream(data: {
        room_id: string;
        stream_id: string;
        participant_id: string;
    }): Promise<{ status: string; message: string }> {
        try {
            await this.sfuService.unpublishStream(
                data.room_id,
                data.stream_id,
                data.participant_id,
            );

            return {
                status: 'success',
                message: 'Stream unpublished successfully',
            };
        } catch (error) {
            console.error('Error unpublishing stream:', error);
            throw new RpcException(
                error.message || 'Failed to unpublish stream',
            );
        }
    }

    @GrpcMethod('SfuService', 'UpdateStream')
    async handleUpdateStream(data: {
        stream_id: string;
        participant_id: string;
        metadata: string;
        room_id: string;
    }): Promise<{ status: string; message: string }> {
        try {
            const metadata = JSON.parse(data.metadata);
            await this.sfuService.updateStream(
                data.stream_id,
                data.participant_id,
                metadata,
                data.room_id,
            );

            return {
                status: 'success',
                message: 'Stream updated successfully',
            };
        } catch (error) {
            console.error('Error updating stream:', error);
            throw new RpcException(error.message || 'Failed to update stream');
        }
    }

    @GrpcMethod('SfuService', 'RemoveParticipantMedia')
    async handleRemoveParticipantMedia(data: {
        room_id: string;
        participant_id: string;
    }): Promise<{ status: string; removed_streams: string[] }> {
        try {
            const removedStreams = this.sfuService.removeParticipantMedia(
                data.room_id,
                data.participant_id,
            );

            return {
                status: 'success',
                removed_streams: removedStreams,
            };
        } catch (error) {
            console.error('Error removing participant media:', error);
            throw new RpcException(
                error.message || 'Failed to remove participant media',
            );
        }
    }

    @GrpcMethod('SfuService', 'CloseMediaRoom')
    async handleCloseMediaRoom(data: {
        room_id: string;
    }): Promise<{ status: string; message: string }> {
        try {
            this.sfuService.closeMediaRoom(data.room_id);

            return {
                status: 'success',
                message: 'Media room closed successfully',
            };
        } catch (error) {
            console.error('Error closing media room:', error);
            throw new RpcException(
                error.message || 'Failed to close media room',
            );
        }
    }

    @GrpcMethod('SfuService', 'CreateProducer')
    async handleCreateProducer(data: {
        room_id: string;
        transport_id: string;
        kind: string;
        rtp_parameters: string;
        metadata: string;
        participant_data: string;
    }): Promise<{
        status: string;
        message: string;
        producer_data?: string;
    }> {
        try {
            // Validate and parse inputs
            if (!data.rtp_parameters) {
                throw new Error('RTP parameters are required');
            }
            if (!data.metadata) {
                throw new Error('Metadata is required');
            }
            if (!data.participant_data) {
                throw new Error('Participant data is required');
            }

            const rtpParameters = JSON.parse(data.rtp_parameters);
            const metadata = JSON.parse(data.metadata);
            const participant = JSON.parse(data.participant_data);
            // Ensure Maps are properly initialized before passing to SFU service
            this.ensureParticipantMaps(participant);

            const result = await this.sfuService.createProducer({
                roomId: data.room_id,
                transportId: data.transport_id,
                kind: data.kind as mediasoupTypes.MediaKind,
                rtpParameters,
                metadata,
                participant,
            });
            const responseData = {
                producer_id: result.producerId,
                producer: {
                    id: result.producer.id,
                    kind: result.producer.kind,
                    rtpParameters: result.producer.rtpParameters,
                    type: result.producer.type,
                    paused: result.producer.paused,
                },
                streamId: result.streamId,
            };
            const finalResponse = {
                status: 'success',
                message: 'Producer created successfully',
                producer_data: JSON.stringify(responseData),
            };

            return finalResponse;
        } catch (error) {
            console.error('Error creating producer:', error);
            throw new RpcException(
                `Failed to create producer: ${error.message}`,
            );
        }
    }

    @GrpcMethod('SfuService', 'PinUser')
    async handlePinUser(data: {
        room_id: string;
        pinner_peer_id: string;
        pinned_peer_id: string;
        transport_id: string;
        rtp_capabilities: string;
    }): Promise<{ status: string; pin_data: string }> {
        try {
            console.log(`[SFU Controller] Pin user request:`, data);

            if (!data.room_id || !data.pinner_peer_id || !data.pinned_peer_id) {
                throw new RpcException('Missing required fields for pin user');
            }

            // Parse RTP capabilities
            let rtpCapabilities = {};
            try {
                rtpCapabilities = JSON.parse(data.rtp_capabilities || '{}');
            } catch (error) {
                console.warn(
                    '[SFU Controller] Invalid RTP capabilities for pin',
                );
                rtpCapabilities = {};
            }

            const result = await this.sfuService.pinUser(
                data.room_id,
                data.pinner_peer_id,
                data.pinned_peer_id,
                data.transport_id,
                rtpCapabilities,
            );

            return {
                status: result.success ? 'success' : 'failed',
                pin_data: JSON.stringify(result),
            };
        } catch (error) {
            console.error('Error pinning user:', error);
            throw new RpcException(error.message || 'Failed to pin user');
        }
    }

    @GrpcMethod('SfuService', 'UnpinUser')
    async handleUnpinUser(data: {
        room_id: string;
        unpinner_peer_id: string;
        unpinned_peer_id: string;
    }): Promise<{ status: string; unpin_data: string }> {
        try {
            console.log(`[SFU Controller] Unpin user request:`, data);

            if (
                !data.room_id ||
                !data.unpinner_peer_id ||
                !data.unpinned_peer_id
            ) {
                throw new RpcException(
                    'Missing required fields for unpin user',
                );
            }

            const result = await this.sfuService.unpinUser(
                data.room_id,
                data.unpinner_peer_id,
                data.unpinned_peer_id,
            );

            return {
                status: result.success ? 'success' : 'failed',
                unpin_data: JSON.stringify(result),
            };
        } catch (error) {
            console.error('Error unpinning user:', error);
            throw new RpcException(error.message || 'Failed to unpin user');
        }
    }

    @GrpcMethod('SfuService', 'HandleSpeaking')
    async handleSpeaking(data: {
        room_id: string;
        peer_id: string;
        port: number; // Optional port for audio service
    }): Promise<{ status: string; message: string }> {
        try {
            console.log(`[SFU Controller] Handle speaking request:`, data);

            if (!data.room_id || !data.peer_id) {
                throw new RpcException(
                    'Missing required fields for handling speaking',
                );
            }

            const result = await this.sfuService.handleSpeaking({
                room_id: data.room_id,
                peer_id: data.peer_id,
                port: data.port,
            });

            return result;
        } catch (error) {
            console.error('Error handling speaking:', error);
            throw new RpcException(
                error.message || 'Failed to handle speaking',
            );
        }
    }

    @GrpcMethod('SfuService', 'HandleStopSpeaking')
    async handleStopSpeaking(data: {
        room_id: string;
        peer_id: string;
    }): Promise<{ status: string; message: string }> {
        try {
            console.log(`[SFU Controller] Handle stop speaking request:`, data);

            if (!data.room_id || !data.peer_id) {
                throw new RpcException(
                    'Missing required fields for handling stop speaking',
                );
            }

            const result = await this.sfuService.handleStopSpeaking({
                room_id: data.room_id,
                peer_id: data.peer_id,
            });

            return result;
        } catch (error) {
            console.error('Error handling stop speaking:', error);
            throw new RpcException(
                error.message || 'Failed to handle stop speaking',
            );
        }
    }

    @GrpcMethod('SfuService', 'AllocatePort')
    async handleAllocatePort(data: {
        room_id: string;
        source_user_id: string;
        target_user_id: string;
        source_language: string;
        target_language: string;
        audio_port: number;
        send_port: number; // Added for bidirectional support
        ssrc: number;
    }): Promise<{ success: boolean; stream_id?: string; message?: string }> {
        try {
            const result = await this.sfuService.allocatePort(
                data.room_id,
                data.source_user_id,
                data.target_user_id,
                data.source_language,
                data.target_language,
                data.audio_port,
                data.send_port,
                data.ssrc,
            );

            return {
                success: result.success,
                stream_id: result.streamId,
                message: result.message,
            };
        } catch (error) {
            throw new RpcException({
                code: 2,
                message: error.message || 'Failed to establish RTP connection',
            });
        }
    }

    /**
     * Handle the destruction of a translation cabin.
     * @param data - The data required to destroy the translation cabin.
     * @returns A promise that resolves to the result of the destruction operation.
     */
    @GrpcMethod('SfuService', 'DestroyTranslationCabin')
    async handleDestroyTranslationCabin(data: {
        room_id: string;
        source_user_id: string;
        target_user_id: string;
        source_language: string;
        target_language: string;
    }): Promise<{ success: boolean; message?: string }> {
        try {
            // Validate data
            if (
                !data.room_id ||
                !data.target_user_id ||
                !data.source_language ||
                !data.target_language
            ) {
                return {
                    success: false,
                    message:
                        'Missing required fields for destroying translation cabin',
                };
            }
            return await this.sfuService.destroyTranslationCabin(data);
        } catch (error) {
            throw new RpcException({
                code: 2,
                message: error.message || 'Failed to destroy translation cabin',
            });
        }
    }

    @GrpcMethod('SfuService', 'ListTranslationCabin')
    async handleListTranslationCabin(data: {
        room_id: string;
        user_id: string;
    }): Promise<{
        success: boolean;
        cabins: {
            target_user_id: string;
            source_language: string;
            target_language: string;
        }[];
        message?: string;
    }> {
        try {
            console.log(
                `[SFU Controller] Handle list translation cabin request:`,
                data,
            );

            if (!data.room_id || !data.user_id) {
                throw new RpcException(
                    'Missing required fields for listing translation cabins',
                );
            }

            const result = await this.sfuService.listTranslationCabin({
                roomId: data.room_id,
                userId: data.user_id,
            });
            return result;
        } catch (error) {
            console.error('Error handling list translation cabin:', error);
            throw new RpcException(
                error.message || 'Failed to handle list translation cabin',
            );
        }
    }
}
