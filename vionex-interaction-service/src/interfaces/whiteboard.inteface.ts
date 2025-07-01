export interface PositionMouse {
  x: number;
  y: number;
  tool: string;
}

export interface MouseUser {
  position: PositionMouse;
  peerId: string;
}

export interface WhiteboardElement {
  id: string;
  type: string;
  x: number;
  y: number;
  data: string; // JSON string containing element-specific data
}

export interface WhiteboardState {
  roomId: string;
  elements: WhiteboardElement[];
  state: string; // JSON string containing additional state data
  allowedUsers: string[];
  updatedAt: string;
}
