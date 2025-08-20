import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs/internal/firstValueFrom';
import { AuthGRPCService } from 'src/interfaces';

@Injectable()
export class AuthClientService implements OnModuleInit {
    private authService: AuthGRPCService;

    constructor(@Inject('AUTH_SERVICE') private client: ClientGrpc) {}

    onModuleInit() {
        this.authService =
            this.client.getService<AuthGRPCService>('AuthService');
    }

    async login(data: { email: string; password: string }) {
        const response = await firstValueFrom(this.authService.login(data));
        return {
            success: response.success,
            accessToken: response.access_token,
            refreshToken: response.refresh_token,
            message: response.message,
        };
    }

    async register(data: { email: string; password: string; name: string }) {
        const response = await firstValueFrom(this.authService.register(data));
        return {
            success: response.success,
            message: response.message,
            accessToken: response.access_token,
            refreshToken: response.refresh_token,
        };
    }

    async logout(data: { access_token: string }) {
        const response = await firstValueFrom(this.authService.logout(data));
        return {
            success: response.success,
            message: response.message,
        };
    }

    async getInfo(data: { access_token: string }) {
        const response = await firstValueFrom(this.authService.getInfo(data));
        return {
            success: response.success,
            message: response.message,
            user: response.user,
        };
    }

    async verifyToken(token: string) {
        const response = await firstValueFrom(
            this.authService.verifyToken({ token }),
        );
        return {
            success: response.success,
            message: response.message,
            user: response.user,
        };
    }
}
