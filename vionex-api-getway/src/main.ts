import { ConfigModule, ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { IoAdapter } from '@nestjs/platform-socket.io/adapters/io-adapter';
import * as fs from 'fs';
import { GatewayModule } from './gateway.module';

class SecureIoAdapter extends IoAdapter {
    createIOServer(port: number, options?: any): any {
        options = options || {};
        options.path = '/socket.io';
        options.cors = {
            origin: '*',
            methods: ['GET', 'POST'],
            credentials: true,
        };
        // Enable transports for HTTPS proxy environments
        options.transports = ['websocket', 'polling'];
        // Allow upgrades for better compatibility
        options.allowUpgrades = true;
        // Set ping timeout and interval for stability
        options.pingTimeout = 60000;
        options.pingInterval = 25000;

        return super.createIOServer(port, options);
    }
}

async function bootstrap() {
    await ConfigModule.forRoot({
        isGlobal: true,
    });
    // const httpsOptions = {
    //     key: fs.readFileSync('./secrets/private-key.pem'),
    //     cert: fs.readFileSync('./secrets/public-certificate.pem'),
    // };
    const configService = new ConfigService();
    const app = await NestFactory.create(GatewayModule, {httpsOptions});
    app.useWebSocketAdapter(new SecureIoAdapter(app));

    // Enable global prefix for API routes (optional)
    // app.setGlobalPrefix('api');

    app.enableCors({
        origin: '*',
        methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
        allowedHeaders:
            'Content-Type,Accept,Authorization,X-Requested-With,X-Peer-Id',
        credentials: true,
        preflightContinue: false,
        optionsSuccessStatus: 204,
    });
    const port = configService.get('PORT') ?? 3000;
    const host = configService.get('HOST') ?? '0.0.0.0';

    await app.listen(port, host);
}
bootstrap();
