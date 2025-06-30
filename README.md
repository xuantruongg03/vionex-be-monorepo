# 🎥 VIONEX - Advanced Video Conferencing Platform

<div align="center">
  <img src="https://res.cloudinary.com/dcweof28t/image/upload/v1751123716/image_products/logo_o34pnk.png" alt="Vionex Logo" width="400"/>
  
  <p><strong>Next-Generation Video Conferencing Solution</strong></p>
  
  [![License](https://img.shields.io/badge/License-Custom-blue.svg)](LICENSE)
  [![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
  [![NestJS](https://img.shields.io/badge/NestJS-10+-red.svg)](https://nestjs.com/)
  [![TypeScript](https://img.shields.io/badge/TypeScript-5+-blue.svg)](https://www.typescriptlang.org/)
  [![gRPC](https://img.shields.io/badge/gRPC-Latest-lightgrey.svg)](https://grpc.io/)
</div>

---

## 🚀 Overview

**Vionex** is a cutting-edge, enterprise-grade video conferencing platform built with modern microservices architecture. Designed for scalability, reliability, and performance, Vionex delivers seamless real-time communication experiences for businesses, educational institutions, and collaborative teams.

### ✨ Key Features

- 🎥 **HD Video Conferencing** - Crystal-clear video calls with adaptive bitrate streaming
- 💬 **Real-time Chat** - Instant messaging with rich media support
- 📋 **Interactive Whiteboard** - Collaborative drawing and presentation tools
- 🗳️ **Live Polling & Voting** - Engage participants with real-time polls
- 🏢 **Room Management** - Advanced meeting room controls and permissions
- 🔄 **WebRTC SFU** - Selective Forwarding Unit for optimized media routing
- 🌐 **REST & WebSocket APIs** - Comprehensive integration capabilities
- 🔒 **Enterprise Security** - End-to-end encryption and access controls

---

## 🏗️ System Architecture

Vionex follows a **microservices architecture** pattern, ensuring scalability, maintainability, and fault tolerance:

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Client Apps   │ ── │  API Gateway     │ ── │  Load Balancer  │
│  (Web/Mobile)   │    │  (Entry Point)   │    │                 │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                │
                    ┌───────────┼───────────┐
                    │           │           │
        ┌───────────▼───┐  ┌────▼────┐  ┌──▼─────────┐
        │  Chat Service │  │   SFU   │  │ Room Mgmt  │
        │   (gRPC)      │  │ Service │  │  Service   │
        └───────────────┘  └─────────┘  └────────────┘
                    │           │           │
        ┌───────────▼───┐  ┌────▼────┐  ┌──▼─────────┐
        │  Whiteboard   │  │ Voting  │  │ Signaling  │
        │   Service     │  │ Service │  │  Service   │
        └───────────────┘  └─────────┘  └────────────┘
```

### 🛠️ Technology Stack

#### **Backend Framework**
- **NestJS** - Progressive Node.js framework for scalable server-side applications
- **TypeScript** - Type-safe JavaScript for enhanced developer experience
- **Node.js 18+** - High-performance JavaScript runtime

#### **Communication Protocols**
- **gRPC** - High-performance RPC framework for inter-service communication
- **WebSocket** - Real-time bidirectional communication
- **REST API** - Standard HTTP-based API endpoints
- **WebRTC** - Peer-to-peer real-time communication

#### **Media Processing**
- **SFU (Selective Forwarding Unit)** - Optimized media routing
- **WebRTC** - Browser-native media streaming
- **Adaptive Bitrate** - Dynamic quality adjustment

#### **Development Tools**
- **Protocol Buffers** - Efficient data serialization
- **ESLint** - Code quality and consistency
- **Jest** - Comprehensive testing framework
- **Docker** - Containerization and deployment

---

## 🏢 Service Architecture

### Core Services

| Service | Purpose | Protocol | Port |
|---------|---------|----------|------|
| **API Gateway** | Main entry point, routing, authentication | HTTP/WS | 3000 |
| **Chat Service** | Real-time messaging, message history | gRPC | 5001 |
| **Room Service** | Meeting room management, permissions | gRPC | 5002 |
| **SFU Service** | Media forwarding, stream management | gRPC/WS | 5003 |
| **Whiteboard Service** | Collaborative drawing, annotations | gRPC | 5004 |
| **Voting Service** | Live polls, surveys, voting systems | gRPC | 5005 |
| **Signaling Service** | WebRTC signaling, peer coordination | gRPC | 5006 |

### 🔄 Communication Flow

1. **Client Connection** → API Gateway (WebSocket/HTTP)
2. **Service Discovery** → gRPC inter-service communication
3. **Media Streaming** → SFU Service (WebRTC)
4. **Real-time Features** → Dedicated microservices
5. **Data Persistence** → Service-specific storage solutions

---

## 🚀 Quick Start

### Prerequisites

- **Node.js** 18.0.0 or higher
- **npm** 8.0.0 or higher
- **Git** for version control

### Installation

```bash
# Clone the repository
git clone https://github.com/your-org/vionex-backend.git
cd vionex-backend

# Install dependencies for all services
npm install

# Build all services
npm run build
```

### Running Services

#### Option 1: Individual Services
```bash
# Start API Gateway
npm run start:gateway

# Start Chat Service
npm run start:chat

# Start Room Service
npm run start:room

# Start SFU Service
npm run start:sfu
```

#### Option 2: Batch Scripts (Windows)
```bash
# Start API Gateway
.\run-gateway.bat

# Start Chat Service
.\run-chat.bat

# Start Room Service
.\run-room.bat

# Start SFU Service
.\run-sfu.bat
```

### Development Mode

```bash
# Run in development mode with hot reload
npm run start:dev

# Run tests
npm run test

# Run e2e tests
npm run test:e2e
```

---

## 📊 Performance & Scalability

- **Concurrent Users**: Supports 10,000+ simultaneous connections
- **Media Quality**: Up to 4K video resolution with adaptive streaming
- **Latency**: < 100ms for real-time features
- **Horizontal Scaling**: Microservices can be scaled independently
- **Load Balancing**: Built-in support for multiple instance deployment

---

## 🔒 Security Features

- **JWT Authentication** - Secure token-based authentication
- **Role-based Access Control** - Granular permission management
- **End-to-end Encryption** - Secure media and message transmission
- **CORS Protection** - Cross-origin request security
- **Rate Limiting** - API abuse prevention
- **Input Validation** - Comprehensive request sanitization

---

## 📚 API Documentation

- **REST API**: Available at `/api/docs` when running
- **gRPC Services**: Protocol buffer definitions in `/protos`
- **WebSocket Events**: Real-time event documentation
- **Postman Collection**: Import-ready API collection

---

## 🤝 Contributing

We welcome contributions from the community! Please read our [Contributing Guidelines](CONTRIBUTING.md) before submitting pull requests.

### Development Workflow

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

---

## 📄 License

This project is licensed under a custom **Research and Educational License**. 

- ✅ **Permitted**: Educational use, research, contributions
- ❌ **Restricted**: Commercial use without explicit permission

See the [LICENSE](LICENSE) file for full details.

For commercial licensing inquiries, please contact us.

----
<div align="center">
  <p>Built with by xuantruongg003</p>
  <p>© 2025 Vionex Project. All rights reserved.</p>
</div>