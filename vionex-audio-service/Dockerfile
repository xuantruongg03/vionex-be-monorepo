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
    libavformat-dev \
    libavcodec-dev \
    libavdevice-dev \
    libavutil-dev \
    libswscale-dev \
    libswresample-dev \
    libavfilter-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .

# Install dependencies with pinned compatible versions
RUN pip install --user --no-cache-dir \
    "numpy==1.26.4" \
    "scipy==1.11.4" \
    "scikit-learn==1.3.2" \
    && pip install --user --no-cache-dir --index-url https://download.pytorch.org/whl/cpu \
    torch==2.6.0+cpu torchaudio==2.6.0+cpu \
    && pip install --user --no-cache-dir -r requirements.txt

# Stage 2: Runtime
FROM python:3.11-slim

# Install only runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libopus0 \
    && rm -rf /var/lib/apt/lists/* \
    && rm -rf /tmp/* \
    && rm -rf /var/tmp/*

# Copy Python packages from builder stage
COPY --from=builder /root/.local /root/.local

# Cleanup unneeded python caches (keep tests for now to avoid module errors)
RUN find /root/.local -type d -name '__pycache__' -prune -exec rm -rf {} + \
    && find /root/.local -type f -name '*.py[co]' -delete

# Ensure Python user packages are in PATH
ENV PATH=/root/.local/bin:$PATH

WORKDIR /app

# Copy proto files
COPY proto/ ./proto/

# Copy application code
COPY *.py ./
COPY service/ ./service/
COPY core/ ./core/
COPY clients/ ./clients/
COPY models/Helsinki-NLP-opus-mt-vi-en /app/models/Helsinki-NLP-opus-mt-vi-en
COPY models/Helsinki-NLP-opus-mt-en-vi /app/models/Helsinki-NLP-opus-mt-en-vi
# COPY models/Helsinki-NLP-opus-mt-vi-lo /app/models/Helsinki-NLP-opus-mt-vi-lo
# COPY models/Helsinki-NLP-opus-mt-lo-vi /app/models/Helsinki-NLP-opus-mt-lo-vi
# COPY models/Helsinki-NLP-opus-mt-en-lo /app/models/Helsinki-NLP-opus-mt-en-lo
# COPY models/Helsinki-NLP-opus-mt-lo-en /app/models/Helsinki-NLP-opus-mt-lo-en

# Create directory structure and copy XTTS-v2 samples for speaker voice reference
RUN mkdir -p /app/models/XTTS-v2
COPY models/XTTS-v2/samples /app/models/XTTS-v2/samples

# Expose gRPC port and UDP port range for RTP
EXPOSE 30005
EXPOSE 35000-35400/udp

# Run application
CMD ["python3", "audio_service.py"]
