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

Interactive features microservice for voting, polling, whiteboard, and quiz management in video meetings.

## ✨ Features

- **Voting System**: Real-time voting and polling in meetings
- **Quiz Management**: Interactive quizzes and Q&A sessions
- **Whiteboard Integration**: Collaborative whiteboard functionality
- **Analytics & Reports**: Interaction analytics and data export
- **Survey Tools**: Feedback collection and surveys
- **Engagement Tracking**: Participant engagement monitoring

## 🛠️ Technologies

- **Framework**: NestJS
- **Language**: TypeScript
- **Communication**: gRPC
- **Data Processing**: ExcelJS (for exports)
- **Real-time**: Redis
- **Storage**: MongoDB

## 📁 Project Structure

```
src/
├── voting.controller.ts      # Voting and polling endpoints
├── voting.service.ts         # Voting logic and management
├── quiz.controller.ts        # Quiz management endpoints
├── quiz.service.ts           # Quiz logic and scoring
├── whiteboard.controller.ts  # Whiteboard endpoints
├── whiteboard.service.ts     # Whiteboard state management
├── analytics.service.ts      # Analytics and reporting
├── dto/
│   └── interaction.dto.ts    # Data transfer objects
├── app.module.ts             # Module configuration
└── main.ts                   # Entry point
```

## 🔧 Environment Variables

```bash
# Server
INTERACTION_GRPC_PORT=30010
NODE_ENV=development


# Analytics
ANALYTICS_RETENTION_DAYS=30
EXPORT_BATCH_SIZE=1000
```

## 📋 Installation

```bash
# Install dependencies
npm install
# Run service
npm run start:dev

# Run with Docker
docker build -t vionex-interaction-service .
docker run -p 30010:30010 --env-file .env vionex-interaction-service
```
