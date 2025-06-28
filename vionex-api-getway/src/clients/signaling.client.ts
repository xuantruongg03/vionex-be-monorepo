import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import * as mediasoupTypes from 'mediasoup/node/lib/types';
import { Observable, firstValueFrom, map } from 'rxjs';
import {
  Participant,
  Stream,
  SignalingGrpcService,
  ProtoStream,
} from '../interfaces/interface';

@Injectable()
export class SignalingClientService implements OnModuleInit {
  private signalingService: SignalingGrpcService;

  constructor(@Inject('SIGNALING_SERVICE') private client: ClientGrpc) {}

  onModuleInit() {
    this.signalingService =
      this.client.getService<SignalingGrpcService>('SignalingService');
  }

  // Helper method to convert ProtoStream to Stream
  private convertProtoStreamToStream(protoStream: ProtoStream): Stream {
    const result = {
      streamId: protoStream.stream_id,
      publisherId: protoStream.publisher_id,
      producerId: protoStream.producer_id,
      metadata: this.safeJsonParse(protoStream.metadata),
      rtpParameters: this.safeJsonParse(protoStream.rtp_parameters),
      roomId: protoStream.room_id,
    };

    return result;
  }

  // Helper method to safely parse JSON
  private safeJsonParse(data: any): any {
    if (!data) return {};
    if (typeof data === 'object') return data;
    if (typeof data === 'string') {
      try {
        return JSON.parse(data);
      } catch {
        return {};
      }
    }
    return {};
  }

  // Helper method to convert Stream to ProtoStream
  private convertStreamToProtoStream(stream: Stream): ProtoStream {
    return {
      stream_id: stream.streamId,
      publisher_id: stream.publisherId,
      producer_id: stream.producerId,
      metadata: JSON.stringify(stream.metadata),
      rtp_parameters: JSON.stringify(stream.rtpParameters),
      room_id: stream.roomId,
    };
  }

  async createMediaRoom(roomId: string) {
    return firstValueFrom(
      this.signalingService.createMediaRoom({ room_id: roomId }).pipe(
        map((response) => {
          if (!response || !response.router_data) {
            return { router: { rtpCapabilities: null } };
          }
          try {
            return JSON.parse(response.router_data);
          } catch (error) {
            console.error('Failed to parse createMediaRoom response:', error);
            return { router: { rtpCapabilities: null } };
          }
        }),
      ),
    );
  }

  async getStreamsByRoom(roomId: string) {
    return firstValueFrom(
      this.signalingService.getStreamsByRoom({ room_id: roomId }).pipe(
        map((response) => {
          if (!response || !response.streams) {
            return [];
          }

          const convertedStreams = response.streams.map((protoStream) => {
            return this.convertProtoStreamToStream(protoStream);
          });

          return convertedStreams;
        }),
      ),
    );
  }

  async connectTransport(
    transportId: string,
    dtlsParameters: mediasoupTypes.DtlsParameters,
    participant: Participant,
  ) {
    // Ensure participant has proper Map structure before serialization
    const participantData = {
      peer_id: participant.peer_id,
      socket_id: participant.socket_id,
      is_creator: participant.is_creator,
      time_arrive: participant.time_arrive,
      rtp_capabilities: participant.rtp_capabilities,
      // Convert Maps to objects for JSON serialization, they will be reconstructed on the other side
      transports:
        participant.transports instanceof Map
          ? Object.fromEntries(participant.transports)
          : participant.transports || {},
      producers:
        participant.producers instanceof Map
          ? Object.fromEntries(participant.producers)
          : participant.producers || {},
      consumers:
        participant.consumers instanceof Map
          ? Object.fromEntries(participant.consumers)
          : participant.consumers || {},
    };

    return firstValueFrom(
      this.signalingService
        .connectTransport({
          transport_id: transportId,
          dtls_parameters: JSON.stringify(dtlsParameters),
          participant_data: JSON.stringify(participantData),
        })
        .pipe(
          map((response) => {
            return {
              success: response.success,
              message: response.message,
              transport: JSON.parse(response.transport || '{}'),
            };
          }),
        ),
    );
  }

  removeParticipantMedia(roomId: string, participantId: string) {
    return this.signalingService
      .removeParticipantMedia({
        room_id: roomId,
        participant_id: participantId,
      })
      .pipe(map((response) => response.removed_stream_ids || []));
  }
  async createTransport(roomId: string) {
    return firstValueFrom(
      this.signalingService.createTransport({ room_id: roomId }).pipe(
        map((response) => {
          if (!response || !response.transport_data) {
            throw new Error('Failed to create transport');
          }
          try {
            const parsedData = JSON.parse(response.transport_data);
            // SFU service returns { transport: transportData }, so we need to extract the transport
            return parsedData;
          } catch (error) {
            console.error('Failed to parse transport data:', error);
            throw new Error('Invalid transport data');
          }
        }),
      ),
    );
  }
  async createProducer(data: {
    transportId: string;
    kind: string;
    rtpParameters: mediasoupTypes.RtpParameters;
    roomId: string;
    participantId: string;
    metadata?: any;
  }) {
    return firstValueFrom(
      this.signalingService
        .createProducer({
          transport_id: data.transportId,
          kind: data.kind,
          rtp_parameters: JSON.stringify(data.rtpParameters),
          room_id: data.roomId,
          metadata: JSON.stringify(data.metadata || {}),
          participant_data: JSON.stringify({ peerId: data.participantId }),
        })
        .pipe(
          map((response: any) => {
            if (!response) {
              throw new Error('No response from createProducer');
            }

            if (!response.success) {
              throw new Error(response?.message || 'Failed to create producer');
            }

            // Parse the data field if it's a JSON string
            let parsedData = {};
            if (response.data) {
              try {
                parsedData = JSON.parse(response.data);
              } catch (error) {
                console.error('Failed to parse createProducer data:', error);
              }
            }

            // Parse producer_data if it's a JSON string (from SFU service)
            let producerData: any = {};
            if (response.producer_data) {
              try {
                producerData = JSON.parse(response.producer_data);
                console.log(
                  '✅ [Signaling Client] Parsed producer_data:',
                  producerData,
                );
              } catch (error) {
                console.error(
                  '❌ [Signaling Client] Failed to parse producer_data:',
                  error,
                );
              }
            } else {
              console.log(
                '⚠️ [Signaling Client] No producer_data in response. Available fields:',
                Object.keys(response),
              );
            }

            // Response from signaling controller has format: { status, message, producer_id, data, success }
            const result = {
              producerId: response.producer_id || producerData.producer_id,
              producer: parsedData || producerData,
              streamId: producerData.streamId, // Get streamId from SFU service
              producer_data: response.producer_data, // Keep raw producer_data for fallback
            };
            console.log('✅ [Signaling Client] Final result:', result);
            return result;
          }),
        ),
    );
  }

  getIceServers() {
    return firstValueFrom(this.signalingService.getIceServers({}));
  }

  async saveStream(roomId: string, stream: Stream) {
    const protoStream = this.convertStreamToProtoStream(stream);
    return this.signalingService.saveStream({
      room_id: roomId,
      stream: protoStream,
    });
  }

  getStream(streamId: string) {
    return firstValueFrom(
      this.signalingService.getStream({ stream_id: streamId }).pipe(
        map((response) => {
          if (
            !response ||
            !response.success ||
            !response.data ||
            !response.data.stream
          ) {
            return { data: null, success: false };
          }
          return {
            data: {
              stream: this.convertProtoStreamToStream(response.data.stream),
            },
            success: true,
          };
        }),
      ),
    );
  }

  async removeStream(streamId: string, roomId: string) {
    return this.signalingService.removeStream({
      stream_id: streamId,
      room_id: roomId,
    });
  }

  async saveProducer(roomId: string, streamId: string, producer: any) {
    return this.signalingService.saveProducer({
      room_id: roomId,
      stream_id: streamId,
      producer_data: JSON.stringify(producer),
    });
  }

  getStreamByProducer(producerId: string) {
    return this.signalingService
      .getStreamByProducer({ producer_id: producerId })
      .pipe(map((protoStream) => this.convertProtoStreamToStream(protoStream)));
  }

  async saveProducerToStream(
    roomId: string,
    producerId: string,
    stream: Stream,
  ) {
    const protoStream = this.convertStreamToProtoStream(stream);
    return this.signalingService.saveProducerToStream({
      room_id: roomId,
      producer_id: producerId,
      stream: protoStream,
    });
  }

  async removeProducer(roomId: string, streamId: string) {
    return this.signalingService.removeProducer({
      room_id: roomId,
      stream_id: streamId,
    });
  }

  async createConsumer(data: {
    roomId: string;
    streamId: string;
    transportId: string;
    rtpCapabilities: mediasoupTypes.RtpCapabilities;
    participant: Participant;
  }) {
    // Ensure participant has proper Map structure before serialization
    const participantData = {
      peer_id: data.participant.peer_id,
      socket_id: data.participant.socket_id,
      is_creator: data.participant.is_creator,
      time_arrive:
        data.participant.time_arrive &&
        !isNaN(data.participant.time_arrive.getTime())
          ? data.participant.time_arrive.getTime()
          : Date.now(),
      rtp_capabilities: data.participant.rtp_capabilities,
      // Convert Maps to objects for JSON serialization, they will be reconstructed on the other side
      transports:
        data.participant.transports instanceof Map
          ? Object.fromEntries(data.participant.transports)
          : data.participant.transports || {},
      producers:
        data.participant.producers instanceof Map
          ? Object.fromEntries(data.participant.producers)
          : data.participant.producers || {},
      consumers:
        data.participant.consumers instanceof Map
          ? Object.fromEntries(data.participant.consumers)
          : data.participant.consumers || {},
    };

    return firstValueFrom(
      this.signalingService
        .createConsumer({
          room_id: data.roomId,
          stream_id: data.streamId,
          transport_id: data.transportId,
          rtp_capabilities: JSON.stringify(data.rtpCapabilities),
          participant_data: JSON.stringify(participantData),
        })
        .pipe(
          map((response: any) => {
            if (!response) {
              throw new Error('No response from createConsumer');
            }

            // Check both possible success indicators
            const isSuccess =
              response.success === true || response.status === 'success';

            if (!isSuccess) {
              console.error('CreateConsumer failed:', response);
              throw new Error(response?.message || 'Failed to create consumer');
            }

            // Parse consumer_data if it's a string
            let consumerData = response.data;
            if (response.consumer_data) {
              try {
                consumerData = JSON.parse(response.consumer_data);
              } catch (error) {
                console.error('Failed to parse consumer_data:', error);
                consumerData = response.data;
              }
            }

            // Return the consumer data with required fields
            const result = {
              success: true,
              data: {
                consumerId: consumerData?.consumerId,
                kind: consumerData?.kind || response.data?.kind,
                rtpParameters: consumerData?.rtpParameters,
                producerId: consumerData?.producerId,
                ...response.data,
              },
            };

            return result;
          }),
        ),
    );
  }

  async leaveRoom(data: {
    roomId: string;
    participantId: string;
    socketId: string;
  }) {
    return firstValueFrom(
      this.signalingService.leaveRoom({
        room_id: data.roomId,
        participant_id: data.participantId, // Fixed: use participant_id instead of peer_id
        socket_id: data.socketId,
      }),
    );
  }

  async handlePresence(data: {
    roomId: string;
    peerId: string;
    metadata: any;
  }) {
    return firstValueFrom(
      this.signalingService
        .handlePresence({
          room_id: data.roomId,
          peer_id: data.peerId,
          metadata: JSON.stringify(data.metadata),
        })
        .pipe(
          map((response) => ({
            status: response.status,
            message: response.message,
            data: {
              stream: this.convertProtoStreamToStream(response.data.stream),
              isUpdated: response.data.isUpdated,
            },
          })),
        ),
    );
  }
  getStreamByProducerId(producerId: string) {
    return firstValueFrom(
      this.signalingService
        .getStreamByProducer({ producer_id: producerId })
        .pipe(
          map((response) => ({
            stream: response || null,
          })),
        ),
    );
  }

  async resumeConsumer(data: {
    roomId: string;
    consumerId: string;
    participantId: string;
  }) {
    return firstValueFrom(
      this.signalingService
        .resumeConsumer({
          room_id: data.roomId,
          consumer_id: data.consumerId,
          participant_id: data.participantId,
        })
        .pipe(
          map((response: any) => {
            if (!response) {
              throw new Error('No response from resumeConsumer');
            }

            if (response.status !== 'success') {
              throw new Error(response?.message || 'Failed to resume consumer');
            }

            return {
              success: true,
              message: response.message,
            };
          }),
        ),
    );
  }

  async updateStream(data: {
    streamId: string;
    participantId: string;
    metadata: any;
    roomId: string;
  }) {
    return firstValueFrom(
      this.signalingService
        .updateStream({
          stream_id: data.streamId,
          participant_id: data.participantId,
          metadata: JSON.stringify(data.metadata),
          room_id: data.roomId,
        })
        .pipe(
          map((response) => {
            if (response.status !== 'success') {
              throw new Error(response.message || 'Failed to update stream');
            }

            return {
              success: true,
              message: response.message,
              data: response.data,
            };
          }),
        ),
    );
  }
}
