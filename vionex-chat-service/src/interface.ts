import { Observable } from 'rxjs/internal/Observable';

export interface ChatMessage {
  id: string;
  room_id: string;
  sender: string;
  sender_name: string;
  text: string;
  timestamp: string;
  fileUrl?: string;
  fileName?: string;
  fileType?: string;
  fileSize?: number;
  isImage?: boolean;
}

export interface ChatGRPCService {
  sendMessage(data: {
    room_id: string;
    sender: string;
    sender_name: string;
    text: string;
    fileUrl?: string;
    fileName?: string;
    fileType?: string;
    fileSize?: number;
    isImage?: boolean;
  }): Observable<ChatMessageResponse | null>;

  getMessages(data: {
    room_id: string;
  }): Observable<{ success: boolean; messages: ChatMessage[] }>;

  removeRoomMessages(data: {
    room_id: string;
  }): Observable<{ success: boolean; message: string }>;
}

export interface ChatMessageResponse {
  success: boolean;
  message: ChatMessage | null;
}
