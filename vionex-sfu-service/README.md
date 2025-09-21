<p align="center">
  <img src="https://res.cloudinary.com/dcweof28t/image/upload/v1750399380/image_products/favicon_vo2jtz.png" alt="Vionex Logo" width="200"/>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/NestJS-e0234e?style=for-the-badge&logo=nestjs&logoColor=white" alt="NestJS"/>
  <img src="https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript"/>
  <img src="https://img.shields.io/badge/WebRTC-333333?style=for-the-badge&logo=webrtc&logoColor=white" alt="WebRTC"/>
  <img src="https://img.shields.io/badge/Mediasoup-FF6B35?style=for-the-badge&logo=webrtc&logoColor=white" alt="Mediasoup"/>
  <img src="https://img.shields.io/badge/Socket.io-black?style=for-the-badge&logo=socket.io&badgeColor=010101" alt="Socket.io"/>
</p>

# 📡 Vionex SFU Service

Selective Forwarding Unit (SFU) microservice for high-performance video/audio streaming using Mediasoup WebRTC.

## ✨ Features

- **Video/Audio Streaming**: High-quality real-time media streaming
- **Screen Sharing**: Desktop and application screen sharing
- **Media Routing**: Intelligent media routing and bandwidth optimization
- **WebRTC Support**: Full WebRTC implementation with SFU architecture
- **Low Latency**: Ultra-low latency streaming for real-time communication
- **Scalable Media**: Horizontally scalable media processing

## 🛠️ Technologies

- **Framework**: NestJS
- **Language**: TypeScript
- **Media Server**: Mediasoup v3.16
- **Real-time**: Socket.io
- **Communication**: gRPC, WebRTC
- **Protocol**: WebRTC SFU architecture

## 📁 Project Structure

```
src/
├── sfu.controller.ts         # gRPC media endpoints
├── sfu.service.ts            # SFU logic and media management
├── sfu.gateway.ts            # WebSocket gateway for WebRTC
├── media/
│   ├── producer.service.ts   # Media producer management
│   ├── consumer.service.ts   # Media consumer management
│   └── transport.service.ts  # WebRTC transport management
├── room/
│   └── room-manager.ts       # Room and participant management
├── app.module.ts             # Module configuration
└── main.ts                   # Entry point
```

## 🔧 Environment Variables

```bash
# Server
SFU_GRPC_PORT=30004
NODE_ENV=development

# Mediasoup Configuration
MEDIASOUP_LISTEN_IP=0.0.0.0
MEDIASOUP_ANNOUNCED_IP=127.0.0.1
MEDIASOUP_MIN_PORT=40000
MEDIASOUP_MAX_PORT=49999

# WebRTC Configuration
WEBRTC_LISTEN_IP=0.0.0.0
WEBRTC_ANNOUNCED_IP=127.0.0.1

# TURN Server (optional)
TURN_SERVER_URL=turn:turnserver.example.com:3478
TURN_USERNAME=username
TURN_PASSWORD=password

# Performance
MAX_BITRATE=3000000
MAX_PARTICIPANTS_PER_ROUTER=100
```

## 📋 Installation

```bash
# Install dependencies
npm install

# Run service
npm run start:dev

# Run with Docker
docker build -t vionex-sfu-service .
docker run -p 30004:30004 -p 40000-49999:40000-49999/udp --env-file .env vionex-sfu-service
```
