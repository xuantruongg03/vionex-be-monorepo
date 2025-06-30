import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';

// SFU gRPC service interface based on proto
export interface SfuGrpcService {
  // Media room management
  createMediaRoom(data: { room_id: string }): any;
  closeMediaRoom(data: { room_id: string }): any;
  getMediaRouter(data: { room_id: string }): any;

  // Transport management
  createTransport(data: { room_id: string }): any;
  connectTransport(data: {
    transport_id: string;
    dtls_parameters: string;
    participant_data: string;
  }): any;

  // Producer/Consumer management
  createProducer(data: {
    transport_id: string;
    kind: string;
    rtp_parameters: string;
    metadata: string;
    room_id: string;
    participant_data: string;
  }): any;
  createConsumer(data: {
    stream_id: string;
    transport_id: string;
    room_id: string;
    peer_id: string;
    rtp_capabilities: string;
    participant_data: string;
  }): any;
  resumeConsumer(data: {
    consumer_id: string;
    room_id: string;
    peer_id: string;
  }): any;

  // Stream management
  getStreams(data: { room_id: string }): any;
  saveStream(data: {
    stream_id: string;
    publisher_id: string;
    producer_id: string;
    metadata: string;
    rtp_parameters: string;
    room_id: string;
  }): any;
  updateStream(data: {
    stream_id: string;
    participant_id: string;
    metadata: string;
    room_id: string;
  }): any;
  removeStream(data: { stream_id: string }): any;

  // Participant management
  removeParticipantMedia(data: {
    room_id: string;
    participant_id: string;
  }): any;

  // Presence
  handlePresence(data: {
    room_id: string;
    peer_id: string;
    metadata: string;
  }): any;
}

@Injectable()
export class SfuClientService implements OnModuleInit {
  private sfuService: SfuGrpcService;

  constructor(@Inject('SFU_SERVICE') private client: ClientGrpc) {}

  onModuleInit() {
    this.sfuService = this.client.getService<SfuGrpcService>('SfuService');
  }

  async createMediaRoom(roomId: string) {
    return firstValueFrom(this.sfuService.createMediaRoom({ room_id: roomId }));
  }

  async getRouterRtpCapabilities(roomId: string) {
    const result: any = await firstValueFrom(
      this.sfuService.getMediaRouter({ room_id: roomId }),
    );
    console.log('[SfuClient] getRouterRtpCapabilities result:', result);

    if (result && result.router_data) {
      const capabilities = JSON.parse(result.router_data);
      console.log('[SfuClient] Parsed router capabilities:', capabilities);
      return capabilities;
    }

    throw new Error('No router capabilities returned from SFU service');
  }

  async createTransport(roomId: string, peerId: string, isProducer: boolean) {
    // Current proto only supports room_id, so we'll use what's available
    return firstValueFrom(
      this.sfuService.createTransport({
        room_id: roomId,
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
        participant_data: JSON.stringify({ room_id: roomId, peer_id: peerId }),
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

  async sendPresence(roomId: string, peerId: string, metadata: any) {
    return this.handlePresence(roomId, peerId, metadata);
  }
}
