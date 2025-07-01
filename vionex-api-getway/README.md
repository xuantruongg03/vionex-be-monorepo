<p align="center">
  <img src="https://res.cloudinary.com/dcweof28t/image/upload/v1750399380/image_products/favicon_vo2jtz.png" alt="Vionex Logo" width="200"/>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/NestJS-e0234e?style=for-the-badge&logo=nestjs&logoColor=white" alt="NestJS"/>
  <img src="https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript"/>
  <img src="https://img.shields.io/badge/Socket.io-black?style=for-the-badge&logo=socket.io&badgeColor=010101" alt="Socket.io"/>
  <img src="https://img.shields.io/badge/gRPC-4285f4?style=for-the-badge&logo=grpc&logoColor=white" alt="gRPC"/>
  <img src="https://img.shields.io/badge/Mediasoup-FF6B35?style=for-the-badge&logo=webrtc&logoColor=white" alt="Mediasoup"/>
</p>

# 🚀 Vionex API Gateway Service

The main entry point for the Vionex video meeting system, handling WebSocket signaling and REST API endpoints. This service acts as an intermediary connecting clients to backend microservices.

## ✨ Key Features

- **WebSocket Gateway**: Real-time signaling for video calls
- **REST API Endpoints**: HTTP APIs for basic operations
- **Message Forwarding**: Route messages to microservices
- **Authentication & Authorization**: User authentication and permissions
- **gRPC Client**: Communication with microservices via gRPC
- **Media Signaling**: WebRTC signaling for video/audio

## 🛠️ Technologies

- **Framework**: NestJS v11
- **Language**: TypeScript
- **Real-time**: Socket.io v4.8
- **Media**: Mediasoup v3.16
- **Communication**: gRPC (@grpc/grpc-js)
- **HTTP Client**: Axios
- **Runtime**: Node.js

## 📁 Project Structure

```
src/
├── chat-http.controller.ts    # HTTP endpoints for chat
├── gateway.controller.ts      # Main REST API controller
├── gateway.gateway.ts         # WebSocket gateway
├── gateway.module.ts          # Module configuration
└── main.ts                   # Application entry point
```

## 🔧 Environment Variables

```bash
# Server Configuration
PORT=3000
NODE_ENV=development

# gRPC Services
CHAT_SERVICE_URL=localhost:50051
ROOM_SERVICE_URL=localhost:50052
SFU_SERVICE_URL=localhost:50053
INTERACTION_SERVICE_URL=localhost:50054

# WebSocket Configuration
CORS_ORIGIN=http://localhost:5173

# SSL Certificates (place in secrets/ directory)
# private-key.pem
# public-certificate.pem
```

## 🏗️ Architecture

```
┌─────────────────┐    ┌──────────────────┐
│   Web Client    │◄──►│  API Gateway     │
└─────────────────┘    └──────────────────┘
                                │
                    ┌───────────┼───────────┐
                    │           │           │
                    ▼           ▼           ▼
            ┌──────────┐ ┌──────────┐ ┌──────────┐
            │   Chat   │ │   Room   │ │   SFU    │
            │ Service  │ │ Service  │ │ Service  │
            └──────────┘ └──────────┘ └──────────┘
```
