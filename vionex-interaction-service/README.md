<p align="center">
  <img src="https://res.cloudinary.com/dcweof28t/image/upload/v1750399380/image_products/favicon_vo2jtz.png" alt="Vionex Logo" width="200"/>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/NestJS-e0234e?style=for-the-badge&logo=nestjs&logoColor=white" alt="NestJS"/>
  <img src="https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript"/>
  <img src="https://img.shields.io/badge/gRPC-4285f4?style=for-the-badge&logo=grpc&logoColor=white" alt="gRPC"/>
  <img src="https://img.shields.io/badge/Excel-217346?style=for-the-badge&logo=microsoft-excel&logoColor=white" alt="Excel"/>
  <img src="https://img.shields.io/badge/Microservice-FF6B6B?style=for-the-badge&logo=microgenetics&logoColor=white" alt="Microservice"/>
</p>

# 🎯 Vionex Interaction Service

A microservice that manages interactions and interactive activities within the Vionex video meeting system. This service handles features like voting, quizzes, whiteboard, polling, and other interactive activities in meeting rooms.

## ✨ Key Features

- **Voting System**: Voting and polling mechanisms
- **Real-time Polling**: Real-time opinion polling
- **Whiteboard Integration**: Interactive whiteboard integration
- **Quiz Management**: Quiz and question management
- **Analytics & Reports**: Interaction analytics and reporting
- **Survey Tools**: Survey and feedback tools
- **Engagement Tracking**: Participation level tracking
- **Data Export**: Excel data export capabilities

## 🛠️ Technologies

- **Framework**: NestJS v11
- **Language**: TypeScript
- **Communication**: gRPC (@grpc/grpc-js)
- **Data Processing**: ExcelJS v4.4
- **Configuration**: @nestjs/config
- **Microservices**: @nestjs/microservices
- **Runtime**: Node.js

## 📁 Project Structure

```
src/
├── voting/
│   ├── voting.controller.ts   # Voting gRPC controller
│   ├── voting.service.ts      # Voting business logic
│   └── dto/                   # Voting DTOs
├── quiz/
│   ├── quiz.controller.ts     # Quiz management
│   ├── quiz.service.ts        # Quiz logic
│   └── models/                # Quiz models
├── polling/
│   ├── polling.controller.ts  # Polling controller
│   ├── polling.service.ts     # Polling service
│   └── types/                 # Polling types
├── whiteboard/
│   ├── whiteboard.controller.ts # Whiteboard controller
│   ├── whiteboard.service.ts   # Whiteboard service
│   └── events/                 # Whiteboard events
├── analytics/
│   ├── analytics.service.ts   # Analytics processing
│   ├── export.service.ts      # Data export service
│   └── reports/               # Report generators
├── shared/
│   ├── interfaces/            # TypeScript interfaces
│   ├── validators/            # Data validators
│   └── utils/                 # Utility functions
├── app.module.ts              # Root module
└── main.ts                   # Application entry point
```

## Environment Variables

```bash
# Service Configuration
PORT=50054
NODE_ENV=development

# gRPC Configuration
GRPC_HOST=0.0.0.0
GRPC_PORT=50054

# Database Configuration
DATABASE_URL=mongodb://localhost:27017/vionex-interactions

# Redis Configuration (for real-time features)
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# File Storage
UPLOAD_DIR=./uploads
MAX_FILE_SIZE=10MB

# Analytics
ANALYTICS_RETENTION_DAYS=30
EXPORT_BATCH_SIZE=1000
```

## 🏗️ Architecture

```
┌─────────────────┐    gRPC    ┌──────────────────────┐
│   API Gateway   │◄─────────►│ Interaction Service  │
└─────────────────┘            └──────────────────────┘
                                        │
                        ┌───────────────┼───────────────┐
                        ▼               ▼               ▼
                ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
                │   Voting    │ │    Quiz     │ │ Whiteboard  │
                │   Engine    │ │   Engine    │ │   Engine    │
                └─────────────┘ └─────────────┘ └─────────────┘
                        │               │               │
                        ▼               ▼               ▼
                ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
                │   Results   │ │  Analytics  │ │   Canvas    │
                │   Store     │ │   Engine    │ │   State     │
                └─────────────┘ └─────────────┘ └─────────────┘
```
