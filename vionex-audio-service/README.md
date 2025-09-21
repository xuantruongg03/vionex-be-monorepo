<p align="center">
  <img src="https://res.cloudinary.com/dcweof28t/image/upload/v1750399380/image_products/favicon_vo2jtz.png" alt="Vionex Logo" width="200"/>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Python-3776AB?style=for-the-badge&logo=python&logoColor=white" alt="Python"/>
  <img src="https://img.shields.io/badge/gRPC-4285f4?style=for-the-badge&logo=grpc&logoColor=white" alt="gRPC"/>
  <img src="https://img.shields.io/badge/AI-FF6B6B?style=for-the-badge&logo=artificial-intelligence&logoColor=white" alt="AI"/>
  <img src="https://img.shields.io/badge/Whisper-00C4CC?style=for-the-badge&logo=openai&logoColor=white" alt="Whisper"/>
  <img src="https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white" alt="Docker"/>
</p>

# 🎤 Vionex Audio Service

Audio processing microservice for speech-to-text conversion using Faster-Whisper with organization isolation support.

## ✨ Features

- **Speech Recognition**: Real-time audio to text conversion using Faster-Whisper
- **Multi-language Support**: Automatic language detection
- **Audio Buffer Processing**: Efficient PCM audio buffer handling
- **Organization Isolation**: Multi-tenant transcript storage
- **Quality Analysis**: Audio quality assessment

## 🛠️ Technologies

- **Language**: Python
- **AI Engine**: Faster-Whisper
- **Communication**: gRPC
- **Audio Processing**: NumPy, PyDub
- **Containerization**: Docker

## 📁 Project Structure

```
src/
├── core/
│   ├── config.py             # Configuration
│   └── model.py              # Whisper model
├── services/
│   └── audio_processor.py    # Audio processing
├── proto/                    # gRPC protocol files
├── transcripts/              # Transcript storage
├── main.py                   # Entry point
├── requirements.txt          # Dependencies
└── Dockerfile               # Docker config
```

## � Environment Variables

```bash
# Service
GRPC_PORT=30005
PYTHON_ENV=development

# Audio
SAMPLE_RATE=16000
MIN_AUDIO_DURATION=0.5
CHANNELS=1

# Whisper
WHISPER_MODEL=base
WHISPER_DEVICE=cpu

# Storage
TRANSCRIPT_DIR=./transcripts

# Logging
LOG_LEVEL=INFO
```

## � Installation

```bash
# Install dependencies
pip install -r requirements.txt

# Generate proto files
python -m grpc_tools.protoc -I../protos ../protos/audio.proto --python_out=./proto --grpc_python_out=./proto

# Create environment file
cp .env.example .env

# Run service
python main.py

# Run with Docker
docker build -t vionex-audio-service .
docker run -p 30005:30005 --env-file .env vionex-audio-service
```
