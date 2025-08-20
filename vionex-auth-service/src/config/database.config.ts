import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { User } from '../entities/user.entity';
import { Organization } from '../entities/organization.entity';

export const databaseConfig = (
    configService: ConfigService,
): TypeOrmModuleOptions => ({
    type: 'mysql',
    host: configService.get<string>('DB_HOST', 'localhost'),
    port: configService.get<number>('DB_PORT', 3306),
    username: configService.get<string>('DB_USERNAME', 'root'),
    password: configService.get<string>('DB_PASS', ''),
    database: configService.get<string>('DB_NAME', 'auth_service'),
    entities: [User, Organization],
    // synchronize: configService.get<string>('NODE_ENV') === 'development', // Only in development
    synchronize: false,
    // logging: configService.get<string>('NODE_ENV') === 'development',
    logging: false,
    charset: 'utf8mb4',
    timezone: 'Z',
    extra: {
        connectionLimit: 10,
    },
});
