import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { Observable, firstValueFrom } from 'rxjs';
import { CircuitBreaker, RetryUtil } from 'src/utils/resilience';

export interface PositionMouse {
  x: number;
  y: number;
}

export interface WhiteboardElement {
  id: string;
  type: string;
  x: number;
  y: number;
  data: string; // JSON string
}

export interface WhiteboardState {
  room_id: string;
  elements: WhiteboardElement[];
  state: string; // JSON string
  allowed_users: string[];
  updated_at: string;
}

export interface WhiteboardGrpcService {
  updateWhiteboard(data: {
    room_id: string;
    elements: WhiteboardElement[];
    state: string;
  }): Observable<{
    success: boolean;
    error?: string;
  }>;

  getWhiteboardData(data: { room_id: string }): Observable<{
    success: boolean;
    whiteboard_data?: WhiteboardState;
  }>;

  clearWhiteboard(data: { room_id: string }): Observable<{
    success: boolean;
  }>;

  updatePermissions(data: {
    room_id: string;
    allowed_users: string[];
  }): Observable<{
    success: boolean;
  }>;

  getPermissions(data: { room_id: string }): Observable<{
    success: boolean;
    allowed_users?: string[];
  }>;

  handlePointer(data: {
    room_id: string;
    position: PositionMouse;
    user_id: string;
  }): Observable<{
    success: boolean;
  }>;

  handlePointerLeave(data: { room_id: string; user_id: string }): Observable<{
    success: boolean;
  }>;
}

@Injectable()
export class WhiteboardClientService implements OnModuleInit {
  private whiteboardService: WhiteboardGrpcService;
  private circuitBreaker = new CircuitBreaker(5, 60000);

  constructor(
    @Inject('WHITEBOARD_SERVICE') private readonly client: ClientGrpc,
  ) {}

  onModuleInit() {
    this.whiteboardService =
      this.client.getService<WhiteboardGrpcService>('WhiteboardService');
  }

  async updateWhiteboard(data: {
    room_id: string;
    elements: any[];
    state: string;
  }) {
    return this.circuitBreaker.execute(async () => {
      return RetryUtil.withRetry(
        async () => {
          const response = await firstValueFrom(
            this.whiteboardService.updateWhiteboard(data),
          );
          return response;
        },
        3,
        1000,
      );
    });
  }

  async getWhiteboardData(data: { room_id: string }) {
    return this.circuitBreaker.execute(async () => {
      return RetryUtil.withRetry(
        async () => {
          const response = await firstValueFrom(
            this.whiteboardService.getWhiteboardData(data),
          );
          return response;
        },
        3,
        1000,
      );
    });
  }

  async clearWhiteboard(data: { room_id: string }) {
    return this.circuitBreaker.execute(async () => {
      return RetryUtil.withRetry(
        async () => {
          const response = await firstValueFrom(
            this.whiteboardService.clearWhiteboard(data),
          );
          return response;
        },
        3,
        1000,
      );
    });
  }

  async updatePermissions(data: { room_id: string; allowed_users: string[] }) {
    return this.circuitBreaker.execute(async () => {
      return RetryUtil.withRetry(
        async () => {
          const response = await firstValueFrom(
            this.whiteboardService.updatePermissions(data),
          );
          return response;
        },
        3,
        1000,
      );
    });
  }

  async getPermissions(data: { room_id: string }) {
    return this.circuitBreaker.execute(async () => {
      return RetryUtil.withRetry(
        async () => {
          const response = await firstValueFrom(
            this.whiteboardService.getPermissions(data),
          );
          return response;
        },
        3,
        1000,
      );
    });
  }

  async handlePointer(data: {
    room_id: string;
    position: PositionMouse;
    user_id: string;
  }) {
    return this.circuitBreaker.execute(async () => {
      return RetryUtil.withRetry(
        async () => {
          const response = await firstValueFrom(
            this.whiteboardService.handlePointer(data),
          );
          return response;
        },
        3,
        1000,
      );
    });
  }

  async handlePointerLeave(data: { room_id: string; user_id: string }) {
    return this.circuitBreaker.execute(async () => {
      return RetryUtil.withRetry(
        async () => {
          const response = await firstValueFrom(
            this.whiteboardService.handlePointerLeave(data),
          );
          return response;
        },
        3,
        1000,
      );
    });
  }
}
