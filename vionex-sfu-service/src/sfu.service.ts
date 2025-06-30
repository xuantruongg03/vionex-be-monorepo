import { Injectable } from '@nestjs/common';
import * as mediasoup from 'mediasoup';
import { types as mediasoupTypes } from 'mediasoup';
import { ConfigService } from '@nestjs/config';
import { MediaRoom, Stream } from './interface';

@Injectable()
export class SfuService {
  private webRtcServer: mediasoupTypes.WebRtcServer;
  private streams = new Map<string, Stream>(); // Map<streamId, Stream>
  private producerToStream = new Map<string, Stream>(); // Map<producerId, Stream>
  private worker: mediasoupTypes.Worker;
  private mediaRooms = new Map<string, MediaRoom>();
  private transports = new Map<string, mediasoupTypes.WebRtcTransport>(); // Map<transportId, Transport>

  constructor(private configService: ConfigService) {
    this.initializeMediasoup();
  }

  private async initializeMediasoup() {
    try {
      const rtcMinPort = parseInt(
        this.configService.get('MEDIASOUP_RTC_MIN_PORT') || '40000',
        10,
      );
      const rtcMaxPort = parseInt(
        this.configService.get('MEDIASOUP_RTC_MAX_PORT') || '49999',
        10,
      );

      this.worker = await mediasoup.createWorker({
        logLevel: 'warn',
        logTags: ['info', 'ice', 'dtls', 'rtp', 'srtp', 'rtcp'],
        rtcMinPort,
        rtcMaxPort,
      });

      this.worker.on('died', () => {
        console.error('Mediasoup worker died, exiting in 2 seconds...');
        setTimeout(() => process.exit(1), 2000);
      });
    } catch (error) {
      console.error('Failed to create mediasoup worker:', error);
      throw error;
    }
  }

  async createMediaRoom(roomId: string): Promise<mediasoupTypes.Router> {
    if (this.mediaRooms.has(roomId)) {
      const mediaRoom = this.mediaRooms.get(roomId);
      if (mediaRoom) {
        return mediaRoom.router;
      }
    }

    try {
      // Use EXACT same router configuration as working old backend
      const router = await this.worker.createRouter({
        mediaCodecs: [
          {
            kind: 'audio',
            mimeType: 'audio/opus',
            clockRate: 48000,
            channels: 2,
          },
          {
            kind: 'video',
            mimeType: 'video/VP8',
            clockRate: 90000,
            parameters: {
              'x-google-start-bitrate': 1000,
            },
          },
          {
            kind: 'video',
            mimeType: 'video/H264',
            clockRate: 90000,
            parameters: {
              'packetization-mode': 1,
              'profile-level-id': '42e01f',
              'level-asymmetry-allowed': 1,
              'x-google-start-bitrate': 1000,
            },
          },
        ],
      });

      console.log('🎯 [SFU] Router created successfully');

      // Log specific payload types assigned by mediasoup
      const routerCodecs = router.rtpCapabilities.codecs;
      if (routerCodecs && routerCodecs.length > 0) {
        console.log('🎯 [SFU] Router codec payload types:');
        routerCodecs.forEach((codec: any) => {
          console.log(
            `   - ${codec.mimeType}: ${codec.preferredPayloadType || 'auto'}`,
          );
        });
      }

      this.mediaRooms.set(roomId, {
        router,
        producers: new Map(),
        consumers: new Map(),
      });

      return router;
    } catch (error) {
      console.error(`Failed to create router for room ${roomId}:`, error);
      throw error;
    }
  }
  async createWebRtcTransport(
    roomId: string,
  ): Promise<mediasoupTypes.WebRtcTransport> {
    // Đảm bảo room tồn tại trước khi tạo transport
    let mediaRoom = this.mediaRooms.get(roomId);
    if (!mediaRoom) {
      await this.createMediaRoom(roomId);
      mediaRoom = this.mediaRooms.get(roomId);
      if (!mediaRoom) {
        throw new Error(`Failed to create room ${roomId}`);
      }
    }

    try {
      const transportOptions = {
        listenIps: [
          {
            ip: this.configService.get('MEDIASOUP_LISTEN_IP') || '0.0.0.0',
            announcedIp:
              this.configService.get('MEDIASOUP_ANNOUNCED_IP') || undefined,
          },
        ],
        enableUdp: true,
        enableTcp: true,
        preferUdp: true,
        initialAvailableOutgoingBitrate: 1000000,
        enableSctp: true,
        numSctpStreams: { OS: 1024, MIS: 1024 },
        maxSctpMessageSize: 262144,
        dtlsParameters: {
          role: 'server',
        },
        handshakeTimeout: 120000,
      };
      const transport =
        await mediaRoom.router.createWebRtcTransport(transportOptions);

      // Store transport for later access
      console.log(
        `🚀 [SFU] Created and storing transport with ID: ${transport.id}`,
      );
      this.transports.set(transport.id, transport);
      console.log(
        `🚀 [SFU] Transport ${transport.id} stored. Total transports:`,
        this.transports.size,
      );
      console.log(
        `🚀 [SFU] All transport IDs:`,
        Array.from(this.transports.keys()),
      );

      // Set up cleanup when transport closes
      transport.on('routerclose', () => {
        console.log(
          `🗑️ [SFU] Transport ${transport.id} closed because router closed`,
        );
        this.transports.delete(transport.id);
        console.log(
          `🗑️ [SFU] Transport ${transport.id} removed from registry. Remaining:`,
          this.transports.size,
        );
      });

      transport.on('@close', () => {
        console.log(`🗑️ [SFU] Transport ${transport.id} closed`);
        this.transports.delete(transport.id);
        console.log(
          `🗑️ [SFU] Transport ${transport.id} removed from registry. Remaining:`,
          this.transports.size,
        );
      });

      return transport;
    } catch (error) {
      console.error(
        `Failed to create WebRTC transport in room ${roomId}:`,
        error,
      );
      throw error;
    }
  }
  async getIceServers() {
    if (this.configService.get('USE_ICE_SERVERS') == 'true') {
      return [
        {
          urls:
            this.configService.get('STUN_SERVER_URL') ||
            'stun:stun.l.google.com:19302',
          username: '',
          credential: '',
        },
        {
          urls:
            this.configService.get('TURN_SERVER_URL') ||
            'turn:turnserver.example.com:3478',
          username: this.configService.get('TURN_SERVER_USERNAME') || 'user',
          credential: this.configService.get('TURN_SERVER_PASSWORD') || 'pass',
        },
      ];
    }
    return [];
  }

  saveProducer(
    roomId: string,
    streamId: string,
    producer: mediasoupTypes.Producer,
  ): void {
    const mediaRoom = this.mediaRooms.get(roomId);
    if (!mediaRoom) return;

    mediaRoom.producers.set(streamId, producer);
  }

  getProducer(
    roomId: string,
    streamId: string,
  ): mediasoupTypes.Producer | undefined {
    return this.mediaRooms.get(roomId)?.producers.get(streamId);
  }

  async getMediaRouter(roomId: string): Promise<mediasoupTypes.Router> {
    const mediaRoom = this.mediaRooms.get(roomId);
    if (!mediaRoom) {
      return await this.createMediaRoom(roomId);
    }
    return mediaRoom.router;
  }

  saveConsumer(
    roomId: string,
    streamId: string,
    consumer: mediasoupTypes.Consumer,
  ): void {
    const mediaRoom = this.mediaRooms.get(roomId);
    if (!mediaRoom) return;

    if (!mediaRoom.consumers.has(streamId)) {
      mediaRoom.consumers.set(streamId, []);
    }

    const consumers = mediaRoom.consumers.get(streamId);
    if (consumers) {
      consumers.push(consumer);
    }
  }

  async removeProducer(roomId: string, streamId: string): Promise<void> {
    const mediaRoom = this.mediaRooms.get(roomId);
    if (!mediaRoom) return;

    mediaRoom.producers.delete(streamId);

    if (mediaRoom.consumers.has(streamId)) {
      for (const consumer of mediaRoom.consumers.get(streamId) || []) {
        consumer.close();
      }
      mediaRoom.consumers.delete(streamId);
    }
  }

  closeMediaRoom(roomId: string): void {
    const mediaRoom = this.mediaRooms.get(roomId);
    if (!mediaRoom) return;

    for (const producer of mediaRoom.producers.values()) {
      producer.close();
    }

    for (const consumers of mediaRoom.consumers.values()) {
      for (const consumer of consumers) {
        consumer.close();
      }
    }
    mediaRoom.router.close();
    this.mediaRooms.delete(roomId);
  }
  async canConsume(
    roomId: string,
    producerId: string,
    rtpCapabilities: mediasoupTypes.RtpCapabilities,
  ): Promise<boolean> {
    // Đảm bảo room tồn tại
    const mediaRoom = this.mediaRooms.get(roomId);
    if (!mediaRoom) {
      // Tạo room nếu chưa tồn tại
      await this.createMediaRoom(roomId);
      const newMediaRoom = this.mediaRooms.get(roomId);
      if (!newMediaRoom) return false;
    }

    const room = this.mediaRooms.get(roomId);

    try {
      return room!.router.canConsume({
        producerId,
        rtpCapabilities,
      });
    } catch (error) {
      console.error('canConsume() error:', error);
      return false;
    }
  }
  async getStreamsByRoom(roomId: string): Promise<Stream[]> {
    // Đảm bảo room tồn tại trước khi lấy streams
    await this.getMediaRouter(roomId);

    const roomStreams = Array.from(this.streams.values())
      .filter((stream) => stream.roomId === roomId)
      .map((stream) => ({
        streamId: stream.streamId,
        publisherId: stream.publisherId,
        metadata: stream.metadata,
        producerId: stream.producerId,
        rtpParameters: stream.rtpParameters,
        roomId: stream.roomId,
      }));

    return roomStreams;
  }

  deleteStream(streamId: string): boolean {
    if (this.streams.has(streamId)) {
      this.streams.delete(streamId);
      return true;
    } else {
      console.warn(`Stream with ID ${streamId} does not exist.`);
      return false;
    }
  }
  saveStream(stream: Stream): boolean {
    if (this.streams.has(stream.streamId)) {
      console.warn(
        `⚠️ [SFU] Stream with ID ${stream.streamId} already exists.`,
      );
      return false;
    }
    this.streams.set(stream.streamId, stream);
    return true;
  }

  removeStream(roomId: string, streamId: string): boolean {
    if (this.streams.has(streamId)) {
      this.streams.delete(streamId);
      return true;
    }
    console.warn(`Stream with ID ${streamId} does not exist.`);
    return false;
  }

  saveProducerToStream(producerId: string, stream: Stream): boolean {
    const hasStream = this.streams.get(stream.streamId);
    if (!hasStream) {
      console.warn(`Stream with ID ${stream.streamId} does not exist.`);
      return false;
    }
    this.producerToStream.set(producerId, stream);
    return true;
  }

  getStreamByProducerId(producerId: string): Stream | null {
    return this.producerToStream.get(producerId) || null;
  }

  getStream(streamId: string): Stream | null {
    console.log(
      `🔍 [SFU] Looking for stream ${streamId}. Available streams:`,
      Array.from(this.streams.keys()),
    );
    const stream = this.streams.get(streamId) || null;
    if (!stream) {
      console.error(
        `❌ [SFU] Stream ${streamId} not found in streams registry`,
      );
    } else {
      console.log(`✅ [SFU] Found stream ${streamId}`);
    }
    return stream;
  }

  removeProducerFromStream(producerId: string): boolean {
    if (this.producerToStream.has(producerId)) {
      this.producerToStream.delete(producerId);
      return true;
    } else {
      console.warn(`Producer with ID ${producerId} does not exist.`);
      return false;
    }
  }
  async createConsumer(
    roomId: string,
    streamId: string,
    transportId: string,
    rtpCapabilities: any,
    participant: any,
  ) {
    try {
      console.log(
        `🎯 [SFU] Creating consumer - Room: ${roomId}, Stream: ${streamId}, Transport: ${transportId}`,
      );
      console.log(
        `🎯 [SFU] RTP capabilities provided:`,
        rtpCapabilities ? 'YES' : 'NO',
      );
      console.log(`🎯 [SFU] Participant data:`, participant);

      // Get the media room
      const mediaRoom = this.mediaRooms.get(roomId);
      if (!mediaRoom) {
        throw new Error(`Media room ${roomId} not found`);
      }

      // Get the transport
      const transport = this.transports.get(transportId);
      if (!transport) {
        throw new Error(`Transport ${transportId} not found`);
      }

      // Get the stream to find the producer
      const stream = this.streams.get(streamId);
      if (!stream) {
        throw new Error(`Stream ${streamId} not found`);
      }

      // Get the producer by its producerId (not streamId)
      let producer: mediasoupTypes.Producer | undefined;
      for (const [, p] of mediaRoom.producers.entries()) {
        if (p.id === stream.producerId) {
          producer = p;
          break;
        }
      }

      if (!producer) {
        throw new Error(
          `Producer ${stream.producerId} for stream ${streamId} not found in media room`,
        );
      }

      // If no RTP capabilities provided, use router capabilities as fallback
      let finalRtpCapabilities = rtpCapabilities;
      if (!rtpCapabilities || Object.keys(rtpCapabilities).length === 0) {
        console.log(
          `🎯 [SFU] No RTP capabilities provided, using router capabilities`,
        );
        finalRtpCapabilities = mediaRoom.router.rtpCapabilities;
      }

      // Check if router can consume this producer with the given capabilities
      if (
        !mediaRoom.router.canConsume({
          producerId: producer.id,
          rtpCapabilities: finalRtpCapabilities,
        })
      ) {
        console.warn(
          `🚫 [SFU] Router cannot consume producer ${producer.id} with given capabilities`,
        );
        console.warn(
          `🚫 [SFU] Producer kind: ${producer.kind}, mimeType: ${producer.rtpParameters.codecs[0]?.mimeType}`,
        );
        throw new Error(
          'Router cannot consume this producer with given RTP capabilities',
        );
      }

      // Create consumer
      const consumer = await transport.consume({
        producerId: producer.id,
        rtpCapabilities: finalRtpCapabilities,
        paused: true, // Start paused
      });

      console.log(
        `✅ [SFU] Consumer created: ${consumer.id}, kind: ${consumer.kind}`,
      );

      // Store consumer in media room - use streamId as key and store array of consumers
      if (!mediaRoom.consumers.has(streamId)) {
        mediaRoom.consumers.set(streamId, []);
      }
      const consumers = mediaRoom.consumers.get(streamId);
      if (consumers) {
        consumers.push(consumer);
      }

      // Handle consumer close event
      consumer.on('transportclose', () => {
        console.log(`Consumer ${consumer.id} closed because transport closed`);
        // Remove consumer from the array
        const consumers = mediaRoom.consumers.get(streamId);
        if (consumers) {
          const index = consumers.findIndex((c) => c.id === consumer.id);
          if (index !== -1) {
            consumers.splice(index, 1);
          }
          // If no consumers left, remove the key
          if (consumers.length === 0) {
            mediaRoom.consumers.delete(streamId);
          }
        }
      });

      return {
        consumerId: consumer.id,
        producerId: producer.id,
        kind: consumer.kind,
        rtpParameters: consumer.rtpParameters,
        consumer,
      };
    } catch (error) {
      console.error('Error creating consumer:', error);
      throw error;
    }
  }

  async resumeConsumer(
    roomId: string,
    consumerId: string,
    participantId: string,
  ): Promise<void> {
    try {
      console.log(
        `🎯 [SFU] Resuming consumer: ${consumerId} in room: ${roomId}`,
      );

      const mediaRoom = this.mediaRooms.get(roomId);
      if (!mediaRoom) {
        throw new Error(`Room ${roomId} not found`);
      }

      // Find the consumer by ID across all streams in the room
      let foundConsumer: mediasoupTypes.Consumer | null = null;
      for (const [streamId, consumers] of mediaRoom.consumers.entries()) {
        const consumer = consumers.find((c) => c.id === consumerId);
        if (consumer) {
          foundConsumer = consumer;
          break;
        }
      }

      if (!foundConsumer) {
        throw new Error(`Consumer ${consumerId} not found in room ${roomId}`);
      }

      // Resume the consumer
      await foundConsumer.resume();

      console.log(`✅ [SFU] Consumer resumed: ${consumerId}`);
    } catch (error) {
      console.error('Error resuming consumer:', error);
      throw error;
    }
  }

  async unpublishStream(
    roomId: string,
    streamId: string,
    participantId: string,
  ): Promise<void> {
    const mediaRoom = this.mediaRooms.get(roomId);
    if (!mediaRoom) {
      throw new Error(`Room ${roomId} not found 461`);
    }

    // Get stream
    const stream = this.getStream(streamId);
    if (!stream) {
      throw new Error(`Stream ${streamId} not found`);
    }

    // Verify ownership
    if (stream.publisherId !== participantId) {
      throw new Error('You do not own this stream');
    }

    // Get producer
    const producer = mediaRoom.producers.get(streamId);
    if (producer) {
      producer.close();
      // Remove producers from room
      mediaRoom.producers.delete(streamId);
    }

    // Close all consumers for this stream
    const consumers = mediaRoom.consumers.get(streamId);
    if (consumers && consumers.length > 0) {
      consumers.forEach((consumer) => {
        consumer.close();
      });

      // Remove consumers from room
      mediaRoom.consumers.delete(streamId);
    }

    // Remove stream
    this.removeStream(roomId, streamId);
    this.removeProducer(roomId, streamId);
    console.log(`Stream ${streamId} unpublished in room ${roomId}`);
  }

  async updateStream(
    streamId: string,
    participantId: string,
    metadata: any,
    roomId: string,
  ): Promise<void> {
    const mediaRoom = this.mediaRooms.get(roomId);
    if (!mediaRoom) {
      throw new Error(`Room ${roomId} not found 580`);
    }
    // Find stream
    const stream = this.getStream(streamId);
    if (!stream) {
      throw new Error(`Stream ${streamId} not found`);
    }

    // Verify ownership
    if (stream.publisherId !== participantId) {
      throw new Error('You do not own this stream');
    }

    // Update metadata
    stream.metadata = metadata;
    if (metadata.video !== undefined) {
      stream.metadata.video = metadata.video;
    }
    if (metadata.audio !== undefined) {
      stream.metadata.audio = metadata.audio;
    }
    if (metadata.noCameraAvailable !== undefined) {
      stream.metadata.noCameraAvailable = metadata.noCameraAvailable;
    }

    console.log(`Stream ${streamId} updated in room ${roomId}`);
  }

  removeParticipantMedia(roomId: string, participantId: string): string[] {
    console.log(
      `[SFU Service] Removing participant media for ${participantId} in room ${roomId}`,
    );

    const mediaRoom = this.mediaRooms.get(roomId);
    if (!mediaRoom) {
      console.warn(`Room ${roomId} not found 539`);
      return [];
    }

    const removedStreams: string[] = [];

    // Remove all streams belonging to this participant
    for (const [streamId, stream] of this.streams.entries()) {
      if (stream.publisherId === participantId) {
        console.log(
          `[SFU Service] Removing stream ${streamId} from participant ${participantId}`,
        );

        // Close producers
        const producer = mediaRoom.producers.get(streamId);
        if (producer) {
          console.log(`[SFU Service] Closing producer for stream ${streamId}`);
          producer.close();
          mediaRoom.producers.delete(streamId);
        }

        // Close consumers
        const consumers = mediaRoom.consumers.get(streamId);
        if (consumers) {
          console.log(
            `[SFU Service] Closing ${consumers.length} consumers for stream ${streamId}`,
          );
          consumers.forEach((consumer) => consumer.close());
          mediaRoom.consumers.delete(streamId);
        }

        // Remove stream
        this.streams.delete(streamId);
        removedStreams.push(streamId);
      }
    }

    console.log(
      `[SFU Service] Removed ${removedStreams.length} streams for participant ${participantId}:`,
      removedStreams,
    );
    return removedStreams;
  }

  async handlePresence(data: {
    roomId: string;
    peerId: string;
    metadata: any; // Now accepting parsed object instead of string
  }): Promise<{ stream: Stream; isUpdated: boolean } | null> {
    console.log('[SFU Service] HandlePresence called with:', data);

    const { roomId, peerId } = data;

    // Use metadata directly since it's already parsed in controller
    let metadata = data.metadata || {};
    console.log('[SFU Service] Using metadata:', metadata);
    console.log('[SFU Service] Metadata type:', typeof metadata);

    console.log('[SFU Service] Current streams in memory:', this.streams.size);
    console.log(
      '[SFU Service] All stream IDs:',
      Array.from(this.streams.keys()),
    );

    const existingPresenceStreams = Array.from(this.streams.entries()).filter(
      ([streamId, stream]) =>
        stream.publisherId === peerId &&
        (streamId.includes('presence') || stream.metadata?.type === 'presence'),
    );

    console.log(
      '[SFU Service] Found existing presence streams:',
      existingPresenceStreams.length,
    );

    // Nếu đã có presence stream, chỉ cập nhật metadata thay vì tạo mới
    if (existingPresenceStreams.length > 0) {
      const [streamId, stream] = existingPresenceStreams[0];

      // Cập nhật metadata
      stream.metadata = {
        ...stream.metadata,
        ...metadata,
        type: 'presence',
        noCameraAvailable: true,
        noMicroAvailable: true,
      };

      console.log('[SFU Service] Updated existing presence stream:', streamId);
      return { stream, isUpdated: true };
    }

    // // Tạo một streamId đặc biệt để đánh dấ đây là presence (không có media thực)
    const streamId = `${peerId}-presence-${Date.now()}`;
    console.log(
      '[SFU Service] Creating new presence stream with ID:',
      streamId,
    );

    // // Lưu stream "vô hình" này vào danh sách streams
    const streamPresence: Stream = {
      streamId,
      publisherId: peerId,
      producerId: 'presence-' + peerId,
      metadata: {
        ...metadata, // Use metadata parameter instead of data.metadata
        type: 'presence',
        noCameraAvailable: true,
        noMicroAvailable: true,
      },
      rtpParameters: { codecs: [], headerExtensions: [] },
      roomId,
    };

    this.streams.set(streamId, streamPresence);
    console.log(
      '[SFU Service] Presence stream saved. Total streams now:',
      this.streams.size,
    );
    console.log('[SFU Service] New stream details:', streamPresence);

    const result = { stream: streamPresence, isUpdated: false };
    console.log('[SFU Service] Returning result:', result);

    return result;
  }

  getTransport(
    transportId: string,
  ): mediasoupTypes.WebRtcTransport | undefined {
    return this.transports.get(transportId);
  }

  async createProducer(data: {
    roomId: string;
    transportId: string;
    kind: mediasoupTypes.MediaKind;
    rtpParameters: mediasoupTypes.RtpParameters;
    metadata: any;
    participant: any;
  }): Promise<{
    producer: mediasoupTypes.Producer;
    streamId: string;
    producerId: string;
    rtpParameters: mediasoupTypes.RtpParameters;
  }> {
    const transport = this.transports.get(data.transportId);
    if (!transport) {
      throw new Error(`Transport ${data.transportId} not found`);
    }

    const mediaRoom = this.mediaRooms.get(data.roomId);
    if (!mediaRoom) {
      throw new Error(`Media room ${data.roomId} not found`);
    }

    try {
      const producer = await transport.produce({
        kind: data.kind,
        rtpParameters: data.rtpParameters,
      });

      // Handle producer close event
      producer.on('transportclose', () => {
        console.log(`Producer ${producer.id} closed because transport closed`);
        // Clean up producer from media room
        for (const [streamId, p] of mediaRoom.producers.entries()) {
          if (p.id === producer.id) {
            mediaRoom.producers.delete(streamId);
            break;
          }
        }
        // Clean up from streams map
        this.producerToStream.delete(producer.id);
      });

      // Create stream object - handle both peerId and peer_id
      const participantId =
        data.participant.peerId ||
        data.participant.peer_id ||
        data.participant.participantId ||
        data.participant.id ||
        'unknown';
      const participantName =
        data.participant.name || data.participant.username || participantId;
      const streamId = `${participantId}-${data.kind}-${Date.now()}`;
      const stream: Stream = {
        streamId,
        publisherId: participantId,
        producerId: producer.id,
        metadata: data.metadata,
        rtpParameters: producer.rtpParameters,
        roomId: data.roomId,
      };

      // Save stream to streams map
      this.saveStream(stream);

      // Save producer to stream mapping
      this.saveProducerToStream(producer.id, stream);

      // Save producer to media room
      this.saveProducer(data.roomId, streamId, producer);

      console.log(
        `🎬 [SFU Service] Producer created: ${producer.id}, kind: ${producer.kind}, streamId: ${streamId}, participant: ${participantName}`,
      );

      return {
        producer,
        streamId,
        producerId: producer.id,
        rtpParameters: producer.rtpParameters,
      };
    } catch (error) {
      console.error('Error creating producer:', error);
      throw error;
    }
  }
}
