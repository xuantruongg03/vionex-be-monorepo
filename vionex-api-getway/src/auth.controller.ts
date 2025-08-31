import { Body, Controller, Get, Post, Put, Headers } from '@nestjs/common';
import { AuthClientService } from './clients/auth.client';

@Controller('api/auth')
export class AuthController {
    constructor(private readonly authClient: AuthClientService) {}

    /**
     * User login
     * @param body - Login credentials
     * @returns JWT token
     */
    @Post('login')
    async login(@Body() body: { email: string; password: string }) {
        const response = await this.authClient.login(body);
        return {
            data: {
                success: response.success,
                message: response.message,
                accessToken: response.accessToken,
                refreshToken: response.refreshToken,
            },
        };
    }

    /**
     * User registration
     * @param body - Registration details
     * @returns Success message
     */
    @Post('register')
    async register(
        @Body() body: { email: string; password: string; name: string },
    ) {
        const response = await this.authClient.register(body);
        return {
            data: {
                success: response.success,
                message: response.message,
                accessToken: response.accessToken,
                refreshToken: response.refreshToken,
            },
        };
    }

    /**
     * Google OAuth authentication
     * @param body - Google user data
     * @returns JWT token
     */
    @Post('google')
    async googleAuth(
        @Body()
        body: {
            email: string;
            name: string;
            avatar?: string;
            googleId: string;
        },
    ) {
        const response = await this.authClient.googleAuth(body);
        return {
            data: {
                success: response.success,
                message: response.message,
                accessToken: response.accessToken,
                refreshToken: response.refreshToken,
            },
        };
    }

    /**
     * User logout
     * @param body - Logout details
     * @returns Success message
     */
    @Post('logout')
    async logout(@Headers('authorization') authHeader: string) {
        const access_token = authHeader?.split(' ')[1] || '';
        const response = await this.authClient.logout({ access_token });
        return {
            data: {
                success: response.success,
                message: response.message,
            },
        };
    }

    @Get('info')
    async getInfo(@Headers('authorization') authHeader: string) {
        // Get token from header
        const access_token = authHeader?.split(' ')[1] || '';
        const response = await this.authClient.getInfo({ access_token });
        return {
            data: {
                success: response.success,
                message: response.message,
                user: response.user,
            },
        };
    }

    /**
     * Update user profile
     * @param body - Profile update data
     * @param authHeader - Authorization header
     * @returns Success message with updated user data
     */
    @Put('update-profile')
    async updateProfile(
        @Body() body: { name: string; avatar: string },
        @Headers('authorization') authHeader: string,
    ) {
        const access_token = authHeader?.split(' ')[1] || '';
        const response = await this.authClient.updateProfile({
            access_token,
            ...body,
        });
        return {
            data: {
                success: response.success,
                message: response.message,
                user: response.user,
            },
        };
    }
}
