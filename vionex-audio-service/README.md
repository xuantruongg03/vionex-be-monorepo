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

A high-performance microservice for real-time audio processing and speech recognition in the Vionex video conferencing platform. Built with OpenAI's Faster-Whisper for accurate speech-to-text conversion.

## ✨ Key Features

- **Real-time Speech Recognition**: Convert audio streams to text using OpenAI Faster-Whisper
- **Multi-language Support**: Automatic language detection and transcription
- **Audio Buffer Processing**: Efficient PCM audio buffer handling
- **Transcript Management**: Automatic transcript saving and user session management
- **Quality Analysis**: Audio quality assessment and hallucination detection
- **Streaming Support**: Real-time audio streaming via gRPC
- **Performance Optimized**: Threaded processing for low-latency transcription

## 🛠️ Technologies

- **Language**: Python 3.8+
- **AI Engine**: OpenAI Faster-Whisper
- **Communication**: gRPC (grpcio, grpcio-tools)
- **Audio Processing**: NumPy, PyDub
- **Configuration**: python-dotenv
- **Containerization**: Docker
- **Audio Format**: PCM 16-bit, WAV support

## 📁 Project Structure

```
vionex-audio-service/
├── audio_service_clean.py     # Main application entry point
├── core/
│   ├── config.py             # Configuration management
│   └── model.py              # Whisper model initialization
├── service/
│   ├── audio_processor.py    # Core audio processing logic
├── proto/                    # Generated gRPC protocol files
├── transcripts/              # Stored transcript files
├── requirements.txt          # Python dependencies
├── Dockerfile               # Docker configuration
└── README.md                # This file
```

## 📋 Environment Configuration

Create a `.env` file with the following variables:

```bash
# Service Configuration
GRPC_PORT=30005
PYTHON_ENV=development

# Audio Configuration
SAMPLE_RATE=16000
MIN_AUDIO_DURATION=0.5
CHANNELS=1

# Whisper Configuration
WHISPER_MODEL=base
WHISPER_DEVICE=cpu

# Storage Configuration
TRANSCRIPT_DIR=./transcripts

# Logging
LOG_LEVEL=INFO
```

## 🏗️ Architecture

```
┌─────────────────┐    gRPC    ┌──────────────────┐
│   API Gateway   │◄─────────►│   Audio Service  │
└─────────────────┘            └──────────────────┘
                                        │
                                        ▼
                              ┌──────────────────┐
                              │  Audio Processor │
                              │  (Buffer → Array)│
                              └──────────────────┘
                                        │
                                        ▼
                              ┌──────────────────┐
                              │  Faster-Whisper │
                              │  (Speech-to-Text)│
                              └──────────────────┘
                                        │
                                        ▼
                              ┌──────────────────┐
                              │  Transcript      │
                              │  Storage (JSON)  │
                              └──────────────────┘
```

## 🚀 Getting Started

### Prerequisites

- Python 3.8 or higher
- Docker (optional)
- FFmpeg (for audio processing)

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd vionex-audio-service
   ```

2. **Install Python dependencies**
   ```bash
   pip install -r requirements.txt
   ```

3. **Generate proto files** (if needed)
   ```bash
   python -m grpc_tools.protoc -I../protos ../protos/audio.proto --python_out=./proto --grpc_python_out=./proto
   ```

4. **Set up environment variables**
   ```bash
   # Create .env file with your configuration
   cp .env.example .env
   ```

5. **Create transcript directory**
   ```bash
   mkdir transcripts
   ```

### Running the Service

#### Local Development

```bash
python audio_service_clean.py
```

#### Using Docker

1. **Build the Docker image**
   ```bash
   docker build -t vionex-audio-service .
   ```

2. **Run the Docker container**
   ```bash
   docker run --rm -it -p 30005:30005 --env-file .env -v "${PWD}/transcripts:/app/transcripts" vionex-audio-service
   ```

## 🔧 Configuration

### Audio Processing Settings

- **Sample Rate**: 16000 Hz (Whisper requirement)
- **Channels**: Mono (converted automatically)
- **Format**: 16-bit PCM audio buffers
- **Min Duration**: 0.5 seconds minimum audio length

### Whisper Model Options

- **Model Sizes**: tiny, base, small, medium, large
- **Device**: CPU or GPU processing
- **Language**: Auto-detect or specify language code
- **Temperature**: 0.0 for deterministic output

## 📡 gRPC API

### Service Methods

#### `ProcessAudioBuffer`
Process audio buffer and return transcription result.

**Request:**
```protobuf
message AudioBufferRequest {
  bytes audio_buffer = 1;
  string room_id = 2;
  string user_id = 3;
  int32 sample_rate = 4;
  int32 channels = 5;
  float duration = 6;
}
```

**Response:**
```protobuf
message AudioBufferResponse {
  bool success = 1;
  string message = 2;
  string transcript = 3;
  float processing_time = 4;
  bool transcript_saved = 5;
}
```

#### `StartAudioStream`
Start real-time audio streaming session.

#### `StopAudioStream`
Stop audio streaming session.

#### `GetTranscript`
Retrieve stored transcript for a room.

#### `HealthCheck`
Service health status check.

## 📊 Performance Metrics

- **Latency**: < 2 seconds for 5-second audio clips
- **Accuracy**: 90%+ for clear speech
- **Throughput**: Multiple concurrent sessions
- **Memory**: ~1-2GB RAM usage (depends on model)

## 🔍 Monitoring & Debugging

### Logging Levels

- **INFO**: Processing status, transcript results, audio metrics
- **DEBUG**: Detailed processing steps, audio analysis
- **WARNING**: Audio quality issues, potential problems
- **ERROR**: Processing failures, system errors

### Key Metrics Logged

- Audio buffer size and duration
- Audio RMS levels and quality
- Processing time per request
- Transcript length and confidence
- Success/failure rates

## 📄 License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.
