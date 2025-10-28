import { Observable } from 'rxjs/internal/Observable';

export interface ReplyInfo {
    messageId: string;
    senderName: string;
    text: string;
    isFile?: boolean;
}

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
    replyTo?: ReplyInfo;
}

export interface ChatGRPCService {
    sendMessage(data: {
        room_id: string;
        room_key?: string; // NEW: Room key for semantic context isolation
        sender: string;
        sender_name: string;
        text: string;
        fileUrl?: string;
        fileName?: string;
        fileType?: string;
        fileSize?: number;
        isImage?: boolean;
        replyTo?: ReplyInfo;
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
