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

A microservice specialized in handling media streaming for the Vionex video meeting system. This service uses Mediasoup to provide high-performance, low-latency video/audio streaming capabilities.

## ✨ Key Features

- **Video Streaming**: High-quality video streaming
- **Audio Processing**: Real-time audio processing
- **Screen Sharing**: Screen sharing capabilities
- **Media Routing**: Intelligent media routing
- **Low Latency**: Ultra-low latency streaming
- **Bandwidth Optimization**: Optimized bandwidth usage
- **Media Controls**: Media controls (mute, camera on/off)
- **Scalable Architecture**: Horizontally scalable architecture

## 🛠️ Technologies

- **Framework**: NestJS v11
- **Language**: TypeScript
- **Media Server**: Mediasoup v3.16
- **Real-time**: Socket.io v4.8
- **Communication**: gRPC (@grpc/grpc-js)
- **HTTP Client**: Axios
- **Protocol**: WebRTC
- **Runtime**: Node.js

## 📁 Project Structure

```
src/
├── sfu/
│   ├── sfu.controller.ts      # gRPC controller
│   ├── sfu.service.ts         # Business logic
│   ├── sfu.gateway.ts         # WebSocket gateway
│   └── mediasoup/             # Mediasoup integration
├── media/
│   ├── producer.service.ts    # Media producer management
│   ├── consumer.service.ts    # Media consumer management
│   └── transport.service.ts   # Transport management
├── room/
│   ├── room-manager.ts        # Room management
│   └── participant.manager.ts # Participant tracking
├── shared/
│   ├── interfaces/            # TypeScript interfaces
│   └── utils/                 # Utility functions
├── app.module.ts              # Root module
└── main.ts                   # Application entry point
```

## 🔧 Environment Variables

```bash
# Service Configuration
PORT=50053
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

## 🏗️ Media Pipeline Architecture

```
┌─────────────────┐    WebRTC    ┌──────────────────┐
│   Web Client    │◄───────────►│   SFU Service    │
└─────────────────┘              └──────────────────┘
                                          │
                                          ▼
                                  ┌─────────────────┐
                                  │  Mediasoup SFU  │
                                  │    Routers      │
                                  └─────────────────┘
                                          │
                    ┌─────────────────────┼─────────────────────┐
                    ▼                     ▼                     ▼
            ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
            │   Producer   │    │   Producer   │    │   Producer   │
            │  (Client A)  │    │  (Client B)  │    │  (Client C)  │
            └──────────────┘    └──────────────┘    └──────────────┘
                    │                     │                     │
                    ▼                     ▼                     ▼
            ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
            │   Consumer   │    │   Consumer   │    │   Consumer   │
            │ (Other Peers)│    │ (Other Peers)│    │ (Other Peers)│
            └──────────────┘    └──────────────┘    └──────────────┘
```
