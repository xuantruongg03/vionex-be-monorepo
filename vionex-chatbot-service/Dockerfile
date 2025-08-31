# Stage 1: Build dependencies
FROM python:3.11-slim AS builder

# Prevent interactive prompts
ENV DEBIAN_FRONTEND=noninteractive

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    python3-dev \
    libffi-dev \
    libssl-dev \
    pkg-config \
    git \
    wget \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .

# Install dependencies with pinned compatible versions
RUN pip install --user --no-cache-dir --timeout=300 \
    "numpy==1.26.4"

# Install PyTorch CPU version first (smaller download), GPU will be available via CUDA runtime
RUN pip install --user --no-cache-dir --timeout=600 --retries=3 \
    torch==2.6.0 torchaudio==2.6.0 --index-url https://download.pytorch.org/whl/cpu

# Install remaining requirements
RUN pip install --user --no-cache-dir --timeout=300 -r requirements.txt

# Stage 2: Runtime
FROM python:3.11-slim

# Install runtime dependencies for CUDA support
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget \
    gnupg2 \
    && rm -rf /var/lib/apt/lists/* \
    && rm -rf /tmp/* \
    && rm -rf /var/tmp/*

# Install CUDA Toolkit keyring and repository
RUN wget https://developer.download.nvidia.com/compute/cuda/repos/ubuntu2204/x86_64/cuda-keyring_1.0-1_all.deb \
    && dpkg -i cuda-keyring_1.0-1_all.deb \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
    cuda-cudart-11-8 \
    cuda-compat-11-8 \
    && rm -rf /var/lib/apt/lists/* \
    && rm cuda-keyring_1.0-1_all.deb

# Set CUDA environment variables
ENV CUDA_HOME=/usr/local/cuda-11.8
ENV LD_LIBRARY_PATH=/usr/local/cuda-11.8/lib64:/usr/lib/x86_64-linux-gnu
ENV PATH=/usr/local/cuda-11.8/bin:$PATH

# Copy Python packages from builder stage
COPY --from=builder /root/.local /root/.local

# Cleanup unneeded python caches
RUN find /root/.local -type d -name '__pycache__' -prune -exec rm -rf {} + \
    && find /root/.local -type f -name '*.py[co]' -delete

# Ensure Python user packages are in PATH
ENV PATH=/root/.local/bin:$PATH

# Set environment variables for better GPU utilization
ENV CUDA_VISIBLE_DEVICES=0
ENV PYTORCH_CUDA_ALLOC_CONF=max_split_size_mb:512
ENV TRANSFORMERS_CACHE=/app/models/.cache
ENV HF_HOME=/app/models/.cache

WORKDIR /app

# Copy proto files
COPY proto/ ./proto/

# Copy application code
COPY *.py ./
COPY services/ ./services/
COPY core/ ./core/
COPY clients/ ./clients/

# Create cache directories
RUN mkdir -p /app/models/.cache

# Model files will be downloaded at runtime from Hugging Face
# No need to copy large model files into the image

# Set proper permissions
RUN chmod -R 755 /app && \
    chmod -R 777 /app/models/.cache

# Expose gRPC port
EXPOSE 30007

# Run application
CMD ["python3", "main.py"]
