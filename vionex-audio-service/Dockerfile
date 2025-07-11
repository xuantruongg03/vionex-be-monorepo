FROM ubuntu:22.04

# Prevent interactive prompts
ENV DEBIAN_FRONTEND=noninteractive

RUN apt update && apt install -y \
    python3 \
    python3-pip \
    python3-dev \
    ffmpeg \
    gstreamer1.0-tools \
    gstreamer1.0-plugins-base \
    gstreamer1.0-plugins-good \
    gstreamer1.0-plugins-bad \
    gstreamer1.0-plugins-ugly \
    gstreamer1.0-libav \
    python3-gi \
    gir1.2-gstreamer-1.0 \
    gir1.2-gst-plugins-base-1.0 \
    libglib2.0-dev \
    libgirepository1.0-dev \
    pkg-config \
    && apt clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt ./
RUN pip3 install --no-cache-dir -r requirements.txt

# Test gi import
RUN python3 -c "import gi; print('gi import successful')" || echo "gi import failed"

COPY . .
COPY proto/ proto/

RUN mkdir -p ./transcripts

# Expose gRPC port and UDP port range for RTP
EXPOSE 30005
EXPOSE 35000-35400/udp

# Run
CMD ["python3", "audio_service.py"]
