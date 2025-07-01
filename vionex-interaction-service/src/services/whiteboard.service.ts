import { Injectable } from '@nestjs/common';
import { PositionMouse, MouseUser } from '../interfaces/whiteboard.inteface';
import { RoomClientService } from '../clients/room.client';

@Injectable()
export class WhiteboardService {
  private whiteboardData = new Map<string, any>();
  private positionMouse = new Map<string, Map<string, MouseUser>>();
  private whiteboardPermissions = new Map<string, string[]>();

  constructor(private readonly roomClient: RoomClientService) {}

  // Whiteboard data management
  updateWhiteboardData(roomId: string, elements: any[], state: any) {
    // Check if elements is valid
    if (!elements || !Array.isArray(elements)) {
      console.warn(
        `[Whiteboard] Invalid elements received for room ${roomId}:`,
        elements,
      );
      return {
        elements: [],
        state,
        updatedAt: new Date().toISOString(),
      };
    }

    // Validate and fix elements before saving
    const validatedElements = elements.map((element) => {
      if (element.type === 'freedraw' && !element.points) {
        console.warn(
          `[Whiteboard] Freedraw element ${element.id} missing points property, adding empty array`,
        );
        return {
          ...element,
          points: [], // Add empty points array to prevent crash
        };
      }
      return element;
    });

    const data = {
      elements: validatedElements,
      state,
      updatedAt: new Date().toISOString(),
    };
    this.whiteboardData.set(roomId, data);
    return data;
  }

  getWhiteboardData(roomId: string) {
    return this.whiteboardData.get(roomId) || null;
  }

  clearWhiteboard(roomId: string) {
    this.whiteboardData.set(roomId, {
      elements: [],
      state: null,
      updatedAt: new Date().toISOString(),
    });
    return true;
  }

  // Permissions management
  updatePermissions(roomId: string, allowedUsers: string[]) {
    console.log(
      `[WhiteboardService] Updating permissions for room ${roomId}:`,
      allowedUsers,
    );

    // Note: We store exactly what's sent. Creator permissions are handled in the frontend logic.
    // Frontend should always check: isCreator || allowedUsers.includes(username)
    this.whiteboardPermissions.set(roomId, allowedUsers);
    return {
      success: true,
      allowed_users: allowedUsers,
    };
  }

  getPermissions(roomId: string) {
    const permissions = this.whiteboardPermissions.get(roomId) || [];
    console.log(
      `[WhiteboardService] Getting permissions for room ${roomId}:`,
      permissions,
    );
    return {
      success: true,
      allowed_users: permissions,
    };
  }

  // Initialize permissions for a new room with creator
  initializeRoomPermissions(roomId: string, creatorPeerId: string) {
    // Don't add creator to allowed_users by default, but ensure they can draw
    // The canUserDraw method will handle creator permission check
    if (!this.whiteboardPermissions.has(roomId)) {
      this.whiteboardPermissions.set(roomId, []);
    }

    // Initialize empty whiteboard data if not exists
    if (!this.whiteboardData.has(roomId)) {
      this.whiteboardData.set(roomId, {
        elements: [],
        state: {},
        updatedAt: new Date().toISOString(),
      });
    }
  }

  async canUserDraw(roomId: string, peerId: string): Promise<boolean> {
    try {
      console.log(
        `[WhiteboardService] Checking draw permission for ${peerId} in room ${roomId}`,
      );

      // First check if user has explicit permission
      const permissions = this.whiteboardPermissions.get(roomId) || [];
      console.log(`[WhiteboardService] Current permissions:`, permissions);

      if (permissions.includes(peerId)) {
        console.log(
          `[WhiteboardService] User ${peerId} has explicit permission`,
        );
        return true;
      }

      // Then check if user is creator by getting participant info from room service
      console.log(`[WhiteboardService] Checking creator status for ${peerId}`);
      const participant = await this.roomClient.getParticipantByPeerId(
        roomId,
        peerId,
      );

      console.log(`[WhiteboardService] Participant info:`, participant);

      if (participant && participant.is_creator) {
        console.log(`[WhiteboardService] User ${peerId} is creator`);
        return true;
      }

      // Additional check: if permissions array is empty, assume this is a new room
      // and allow the first user to draw (likely the creator)
      if (permissions.length === 0) {
        console.log(
          `[WhiteboardService] Permissions empty, checking fallback for ${peerId}`,
        );
        // If we can't determine creator status but permissions are empty,
        // we could allow the user to draw as a fallback
        // This handles cases where room service is not accessible
        const isCreatorOrFallback = participant?.is_creator || false;
        console.log(
          `[WhiteboardService] Fallback result: ${isCreatorOrFallback}`,
        );
        return isCreatorOrFallback;
      }

      console.log(`[WhiteboardService] User ${peerId} denied draw permission`);
      return false;
    } catch (error) {
      console.error(
        '[WhiteboardService] Error checking user draw permission:',
        error,
      );

      // Fallback logic: if we can't check creator status
      const permissions = this.whiteboardPermissions.get(roomId) || [];

      // If user has explicit permission, allow
      if (permissions.includes(peerId)) {
        return true;
      }

      // If permissions are empty (new room), allow as potential creator
      if (permissions.length === 0) {
        return true;
      }

      return false;
    }
  }
  // Pointer management
  updateUserPointer(roomId: string, peerId: string, position: PositionMouse) {
    if (!this.positionMouse.has(roomId)) {
      this.positionMouse.set(roomId, new Map());
    }

    const pointersInRoom = this.positionMouse.get(roomId);
    if (!pointersInRoom) return [];

    pointersInRoom.set(peerId, { position, peerId });

    return this.getPointers(roomId);
  }

  getPointers(roomId: string) {
    const pointersMap = this.positionMouse.get(roomId);
    if (!pointersMap) return [];

    return Array.from(pointersMap.values());
  }

  removeUserPointer(roomId: string, peerId: string) {
    const pointersMap = this.positionMouse.get(roomId);
    if (pointersMap) {
      pointersMap.delete(peerId);
    }
    return this.getPointers(roomId);
  }

  // Clean up room data when room is empty
  cleanupRoom(roomId: string) {
    this.whiteboardData.delete(roomId);
    this.positionMouse.delete(roomId);
    this.whiteboardPermissions.delete(roomId);
  }
}
