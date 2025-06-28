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
      participant.transports = new Map(Object.entries(participant.transports));
    } else if (!participant.transports) {
      participant.transports = new Map();
    }

    // Convert producers to Map if it's a plain object
    if (
      participant.producers &&
      typeof participant.producers === 'object' &&
      !(participant.producers instanceof Map)
    ) {
      participant.producers = new Map(Object.entries(participant.producers));
    } else if (!participant.producers) {
      participant.producers = new Map();
    }

    // Convert consumers to Map if it's a plain object
    if (
      participant.consumers &&
      typeof participant.consumers === 'object' &&
      !(participant.consumers instanceof Map)
    ) {
      participant.consumers = new Map(Object.entries(participant.consumers));
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

      // Log router RTP capabilities for debugging
      console.log(
        `🔍 [SFU Controller] Router RTP capabilities for room ${data.room_id}:`,
      );
      console.log(
        'Codecs:',
        JSON.stringify(router.rtpCapabilities.codecs, null, 2),
      );

      // Log specific payload types
      const codecs = router.rtpCapabilities.codecs;
      if (codecs && codecs.length > 0) {
        const opusCodec = codecs.find((c) => c.mimeType === 'audio/opus');
        const vp8Codec = codecs.find((c) => c.mimeType === 'video/VP8');
        const h264Codec = codecs.find((c) => c.mimeType === 'video/H264');

        console.log(
          `🎵 [SFU Controller] Opus payload type: ${opusCodec?.preferredPayloadType || 'not found'}`,
        );
        console.log(
          `📹 [SFU Controller] VP8 payload type: ${vp8Codec?.preferredPayloadType || 'not found'}`,
        );
        console.log(
          `📹 [SFU Controller] H264 payload type: ${h264Codec?.preferredPayloadType || 'not found'}`,
        );
      }

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
        console.error(`❌ Transport ${transport_id} not found`);
        throw new RpcException(`Transport ${transport_id} not found`);
      }

      // Check if already connected
      if (transport.appData?.connected) {
        return { message: 'Transport already connected', success: false };
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
      console.error('❌ Error connecting transport:', error);
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
    ice_servers: Array<{ urls: string; username: string; credential: string }>;
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
    console.log('🎬 [SFU CONTROLLER] Saving stream:', {
      streamId: data.stream.streamId,
      publisherId: data.stream.publisherId,
      producerId: data.stream.producerId,
      roomId: data.room_id,
    });

    const result = this.sfuService.saveStream(data.stream);
    if (!result) {
      console.error(
        '❌ [SFU CONTROLLER] Failed to save stream:',
        data.stream.streamId,
      );
      throw new RpcException('Failed to save stream');
    }
    console.log(
      '✅ [SFU CONTROLLER] Stream saved successfully:',
      data.stream.streamId,
    );
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
    const result = this.sfuService.removeStream(data.room_id, data.stream_id);
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
    const result = this.sfuService.removeProducer(data.room_id, data.stream_id);
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
      console.log(
        `🎯 [SFU] CreateConsumer request - Transport ID: ${data.transport_id}, Stream ID: ${data.stream_id}, Room ID: ${data.room_id}`,
      );

      const rtpCapabilities = JSON.parse(data.rtp_capabilities);
      const participant = JSON.parse(data.participant_data);

      // Ensure Maps are properly initialized before passing to SFU service
      this.ensureParticipantMaps(participant);

      const result = await this.sfuService.createConsumer(
        data.room_id,
        data.stream_id,
        data.transport_id,
        rtpCapabilities,
        participant,
      );

      return {
        status: 'success',
        consumer_data: JSON.stringify(result),
      };
    } catch (error) {
      console.error('Error creating consumer:', error);
      throw new RpcException(error.message || 'Failed to create consumer');
    }
  }

  @GrpcMethod('SfuService', 'GetMediaRouter')
  async handleGetMediaRouter(data: {
    room_id: string;
  }): Promise<{ status: string; router_data: string }> {
    try {
      const mediaRouter = await this.sfuService.getMediaRouter(data.room_id);
      return {
        status: 'success',
        router_data: JSON.stringify({ router: mediaRouter }),
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
      throw new RpcException(error.message || 'Failed to resume consumer');
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
      throw new RpcException(error.message || 'Failed to unpublish stream');
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
      console.log(
        `[SFU Controller] RemoveParticipantMedia called for participant ${data.participant_id} in room ${data.room_id}`,
      );

      const removedStreams = this.sfuService.removeParticipantMedia(
        data.room_id,
        data.participant_id,
      );

      console.log(
        `[SFU Controller] Successfully removed participant media. Removed streams:`,
        removedStreams,
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
      throw new RpcException(error.message || 'Failed to close media room');
    }
  }

  @GrpcMethod('SfuService', 'HandlePresence')
  async handlePresence(data: {
    room_id: string;
    peer_id: string;
    metadata: string;
  }): Promise<{ status: string; presence_data: string }> {
    console.log('[SFU Controller] HandlePresence called with:', {
      room_id: data.room_id,
      peer_id: data.peer_id,
      metadata: data.metadata,
      metadata_type: typeof data.metadata,
    });

    // Parse metadata properly, ensuring we don't double-parse
    let parsedMetadata;
    try {
      if (typeof data.metadata === 'string') {
        // Check if it's already a JSON string or raw metadata
        const trimmed = data.metadata.trim();
        if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
          parsedMetadata = JSON.parse(data.metadata);
        } else {
          // If it's not JSON format, treat as plain object
          parsedMetadata = { raw: data.metadata };
        }
      } else if (typeof data.metadata === 'object' && data.metadata !== null) {
        parsedMetadata = data.metadata;
      } else {
        parsedMetadata = {};
      }
      console.log('[SFU Controller] Parsed metadata:', parsedMetadata);
    } catch (error) {
      console.error('[SFU Controller] Failed to parse metadata:', error);
      console.error('[SFU Controller] Raw metadata:', data.metadata);
      parsedMetadata = {}; // Default to empty object
    }

    const payload = {
      roomId: data.room_id,
      peerId: data.peer_id,
      metadata: parsedMetadata, // Pass parsed object instead of string
    };

    console.log('[SFU Controller] Calling SFU service with payload:', payload);

    const rs = await this.sfuService.handlePresence(payload);
    console.log('[SFU Controller] SFU service returned:', rs);

    if (!rs) {
      console.error('[SFU Controller] SFU service returned null/undefined');
      throw new RpcException('Failed to handle presence');
    }

    const result = {
      status: 'success',
      presence_data: JSON.stringify(rs),
    };

    console.log('[SFU Controller] Final result:', result);
    return result;
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
      console.log('🎬 [SFU Controller] CreateProducer request:', {
        room_id: data.room_id,
        transport_id: data.transport_id,
        kind: data.kind,
        rtp_parameters_length: data.rtp_parameters?.length || 0,
        metadata: data.metadata,
        participant_data: data.participant_data,
      });

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

      console.log('🎬 [SFU Controller] Parsed data:', {
        rtpParameters: !!rtpParameters,
        metadata,
        participant,
      });

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

      console.log(
        `📊 [SFU] Producer created in room ${data.room_id}: ${result.producerId} (${data.kind}) by ${participant.peerId || 'unknown'}`,
      );

      // Log current stream count
      const allStreams = await this.sfuService.getStreamsByRoom(data.room_id);
      console.log(
        `📊 [SFU] Room ${data.room_id} now has ${allStreams.length} total streams`,
      );

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

      console.log(
        '🔧 [SFU Controller] Response data before stringify:',
        responseData,
      );

      const finalResponse = {
        status: 'success',
        message: 'Producer created successfully',
        producer_data: JSON.stringify(responseData),
      };

      console.log('🔧 [SFU Controller] Final response:', finalResponse);
      return finalResponse;
    } catch (error) {
      console.error('Error creating producer:', error);
      throw new RpcException(`Failed to create producer: ${error.message}`);
    }
  }
}
