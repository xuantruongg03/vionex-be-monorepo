import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthGrpcController } from './auth.controller';
import { AuthService } from './auth.service';
import { OrganizationService } from './organization.service';
import { databaseConfig } from './config/database.config';
import { User } from './entities/user.entity';
import { Organization } from './entities/organization.entity';

@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true,
        }),
        TypeOrmModule.forRootAsync({
            imports: [ConfigModule],
            useFactory: (configService: ConfigService) =>
                databaseConfig(configService),
            inject: [ConfigService],
        }),
        TypeOrmModule.forFeature([User, Organization]),
    ],
    controllers: [AuthGrpcController],
    providers: [AuthService, OrganizationService],
})
export class AuthModule {}
