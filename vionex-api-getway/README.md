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

API Gateway service for Vionex video meeting system - handles client requests routing, WebSocket signaling, and microservices communication.

## ✨ Key Features

- **WebSocket Gateway**: Real-time communication for video calls
- **REST API Gateway**: HTTP endpoint routing to backend services
- **Organization Support**: Multi-tenant request handling
- **Authentication**: JWT-based security
- **gRPC Communication**: Backend microservices integration

## 🛠️ Technologies

- **Framework**: NestJS
- **Language**: TypeScript
- **WebSocket**: Socket.io
- **Communication**: gRPC
- **Authentication**: JWT
- **Runtime**: Node.js

## 📁 Project Structure

```
src/
├── clients/                   # gRPC clients
├── handlers/                  # WebSocket handlers
├── helpers/                   # Utilities
├── interfaces/                # TypeScript interfaces
├── auth.controller.ts         # Auth endpoints
├── gateway.controller.ts      # Main controller
├── gateway.gateway.ts         # WebSocket gateway
├── gateway.module.ts          # Module config
├── organization.controller.ts # Organization endpoints
├── room-http.controller.ts    # Room endpoints
└── main.ts                    # Entry point
```

## 🔧 Environment Variables

```bash
# Server
PORT=3000
NODE_ENV=development

# gRPC Services
ROOM_SERVICE_HOST=localhost
ROOM_SERVICE_GRPC_PORT=30001
CHAT_SERVICE_HOST=localhost
CHAT_SERVICE_GRPC_PORT=30002
SFU_SERVICE_HOST=localhost
SFU_SERVICE_GRPC_PORT=30004
AUDIO_SERVICE_HOST=localhost
AUDIO_SERVICE_GRPC_PORT=30005
CHATBOT_SERVICE_HOST=localhost
CHATBOT_SERVICE_GRPC_PORT=30007
AUTH_SERVICE_HOST=localhost
AUTH_SERVICE_GRPC_PORT=30008

## 📋 Installation

```bash
# Install dependencies
npm install

# Create environment file
cp .env.example .env

# Run development
npm run start:dev

# Build production
npm run build
npm run start:prod
```