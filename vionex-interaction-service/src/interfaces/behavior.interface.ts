export interface UserEvent {
  type: string;
  value: boolean | string | number;
  time: Date;
}

export interface UserBehaviorLog {
  userId: string;
  roomId: string;
  events: UserEvent[];
  lastUpdated: Date;
}

export interface BehaviorLogRequest {
  userId: string;
  roomId: string;
  events: UserEvent[];
}

export enum TypeUserEvent {
  FOCUS_TAB = 'FOCUS_TAB',
  FOCUS = 'FOCUS',
  ATTENTION = 'ATTENTION',
}
