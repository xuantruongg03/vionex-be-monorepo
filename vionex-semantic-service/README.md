<p align="center">
  <img src="https://res.cloudinary.com/dcweof28t/image/upload/v1750399380/image_products/favicon_vo2jtz.png" alt="Vionex Logo" width="200"/>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Python-3776AB?style=for-the-badge&logo=python&logoColor=white" alt="Python"/>
  <img src="https://img.shields.io/badge/gRPC-4285f4?style=for-the-badge&logo=grpc&logoColor=white" alt="gRPC"/>
  <img src="https://img.shields.io/badge/Qdrant-DC382D?style=for-the-badge&logo=qdrant&logoColor=white" alt="Qdrant"/>
  <img src="https://img.shields.io/badge/HuggingFace-FFD21E?style=for-the-badge&logo=huggingface&logoColor=black" alt="HuggingFace"/>
  <img src="https://img.shields.io/badge/AI-FF6B6B?style=for-the-badge&logo=artificial-intelligence&logoColor=white" alt="AI"/>
</p>

# � Vionex Semantic Service

AI-powered semantic search and transcript analysis service using vector embeddings and Qdrant database.

## ✨ Features

- **Semantic Search**: Vector-based similarity search for meeting transcripts
- **Organization Support**: Multi-tenant transcript storage with organization isolation
- **AI Embeddings**: Sentence Transformers for text vectorization
- **Real-time Indexing**: Instant transcript processing and storage
- **Multi-language Support**: Global language detection and processing
- **Vector Database**: High-performance Qdrant vector storage

## 🛠️ Technologies

- **Language**: Python 3.8+
- **Framework**: gRPC
- **Vector Database**: Qdrant
- **AI/ML**: Sentence Transformers, Hugging Face
- **Embeddings**: all-MiniLM-L6-v2 model
- **Processing**: AsyncIO for concurrent operations

## 📁 Project Structure

```
src/
├── semantic_processor.py    # Core semantic processing logic
├── main.py                  # gRPC server entry point
├── proto/
│   ├── semantic_pb2.py     # Generated protobuf classes
│   └── semantic_pb2_grpc.py# Generated gRPC stubs
├── core/
│   ├── config.py           # Service configuration
│   ├── model.py            # AI model initialization
│   └── vectordb.py         # Qdrant database client
└── requirements.txt        # Python dependencies
```

## 🔧 Environment Variables

```bash
# Server
SEMANTIC_GRPC_PORT=30006
NODE_ENV=development

# Vector Database
QDRANT_HOST=localhost
QDRANT_PORT=6333
COLLECTION_NAME=transcripts

# AI Model Configuration
MODEL_NAME=sentence-transformers/all-MiniLM-L6-v2
MODEL_DEVICE=cpu

# Logging
LOG_LEVEL=INFO
```

## 📋 Installation

```bash
# Install dependencies
pip install -r requirements.txt

# Generate proto files
python -m grpc_tools.protoc -I../protos ../protos/semantic.proto --python_out=./proto --grpc_python_out=./proto

# Start Qdrant database
docker run -p 6333:6333 qdrant/qdrant

# Run service
python main.py

# Run with Docker
docker build -t vionex-semantic-service .
docker run -p 30006:30006 --env-file .env vionex-semantic-service
```
