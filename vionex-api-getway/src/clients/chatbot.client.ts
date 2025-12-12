import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';
import { ChatBotGrpcServiceInterface } from '../interfaces/interface';

@Injectable()
export class ChatBotClientService implements OnModuleInit {
    private chatbotService: ChatBotGrpcServiceInterface;

    constructor(@Inject('CHATBOT_SERVICE') private client: ClientGrpc) {}

    onModuleInit() {
        this.chatbotService =
            this.client.getService<ChatBotGrpcServiceInterface>(
                'ChatbotService',
            );
    }

    async askChatBot(data: {
        question: string;
        room_id: string;
        room_key?: string; // NEW: Room key for semantic context isolation
        organization_id?: string;
    }) {
        try {
            const response = await firstValueFrom(
                this.chatbotService.askChatBot(data),
            );
            return response;
        } catch (error) {
            console.error('Error calling askChatBot:', error);
            throw error;
        }
    }

    async extractMeetingSummary(data: {
        room_id: string;
        organization_id?: string;
        room_key?: string;
    }) {
        try {
            const response = await firstValueFrom(
                this.chatbotService.extractMeetingSummary(data),
            );
            return response;
        } catch (error) {
            console.error('Error calling extractMeetingSummary:', error);
            throw error;
        }
    }

    async generateMeetingReport(data: {
        room_id: string;
        organization_id?: string;
        room_key: string;
    }) {
        try {
            const response = await firstValueFrom(
                this.chatbotService.generateMeetingReport(data),
            );
            return response;
        } catch (error) {
            console.error('Error calling generateMeetingReport:', error);
            throw error;
        }
    }
}
