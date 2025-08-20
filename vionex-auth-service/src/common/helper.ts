import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';
import { User } from 'src/entities/user.entity';

const configService = new ConfigService();

export const hashPassword = async (password: string): Promise<string> => {
    return await bcrypt.hash(password, 12);
};

export const generateTokens = async (
    user: User,
): Promise<{ access_token: string; refresh_token: string }> => {
    const payload = {
        userId: user.id,
        orgId: user.orgId,
        role: user.role,
        organizationId: user.orgId, // Add organizationId for compatibility
    };

    const jwtSecret = configService.get<string>('JWT_SECRET') || 'secret-key';
    const jwtRefreshSecret =
        configService.get<string>('JWT_REFRESH_SECRET') || 'refresh-secret-key';

    const access_token = jwt.sign(payload, jwtSecret, {
        expiresIn: configService.get<string>('JWT_EXPIRES_IN') || '1d',
    } as jwt.SignOptions);

    const refresh_token = jwt.sign(payload, jwtRefreshSecret, {
        expiresIn: configService.get<string>('JWT_REFRESH_EXPIRES_IN') || '3d',
    } as jwt.SignOptions);

    return { access_token, refresh_token };
};

export const decodeToken = (
    token: string,
): {
    userId: string;
    orgId?: string;
    role?: string;
    organizationId?: string;
} | null => {
    try {
        const decoded = jwt.verify(
            token,
            configService.get<string>('JWT_SECRET') || 'secret-key',
        );
        return decoded as {
            userId: string;
            orgId?: string;
            role?: string;
            organizationId?: string;
        };
    } catch (error) {
        return null;
    }
};
