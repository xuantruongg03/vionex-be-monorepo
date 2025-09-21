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

Meeting room management microservice handling room creation, participant management, and session coordination.

## ✨ Features

- **Room Management**: Create, delete, and manage meeting rooms
- **Participant Management**: Handle participants and permissions
- **Access Control**: Room security and access management
- **Session Management**: Meeting session lifecycle management
- **Real-time Status**: Monitor room status and activities
- **Room Analytics**: Statistics and usage reporting

## 🛠️ Technologies

- **Framework**: NestJS
- **Language**: TypeScript
- **Communication**: gRPC
- **WebRTC**: Mediasoup SFU
- **Documentation**: Swagger/OpenAPI
- **Storage**: MongoDB

## 📁 Project Structure

```
src/
├── room.controller.ts        # Room management endpoints
├── room.service.ts           # Room logic and state management
├── room.gateway.ts           # WebSocket gateway for real-time
├── participant.service.ts    # Participant management
├── dto/
│   └── room.dto.ts          # Data transfer objects
├── interfaces/
│   └── room.interface.ts    # Room interfaces
├── app.module.ts            # Module configuration
└── main.ts                  # Entry point
```

## 🔧 Environment Variables

```bash

# Mediasoup Configuration
MEDIASOUP_LISTEN_IP=0.0.0.0
MEDIASOUP_ANNOUNCED_IP=127.0.0.1

# Room Configuration
MAX_PARTICIPANTS_PER_ROOM=50
ROOM_TIMEOUT_MINUTES=30
DEFAULT_ROOM_SETTINGS={}
```

## 📋 Installation

```bash
# Install dependencies
npm install

# Run service
npm run start:dev

# Run with Docker
docker build -t vionex-room-service .
docker run -p 30005:30005 --env-file .env vionex-room-service
```
