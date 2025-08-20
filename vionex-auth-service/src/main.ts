import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { AuthModule } from './auth.module';
import { protoPaths } from './common/paths';

async function bootstrap() {
    const app = await NestFactory.createApplicationContext(AuthModule);
    const configService = app.get(ConfigService);

    // Create gRPC microservice
    const grpcApp = await NestFactory.createMicroservice<MicroserviceOptions>(
        AuthModule,
        {
            transport: Transport.GRPC,
            options: {
                package: 'auth',
                protoPath: protoPaths.auth,
                url: `0.0.0.0:${configService.get('AUTH_GRPC_PORT') || 30008}`,
                loader: {
                    keepCase: true,
                },
            },
        },
    );

    // Start gRPC service
    await grpcApp.listen();
    console.log(
        `Auth gRPC Service is running on port ${configService.get('AUTH_GRPC_PORT') || 30008}`,
    );
}
bootstrap();
