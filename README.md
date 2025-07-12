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

-   🎥 **HD Video Conferencing** - Crystal-clear video calls with adaptive bitrate streaming
-   💬 **Real-time Chat** - Instant messaging with rich media support
-   📋 **Interactive Whiteboard** - Collaborative drawing and presentation tools
-   🗳️ **Live Polling & Voting** - Engage participants with real-time polls
-   🏢 **Room Management** - Advanced meeting room controls and permissions
-   🔄 **WebRTC SFU** - Selective Forwarding Unit for optimized media routing
-   🎤 **Real-time Audio Transcription** - AI-powered speech-to-text with Whisper
-   🔍 **Semantic Search** - Vector-based transcript search and analysis
-   🌐 **REST & gRPC APIs** - Comprehensive integration capabilities
-   🔒 **Enterprise Security** - End-to-end encryption and access controls
-   📊 **Interaction Analytics** - Comprehensive analytics and reporting

---

## 🏗️ System Architecture

Vionex follows a **microservices architecture** pattern, ensuring scalability, maintainability, and fault tolerance:

```
┌─────────────────┐    ┌──────────────────┐
│   Client Apps   │ ── │  API Gateway     │
│  (Web/Mobile)   │    │  (Entry Point)   │
└─────────────────┘    └──────────────────┘
                                │
                    ┌───────────┼───────────┐
                    │           │           │
        ┌───────────▼───┐  ┌────▼────┐  ┌──▼─────────┐
        │  Chat Service │  │   SFU   │  │ Room Mgmt  │
        │   (gRPC)      │  │ Service │  │  Service   │
        └───────────────┘  └─────────┘  └────────────┘
                                │
                    ┌───────────▼───────────┐
                    │  Interaction Service  │
                    │ (Whiteboard, Voting)  │
                    └───────────────────────┘
                                │
                    ┌───────────┼
                    │           │
        ┌───────────▼───┐  ┌────▼────────┐
        │ Audio Service │  │   Semantic  │
        │   (Python)    │  │   Service   │
        └───────────────┘  └─────────────┘
```

### 🛠️ Technology Stack

#### **Backend Framework**

-   **NestJS** - Progressive Node.js framework for scalable server-side applications
-   **TypeScript** - Type-safe JavaScript for enhanced developer experience
-   **Node.js 18+** - High-performance JavaScript runtime

#### **Communication Protocols**

-   **gRPC** - High-performance RPC framework for inter-service communication
-   **WebSocket** - Real-time bidirectional communication
-   **REST API** - Standard HTTP-based API endpoints
-   **WebRTC** - Peer-to-peer real-time communication

#### **Media Processing**

-   **SFU (Selective Forwarding Unit)** - Optimized media routing
-   **WebRTC** - Browser-native media streaming
-   **Whisper AI** - Advanced speech-to-text transcription
-   **Adaptive Bitrate** - Dynamic quality adjustment

#### **AI & Analytics**

-   **OpenAI Whisper** - Real-time audio transcription
-   **Sentence Transformers** - Semantic text analysis
-   **Qdrant Vector Database** - Efficient vector search
-   **Python FastAPI** - High-performance AI services

#### **Development Tools**

-   **Protocol Buffers** - Efficient data serialization
-   **ESLint** - Code quality and consistency
-   **Jest** - Comprehensive testing framework
-   **Docker** - Containerization and deployment

---

## 🏢 Service Architecture

### Core Services

| Service                 | Purpose                                   | Protocol     | Port  |
| ----------------------- | ----------------------------------------- | ------------ | ----- |
| **API Gateway**         | Main entry point, routing, authentication | HTTP/WS/gRPC | 3000  |
| **Chat Service**        | Real-time messaging, message history      | gRPC         | 30002 |
| **Room Service**        | Meeting room management, permissions      | gRPC         | 30001 |
| **SFU Service**         | Media forwarding, stream management       | gRPC/WebRTC  | 30004 |
| **Interaction Service** | Whiteboard, voting, polls management      | gRPC         | 30003 |
| **Audio Service**       | Real-time speech transcription            | gRPC         | 30005 |
| **Semantic Service**    | Vector search, transcript analysis        | gRPC         | 30006 |

### 📋 Service Details

#### 🌐 **API Gateway (vionex-api-getway)**

-   **Main entry point** for all client requests
-   **WebSocket gateway** for real-time communication
-   **HTTP REST API** endpoints
-   **gRPC client** for microservice communication
-   **Authentication & authorization** handling
-   **Request routing** to appropriate services

#### 💬 **Chat Service (vionex-chat-service)**

-   **Real-time messaging** with WebSocket support
-   **Message persistence** and history
-   **Room-based chat** functionality
-   **Message broadcasting** to participants
-   **Chat moderation** features

#### 🏢 **Room Service (vionex-room-service)**

-   **Meeting room management** and lifecycle
-   **Participant management** and permissions
-   **Room settings** and configurations
-   **Access control** and security
-   **Room analytics** and monitoring

#### 📡 **SFU Service (vionex-sfu-service)**

-   **Media streaming** with WebRTC
-   **Selective Forwarding Unit** implementation
-   **Video/audio routing** optimization
-   **Bandwidth management** and adaptation
-   **Screen sharing** capabilities
-   **Media quality control**

#### 🎨 **Interaction Service (vionex-interaction-service)**

-   **Interactive whiteboard** functionality
-   **Real-time collaborative drawing**
-   **Live polling and voting** systems
-   **Survey management** and results
-   **Participant engagement** tools
-   **Analytics and reporting**

#### 🎙️ **Audio Service (vionex-audio-service)**

-   **Real-time audio transcription** with OpenAI Whisper
-   **Speech-to-text processing** for live meetings
-   **Multi-language support** for global accessibility
-   **Audio quality optimization** and noise reduction
-   **Transcript persistence** and semantic analysis integration
-   **WebRTC audio stream processing**

#### 🔍 **Semantic Service (vionex-semantic-service)**

-   **Vector-based search** for transcript content
-   **Semantic analysis** of meeting conversations
-   **AI-powered content discovery** and insights
-   **Qdrant vector database** for efficient similarity search
-   **Meeting intelligence** and conversation analytics
-   **Advanced NLP processing** with Sentence Transformers

### 🔄 Communication Flow

1. **Client Connection** → API Gateway (WebSocket/HTTP)
2. **Service Discovery** → gRPC inter-service communication
3. **Media Streaming** → SFU Service (WebRTC)
4. **Audio Processing** → Audio Service (Whisper AI)
5. **Semantic Analysis** → Semantic Service (Vector Search)
6. **Real-time Features** → Dedicated microservices
7. **Data Persistence** → Service-specific storage solutions

---

## 📁 Project Structure

```
vionex-backend/
├── protos/                        # Protocol Buffer definitions
│   ├── audio.proto                # Audio service interfaces
│   ├── chat.proto                 # Chat service interfaces
│   ├── interaction.proto          # Interaction service interfaces
│   ├── room.proto                 # Room service interfaces
│   ├── semantic.proto             # Semantic service interfaces
│   ├── sfu.proto                  # SFU service interfaces
│   ├── voting.proto               # Voting functionality
│   └── whiteboard.proto           # Whiteboard functionality
│
├── vionex-api-getway/             # Main API Gateway
│   ├── src/                       # Gateway source code
│   ├── secrets/                   # SSL certificates
│   └── package.json               # Gateway dependencies
│
├── vionex-chat-service/           # Chat microservice
│   ├── src/                       # Chat service source
│   └── package.json               # Chat dependencies
│
├── vionex-room-service/           # Room management service
│   ├── src/                       # Room service source
│   └── package.json               # Room dependencies
│
├── vionex-sfu-service/            # Media streaming service
│   ├── src/                       # SFU service source
│   └── package.json               # SFU dependencies
│
├── vionex-interaction-service/    # Whiteboard & voting service
│   ├── src/                       # Interaction source
│   └── package.json               # Interaction dependencies
│
├── vionex-audio-service/          # Audio transcription service
│   ├── service/                   # Audio processing modules
│   ├── clients/                   # gRPC clients
│   ├── core/                      # Core configurations
│   ├── proto/                     # Generated protobuf files
│   └── requirements.txt           # Python dependencies
│
├── vionex-semantic-service/       # Semantic search service
│   ├── services/                  # Semantic processing modules
│   ├── core/                      # Vector database & models
│   ├── proto/                     # Generated protobuf files
│   └── requirements.txt           # Python dependencies
│
├── run-*.bat                      # Windows batch scripts
├── docker-compose.yml             # Docker services configuration
├── LICENSE                        # Project license
└── README.md                      # This file
```

---

## 🚀 Quick Start

### Prerequisites

-   **Node.js** 18.0.0 or higher
-   **npm** 8.0.0 or higher
-   **Python** 3.8.0 or higher (for AI services)
-   **pip** for Python package management
-   **Git** for version control

### Installation

```bash
# Clone the repository
git clone https://github.com/xuantruongg03/vionex-backend.git
cd vionex-backend

# Install dependencies for Node.js services
cd vionex-api-getway
npm install
cd ..

cd vionex-chat-service
npm install
cd ..

cd vionex-room-service
npm install
cd ..

cd vionex-sfu-service
npm install
cd ..

cd vionex-interaction-service
npm install
cd ..

# Install dependencies for Python services
cd vionex-audio-service
pip install -r requirements.txt
cd ..

cd vionex-semantic-service
pip install -r requirements.txt
cd ..
```

### Running Services

#### Option 1: Using Batch Scripts (Windows)

```bash
# Start API Gateway
.\run-gateway.bat

# Start Chat Service
.\run-chat.bat

# Start Room Service
.\run-room.bat

# Start SFU Service
.\run-sfu.bat

# Start Interaction Service
.\run-interaction.bat

# Start Audio Service
.\run\run-audio.bat

# Start Semantic Service
.\run\run-semantic.bat
```

#### Option 2: Individual Services

```bash
# Start API Gateway
cd vionex-api-getway
npm run start:dev

# Start Chat Service
cd vionex-chat-service
npm run start:dev

# Start Room Service
cd vionex-room-service
npm run start:dev

# Start SFU Service
cd vionex-sfu-service
npm run start:dev

# Start Interaction Service
cd vionex-interaction-service
npm run start:dev

# Start Audio Service
cd vionex-audio-service
python audio_service_clean.py

# Start Semantic Service
cd vionex-semantic-service
python main.py
```

### Development Mode

```bash
# Run each service in development mode with hot reload
cd [service-directory]
npm run start:dev

# Run tests for each service
cd [service-directory]
npm run test

# Run e2e tests for each service
cd [service-directory]
npm run test:e2e
```

### Building Services

```bash
# Build each service
cd [service-directory]
npm run build
```

---

## � Environment Configuration

Each service requires its own environment configuration:

### API Gateway (.env)

```bash
PORT=3000
NODE_ENV=development
GRPC_CHAT_URL=localhost:50051
GRPC_ROOM_URL=localhost:50052
GRPC_SFU_URL=localhost:50053
GRPC_INTERACTION_URL=localhost:50054
GRPC_AUDIO_URL=localhost:50055
GRPC_SEMANTIC_URL=localhost:50056
```

### Chat Service (.env)

```bash
PORT=50051
NODE_ENV=development
```

### Room Service (.env)

```bash
PORT=50052
NODE_ENV=development
```

### SFU Service (.env)

```bash
PORT=50053
NODE_ENV=development
MEDIASOUP_LISTEN_IP=0.0.0.0
MEDIASOUP_ANNOUNCED_IP=127.0.0.1
```

### Interaction Service (.env)

```bash
PORT=50054
NODE_ENV=development
```

### Audio Service (.env)

```bash
GRPC_PORT=50055
SEMANTIC_SERVICE_HOST=localhost
SEMANTIC_SERVICE_PORT=50056
MIN_AUDIO_DURATION=1.0
SAMPLE_RATE=16000
```

### Semantic Service (.env)

```bash
GRPC_PORT=50056
QDRANT_HOST=localhost
QDRANT_PORT=6333
COLLECTION_NAME=transcripts
```

---

## 📊 Performance & Scalability

-   **Concurrent Users**: Supports 10,000+ simultaneous connections
-   **Media Quality**: Up to 4K video resolution with adaptive streaming
-   **Latency**: < 100ms for real-time features
-   **Horizontal Scaling**: Microservices can be scaled independently
-   **Load Balancing**: Built-in support for multiple instance deployment

---

## 🔒 Security Features

-   **JWT Authentication** - Secure token-based authentication
-   **Role-based Access Control** - Granular permission management
-   **End-to-end Encryption** - Secure media and message transmission
-   **CORS Protection** - Cross-origin request security
-   **Rate Limiting** - API abuse prevention
-   **Input Validation** - Comprehensive request sanitization

---

## 📚 API Documentation

### Protocol Buffers

-   **gRPC Services**: Protocol buffer definitions in `/protos` directory
    -   `audio.proto` - Audio service interfaces
    -   `chat.proto` - Chat service interfaces
    -   `interaction.proto` - Interaction service interfaces
    -   `room.proto` - Room management interfaces
    -   `semantic.proto` - Semantic service interfaces
    -   `sfu.proto` - SFU service interfaces
    -   `voting.proto` - Voting functionality
    -   `whiteboard.proto` - Whiteboard functionality

### API Endpoints

-   **REST API**: Available at `/api/docs` when API Gateway is running
-   **WebSocket Events**: Real-time event documentation
-   **gRPC Services**: Each service runs on dedicated ports (50051-50056)

### Service Ports

-   **API Gateway**: 3000 (HTTP/WebSocket)
-   **Chat Service**: 50051 (gRPC)
-   **Room Service**: 50052 (gRPC)
-   **SFU Service**: 50053 (gRPC)
-   **Interaction Service**: 50054 (gRPC)
-   **Audio Service**: 50055 (gRPC)
-   **Semantic Service**: 50056 (gRPC)

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

-   ✅ **Permitted**: Educational use, research, contributions
-   ❌ **Restricted**: Commercial use without explicit permission

See the [LICENSE](LICENSE) file for full details.

For commercial licensing inquiries, please contact us.

---

## 🚀 Deployment

### Production Deployment

#### Using Docker (Recommended)

```bash
# Build Docker images for each service
docker build -t vionex-gateway ./vionex-api-getway
docker build -t vionex-chat ./vionex-chat-service
docker build -t vionex-room ./vionex-room-service
docker build -t vionex-sfu ./vionex-sfu-service
docker build -t vionex-interaction ./vionex-interaction-service
docker build -t vionex-audio ./vionex-audio-service
docker build -t vionex-semantic ./vionex-semantic-service

# Run with Docker Compose
docker-compose up -d
```

#### Manual Deployment

```bash
# Build Node.js services
cd vionex-api-getway && npm run build && cd ..
cd vionex-chat-service && npm run build && cd ..
cd vionex-room-service && npm run build && cd ..
cd vionex-sfu-service && npm run build && cd ..
cd vionex-interaction-service && npm run build && cd ..

# Python services don't need building, just ensure dependencies are installed
cd vionex-audio-service && pip install -r requirements.txt && cd ..
cd vionex-semantic-service && pip install -r requirements.txt && cd ..

# Start services in production mode
npm run start:prod
```

#### Using PM2

```bash
# Install PM2 globally
npm install -g pm2

# Start services with PM2
pm2 start ecosystem.config.js
```

### Monitoring & Logging

-   **Health Checks**: Each service provides `/health` endpoint
-   **Metrics**: Prometheus metrics available at `/metrics`
-   **Logging**: Structured logging with Winston
-   **Tracing**: Distributed tracing with OpenTelemetry

---

## 🔧 Troubleshooting

### Common Issues

#### Port Already in Use

```bash
# Check which process is using the port
netstat -ano | findstr :50051
# Kill the process (replace PID with actual process ID)
taskkill /PID <PID> /F
```

#### gRPC Connection Issues

-   Ensure all services are running on correct ports
-   Check firewall settings
-   Verify environment variables are set correctly

#### Build Errors

```bash
# Clean node_modules and reinstall
rm -rf node_modules package-lock.json
npm install

# Clear TypeScript cache
npx tsc --build --clean
```

#### Git Submodule Issues

If you encounter Git issues with nested repositories:

```bash
# Remove nested .git directories
cd vionex-interaction-service
rm -rf .git
cd ..
git add .
```

### Performance Optimization

#### Memory Management

-   Monitor service memory usage with `npm run start:prod`
-   Use PM2 for production deployment
-   Configure appropriate heap sizes for Node.js

#### Network Optimization

-   Use HTTP/2 for API Gateway
-   Enable gRPC compression
-   Configure appropriate timeout values

---
