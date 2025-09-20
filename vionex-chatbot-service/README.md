<p align="center">
  <img src="https://res.cloudinary.com/dcweof28t/image/upload/v1750399380/image_products/favicon_vo2jtz.png" alt="Vionex Logo" width="200"/>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Python-3776AB?style=for-the-badge&logo=python&logoColor=white" alt="Python"/>
  <img src="https://img.shields.io/badge/gRPC-4285f4?style=for-the-badge&logo=grpc&logoColor=white" alt="gRPC"/>
  <img src="https://img.shields.io/badge/HuggingFace-FFD21E?style=for-the-badge&logo=huggingface&logoColor=black" alt="HuggingFace"/>
  <img src="https://img.shields.io/badge/CUDA-76B900?style=for-the-badge&logo=nvidia&logoColor=white" alt="CUDA"/>
  <img src="https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white" alt="Docker"/>
</p>

# 🤖 Vionex Chatbot Service

AI-powered chatbot service with GPU acceleration for intelligent conversation and transcript-based Q&A within video meetings.

## ✨ Features

- **GPU-accelerated Inference**: CUDA support for fast response generation
- **Transcript-based Q&A**: Answer questions based on meeting transcripts
- **Organization Support**: Multi-tenant chatbot with organization isolation
- **Hugging Face Integration**: Support for public and private models
- **LoRA Adapters**: Fine-tuned model support via PEFT
- **gRPC Communication**: High-performance service communication

## 🛠️ Technologies

- **Language**: Python 3.8+
- **Framework**: gRPC
- **AI/ML**: Hugging Face Transformers, PEFT (LoRA)
- **Hardware**: NVIDIA CUDA GPU support
- **Containerization**: Docker with GPU runtime
- **Models**: OpenChat-3.5, custom fine-tuned models

## 📁 Project Structure

```
src/
├── chatbot_server.py         # gRPC server implementation
├── chatbot_service.py        # Chatbot logic and model handling
├── proto/
│   ├── chatbot_pb2.py       # Generated protobuf files
│   └── chatbot_pb2_grpc.py  # Generated gRPC files
├── models/                  # Model cache directory
├── requirements.txt         # Python dependencies
└── Dockerfile              # Container configuration
```

## 🔧 Environment Variables

```bash
# Server
CHATBOT_GRPC_PORT=30009
NODE_ENV=production

# GPU Configuration
CUDA_VISIBLE_DEVICES=0
MODEL_CACHE_DIR=/app/models/.cache

# Hugging Face
HUGGINGFACE_TOKEN=your-hf-token
BASE_MODEL_REPO=openchat/openchat-3.5-0106
LORA_MODEL_REPO=your-username/your-lora-adapter

# Semantic Service
SEMANTIC_SERVICE_HOST=localhost
SEMANTIC_SERVICE_PORT=30006
```

## 📋 Installation

```bash
# Install dependencies
pip install -r requirements.txt

# Generate proto files
python -m grpc_tools.protoc -I../protos ../protos/chatbot.proto --python_out=./proto --grpc_python_out=./proto

# Create environment file
cp .env.example .env

# Run service locally
python src/chatbot_server.py

# Run with Docker (GPU support)
docker build -t vionex-chatbot-service .
docker run --gpus all -p 30009:30009 --env-file .env vionex-chatbot-service

# Pull from Docker Hub
docker pull lexuantruong098/vionex-chatbot-service-gpu:latest
docker run --gpus all -p 30009:30009 -e HUGGINGFACE_TOKEN=your_token lexuantruong098/vionex-chatbot-service-gpu:latest
```
