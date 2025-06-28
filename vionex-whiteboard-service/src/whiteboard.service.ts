import { Injectable } from '@nestjs/common';

export interface PositionMouse {
  x: number;
  y: number;
}

export interface WhiteboardElement {
  id: string;
  type: string;
  x: number;
  y: number;
  data: any; // Element-specific data (stroke, fill, etc.)
}

export interface WhiteboardState {
  roomId: string;
  elements: WhiteboardElement[];
  state: any; // Additional state data
  allowedUsers: string[];
  updatedAt: Date;
}

@Injectable()
export class WhiteboardService {
  private whiteboardData = new Map<string, WhiteboardState>();
  private pointerPositions = new Map<string, Map<string, PositionMouse>>(); // Map<roomId, Map<userId, position>>

  async updateWhiteboard(
    roomId: string,
    elements: WhiteboardElement[],
    state: any,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      let whiteboardState = this.whiteboardData.get(roomId);

      if (!whiteboardState) {
        whiteboardState = {
          roomId,
          elements: [],
          state: {},
          allowedUsers: [],
          updatedAt: new Date(),
        };
      }

      // Update elements and state
      whiteboardState.elements = elements;
      whiteboardState.state = state;
      whiteboardState.updatedAt = new Date();

      this.whiteboardData.set(roomId, whiteboardState);

      return { success: true };
    } catch (error) {
      console.error('Error updating whiteboard:', error);
      return {
        success: false,
        error: 'Failed to update whiteboard',
      };
    }
  }

  async getWhiteboardData(
    roomId: string,
  ): Promise<{ success: boolean; whiteboardData?: WhiteboardState }> {
    const data = this.whiteboardData.get(roomId);

    if (!data) {
      // Return empty whiteboard if none exists
      const emptyState: WhiteboardState = {
        roomId,
        elements: [],
        state: {},
        allowedUsers: [],
        updatedAt: new Date(),
      };

      this.whiteboardData.set(roomId, emptyState);

      return {
        success: true,
        whiteboardData: emptyState,
      };
    }

    return {
      success: true,
      whiteboardData: data,
    };
  }

  async clearWhiteboard(roomId: string): Promise<{ success: boolean }> {
    try {
      let whiteboardState = this.whiteboardData.get(roomId);

      if (!whiteboardState) {
        whiteboardState = {
          roomId,
          elements: [],
          state: {},
          allowedUsers: [],
          updatedAt: new Date(),
        };
      }

      // Clear elements but keep permissions
      whiteboardState.elements = [];
      whiteboardState.state = {};
      whiteboardState.updatedAt = new Date();

      this.whiteboardData.set(roomId, whiteboardState);

      return { success: true };
    } catch (error) {
      console.error('Error clearing whiteboard:', error);
      return { success: false };
    }
  }

  async updatePermissions(
    roomId: string,
    allowedUsers: string[],
  ): Promise<{ success: boolean }> {
    try {
      let whiteboardState = this.whiteboardData.get(roomId);

      if (!whiteboardState) {
        whiteboardState = {
          roomId,
          elements: [],
          state: {},
          allowedUsers: [],
          updatedAt: new Date(),
        };
      }

      whiteboardState.allowedUsers = allowedUsers;
      whiteboardState.updatedAt = new Date();

      this.whiteboardData.set(roomId, whiteboardState);

      return { success: true };
    } catch (error) {
      console.error('Error updating permissions:', error);
      return { success: false };
    }
  }

  async getPermissions(
    roomId: string,
  ): Promise<{ success: boolean; allowedUsers?: string[] }> {
    const whiteboardState = this.whiteboardData.get(roomId);

    return {
      success: true,
      allowedUsers: whiteboardState?.allowedUsers || [],
    };
  }

  async handlePointer(
    roomId: string,
    position: PositionMouse,
    userId: string,
  ): Promise<{ success: boolean }> {
    try {
      if (!this.pointerPositions.has(roomId)) {
        this.pointerPositions.set(roomId, new Map());
      }

      const roomPointers = this.pointerPositions.get(roomId);
      roomPointers?.set(userId, position);

      return { success: true };
    } catch (error) {
      console.error('Error handling pointer:', error);
      return { success: false };
    }
  }

  async handlePointerLeave(
    roomId: string,
    userId: string,
  ): Promise<{ success: boolean }> {
    try {
      const roomPointers = this.pointerPositions.get(roomId);
      if (roomPointers) {
        roomPointers.delete(userId);

        // Clean up empty room pointer maps
        if (roomPointers.size === 0) {
          this.pointerPositions.delete(roomId);
        }
      }

      return { success: true };
    } catch (error) {
      console.error('Error handling pointer leave:', error);
      return { success: false };
    }
  }

  async removeRoomData(roomId: string): Promise<void> {
    this.whiteboardData.delete(roomId);
    this.pointerPositions.delete(roomId);
  }

  getPointerPositions(roomId: string): Map<string, PositionMouse> {
    return this.pointerPositions.get(roomId) || new Map();
  }
}
