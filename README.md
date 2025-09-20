<p align="center">
  <img src="https://res.cloudinary.com/dcweof28t/image/upload/v1750399380/image_products/favicon_vo2jtz.png" alt="Vionex Logo" width="200"/>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/NestJS-e0234e?style=for-the-badge&logo=nestjs&logoColor=white" alt="NestJS"/>
  <img src="https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript"/>
  <img src="https://img.shields.io/badge/Python-3776AB?style=for-the-badge&logo=python&logoColor=white" alt="Python"/>
  <img src="https://img.shields.io/badge/gRPC-4285f4?style=for-the-badge&logo=grpc&logoColor=white" alt="gRPC"/>
  <img src="https://img.shields.io/badge/WebRTC-333333?style=for-the-badge&logo=webrtc&logoColor=white" alt="WebRTC"/>
  <img src="https://img.shields.io/badge/AI-FF6B6B?style=for-the-badge&logo=artificial-intelligence&logoColor=white" alt="AI"/>
</p>

# 🎥 Vionex Backend

Enterprise-grade video conferencing platform with AI-powered features, built on modern microservices architecture.

## 🚀 Overview

**Vionex** is a comprehensive video conferencing solution designed for scalability, reliability, and advanced AI capabilities. The platform provides seamless real-time communication with intelligent features like automated transcription, semantic search, and organization-aware multi-tenancy.

### ✨ Key Features

- **HD Video Conferencing**: Crystal-clear video calls with WebRTC SFU architecture
- **AI-Powered Transcription**: Real-time speech-to-text with OpenAI Whisper
- **Semantic Search**: Vector-based transcript search and analysis
- **Organization Support**: Multi-tenant architecture with organization isolation
- **Real-time Chat**: Instant messaging within meeting rooms
- **Interactive Tools**: Whiteboard, polling, voting, and quiz management
- **Screen Sharing**: Desktop and application sharing capabilities
- **Authentication & Authorization**: JWT-based security with role management
- **Microservices Architecture**: Scalable and maintainable service design

## 🏗️ System Architecture

Vionex follows a **microservices architecture** pattern with AI-powered services and organization-aware multi-tenancy:

```
                    ┌─────────────────────┐
                    │    Client Apps      │
                    │   (Web/Mobile)      │
                    └──────────┬──────────┘
                               │ HTTP/WebSocket
                               ▼
                    ┌─────────────────────┐
                    │   API Gateway       │
                    │ (Port 3000)         │
                    │ • Authentication    │
                    │ • Request Routing   │
                    │ • Organization      │
                    └──────────┬──────────┘
                               │ gRPC
        ┌──────────────────────┼──────────────────────┐
        │                      │                      │
        ▼                      ▼                      ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│  Auth Service   │  │  Room Service   │  │  Chat Service   │
│  (Port 30008)   │  │  (Port 30005)   │  │  (Port 30007)   │
│ • JWT Auth      │  │ • Room Mgmt     │  │ • Real-time     │
│ • Organization  │  │ • Participants  │  │   Messaging     │
│ • User Mgmt     │  │ • Permissions   │  │ • Message       │
└─────────────────┘  └─────────────────┘  │   History       │
                               │          └─────────────────┘
                               ▼
                    ┌─────────────────────┐
                    │   SFU Service       │
                    │  (Port 30004)       │
                    │ • WebRTC Media      │
                    │ • Video/Audio       │
                    │ • Screen Share      │
                    └──────────┬──────────┘
                               │
        ┌──────────────────────┼──────────────────────┐
        │                      │                      │
        ▼                      ▼                      ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│ Audio Service   │  │Semantic Service │  │Interaction Svc  │
│ (Port 30008)    │  │ (Port 30006)    │  │ (Port 30010)    │
│ • Whisper AI    │  │ • Vector Search │  │ • Whiteboard    │
│ • Transcription │  │ • Qdrant DB     │  │ • Voting/Polls  │
│ • Organization  │  │ • AI Embeddings │  │ • Quiz Mgmt     │
└─────────┬───────┘  └─────────────────┘  └─────────────────┘
          │
          ▼
┌─────────────────┐
│ Chatbot Service │
│ (Port 30009)    │
│ • OpenChat-3.5  │
│ • GPU Support   │
│ • Organization  │
└─────────────────┘
```

## 🛠️ Technology Stack

### **Backend Framework**
- **NestJS**: Progressive Node.js framework for scalable applications
- **TypeScript**: Type-safe JavaScript development
- **Python**: AI/ML services with advanced libraries

### **Communication & Protocols**
- **gRPC**: High-performance inter-service communication
- **WebSocket**: Real-time bidirectional communication
- **WebRTC**: Peer-to-peer media streaming
- **REST API**: Standard HTTP endpoints

### **AI & Machine Learning**
- **OpenAI Whisper**: Advanced speech-to-text transcription
- **Sentence Transformers**: Semantic text embeddings
- **OpenChat-3.5**: LLM for intelligent chatbot responses
- **Qdrant**: Vector database for semantic search

### **Media & Real-time**
- **Mediasoup**: WebRTC SFU for media routing
- **Socket.io**: Real-time event handling
- **WebRTC**: Browser-native media streaming

### **Databases & Storage**
- **MySQL**: Relational data for auth and organizations
- **Qdrant**: Vector database for transcript embeddings

### **Development & Deployment**
- **Protocol Buffers**: Efficient service communication
- **Docker**: Containerization and deployment
- **JWT**: Secure authentication tokens

## 🔧 Microservices Overview

| Service | Purpose | Technology | Port | Key Features |
|---------|---------|------------|------|--------------|
| **API Gateway** | Main entry point, routing, auth | NestJS, TypeScript | 3000 | HTTP/WebSocket routing, JWT auth, organization context |
| **Auth Service** | Authentication & user management | NestJS, PostgreSQL | 30008 | JWT tokens, organization management, Google OAuth |
| **Room Service** | Meeting room lifecycle | NestJS, MongoDB | 30005 | Room creation, participant management, permissions |
| **SFU Service** | Media streaming & WebRTC | NestJS, Mediasoup | 30004 | Video/audio routing, screen sharing, media optimization |
| **Chat Service** | Real-time messaging | NestJS, In-memory | 30007 | Room-based chat, message history, real-time delivery |
| **Audio Service** | Speech transcription | Python, Whisper AI | 30008 | Real-time STT, organization-aware, multi-language |
| **Semantic Service** | Transcript search & analysis | Python, Qdrant | 30006 | Vector embeddings, semantic search, organization isolation |
| **Chatbot Service** | AI-powered Q&A | Python, OpenChat-3.5 | 30009 | GPU acceleration, transcript-based responses, LoRA fine-tuning |
| **Interaction Service** | Interactive meeting tools | NestJS, MongoDB | 30010 | Whiteboard, voting, polls, quizzes, analytics |

### 🔄 Service Communication Flow

```
1. Client → API Gateway (HTTP/WebSocket)
   ├── Authentication via Auth Service
   ├── Room operations via Room Service
   ├── Media streaming via SFU Service
   └── Chat messages via Chat Service

2. SFU Service → Audio Service (gRPC)
   └── Real-time audio transcription

3. Audio Service → Semantic Service (gRPC)
   └── Vector embedding and storage

4. API Gateway → Chatbot Service (gRPC)
   ├── Query Semantic Service for context
   └── Generate AI responses

5. Interaction Service ↔ API Gateway
   └── Whiteboard, voting, quiz management
```

## 📁 Project Structure

```
vionex-backend/
├── protos/                          # Protocol Buffer definitions (shared)
│   ├── auth.proto                   # Authentication service interfaces
│   ├── room.proto                   # Room management interfaces
│   ├── sfu.proto                    # SFU service interfaces
│   ├── chat.proto                   # Chat service interfaces
│   ├── audio.proto                  # Audio service interfaces
│   ├── semantic.proto               # Semantic service interfaces
│   ├── chatbot.proto                # Chatbot service interfaces
│   ├── interaction.proto            # Interaction service interfaces
│   ├── voting.proto                 # Voting functionality
│   └── whiteboard.proto             # Whiteboard functionality
│
├── vionex-api-getway/               # API Gateway Service
│   ├── src/                         # Gateway source code
│   │   ├── websocket/               # WebSocket handlers
│   │   ├── grpc-clients/           # gRPC client connections
│   │   └── auth/                   # Authentication middleware
│   ├── secrets/                    # SSL certificates
│   └── package.json
│
├── vionex-auth-service/             # Authentication Service
│   ├── src/                        # Auth service source
│   │   ├── entities/               # User & organization entities
│   │   ├── auth.controller.ts      # Auth endpoints
│   │   └── organization.controller.ts # Organization management
│   └── package.json
│
├── vionex-room-service/             # Room Management Service
│   ├── src/                        # Room service source
│   │   ├── room.controller.ts      # Room management
│   │   ├── participant.service.ts  # Participant handling
│   │   └── room.gateway.ts         # WebSocket gateway
│   └── package.json
│
├── vionex-sfu-service/              # SFU Media Service
│   ├── src/                        # SFU service source
│   │   ├── sfu.controller.ts       # Media endpoints
│   │   ├── media/                  # Producer/Consumer management
│   │   └── room/                   # Room management
│   └── package.json
│
├── vionex-chat-service/             # Chat Service
│   ├── src/                        # Chat service source
│   │   ├── chat.controller.ts      # Message endpoints
│   │   ├── chat.service.ts         # Message logic
│   │   └── interfaces/             # Message interfaces
│   └── package.json
│
├── vionex-audio-service/            # Audio Transcription Service
│   ├── service/                    # Audio processing modules
│   │   ├── audio_service_clean.py  # Main service file
│   │   └── whisper_processor.py    # Whisper integration
│   ├── clients/                    # gRPC clients
│   ├── core/                       # Configuration
│   ├── proto/                      # Generated protobuf files
│   └── requirements.txt
│
├── vionex-semantic-service/         # Semantic Search Service
│   ├── services/                   # Semantic processing
│   │   └── semantic_processor.py   # Core semantic logic
│   ├── core/                       # Vector DB & models
│   │   ├── vectordb.py            # Qdrant client
│   │   └── model.py               # AI model handling
│   ├── proto/                      # Generated protobuf files
│   └── requirements.txt
│
├── vionex-chatbot-service/          # AI Chatbot Service
│   ├── src/                        # Chatbot source
│   │   ├── chatbot_server.py       # gRPC server
│   │   └── chatbot_service.py      # AI logic
│   ├── models/                     # Model cache
│   ├── proto/                      # Generated protobuf files
│   └── requirements.txt
│
├── vionex-interaction-service/      # Interaction Service
│   ├── src/                        # Interaction source
│   │   ├── voting.controller.ts    # Voting endpoints
│   │   ├── quiz.controller.ts      # Quiz management
│   │   ├── whiteboard.controller.ts# Whiteboard endpoints
│   │   └── analytics.service.ts    # Analytics processing
│   └── package.json

├── docker-compose.yml              # Docker services configuration
├── LICENSE                         # Project license
└── README.md                       # This documentation
```

## 🚀 Quick Start

### Prerequisites
- **Node.js** 18.0+ for TypeScript services
- **Python** 3.8+ for AI services  
- **MySQL** for authentication data
- **Qdrant** for vector embeddings
- **Docker** (recommended) for easy deployment

### Environment Setup

Each service requires its own `.env` configuration:

### Installation & Running

#### Option 1: Docker (Recommended)
```bash
# Clone repository
git clone https://github.com/xuantruongg03/vionex-backend.git
cd vionex-backend

# Start all services with Docker Compose
docker-compose up -d

# View logs
docker-compose logs -f
```

#### Option 2: Manual Development Setup
```bash
# Install Node.js services
cd vionex-api-getway && npm install && cd ..
cd vionex-auth-service && npm install && cd ..
cd vionex-room-service && npm install && cd ..
cd vionex-sfu-service && npm install && cd ..
cd vionex-chat-service && npm install && cd ..
cd vionex-interaction-service && npm install && cd ..

# Install Python services
cd vionex-audio-service && pip install -r requirements.txt && cd ..
cd vionex-semantic-service && pip install -r requirements.txt && cd ..
cd vionex-chatbot-service && pip install -r requirements.txt && cd ..

# Start external dependencies
docker run -p 5432:5432 -e POSTGRES_PASSWORD=password postgres:13
docker run -p 27017:27017 mongo:5
docker run -p 6333:6333 qdrant/qdrant

# Generate proto files for each service
cd vionex-[service-name] && npm run proto:generate && cd ..

# Start services (separate terminals)
cd vionex-api-getway && npm run start:dev
cd vionex-auth-service && npm run start:dev  
cd vionex-room-service && npm run start:dev
cd vionex-sfu-service && npm run start:dev
cd vionex-chat-service && npm run start:dev
cd vionex-interaction-service && npm run start:dev
cd vionex-audio-service && python audio_service_clean.py
cd vionex-semantic-service && python main.py
cd vionex-chatbot-service && python src/chatbot_server.py
```

### Service Health Check
```bash
# Check all services are running
curl http://localhost:3000/health

## 🔐 Security & Organization Features

### Multi-Tenant Architecture
- **Organization Isolation**: Complete data segregation by organization ID
- **Transcript Security**: Organization-aware transcript storage and search
- **Access Control**: Role-based permissions (Owner, Member)
- **JWT Authentication**: Secure token-based authentication
- **API Security**: gRPC and REST endpoint protection

### AI Security & Privacy
- **Local Processing**: Whisper transcription runs locally
- **Vector Isolation**: Qdrant collections separated by organization
- **Model Privacy**: No data sent to external AI services
- **Secure Search**: Semantic search respects organization boundaries

## 📊 Performance & Scalability

### System Capabilities
- **Concurrent Users**: 10,000+ simultaneous connections
- **Media Quality**: Up to 4K video with adaptive streaming  
- **AI Performance**: Real-time transcription with <2s latency
- **Search Speed**: Vector search results in <50ms
- **Horizontal Scaling**: Independent service scaling

### Resource Requirements
- **API Gateway**: 512MB RAM, 1 CPU core
- **Auth Service**: 256MB RAM, 0.5 CPU core
- **Media Services**: 1GB RAM, 2 CPU cores
- **AI Services**: 2-4GB RAM, GPU recommended for Chatbot

### gRPC Services
Each service exposes gRPC endpoints defined in `/protos`:
- **auth.proto**: Authentication and organization management
- **room.proto**: Room lifecycle and participant management  
- **sfu.proto**: Media streaming and WebRTC signaling
- **chat.proto**: Real-time messaging interfaces
- **audio.proto**: Transcription service with organization context
- **semantic.proto**: Vector search with organization filtering
- **chatbot.proto**: AI responses with organization-aware context
- **interaction.proto**: Interactive tools and analytics

## 📜 License

This project is licensed under a **Custom Research and Educational License**.

- ✅ **Permitted**: Educational use, research, contributions, personal projects
- ❌ **Restricted**: Commercial use without explicit permission
- 📧 **Contact**: For commercial licensing inquiries

See the [LICENSE](LICENSE) file for complete terms.

## 🤝 Contributing

We welcome contributions! Please see individual service READMEs for specific development guidelines.

**Built with ❤️ by the Vionex Team**

For support, questions, or commercial licensing: **lexuantruong098@gmail.com**
