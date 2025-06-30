import { Injectable } from '@nestjs/common';
import { Participant, RoomPassword } from './interface';

@Injectable()
export class RoomService {
  private rooms = new Map<string, Map<string, Participant>>();
  private roomPasswords = new Map<string, RoomPassword>();

  /**
   * Checks if a room exists by its ID.
   * @param roomId - The ID of the room to check.
   * @returns An object indicating whether the room exists and its details if it does.
   */
  checkRoomExists(roomId: string) {
    const room = this.rooms.get(roomId);
    if (!room) return false;

    return true;
  }

  /**
   * Checks if a username is available in the specified room.
   * @param roomId - The ID of the room.
   * @param username - The username to check.
   * @returns True if the username is available, false otherwise.
   */
  isUsernameAvailable(
    roomId: string,
    username: string,
  ): {
    success: boolean;
    message: string;
    available: boolean;
  } {
    const room = this.rooms.get(roomId);
    if (!room)
      return {
        success: false,
        message: 'Room does not exist',
        available: false,
      };

    for (const participant of room.values()) {
      if (participant.peer_id === username) {
        return {
          success: false,
          message: 'Username is already taken',
          available: false,
        };
      }
    }
    return {
      success: true,
      message: 'Username is available',
      available: true,
    };
  }

  /**
   * Creates a new room with the specified ID and user ID.
   * @param userId - The ID of the user creating the room.
   * @param password - Optional password for the room.
   * @returns An object indicating the success of the operation and whether the user is the creator.
   */
  async createRoom(roomId: string) {
    this.rooms.set(roomId, new Map());
    return roomId;
  }

  /**
   * Sets a participant in the specified room.
   * @param roomId - The ID of the room.
   * @param peerId - The ID of the participant.
   * @param participant - The participant object to set.
   * @returns An object indicating the success of the operation.
   */ async getRoom(roomId: string) {
    const room = this.rooms.get(roomId);
    if (!room) {
      return null;
    }

    return {
      room_id: roomId,
      participants: Array.from(room.values()) || [],
      isLocked: this.roomPasswords.has(roomId),
    };
  }

  /**
   * Adds a participant to the specified room.
   * @param roomId - The ID of the room.
   * @param participant - The participant object to add.
   * @returns An object indicating the success of the operation.
   */
  async addParticipant(roomId: string, participant: Participant) {
    const room = this.rooms.get(roomId);
    if (!room) return null;

    // Ensure Maps are initialized for the participant
    if (!participant.transports) {
      participant.transports = new Map();
    }
    if (!participant.producers) {
      participant.producers = new Map();
    }
    if (!participant.consumers) {
      participant.consumers = new Map();
    }

    // Handle RTP capabilities properly - store as the actual object, not string
    if (
      participant.rtp_capabilities &&
      typeof participant.rtp_capabilities === 'string'
    ) {
      try {
        // Skip invalid string values
        if (
          participant.rtp_capabilities === '' ||
          participant.rtp_capabilities === '[object Object]' ||
          participant.rtp_capabilities === 'undefined' ||
          participant.rtp_capabilities === 'null'
        ) {
          participant.rtp_capabilities = undefined;
        } else {
          participant.rtp_capabilities = JSON.parse(
            participant.rtp_capabilities,
          );
        }
      } catch (error) {
        console.warn(
          'Failed to parse RTP capabilities, setting to undefined:',
          error,
        );
        participant.rtp_capabilities = undefined;
      }
    }

    // Ensure time_arrive is a Date object
    if (typeof participant.time_arrive === 'number') {
      participant.time_arrive = new Date(participant.time_arrive);
    } else if (!participant.time_arrive) {
      participant.time_arrive = new Date();
    }

    // Check if participant already exists (for socket_id updates)
    const existingParticipant = room.get(participant.peer_id);
    if (existingParticipant) {
      console.log(
        `👤 [Room] Updating existing participant in room ${roomId}:`,
        {
          peer_id: participant.peer_id,
          old_socket_id: existingParticipant.socket_id,
          new_socket_id: participant.socket_id,
          is_creator: participant.is_creator,
        },
      );

      // Update existing participant with new data (especially socket_id)
      existingParticipant.socket_id = participant.socket_id;
      existingParticipant.is_creator = participant.is_creator;

      // Keep existing Maps if they exist, otherwise use new ones
      if (!existingParticipant.transports)
        existingParticipant.transports = participant.transports;
      if (!existingParticipant.producers)
        existingParticipant.producers = participant.producers;
      if (!existingParticipant.consumers)
        existingParticipant.consumers = participant.consumers;

      // Update RTP capabilities if provided
      if (participant.rtp_capabilities) {
        existingParticipant.rtp_capabilities = participant.rtp_capabilities;
      }
    } else {
      console.log(`👤 [Room] Adding new participant to room ${roomId}:`, {
        peer_id: participant.peer_id,
        socket_id: participant.socket_id,
        is_creator: participant.is_creator,
      });

      room.set(participant.peer_id, participant);
    }

    console.log(
      `👤 [Room] Room ${roomId} participants after add/update:`,
      Array.from(room.keys()),
    );

    return {
      status: 'success',
      message: 'Participant added successfully',
    };
  }

  /**
   * Removes a participant from the specified room.
   * @param roomId - The ID of the room.
   * @param peerId - The ID of the participant to remove.
   * @returns An object indicating the success of the operation.
   */
  getParticipantByPeerId(peerId: string, roomId: string): Participant | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    return room.get(peerId) || null;
  }

  getParticipantBySocketId(
    socketId: string,
  ): { participant: Participant; roomId: string } | null {
    console.log(
      `[RoomService] Searching for participant with socket ID: ${socketId}`,
    );

    for (const [roomId, room] of this.rooms) {
      console.log(
        `[RoomService] Checking room ${roomId} with ${room.size} participants`,
      );

      for (const [peerId, participant] of room) {
        console.log(
          `[RoomService] Checking participant ${peerId} with socket_id: ${participant.socket_id}`,
        );

        if (participant.socket_id === socketId) {
          console.log(
            `[RoomService] Found participant ${peerId} in room ${roomId} with matching socket_id`,
          );
          return { participant, roomId };
        }
      }
    }

    console.log(
      `[RoomService] No participant found with socket ID: ${socketId}`,
    );
    return null;
  }

  async removeParticipant(roomId: string, peerId: string) {
    const room = this.rooms.get(roomId);
    if (!room) return false;

    if (room.has(peerId)) {
      room.delete(peerId);
      return true;
    }
    return false;
  }
  async setTransport(roomId: string, transport: any, peerId: string) {
    const room = this.rooms.get(roomId);
    if (!room) return false;

    const participant = room.get(peerId);
    if (!participant) return false;

    // Ensure transports Map is initialized
    if (!participant.transports) {
      participant.transports = new Map();
    }

    participant.transports.set(transport.id, transport);
    return true;
  }
  async setProducer(roomId: string, producer: any, peerId: string) {
    const room = this.rooms.get(roomId);
    if (!room) return false;

    const participant = room.get(peerId);
    if (!participant) return false;

    // Ensure producers Map is initialized
    if (!participant.producers) {
      participant.producers = new Map();
    }

    participant.producers.set(producer.id, producer);
    return true;
  }

  async getParticipantRoom(peerId: string): Promise<string | null> {
    for (const [roomId, room] of this.rooms) {
      if (room.has(peerId)) {
        return roomId;
      }
    }
    return null;
  }

  async removeProducerFromParticipant(
    roomId: string,
    peerId: string,
    producerId: string,
  ): Promise<boolean> {
    const room = this.rooms.get(roomId);
    if (!room) return false;

    const participant = room.get(peerId);
    if (!participant) return false;

    if (participant.producers.has(producerId)) {
      participant.producers.delete(producerId);
      return true;
    }
    return false;
  }

  async leaveRoom(
    roomId: string,
    peerId: string,
  ): Promise<{
    success: boolean;
    newCreator?: Participant;
    isRoomEmpty: boolean;
    removedParticipant?: Participant;
  }> {
    console.log(
      `🚪 [Room] Attempting to remove participant: ${peerId} from room: ${roomId}`,
    );

    const room = this.rooms.get(roomId);
    if (!room) {
      console.log(`❌ [Room] Room ${roomId} not found`);
      return {
        success: false,
        isRoomEmpty: true,
      };
    }

    console.log(
      `🚪 [Room] Room ${roomId} current participants:`,
      Array.from(room.keys()),
    );
    console.log(`🚪 [Room] Looking for participant with peerId: ${peerId}`);

    const participant = room.get(peerId);
    if (!participant) {
      console.log(
        `❌ [Room] Participant ${peerId} not found in room ${roomId}`,
      );
      console.log(`❌ [Room] Available participants:`, Array.from(room.keys()));
      return {
        success: false,
        isRoomEmpty: room.size === 0,
      };
    }

    console.log(
      `✅ [Room] Found participant ${peerId}, removing from room ${roomId}`,
    );
    const wasCreator = participant.is_creator;

    // Close all transports for this participant
    for (const transport of participant.transports.values()) {
      transport.close();
    }

    // Remove participant from room
    room.delete(peerId);
    console.log(
      `✅ [Room] Successfully removed participant ${peerId} from room ${roomId}`,
    );
    console.log(
      `📊 [Room] Room ${roomId} now has ${room.size} participants:`,
      Array.from(room.keys()),
    );

    let newCreator: Participant | undefined = undefined;
    const isRoomEmpty = room.size === 0;

    // Handle creator change if the leaving participant was creator and room is not empty
    if (wasCreator && !isRoomEmpty) {
      // Find participant with earliest timeArrive (longest in room)
      const participants = Array.from(room.values());
      const longestUser = participants.reduce((max, current) => {
        return new Date(current.time_arrive) < new Date(max.time_arrive)
          ? current
          : max;
      });

      if (longestUser) {
        longestUser.is_creator = true;
        newCreator = longestUser;
      }
    }

    // If room is empty, clean up
    if (isRoomEmpty) {
      console.log(`🧹 [Room] Room ${roomId} is now empty, cleaning up`);
      this.rooms.delete(roomId);
    }

    console.log(
      `🏁 [Room] leaveRoom completed for ${peerId}. Success: true, IsRoomEmpty: ${isRoomEmpty}, NewCreator: ${newCreator?.peer_id || 'none'}`,
    );

    return {
      success: true,
      newCreator,
      isRoomEmpty,
      removedParticipant: participant,
    };
  }

  /**
   * Updates participant RTP capabilities
   * @param peerId - The ID of the participant
   * @param rtpCapabilities - The RTP capabilities to set
   * @returns An object indicating the success of the operation
   */
  async updateParticipantRtpCapabilities(peerId: string, rtpCapabilities: any) {
    try {
      // Find the participant across all rooms
      for (const [roomId, room] of this.rooms.entries()) {
        const participant = room.get(peerId);
        if (participant) {
          // Update the participant's RTP capabilities - store as object, not string
          participant.rtp_capabilities = rtpCapabilities;
          room.set(peerId, participant);

          return {
            success: true,
            message: 'RTP capabilities updated successfully',
            roomId: roomId,
          };
        }
      }

      return {
        success: false,
        error: 'Participant not found in any room',
      };
    } catch (error) {
      console.error('Error updating participant RTP capabilities:', error);
      return {
        success: false,
        error: 'Failed to update RTP capabilities',
      };
    }
  }
}
