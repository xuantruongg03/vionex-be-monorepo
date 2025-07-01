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

A microservice dedicated to handling chat features within the Vionex video meeting system. This service manages real-time messaging, chat history, and user interactions within meeting rooms.

## ✨ Key Features

- **Real-time Messaging**: Send and receive messages in real-time
- **Message History**: Store and retrieve chat history
- **Room-based Chat**: Chat functionality organized by meeting rooms
- **Message Notifications**: Notify users of new messages
- **Message Validation**: Content filtering and validation
- **Multi-platform Support**: Support for various client platforms

## 🛠️ Technologies

- **Framework**: NestJS v11
- **Language**: TypeScript
- **Communication**: gRPC (@grpc/grpc-js)
- **ID Generation**: NanoID v5
- **Configuration**: @nestjs/config
- **Microservices**: @nestjs/microservices
- **Runtime**: Node.js

## 📁 Project Structure

```
src/
├── chat/
│   ├── chat.controller.ts     # gRPC controller
│   ├── chat.service.ts        # Business logic
│   └── dto/                   # Data transfer objects
├── shared/
│   ├── interfaces/            # TypeScript interfaces
│   └── utils/                 # Utility functions
├── app.module.ts              # Root module
└── main.ts                   # Application entry point
```

## Environment Variables

```bash
# Service Configuration
PORT=50051
NODE_ENV=development

# gRPC Configuration
GRPC_HOST=0.0.0.0
GRPC_PORT=50051

# Database Configuration
DATABASE_URL=mongodb://localhost:27017/vionex-chat

# Logging
LOG_LEVEL=debug
```

## 🏗️ Architecture

```
┌─────────────────┐    gRPC    ┌──────────────────┐
│   API Gateway   │◄─────────►│   Chat Service   │
└─────────────────┘            └──────────────────┘
                                        │
                                        ▼
                                ┌──────────────────┐
                                │   Message Store  │
                                │   (In-Memory)    │
                                └──────────────────┘
```
