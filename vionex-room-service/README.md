<p align="center">
  <img src="https://res.cloudinary.com/dcweof28t/image/upload/v1750399380/image_products/favicon_vo2jtz.png" alt="Vionex Logo" width="200"/>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/NestJS-e0234e?style=for-the-badge&logo=nestjs&logoColor=white" alt="NestJS"/>
  <img src="https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript"/>
  <img src="https://img.shields.io/badge/gRPC-4285f4?style=for-the-badge&logo=grpc&logoColor=white" alt="gRPC"/>
  <img src="https://img.shields.io/badge/Swagger-85EA2D?style=for-the-badge&logo=swagger&logoColor=black" alt="Swagger"/>
  <img src="https://img.shields.io/badge/Mediasoup-FF6B35?style=for-the-badge&logo=webrtc&logoColor=white" alt="Mediasoup"/>
</p>

# 🏠 Vionex Room Service

A microservice that manages meeting rooms within the Vionex system. This service handles room creation, management, and monitoring, including participant management and room state tracking.

## ✨ Key Features

- **Room Management**: Create, delete and manage meeting rooms
- **Participant Management**: Handle room participants and permissions
- **Access Control**: Room access control and security
- **Room Analytics**: Room statistics and reporting
- **Real-time Status**: Monitor room status in real-time
- **Session Management**: Handle meeting sessions
- **Room Settings**: Configure room-specific settings

## 🛠️ Technologies

- **Framework**: NestJS v11
- **Language**: TypeScript
- **Communication**: gRPC (@grpc/grpc-js)
- **Documentation**: Swagger/OpenAPI
- **Media**: Mediasoup v3.16
- **Configuration**: @nestjs/config
- **API Documentation**: swagger-ui-express
- **Runtime**: Node.js

## 📁 Project Structure

```
src/
├── room/
│   ├── room.controller.ts     # gRPC controller
│   ├── room.service.ts        # Business logic
│   ├── room.gateway.ts        # WebSocket gateway
│   └── dto/                   # Data transfer objects
├── participant/
│   ├── participant.service.ts # Participant management
│   └── participant.model.ts   # Participant entity
├── shared/
│   ├── interfaces/            # TypeScript interfaces
│   ├── guards/               # Authentication guards
│   └── decorators/           # Custom decorators
├── app.module.ts              # Root module
└── main.ts                   # Application entry point
```

## Environment Variables

```bash
# Service Configuration
PORT=50052
NODE_ENV=development

# gRPC Configuration
GRPC_HOST=0.0.0.0
GRPC_PORT=50052

# Mediasoup Configuration
MEDIASOUP_LISTEN_IP=0.0.0.0
MEDIASOUP_ANNOUNCED_IP=127.0.0.1

# Room Configuration
MAX_PARTICIPANTS_PER_ROOM=50
ROOM_TIMEOUT_MINUTES=30

# Database Configuration
DATABASE_URL=mongodb://localhost:27017/vionex-rooms
```

## 🏗️ Architecture

```
┌─────────────────┐    gRPC    ┌──────────────────┐
│   API Gateway   │◄─────────►│   Room Service   │
└─────────────────┘            └──────────────────┘
                                        │
                                        ▼
                                ┌──────────────────┐
                                │   Room Manager   │
                                │   (In-Memory)    │
                                └──────────────────┘
                                        │
                                        ▼
                                ┌──────────────────┐
                                │  Mediasoup SFU   │
                                └──────────────────┘
```
