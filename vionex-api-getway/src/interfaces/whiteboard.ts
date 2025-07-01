// Whiteboard gRPC response interfaces
export interface WhiteboardElement {
  id: string;
  type: string;
  x: number;
  y: number;
  data: string;
  // Additional properties for freedraw elements
  points?: number[][];
  pressures?: number[];
  simulatePressure?: boolean;
  width?: number;
  height?: number;
  strokeColor?: string;
  backgroundColor?: string;
  strokeWidth?: number;
  roughness?: number;
  opacity?: number;
  // Additional properties for other element types
  [key: string]: any;
}

export interface WhiteboardState {
  room_id: string;
  elements: WhiteboardElement[];
  state: string;
  allowed_users: string[];
  updated_at: string;
}

export interface GetWhiteboardDataResponse {
  success: boolean;
  whiteboard_data: WhiteboardState;
}

export interface ClearWhiteboardResponse {
  success: boolean;
}

export interface UpdatePermissionsResponse {
  success: boolean;
  allowed_users: string[];
}

export interface GetPermissionsResponse {
  success: boolean;
  allowed_users: string[];
}

export interface UpdateUserPointerResponse {
  success: boolean;
  pointers: any[];
}