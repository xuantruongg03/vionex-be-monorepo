import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { WhiteboardClientService } from './clients/whiteboard.client';
import { HttpBroadcastService } from './services/http-broadcast.service';

interface WhiteboardElement {
  id: string;
  type: string;
  x: number;
  y: number;
  data: string; // JSON string
}

interface WhiteboardState {
  room_id: string;
  elements: WhiteboardElement[];
  state: string; // JSON string
  allowed_users: string[];
  updated_at: string;
}

interface PositionMouse {
  x: number;
  y: number;
}

interface UpdateWhiteboardDto {
  room_id: string;
  elements: WhiteboardElement[];
  state: string;
}

interface UpdatePermissionsDto {
  room_id: string;
  allowed_users: string[];
}

interface HandlePointerDto {
  room_id: string;
  position: PositionMouse;
  user_id: string;
}

interface PointerLeaveDto {
  room_id: string;
  user_id: string;
}

@Controller('api/whiteboard')
export class WhiteboardHttpController {
  constructor(
    private readonly whiteboardClient: WhiteboardClientService,
    private readonly broadcastService: HttpBroadcastService,
  ) {}

  @Post('update')
  async updateWhiteboard(@Body() data: UpdateWhiteboardDto) {
    try {
      if (!data.room_id || !Array.isArray(data.elements)) {
        throw new HttpException(
          'Room ID and elements array are required',
          HttpStatus.BAD_REQUEST,
        );
      }

      const result = await this.whiteboardClient.updateWhiteboard({
        room_id: data.room_id,
        elements: data.elements,
        state: data.state || '{}',
      });

      if (!result.success) {
        throw new HttpException(
          result.error || 'Failed to update whiteboard',
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }

      // Broadcast whiteboard update to all room participants
      this.broadcastService.broadcastToRoom(
        data.room_id,
        'whiteboard:updated',
        {
          elements: data.elements,
          state: data.state,
          updated_at: new Date().toISOString(),
        },
      );

      return { success: true };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      console.error('Error updating whiteboard:', error);
      throw new HttpException(
        'Internal server error',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('data/:roomId')
  async getWhiteboardData(@Param('roomId') roomId: string) {
    try {
      if (!roomId) {
        throw new HttpException('Room ID is required', HttpStatus.BAD_REQUEST);
      }

      const result = await this.whiteboardClient.getWhiteboardData({
        room_id: roomId,
      });
      if (!result.success) {
        throw new HttpException(
          'Failed to get whiteboard data',
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }

      return {
        success: true,
        whiteboard_data: result.whiteboard_data,
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      console.error('Error getting whiteboard data:', error);
      throw new HttpException(
        'Internal server error',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Delete('clear/:roomId')
  async clearWhiteboard(@Param('roomId') roomId: string) {
    try {
      if (!roomId) {
        throw new HttpException('Room ID is required', HttpStatus.BAD_REQUEST);
      }

      const result = await this.whiteboardClient.clearWhiteboard({
        room_id: roomId,
      });
      if (!result.success) {
        throw new HttpException(
          'Failed to clear whiteboard',
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }

      // Broadcast whiteboard cleared event
      this.broadcastService.broadcastToRoom(roomId, 'whiteboard:cleared', {
        room_id: roomId,
        cleared_at: new Date().toISOString(),
      });

      return { success: true };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      console.error('Error clearing whiteboard:', error);
      throw new HttpException(
        'Internal server error',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('permissions')
  async updatePermissions(@Body() data: UpdatePermissionsDto) {
    try {
      if (!data.room_id || !Array.isArray(data.allowed_users)) {
        throw new HttpException(
          'Room ID and allowed_users array are required',
          HttpStatus.BAD_REQUEST,
        );
      }

      const result = await this.whiteboardClient.updatePermissions({
        room_id: data.room_id,
        allowed_users: data.allowed_users,
      });
      if (!result.success) {
        throw new HttpException(
          'Failed to update permissions',
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }

      // Broadcast permissions update
      this.broadcastService.broadcastToRoom(
        data.room_id,
        'whiteboard:permissions-updated',
        {
          allowed_users: data.allowed_users,
          updated_at: new Date().toISOString(),
        },
      );

      return { success: true };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      console.error('Error updating whiteboard permissions:', error);
      throw new HttpException(
        'Internal server error',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('permissions/:roomId')
  async getPermissions(@Param('roomId') roomId: string) {
    try {
      if (!roomId) {
        throw new HttpException('Room ID is required', HttpStatus.BAD_REQUEST);
      }

      const result = await this.whiteboardClient.getPermissions({
        room_id: roomId,
      });
      if (!result.success) {
        throw new HttpException(
          'Failed to get permissions',
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }

      return {
        success: true,
        allowed_users: result.allowed_users || [],
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      console.error('Error getting whiteboard permissions:', error);
      throw new HttpException(
        'Internal server error',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('pointer')
  async handlePointer(@Body() data: HandlePointerDto) {
    try {
      if (!data.room_id || !data.user_id || !data.position) {
        throw new HttpException(
          'Room ID, user ID, and position are required',
          HttpStatus.BAD_REQUEST,
        );
      }

      const result = await this.whiteboardClient.handlePointer({
        room_id: data.room_id,
        position: data.position,
        user_id: data.user_id,
      });
      if (!result.success) {
        throw new HttpException(
          'Failed to handle pointer',
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }

      // Broadcast pointer position to other users (exclude sender)
      this.broadcastService.broadcastToRoomExcept(
        data.room_id,
        data.user_id,
        'whiteboard:pointer-move',
        {
          user_id: data.user_id,
          position: data.position,
        },
      );

      return { success: true };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      console.error('Error handling whiteboard pointer:', error);
      throw new HttpException(
        'Internal server error',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('pointer/leave')
  async handlePointerLeave(@Body() data: PointerLeaveDto) {
    try {
      if (!data.room_id || !data.user_id) {
        throw new HttpException(
          'Room ID and user ID are required',
          HttpStatus.BAD_REQUEST,
        );
      }

      const result = await this.whiteboardClient.handlePointerLeave({
        room_id: data.room_id,
        user_id: data.user_id,
      });
      if (!result.success) {
        throw new HttpException(
          'Failed to handle pointer leave',
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }

      // Broadcast pointer leave to other users
      this.broadcastService.broadcastToRoomExcept(
        data.room_id,
        data.user_id,
        'whiteboard:pointer-leave',
        {
          user_id: data.user_id,
        },
      );

      return { success: true };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      console.error('Error handling pointer leave:', error);
      throw new HttpException(
        'Internal server error',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
