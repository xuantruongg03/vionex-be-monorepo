# Vionex Chatbot Service

<div align="center">
  <img src="https://res.cloudinary.com/dcweof28t/image/upload/v1751123716/image_products/logo_o34pnk.png" alt="Vionex Logo" width="200"/>
  
  <p><strong>AI-Powered Semantic Search & Analysis Service</strong></p>
  
  [![Python](https://img.shields.io/badge/Python-3.8+-blue.svg)](https://python.org/)
  [![gRPC](https://img.shields.io/badge/gRPC-Latest-lightgrey.svg)](https://grpc.io/)
  [![Qdrant](https://img.shields.io/badge/Qdrant-Vector%20DB-red.svg)](https://qdrant.tech/)
  [![Transformers](https://img.shields.io/badge/🤗%20Transformers-Latest-yellow.svg)](https://huggingface.co/transformers/)
</div>

---

AI-powered chatbot service with GPU support for the Vionex video conferencing platform.

## Features

- **GPU-accelerated inference** using CUDA
- **Hugging Face integration** for model loading
- **Private model support** with authentication
- **gRPC API** for high-performance communication
- **Docker containerization** with multi-stage builds
- **Automatic model downloading** at runtime

## Quick Start

### Prerequisites

- Docker with GPU support (NVIDIA Docker)
- NVIDIA GPU with CUDA 11.8+ support
- Hugging Face account (for private models)

### Pull and Run

```bash
# Pull the latest image
docker pull lexuantruong098/vionex-chatbot-service-gpu:latest

# Run with GPU support
docker run --gpus all \
  -p 30007:30007 \
  -e HUGGINGFACE_TOKEN=your_hf_token_here \
  -e BASE_MODEL_REPO=your-username/your-model \
  -e LORA_MODEL_REPO=your-username/your-lora \
  lexuantruong098/vionex-chatbot-service-gpu:latest
```

### Using Docker Compose

```bash
# Create .env file
cp .env.example .env
# Edit .env with your configurations

# Run with docker-compose
docker-compose up -d
```

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `CHATBOT_GRPC_PORT` | gRPC server port | `30007` |
| `HUGGINGFACE_TOKEN` | HF access token for private models | - |
| `BASE_MODEL_REPO` | Base model repository ID | - |
| `LORA_MODEL_REPO` | LoRA adapter repository ID | - |
| `MODEL_CACHE_DIR` | Model cache directory | `/app/models/.cache` |
| `CUDA_VISIBLE_DEVICES` | GPU device selection | `0` |

### Model Configuration

1. **Public Models**: Use repository ID directly
   ```
   BASE_MODEL_REPO=microsoft/DialoGPT-medium
   ```

2. **Private Models**: Require authentication token
   ```
   HUGGINGFACE_TOKEN=hf_xxxxxxxxxxxxx
   BASE_MODEL_REPO=your-username/private-model
   ```

## Development

### Local Build

```bash
# Build image
docker build -t vionex-chatbot-gpu .

# Run locally
docker run --gpus all -p 30007:30007 vionex-chatbot-gpu
```

### Model Requirements

- Model must be compatible with `transformers` library
- CUDA 11.8 compatible
- Supports LoRA adapters via `peft` library

## API Usage

### gRPC Endpoint

```
Service: ChatbotService
Method: AskChatBot
Port: 30007
```

### Example Request

```python
import grpc
from proto import chatbot_pb2, chatbot_pb2_grpc

channel = grpc.insecure_channel('localhost:30007')
stub = chatbot_pb2_grpc.ChatbotServiceStub(channel)

response = stub.AskChatBot(chatbot_pb2.AskChatBotRequest(
    question="What is the weather like?",
    room_id="room123"
))

print(response.answer)
```

## Performance

- **GPU Memory**: Requires 8-16GB VRAM depending on model size
- **RAM**: 4-8GB recommended
- **Storage**: 2-4GB for cached models
- **First Startup**: 2-5 minutes (model download time)

## Troubleshooting

### Common Issues

1. **CUDA not found**: Ensure NVIDIA Docker runtime is installed
2. **Model download fails**: Check internet connection and HF token
3. **Out of memory**: Reduce model size or increase GPU memory
4. **Permission denied**: Check file permissions in cache directory

### Logs

```bash
# View container logs
docker logs <container_id>

# Follow logs in real-time
docker logs -f <container_id>
```

## Production Deployment

### Resource Requirements

```yaml
resources:
  limits:
    nvidia.com/gpu: 1
    memory: "16Gi"
  requests:
    memory: "8Gi"
```

### Health Checks

The container includes built-in health checks:
- Port 30007 connectivity
- gRPC service readiness
- Model loading status

## Docker Commands

### Build and Push

```bash
# Build the image
docker build -t vionex-chatbot-gpu .

# Tag for registry
docker tag vionex-chatbot-gpu lexuantruong098/vionex-chatbot-service-gpu:latest

# Push to Docker Hub
docker push lexuantruong098/vionex-chatbot-service-gpu:latest

# Optional: Push with version tag
docker tag vionex-chatbot-gpu lexuantruong098/vionex-chatbot-service-gpu:v$(date +%Y%m%d)
docker push lexuantruong098/vionex-chatbot-service-gpu:v$(date +%Y%m%d)
```

### Pull and Run on Production

```bash
# Pull latest image
docker pull lexuantruong098/vionex-chatbot-service-gpu:latest

# Run with GPU support
docker run -d \
  --name vionex-chatbot-service \
  --gpus all \
  --restart unless-stopped \
  -p 30007:30007 \
  -e HUGGINGFACE_TOKEN=your_token_here \
  -e BASE_MODEL_REPO=your-username/your-model \
  -v chatbot_cache:/app/models/.cache \
  lexuantruong098/vionex-chatbot-service-gpu:latest

# View logs
docker logs -f vionex-chatbot-service
```

## License

This software is licensed for non-commercial use only.

## Support

For issues and questions, contact: lexuantruong098@gmail.com
