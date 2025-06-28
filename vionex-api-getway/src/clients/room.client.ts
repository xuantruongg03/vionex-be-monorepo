import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';
import { Participant, RoomGrpcService } from '../interfaces/interface';

@Injectable()
export class RoomClientService implements OnModuleInit {
  private roomService: RoomGrpcService;

  constructor(@Inject('ROOM_SERVICE') private client: ClientGrpc) {}

  onModuleInit() {
    this.roomService = this.client.getService<RoomGrpcService>('RoomService');
  }

  async isRoomExists(roomId: string): Promise<boolean> {
    try {
      const response = await firstValueFrom(
        this.roomService.isRoomExists({ room_id: roomId }),
      );
      return response.is_exists;
    } catch (error) {
      console.log(`Room with ID ${roomId} does not exist:`, error);
      throw new Error(`Room with ID ${roomId} does not exist`);
    }
  }

  async isUsernameAvailable(
    roomId: string,
    username: string,
  ): Promise<{ success: boolean; message?: string }> {
    return firstValueFrom(
      this.roomService.isUsernameAvailable({
        room_id: roomId,
        username,
      }),
    );
  }

  async createRoom(roomId: string) {
    try {
      const response = await firstValueFrom(
        this.roomService.createRoom({ room_id: roomId }),
      );
      return { data: { roomId: response.room_id } };
    } catch (error) {
      console.error(`Error creating room:`, error);
      throw new Error(`Failed to create room`);
    }
  }

  async joinRoom(roomId: string, userId: string) {
    const response = await firstValueFrom(
      this.roomService.joinRoom({ room_id: roomId, user_id: userId }),
    );
    return response;
  }

  async isRoomLocked(roomId: string): Promise<boolean> {
    try {
      const response = await firstValueFrom(
        this.roomService.isRoomLocked({ room_id: roomId }),
      );
      return response.locked;
    } catch (error) {
      console.error(`Error checking if room ${roomId} is locked:`, error);
      throw new Error(`Failed to check if room ${roomId} is locked`);
    }
  }

  async verifyRoomPassword(roomId: string, password: string): Promise<boolean> {
    try {
      const response = await firstValueFrom(
        this.roomService.verifyRoomPassword({ room_id: roomId, password }),
      );
      return response.valid;
    } catch (error) {
      console.error(`Error verifying password for room ${roomId}:`, error);
      throw new Error(`Failed to verify password for room ${roomId}`);
    }
  }

  async getRoom(roomId: string) {
    try {
      const response = await firstValueFrom(
        this.roomService.getRoom({ room_id: roomId }),
      );

      // Ensure participants field always exists
      if (response.data && !response.data.participants) {
        response.data.participants = [];
      }

      return response;
    } catch (error) {
      throw new Error(`Room with ID ${roomId} not found`);
    }
  }
  async setParticipant(roomId: string, participant: Participant) {
    try {
      console.log(`[RoomClient] Setting participant in room ${roomId}:`, {
        peer_id: participant.peer_id,
        socket_id: participant.socket_id,
        is_creator: participant.is_creator,
      });
      await firstValueFrom(
        this.roomService.setParticipant({
          room_id: roomId,
          participant: {
            socket_id: participant.socket_id,
            peer_id: participant.peer_id,
            transports: {},
            producers: {},
            consumers: {},
            is_creator: participant.is_creator,
            time_arrive: participant.time_arrive.getTime(),
            rtp_capabilities: participant.rtp_capabilities
              ? typeof participant.rtp_capabilities === 'string'
                ? participant.rtp_capabilities
                : JSON.stringify(participant.rtp_capabilities)
              : '',
          },
        }),
      );
      console.log(
        `[RoomClient] Participant ${participant.peer_id} set successfully in room ${roomId}`,
      );
    } catch (error) {
      console.error(
        `[RoomClient] Error setting participant for room ${roomId}:`,
        error,
      );
      throw new Error(`Failed to set participant for room ${roomId}`);
    }
  }

  async getParticipants(roomId: string) {
    try {
      const response: any = await firstValueFrom(
        this.roomService.getParticipants({ room_id: roomId }),
      );
      if (!response || !response.participants) {
        console.warn(`No participants found for room ${roomId}`);
        return [];
      }

      return response?.participants.map((p: any) => ({
        socket_id: p.socket_id || p.socketId,
        peer_id: p.peer_id || p.peerId,
        transports: new Map(),
        producers: new Map(),
        consumers: new Map(),
        is_creator: p.is_creator !== undefined ? p.is_creator : p.isCreator,
        time_arrive: new Date(p.time_arrive || p.timeArrive),
        rtp_capabilities: this.safeParseRtpCapabilities(
          p.rtp_capabilities || p.rtpCapabilities,
        ),
      }));
    } catch (error) {
      console.error(`Error getting participants for room ${roomId}:`, error);
      throw new Error(`Failed to get participants for room ${roomId}`);
    }
  }

  async removeParticipant(roomId: string, peerId: string) {
    try {
      await firstValueFrom(
        this.roomService.removeParticipant({
          room_id: roomId,
          peer_id: peerId,
        }),
      );
    } catch (error) {
      console.error(
        `Error removing participant ${peerId} from room ${roomId}:`,
        error,
      );
      throw new Error(
        `Failed to remove participant ${peerId} from room ${roomId}`,
      );
    }
  }

  async setTransport(roomId: string, transport: any, peerId: string) {
    try {
      if (!transport) {
        console.error('Transport is undefined or null');
        throw new Error('Transport data is required');
      }

      await firstValueFrom(
        this.roomService.setTransport({
          room_id: roomId,
          transport_data: JSON.stringify(transport), // Fixed field name
          peer_id: peerId,
        }),
      );
    } catch (error) {
      console.error(`Error setting transport for room ${roomId}:`, error);
      throw new Error(`Failed to set transport for room ${roomId}`);
    }
  }

  async setProducer(roomId: string, producer: any, peerId: string) {
    try {
      await firstValueFrom(
        this.roomService.setProducer({
          room_id: roomId,
          producer: JSON.stringify(producer),
          peer_id: peerId,
        }),
      );
    } catch (error) {
      console.error(`Error setting producer for room ${roomId}:`, error);
      throw new Error(`Failed to set producer for room ${roomId}`);
    }
  }

  async getParticipantRoom(peerId: string): Promise<string | null> {
    try {
      const response = await firstValueFrom(
        this.roomService.getParticipantRoom({ peer_id: peerId }),
      );
      console.log(
        `[RoomClient] Room lookup for participant ${peerId}:`,
        response.room_id || 'NO_ROOM_FOUND',
      );
      return response.room_id || null;
    } catch (error) {
      console.error(`Error getting room for participant ${peerId}:`, error);
      return null;
    }
  }

  async removeProducerFromParticipant(
    roomId: string,
    peerId: string,
    producerId: string,
  ) {
    try {
      const response = await firstValueFrom(
        this.roomService.removeProducerFromParticipant({
          room_id: roomId,
          peer_id: peerId,
          producer_id: producerId,
        }),
      );
      return response;
    } catch (error) {
      console.error('Error removing producer from participant:', error);
      throw new Error('Failed to remove producer from participant');
    }
  }
  async getParticipantByPeerId(
    roomId: string,
    peerId: string,
  ): Promise<Participant | null> {
    try {
      const response: any = await firstValueFrom(
        this.roomService.getParticipantByPeerId({
          peer_id: peerId,
          room_id: roomId,
        }),
      );
      console.log(
        `[RoomClient] Raw participant response:`,
        JSON.stringify(response, null, 2),
      );

      // Handle different response formats
      if (!response) {
        console.log(
          `[RoomClient] No response received for participant ${peerId}`,
        );
        return null;
      }

      // If response is empty object, also return null
      if (Object.keys(response).length === 0) {
        console.log(
          `[RoomClient] Empty response received for participant ${peerId}`,
        );
        return null;
      }

      // Try to extract participant data from response
      let participant: any = null;
      if (response.participant) {
        participant = response.participant;
      } else if (response.peer_id || response.peerId) {
        participant = response;
      } else {
        console.log(
          `[RoomClient] Invalid response format for participant ${peerId}:`,
          response,
        );
        return null;
      }

      // Convert to our Participant format
      const result: Participant = {
        socket_id: participant.socket_id || participant.socketId || '',
        peer_id: participant.peer_id || participant.peerId || peerId,
        transports: participant.transports
          ? new Map(Object.entries(participant.transports))
          : new Map(),
        producers: participant.producers
          ? new Map(Object.entries(participant.producers))
          : new Map(),
        consumers: participant.consumers
          ? new Map(Object.entries(participant.consumers))
          : new Map(),
        is_creator: participant.is_creator || participant.isCreator || false,
        time_arrive: participant.time_arrive
          ? typeof participant.time_arrive === 'number'
            ? new Date(participant.time_arrive)
            : participant.time_arrive.low !== undefined
              ? new Date(
                  participant.time_arrive.low +
                    participant.time_arrive.high * Math.pow(2, 32),
                )
              : new Date(participant.time_arrive)
          : new Date(),
        rtp_capabilities: this.safeParseRtpCapabilities(
          participant.rtp_capabilities || participant.rtpCapabilities,
        ),
      };

      console.log(`[RoomClient] Converted participant:`, {
        peer_id: result.peer_id,
        socket_id: result.socket_id,
        is_creator: result.is_creator,
      });

      return result;
    } catch (error) {
      console.error(`[RoomClient] Error getting participant ${peerId}:`, error);
      throw new Error(`Failed to get participant ${peerId}`);
    }
  }

  // Find participant by socket ID across all rooms (for disconnect handling)
  async findParticipantBySocketId(socketId: string): Promise<{ peerId: string; roomId: string } | null> {
    try {
      // This method needs to be implemented in the Room service
      // For now, we'll return null and let the Gateway handle it with fallback logic
      console.log(`[RoomClient] findParticipantBySocketId not implemented in Room service, returning null`);
      return null;
    } catch (error) {
      console.error(`[RoomClient] Error finding participant by socket ID ${socketId}:`, error);
      return null;
    }
  }

  async updateParticipantRtpCapabilities(peerId: string, rtpCapabilities: any) {
    try {
      const response = await firstValueFrom(
        this.roomService.updateParticipantRtpCapabilities({
          peer_id: peerId,
          rtp_capabilities: JSON.stringify(rtpCapabilities),
        }),
      );
      return response;
    } catch (error) {
      console.error('Error updating participant RTP capabilities:', error);
      return { success: false, error: 'Failed to update RTP capabilities' };
    }
  }

  async leaveRoom(data: {
    roomId: string;
    participantId: string;
    socketId: string;
  }) {
    try {
      const response = await firstValueFrom(
        this.roomService.leaveRoom({
          room_id: data.roomId,
          participant_id: data.participantId,
          socket_id: data.socketId,
        }),
      );
      return {
        success: true,
        data: {
          newCreator: response.new_creator_data
            ? JSON.parse(response.new_creator_data)
            : null,
          isRoomEmpty: response.is_room_empty || false,
        },
      };
    } catch (error) {
      console.error('Error leaving room:', error);
      throw new Error('Failed to leave room');
    }
  }

  private safeParseRtpCapabilities(data: any): any {
    if (!data) return undefined;

    // If it's already an object (but not a string representation), return it as is
    if (typeof data === 'object' && data !== null) {
      // Check if it's already a proper RTP capabilities object
      if (data.codecs || data.headerExtensions) {
        // console.log('Returning valid RTP capabilities object');
        return data;
      }
      // If it's a generic object that was incorrectly passed, return undefined
      console.warn(
        'RTP capabilities object does not have expected structure:',
        data,
      );
      return undefined;
    }

    // If it's a string, try to parse it
    if (typeof data === 'string') {
      if (
        data === '' ||
        data === 'undefined' ||
        data === 'null' ||
        data === '[object Object]'
      ) {
        // console.log('Skipping invalid string data:', data);
        return undefined;
      }

      try {
        const parsed = JSON.parse(data);
        // console.log('Successfully parsed RTP capabilities from string');
        return parsed;
      } catch (error) {
        console.warn(
          'Failed to parse RTP capabilities string:',
          error,
          'Data:',
          data,
        );
        return undefined;
      }
    }

    // console.log('Unknown data type, returning undefined');
    return undefined;
  }
}
