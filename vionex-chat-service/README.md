<p align="center">
  <img src="https://res.cloudinary.com/dcweof28t/image/upload/v1750399380/image_products/favicon_vo2jtz.png" alt="Vionex Logo" width="200"/>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/NestJS-e0234e?style=for-the-badge&logo=nestjs&logoColor=white" alt="NestJS"/>
  <img src="https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript"/>
  <img src="https://img.shields.io/badge/gRPC-4285f4?style=for-the-badge&logo=grpc&logoColor=white" alt="gRPC"/>
  <img src="https://img.shields.io/badge/Microservice-FF6B6B?style=for-the-badge&logo=microgenetics&logoColor=white" alt="Microservice"/>
</p>

# 💬 Vionex Chat Service

Real-time messaging microservice for video meeting rooms with organization-aware chat management.

## ✨ Features

- **Real-time Messaging**: Send and receive messages in meeting rooms
- **Organization Support**: Multi-tenant chat with organization isolation
- **Message History**: Store and retrieve chat history by room
- **gRPC Communication**: High-performance service communication
- **Message Validation**: Content filtering and message validation
- **Room-based Chat**: Chat scoped to specific meeting rooms

## 🛠️ Technologies

- **Framework**: NestJS
- **Language**: TypeScript
- **Communication**: gRPC
- **Database**: MongoDB (optional for persistence)
- **ID Generation**: NanoID
- **Storage**: In-memory message store

## 📁 Project Structure

```
src/
├── chat.controller.ts        # gRPC message endpoints
├── chat.service.ts           # Message management logic
├── interfaces/
│   └── chat.interface.ts     # Message interfaces
├── dto/
│   └── chat.dto.ts          # Data transfer objects
├── app.module.ts            # Module configuration
└── main.ts                  # Entry point
```

## 🔧 Environment Variables

```bash
# Server
CHAT_GRPC_PORT=30007
NODE_ENV=development

# gRPC Configuration
GRPC_HOST=0.0.0.0


# Logging
LOG_LEVEL=info
```

## 📋 Installation

```bash
# Install dependencies
npm install

# Run service
npm run start:dev

# Run with Docker
docker build -t vionex-chat-service .
docker run -p 30007:30007 --env-file .env vionex-chat-service
```
