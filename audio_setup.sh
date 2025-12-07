#!/bin/bash

################################################################################
# Vionex Audio Service Setup Script for Ubuntu 24.04
# 
# This script installs and configures:
# - CUDA 12.8 + cuDNN 9 (for GPU support)
# - Python environment with all dependencies
# - Audio Service dependencies (Whisper, TTS, Opus, FFmpeg)
# - PM2 for process management
#
# Usage: sudo bash audio_setup.sh
# 
# NOTE: Run this script from the vionex-backend directory
################################################################################

################################################################################
# ⚠️  CONFIGURATION - CHANGE THESE VALUES BEFORE RUNNING
################################################################################

# Your server's public IP address (required for WebRTC/Mediasoup)
SERVER_IP="YOUR_SERVER_IP_HERE"

# Semantic Service configuration
SEMANTIC_SERVICE_HOST="localhost"
SEMANTIC_SERVICE_PORT="30006"

# SFU Service configuration  
SFU_SERVICE_HOST="localhost"

# Audio Service gRPC port
AUDIO_GRPC_PORT="30005"

# Audio RTP port range
AUDIO_MIN_PORT="35000"
AUDIO_MAX_PORT="35400"

################################################################################

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
    log_error "Please run as root (use sudo)"
    exit 1
fi

# Get the actual user who ran sudo
ACTUAL_USER=${SUDO_USER:-$USER}
ACTUAL_HOME=$(eval echo ~$ACTUAL_USER)

log_info "Starting Vionex Audio Service Setup for Ubuntu 24.04..."
log_info "Running as root, actual user: $ACTUAL_USER"
echo "========================================"

################################################################################
# 1. System Preparation
################################################################################
log_info "Step 1: Preparing system..."

# Kill and disable unattended upgrades to prevent conflicts
log_info "Stopping all unattended-upgrades processes..."
systemctl stop unattended-upgrades 2>/dev/null || true
systemctl disable unattended-upgrades 2>/dev/null || true
systemctl mask unattended-upgrades 2>/dev/null || true

# Kill any running unattended-upgrades processes
pkill -9 unattended-upgr 2>/dev/null || true
pkill -9 apt.systemd.dai 2>/dev/null || true
pkill -9 apt-get 2>/dev/null || true

# Wait for dpkg lock to be released
log_info "Waiting for dpkg lock to be released..."
max_wait=60
wait_count=0
while fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1; do
    if [ $wait_count -ge $max_wait ]; then
        log_error "Timeout waiting for dpkg lock. Please run: sudo kill -9 \$(lsof -t /var/lib/dpkg/lock-frontend)"
        exit 1
    fi
    echo -n "."
    sleep 2
    wait_count=$((wait_count + 2))
done
echo ""

# Remove stale locks if they exist
log_info "Removing stale locks..."
rm -f /var/lib/dpkg/lock-frontend 2>/dev/null || true
rm -f /var/lib/dpkg/lock 2>/dev/null || true
rm -f /var/cache/apt/archives/lock 2>/dev/null || true

# Reconfigure dpkg
log_info "Reconfiguring dpkg..."
dpkg --configure -a

# Update system
log_info "Updating package lists..."
apt-get update

# Install basic dependencies
log_info "Installing basic dependencies..."
DEBIAN_FRONTEND=noninteractive apt-get install -y \
    wget \
    curl \
    git \
    build-essential \
    software-properties-common \
    lsof \
    htop \
    unzip

log_success "System preparation completed"

################################################################################
# 2. CUDA 12.8 Installation (Ubuntu 24.04)
################################################################################
log_info "Step 2: Installing CUDA 12.8..."

# Check if NVIDIA GPU exists
if ! lspci | grep -i nvidia > /dev/null 2>&1; then
    log_warning "No NVIDIA GPU detected. Skipping CUDA installation..."
    log_warning "Audio service will run in CPU mode."
    USE_GPU=false
else
    USE_GPU=true
    
    if [ -d "/usr/local/cuda-12.8" ]; then
        log_warning "CUDA 12.8 already installed, skipping..."
    else
        log_info "Downloading CUDA keyring for Ubuntu 24.04..."
        wget -q https://developer.download.nvidia.com/compute/cuda/repos/ubuntu2404/x86_64/cuda-keyring_1.1-1_all.deb
        
        log_info "Installing CUDA keyring..."
        dpkg -i cuda-keyring_1.1-1_all.deb
        rm cuda-keyring_1.1-1_all.deb
        
        log_info "Installing CUDA runtime and compatibility..."
        apt-get update
        DEBIAN_FRONTEND=noninteractive apt-get install -y cuda-cudart-12-8 cuda-compat-12-8
        
        log_success "CUDA 12.8 installed"
    fi
fi

################################################################################
# 3. cuDNN 9 Installation
################################################################################
if [ "$USE_GPU" = true ]; then
    log_info "Step 3: Installing cuDNN 9..."

    if dpkg -l | grep -q libcudnn9-cuda-12; then
        log_warning "cuDNN 9 already installed, skipping..."
    else
        log_info "Installing cuDNN 9 for CUDA 12..."
        DEBIAN_FRONTEND=noninteractive apt-get install -y libcudnn9-cuda-12 libcudnn9-dev-cuda-12
        log_success "cuDNN 9 installed"
    fi
else
    log_info "Step 3: Skipping cuDNN (no GPU)..."
fi

################################################################################
# 4. Environment Variables Setup
################################################################################
log_info "Step 4: Setting up environment variables..."

if [ "$USE_GPU" = true ]; then
    # Add CUDA paths to system-wide environment
    CUDA_ENV_FILE="/etc/profile.d/cuda.sh"
    if [ ! -f "$CUDA_ENV_FILE" ]; then
        log_info "Creating CUDA environment file..."
        cat > "$CUDA_ENV_FILE" << 'EOF'
export CUDA_HOME=/usr/local/cuda-12.8
export LD_LIBRARY_PATH=$CUDA_HOME/lib64:/usr/lib/x86_64-linux-gnu:$LD_LIBRARY_PATH
export PATH=$CUDA_HOME/bin:$PATH
EOF
        chmod +x "$CUDA_ENV_FILE"
        log_success "CUDA environment configured"
    else
        log_warning "CUDA environment file already exists"
    fi

    # Source the environment for current session
    export CUDA_HOME=/usr/local/cuda-12.8
    export LD_LIBRARY_PATH=$CUDA_HOME/lib64:/usr/lib/x86_64-linux-gnu:$LD_LIBRARY_PATH
    export PATH=$CUDA_HOME/bin:$PATH
fi

################################################################################
# 5. Python 3 Installation
################################################################################
log_info "Step 5: Installing Python 3 and pip..."

DEBIAN_FRONTEND=noninteractive apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    python3-dev \
    python3-full

log_success "Python 3 installed"

################################################################################
# 6. Audio Processing Dependencies (CRITICAL)
################################################################################
log_info "Step 6: Installing audio processing dependencies..."

# Install Opus codec library (REQUIRED for opuslib)
log_info "Installing Opus codec..."
DEBIAN_FRONTEND=noninteractive apt-get install -y libopus0 libopus-dev

# Install FFmpeg (REQUIRED for audio processing)
log_info "Installing FFmpeg..."
DEBIAN_FRONTEND=noninteractive apt-get install -y ffmpeg

# Install PortAudio (REQUIRED for audio I/O)
log_info "Installing PortAudio..."
DEBIAN_FRONTEND=noninteractive apt-get install -y portaudio19-dev

# Install additional audio libraries
log_info "Installing additional audio libraries..."
DEBIAN_FRONTEND=noninteractive apt-get install -y \
    libasound2-dev \
    libsndfile1 \
    libsndfile1-dev \
    libffi-dev \
    libssl-dev

log_success "Audio dependencies installed"

################################################################################
# 7. Audio Service Setup
################################################################################
log_info "Step 7: Setting up Audio Service..."

AUDIO_SERVICE_DIR="vionex-audio-service"
if [ -d "$AUDIO_SERVICE_DIR" ]; then
    cd "$AUDIO_SERVICE_DIR"
    
    # Create required directories
    log_info "Creating required directories..."
    mkdir -p transcripts logs models voice_clones
    
    # Create virtual environment
    if [ ! -d "venv" ]; then
        log_info "Creating Python virtual environment for Audio Service..."
        python3 -m venv venv
    fi
    
    # Activate virtual environment and install dependencies
    log_info "Installing Audio Service Python packages..."
    source venv/bin/activate
    
    # Upgrade pip, setuptools, wheel
    pip install --upgrade pip setuptools wheel
    
    # Install PyTorch first (GPU or CPU version)
    if [ "$USE_GPU" = true ]; then
        log_info "Installing PyTorch with CUDA support..."
        pip install torch>=2.6.0 torchaudio>=2.6.0 --index-url https://download.pytorch.org/whl/cu124
    else
        log_info "Installing PyTorch (CPU only)..."
        pip install torch>=2.6.0 torchaudio>=2.6.0 --index-url https://download.pytorch.org/whl/cpu
    fi
    
    # Install requirements
    if [ -f "requirements.txt" ]; then
        log_info "Installing requirements.txt..."
        pip install -r requirements.txt
        log_success "Audio Service dependencies installed"
    else
        log_error "requirements.txt not found in $AUDIO_SERVICE_DIR"
    fi
    
    # Verify installations
    log_info "Verifying installations..."
    
    if [ "$USE_GPU" = true ]; then
        python3 -c "import torch; print('PyTorch:', torch.__version__, '| CUDA:', torch.cuda.is_available())" || log_warning "PyTorch verification failed"
    else
        python3 -c "import torch; print('PyTorch:', torch.__version__, '| CPU mode')" || log_warning "PyTorch verification failed"
    fi
    
    python3 -c "import opuslib; print('OpusLib: OK')" || log_warning "OpusLib not installed properly"
    python3 -c "from faster_whisper import WhisperModel; print('Faster-Whisper: OK')" || log_warning "Faster-Whisper not installed properly"
    python3 -c "from TTS.api import TTS; print('Coqui TTS: OK')" 2>/dev/null || log_warning "Coqui TTS not installed properly"
    
    deactivate
    
    # Create .env file if it doesn't exist
    if [ ! -f ".env" ]; then
        log_info "Creating .env file for Audio Service..."
        
        # Determine engine type based on GPU availability
        if [ "$USE_GPU" = true ]; then
            ENGINE_TYPE="cuda"
        else
            ENGINE_TYPE="cpu"
        fi
        
        cat > .env << ENVEOF
MIN_PORT=${AUDIO_MIN_PORT}
MAX_PORT=${AUDIO_MAX_PORT}
GRPC_PORT=${AUDIO_GRPC_PORT}
TRANSCRIPT_DIR=./transcripts
MODEL_WHISPER=large-v2
TYPE_ENGINE=${ENGINE_TYPE}

# Whisper optimization
WHISPER_COMPUTE_TYPE=float16

# TTS optimization parameters
TTS_TEMPERATURE=0.6
TTS_LENGTH_PENALTY=0.9
TTS_REPETITION_PENALTY=2.8

# GPU optimization
ENABLE_MIXED_PRECISION=true
ENABLE_TENSOR_CORES=true
BATCH_SIZE=3

SEMANTIC_SERVICE_HOST=${SEMANTIC_SERVICE_HOST}
SEMANTIC_SERVICE_PORT=${SEMANTIC_SERVICE_PORT}

SFU_SERVICE_HOST=${SFU_SERVICE_HOST}

MEDIASOUP_ANNOUNCED_IP=${SERVER_IP}

ENABLE_TEST_MODE=false

# Logging configuration
LOG_LEVEL=INFO
LOG_TO_FILE=true
LOG_DIR=logs
LOG_FILE_PREFIX=audio_service

ENABLE_TEXT_CORRECTOR=false
TEXT_CORRECTOR_MODEL_SIZE=base
SHARED_SOCKET_PORT=${AUDIO_MIN_PORT}

# Coqui TTS License Agreement
COQUI_TOS_AGREED=1

# Translation models
ENABLE_TRANSLATION=false
ENVEOF
        log_success ".env file created for Audio Service"
        log_warning "Please update MEDIASOUP_ANNOUNCED_IP with your server IP in vionex-audio-service/.env"
    else
        log_warning ".env file already exists for Audio Service"
    fi
    
    # Set correct ownership
    chown -R $ACTUAL_USER:$ACTUAL_USER .
    
    cd ..
else
    log_error "Audio Service directory not found: $AUDIO_SERVICE_DIR"
    exit 1
fi

################################################################################
# 8. Node.js and PM2 Installation
################################################################################
log_info "Step 8: Installing Node.js and PM2..."

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    log_info "Installing Node.js 20.x..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs
    log_success "Node.js installed: $(node --version)"
else
    log_warning "Node.js already installed: $(node --version)"
fi

# Install PM2 globally
if ! command -v pm2 &> /dev/null; then
    log_info "Installing PM2 globally..."
    npm install -g pm2
    log_success "PM2 installed: $(pm2 --version)"
else
    log_warning "PM2 already installed: $(pm2 --version)"
fi

# Setup PM2 to start on boot
log_info "Configuring PM2 startup..."
pm2 startup systemd -u $ACTUAL_USER --hp $ACTUAL_HOME || log_warning "PM2 startup configuration may need manual setup"
log_success "PM2 configured to start on boot"

################################################################################
# 9. Firewall Configuration
################################################################################
log_info "Step 9: Configuring firewall..."

# Check if ufw is installed
if command -v ufw &> /dev/null; then
    log_info "Configuring UFW firewall rules..."
    
    # Allow SSH
    ufw allow ssh
    
    # Allow Audio Service ports
    ufw allow ${AUDIO_GRPC_PORT}/tcp comment 'Audio Service gRPC'
    ufw allow ${AUDIO_MIN_PORT}:${AUDIO_MAX_PORT}/udp comment 'Audio RTP ports'
    
    # Enable firewall if not already enabled
    ufw --force enable
    
    log_success "Firewall rules configured"
    ufw status
else
    log_warning "UFW not installed, skipping firewall configuration"
fi

################################################################################
# 10. Create PM2 Ecosystem Configuration (Audio Service Only)
################################################################################
log_info "Step 10: Creating PM2 ecosystem configuration..."

# Determine CUDA environment based on GPU availability
if [ "$USE_GPU" = true ]; then
    CUDA_ENV_BLOCK="CUDA_HOME: '/usr/local/cuda-12.8',
        LD_LIBRARY_PATH: '/usr/local/cuda-12.8/lib64:/usr/lib/x86_64-linux-gnu',
        PATH: '/usr/local/cuda-12.8/bin:' + process.env.PATH,"
else
    CUDA_ENV_BLOCK=""
fi

cat > ecosystem.config.js << EOF
module.exports = {
  apps: [
    {
      name: 'audio-service',
      script: 'venv/bin/python',
      args: 'audio_service.py',
      cwd: './vionex-audio-service',
      interpreter: 'none',
      env: {
        ${CUDA_ENV_BLOCK}
        PYTHONUNBUFFERED: '1',
        COQUI_TOS_AGREED: '1'
      },
      error_file: './logs/audio-service-error.log',
      out_file: './logs/audio-service-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      autorestart: true,
      watch: false,
      max_memory_restart: '4G',
      instances: 1,
      exec_mode: 'fork'
    }
  ]
};
EOF

log_success "PM2 ecosystem configuration created"

# Create logs directory
mkdir -p logs
chown -R $ACTUAL_USER:$ACTUAL_USER logs
chown $ACTUAL_USER:$ACTUAL_USER ecosystem.config.js

################################################################################
# 11. Create Management Scripts
################################################################################
log_info "Step 11: Creating management scripts..."

# Start script
cat > start-audio.sh << 'EOF'
#!/bin/bash
echo "Starting Vionex Audio Service..."
cd "$(dirname "$0")"
pm2 start ecosystem.config.js
pm2 save
echo "Audio Service started. Use 'pm2 status' to check status."
EOF
chmod +x start-audio.sh
chown $ACTUAL_USER:$ACTUAL_USER start-audio.sh

# Stop script
cat > stop-audio.sh << 'EOF'
#!/bin/bash
echo "Stopping Vionex Audio Service..."
pm2 stop audio-service
echo "Audio Service stopped."
EOF
chmod +x stop-audio.sh
chown $ACTUAL_USER:$ACTUAL_USER stop-audio.sh

# Restart script
cat > restart-audio.sh << 'EOF'
#!/bin/bash
echo "Restarting Vionex Audio Service..."
pm2 restart audio-service
echo "Audio Service restarted."
EOF
chmod +x restart-audio.sh
chown $ACTUAL_USER:$ACTUAL_USER restart-audio.sh

# Status script
cat > status-audio.sh << 'EOF'
#!/bin/bash
echo "==================================="
echo "Vionex Audio Service Status"
echo "==================================="
pm2 status audio-service
echo ""
echo "==================================="
echo "System Resources"
echo "==================================="
if command -v nvidia-smi &> /dev/null; then
    echo "GPU Status:"
    nvidia-smi --query-gpu=index,name,temperature.gpu,utilization.gpu,memory.used,memory.total --format=csv,noheader 2>/dev/null || echo "No GPU detected"
fi
echo ""
echo "Memory Usage:"
free -h
echo ""
echo "Disk Usage:"
df -h | grep -E '^/dev/|Filesystem'
EOF
chmod +x status-audio.sh
chown $ACTUAL_USER:$ACTUAL_USER status-audio.sh

# Logs script
cat > logs-audio.sh << 'EOF'
#!/bin/bash
echo "Viewing logs for Audio Service"
echo "Press Ctrl+C to exit"
echo "==================================="
pm2 logs audio-service
EOF
chmod +x logs-audio.sh
chown $ACTUAL_USER:$ACTUAL_USER logs-audio.sh

# Run directly script (without PM2)
cat > run-audio-direct.sh << 'EOF'
#!/bin/bash
echo "Running Audio Service directly..."
cd "$(dirname "$0")/vionex-audio-service"
source venv/bin/activate
export COQUI_TOS_AGREED=1
python audio_service.py
EOF
chmod +x run-audio-direct.sh
chown $ACTUAL_USER:$ACTUAL_USER run-audio-direct.sh

log_success "Management scripts created"

################################################################################
# Setup Complete
################################################################################
echo ""
echo "========================================"
log_success "Audio Service Setup completed successfully!"
echo "========================================"
echo ""
echo "GPU Mode: $USE_GPU"
echo ""
echo "Next steps:"
echo "1. Update .env file with your server IP:"
echo "   nano vionex-audio-service/.env"
echo "   -> Change MEDIASOUP_ANNOUNCED_IP to your server IP"
echo ""
echo "2. Start Audio Service:"
echo "   ./start-audio.sh"
echo ""
echo "3. Or run directly (for debugging):"
echo "   ./run-audio-direct.sh"
echo ""
echo "4. Check status:"
echo "   ./status-audio.sh"
echo ""
echo "5. View logs:"
echo "   ./logs-audio.sh"
echo ""
echo "PM2 Commands:"
echo "  pm2 status              - View service status"
echo "  pm2 logs audio-service  - View logs"
echo "  pm2 monit               - Monitor resources"
echo "  pm2 restart audio-service - Restart service"
echo ""
log_warning "IMPORTANT: Reboot the system to ensure all changes take effect:"
echo "  sudo reboot"
echo ""
