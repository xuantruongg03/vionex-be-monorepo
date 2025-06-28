import { Controller } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';
import { isValidRoomId } from './common/validate';
import {
  CreateRoomRequest,
  CreateRoomResponse,
  GetParticipantByPeerIdResponse,
  GetParticipantBySocketIdResponse,
  GetParticipantRoomRequest,
  GetParticipantRoomResponse,
  GetParticipantsRequest,
  GetParticipantsResponse,
  GetRoomRequest,
  GetRoomResponse,
  IsRoomExistsRequest,
  IsRoomExistsResponse,
  IsRoomLockedRequest,
  IsRoomLockedResponse,
  JoinRoomRequest,
  JoinRoomResponse,
  LeaveRoomRequest,
  LeaveRoomResponse,
  RemoveParticipantRequest,
  RemoveParticipantResponse,
  RemoveProducerFromParticipantRequest,
  RemoveProducerFromParticipantResponse,
  SetParticipantRequest,
  SetParticipantResponse,
  SetProducerRequest,
  SetProducerResponse,
  SetTransportRequest,
  SetTransportResponse,
  VerifyRoomPasswordRequest,
  VerifyRoomPasswordResponse,
} from './interface';
import { RoomService } from './room.service';

@Controller()
export class RoomGrpcController {
  constructor(private readonly roomService: RoomService) {}

  @GrpcMethod('RoomService', 'IsRoomExists')
  async isRoomExists(data: IsRoomExistsRequest): Promise<IsRoomExistsResponse> {
    try {
      if (!data.room_id || !isValidRoomId(data.room_id)) {
        return { is_exists: false };
      }

      const exists = this.roomService.checkRoomExists(data.room_id);
      return { is_exists: exists };
    } catch (error) {
      return { is_exists: false };
    }
  }

  @GrpcMethod('RoomService', 'CreateRoom')
  async createRoom(data: CreateRoomRequest): Promise<CreateRoomResponse> {
    try {
      const roomId = data.room_id;
      await this.roomService.createRoom(roomId);
      return {
        room_id: roomId,
        message: 'Room created successfully',
        success: true,
      };
    } catch (error) {
      return {
        room_id: '',
        message: 'Failed to create room',
        success: false,
      };
    }
  }

  @GrpcMethod('RoomService', 'JoinRoom')
  async joinRoom(data: JoinRoomRequest): Promise<JoinRoomResponse> {
    try {
      if (!data.room_id || !isValidRoomId(data.room_id)) {
        return {
          success: false,
          message: 'Invalid room ID',
        };
      }

      const exists = this.roomService.checkRoomExists(data.room_id);
      if (!exists) {
        return {
          success: false,
          message: 'Room does not exist',
        };
      }

      // Add user to room logic here if needed
      return {
        success: true,
        message: 'Successfully joined room',
      };
    } catch (error) {
      console.error(`Error joining room ${data.room_id}:`, error);
      return {
        success: false,
        message: 'Failed to join room',
      };
    }
  }

  @GrpcMethod('RoomService', 'IsUsernameAvailable')
  async isUsernameAvailable(data: {
    room_id: string;
    username: string;
  }): Promise<{ success: boolean; message?: string }> {
    try {
      if (!data.room_id || !isValidRoomId(data.room_id)) {
        return { success: false, message: 'Invalid room ID' };
      }

      if (!data.username || data.username.trim() === '') {
        return { success: false, message: 'Username cannot be empty' };
      }

      const isAvailable = this.roomService.isUsernameAvailable(
        data.room_id,
        data.username,
      );
      if (!isAvailable.success) {
        return { success: false, message: isAvailable.message };
      }

      return { success: isAvailable.success, message: isAvailable.message };
    } catch (error) {
      console.error(`Error checking username availability:`, error);
      return {
        success: false,
        message: 'Error checking username availability',
      };
    }
  }

  @GrpcMethod('RoomService', 'IsRoomLocked')
  async isRoomLocked(data: IsRoomLockedRequest): Promise<IsRoomLockedResponse> {
    try {
      const room = this.roomService.getRoom(data.room_id);
      // For now, always return false as room doesn't have locked property
      return { locked: false };
    } catch (error) {
      console.error(
        `Error checking room lock status for ID ${data.room_id}:`,
        error,
      );
      return { locked: false };
    }
  }

  @GrpcMethod('RoomService', 'VerifyRoomPassword')
  async verifyRoomPassword(
    data: VerifyRoomPasswordRequest,
  ): Promise<VerifyRoomPasswordResponse> {
    try {
      // Implement password verification logic
      // For now, return true as placeholder
      return { valid: true };
    } catch (error) {
      console.error(`Error verifying room password:`, error);
      return { valid: false };
    }
  }

  @GrpcMethod('RoomService', 'GetRoom')
  async getRoom(data: GetRoomRequest): Promise<GetRoomResponse> {
    try {
      const room = await this.roomService.getRoom(data.room_id);
      if (!room) {
        return { data: null, success: false };
      }
      const participants = room.participants || [];

      // Serialize participants for gRPC transmission
      const serializedParticipants = participants.map((participant) => ({
        socket_id: participant.socket_id,
        peer_id: participant.peer_id,
        transports: {}, // Maps will be reconstructed on the client side
        producers: {}, // Maps will be reconstructed on the client side
        consumers: {}, // Maps will be reconstructed on the client side
        is_creator: participant.is_creator,
        time_arrive: participant.time_arrive,
        rtp_capabilities: participant.rtp_capabilities
          ? typeof participant.rtp_capabilities === 'string'
            ? participant.rtp_capabilities
            : JSON.stringify(participant.rtp_capabilities)
          : '',
      }));

      const response = {
        data: {
          room_id: room.room_id,
          participants: serializedParticipants as any,
          isLocked: room.isLocked,
        },
        success: true,
      };

      return response;
    } catch (error) {
      console.error(`Error getting room ${data.room_id}:`, error);
      return { data: null, success: false };
    }
  }

  @GrpcMethod('RoomService', 'SetParticipant')
  async setParticipant(
    data: SetParticipantRequest,
  ): Promise<SetParticipantResponse> {
    try {
      const result = await this.roomService.addParticipant(
        data.room_id,
        data.participant,
      );
      return {
        success: result !== null,
        message:
          result !== null
            ? 'Participant added successfully'
            : 'Failed to add participant',
      };
    } catch (error) {
      console.error(`Error setting participant:`, error);
      return {
        success: false,
        message: 'Failed to add participant',
      };
    }
  }

  @GrpcMethod('RoomService', 'GetParticipants')
  async getParticipants(
    data: GetParticipantsRequest,
  ): Promise<GetParticipantsResponse> {
    try {
      const room = await this.roomService.getRoom(data.room_id);
      return { participants: room?.participants || [] };
    } catch (error) {
      console.error(
        `Error getting participants for room ${data.room_id}:`,
        error,
      );
      return { participants: [] };
    }
  }

  @GrpcMethod('RoomService', 'GetParticipantByPeerId')
  async getParticipantByPeerId(data: {
    peer_id: string;
    room_id: string;
  }): Promise<GetParticipantByPeerIdResponse> {
    try {
      const participant = this.roomService.getParticipantByPeerId(
        data.peer_id,
        data.room_id,
      );

      if (!participant) {
        return { participant: null };
      }

      // Serialize participant for gRPC transmission
      const serializedParticipant = {
        socket_id: participant.socket_id,
        peer_id: participant.peer_id,
        transports: {}, // Maps will be reconstructed on the client side
        producers: {}, // Maps will be reconstructed on the client side
        consumers: {}, // Maps will be reconstructed on the client side
        is_creator: participant.is_creator,
        time_arrive: participant.time_arrive,
        rtp_capabilities: participant.rtp_capabilities
          ? typeof participant.rtp_capabilities === 'string'
            ? participant.rtp_capabilities
            : JSON.stringify(participant.rtp_capabilities)
          : '',
      };

      return { participant: serializedParticipant as any };
    } catch (error) {
      console.error(
        `Error getting participant by peer ID ${data.peer_id}:`,
        error,
      );
      return { participant: null };
    }
  }

  @GrpcMethod('RoomService', 'GetParticipantBySocketId')
  async getParticipantBySocketId(
    data: any,
  ): Promise<GetParticipantBySocketIdResponse> {
    try {
      const participant = this.roomService.getParticipantBySocketId(
        data.socket_id,
      );
      return { participant };
    } catch (error) {
      console.error(
        `Error getting participant by socket ID ${data.socket_id}:`,
        error,
      );
      return { participant: null };
    }
  }

  @GrpcMethod('RoomService', 'RemoveParticipant')
  async removeParticipant(
    data: RemoveParticipantRequest,
  ): Promise<RemoveParticipantResponse> {
    try {
      const success = await this.roomService.removeParticipant(
        data.room_id,
        data.peer_id,
      );
      return {
        success,
        message: success
          ? 'Participant removed successfully'
          : 'Failed to remove participant',
      };
    } catch (error) {
      console.error(`Error removing participant:`, error);
      return {
        success: false,
        message: 'Failed to remove participant',
      };
    }
  }

  @GrpcMethod('RoomService', 'SetTransport')
  async setTransport(data: SetTransportRequest): Promise<SetTransportResponse> {
    try {
      if (
        !data.transport_data ||
        data.transport_data === 'undefined' ||
        data.transport_data === 'null'
      ) {
        return {
          success: false,
          message: 'Invalid transport data provided',
        };
      }

      // Parse transport data and set it
      const transportData = JSON.parse(data.transport_data);
      const success = await this.roomService.setTransport(
        data.room_id,
        transportData,
        data.peer_id,
      );
      return {
        success,
        message: success
          ? 'Transport set successfully'
          : 'Failed to set transport',
      };
    } catch (error) {
      console.error(`Error setting transport:`, error);
      return {
        success: false,
        message: 'Failed to set transport',
      };
    }
  }

  @GrpcMethod('RoomService', 'SetProducer')
  async setProducer(data: SetProducerRequest): Promise<SetProducerResponse> {
    try {
      // Parse producer data and set it
      const producerData = JSON.parse(data.producer_data);
      const success = await this.roomService.setProducer(
        data.room_id,
        producerData,
        data.peer_id,
      );
      return {
        success,
        message: success
          ? 'Producer set successfully'
          : 'Failed to set producer',
      };
    } catch (error) {
      console.error(`Error setting producer:`, error);
      return {
        success: false,
        message: 'Failed to set producer',
      };
    }
  }

  @GrpcMethod('RoomService', 'GetParticipantRoom')
  async getParticipantRoom(
    data: GetParticipantRoomRequest,
  ): Promise<GetParticipantRoomResponse> {
    try {
      const roomId = await this.roomService.getParticipantRoom(data.peer_id);
      return { room_id: roomId || '' };
    } catch (error) {
      console.error(`Error getting participant room:`, error);
      return { room_id: '' };
    }
  }

  @GrpcMethod('RoomService', 'RemoveProducerFromParticipant')
  async removeProducerFromParticipant(
    data: RemoveProducerFromParticipantRequest,
  ): Promise<RemoveProducerFromParticipantResponse> {
    try {
      const success = await this.roomService.removeProducerFromParticipant(
        data.room_id,
        data.peer_id,
        data.producer_id,
      );
      return {
        success,
        message: success
          ? 'Producer removed successfully'
          : 'Failed to remove producer',
      };
    } catch (error) {
      console.error(`Error removing producer from participant:`, error);
      return {
        success: false,
        message: 'Failed to remove producer',
      };
    }
  }

  @GrpcMethod('RoomService', 'LeaveRoom')
  async leaveRoom(data: LeaveRoomRequest): Promise<LeaveRoomResponse> {
    try {
      const result = await this.roomService.leaveRoom(
        data.room_id,
        data.participant_id,
      );

      return {
        success: result.success,
        message: result.success
          ? 'Participant left room successfully'
          : 'Failed to leave room',
        removed_streams: [],
        new_creator: result.newCreator ? result.newCreator.peer_id : null,
        is_room_empty: result.isRoomEmpty,
        participant_id: data.participant_id,
      };
    } catch (error) {
      console.error(`Error leaving room:`, error);
      return {
        success: false,
        message: 'Failed to leave room',
        removed_streams: [],
        new_creator: null,
        is_room_empty: false,
        participant_id: data.participant_id,
      };
    }
  }

  @GrpcMethod('RoomService', 'UpdateParticipantRtpCapabilities')
  async updateParticipantRtpCapabilities(data: {
    peer_id: string;
    rtp_capabilities: string;
  }) {
    try {
      const rtpCapabilities = JSON.parse(data.rtp_capabilities);
      const result = await this.roomService.updateParticipantRtpCapabilities(
        data.peer_id,
        rtpCapabilities,
      );

      return {
        success: result.success,
        message: result.message || result.error,
        error: result.error,
      };
    } catch (error) {
      console.error('Error updating participant RTP capabilities:', error);
      return {
        success: false,
        message: 'Failed to update RTP capabilities',
        error: error.message,
      };
    }
  }
}
