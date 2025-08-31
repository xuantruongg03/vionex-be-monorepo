import { Injectable } from '@nestjs/common';
import { Socket } from 'socket.io';
import { WebSocketEventService } from './websocket-event.service';

@Injectable()
export class ServiceErrorService {
    constructor(private readonly eventService: WebSocketEventService) {}

    /**
     * Check if error indicates service unavailability
     */
    isServiceUnavailable(error: any): boolean {
        if (!error || !error.message) return false;

        const errorMessage = error.message.toLowerCase();

        return (
            errorMessage.includes('unavailable') ||
            errorMessage.includes('econnrefused') ||
            errorMessage.includes('14 unavailable') ||
            errorMessage.includes('connection refused') ||
            errorMessage.includes('connect econnrefused') ||
            errorMessage.includes('grpc error') ||
            errorMessage.includes('network error') ||
            errorMessage.includes('connection failed')
        );
    }

    /**
     * Handle service connection errors
     */
    handleServiceError(
        error: any,
        serviceName: string,
    ): {
        isServiceUnavailable: boolean;
        message: string;
        code: string;
    } {
        console.error(`[Gateway] ${serviceName} service error:`, error);

        if (this.isServiceUnavailable(error)) {
            return {
                isServiceUnavailable: true,
                message: `${serviceName} service not available`,
                code: 'SERVICE_UNAVAILABLE',
            };
        }

        return {
            isServiceUnavailable: false,
            message: error.message || `${serviceName} service error`,
            code: 'SERVICE_ERROR',
        };
    }

    /**
     * Emit service unavailable error to client
     */
    emitServiceUnavailableError(
        client: Socket,
        serviceName: string,
        originalError?: string,
    ): void {
        this.eventService.emitError(
            client,
            `${serviceName} service not available`,
            'SERVICE_UNAVAILABLE',
            {
                service: serviceName,
                details: originalError,
                timestamp: new Date().toISOString(),
            },
        );
    }

    /**
     * Wrapper for service calls with automatic error handling
     */
    async executeServiceCall<T>(
        client: Socket,
        serviceName: string,
        serviceCall: () => Promise<T>,
        onError?: (error: any) => void,
    ): Promise<T | null> {
        try {
            return await serviceCall();
        } catch (error) {
            const errorInfo = this.handleServiceError(error, serviceName);

            if (errorInfo.isServiceUnavailable) {
                this.emitServiceUnavailableError(
                    client,
                    serviceName,
                    error.message,
                );
            } else {
                this.eventService.emitError(
                    client,
                    errorInfo.message,
                    errorInfo.code,
                );
            }

            if (onError) {
                onError(error);
            }

            return null;
        }
    }

    /**
     * Wrapper for service calls without client (for internal use)
     */
    async executeServiceCallInternal<T>(
        serviceName: string,
        serviceCall: () => Promise<T>,
        fallbackValue?: T,
    ): Promise<T | null> {
        try {
            return await serviceCall();
        } catch (error) {
            const errorInfo = this.handleServiceError(error, serviceName);

            if (errorInfo.isServiceUnavailable) {
                console.warn(
                    `[Gateway] ${serviceName} service unavailable, using fallback`,
                );
                return fallbackValue || null;
            }

            // Re-throw non-connection errors
            throw error;
        }
    }
}
