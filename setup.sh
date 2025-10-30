#!/bin/bash

################################################################################
# Vionex Backend Services Setup Script
# 
# This script installs and configures:
# - CUDA 12.8 + cuDNN 9
# - Python environment with GPU support
# - Audio Service dependencies (Whisper, TTS, Opus, FFmpeg)
# - Chatbot Service dependencies
# - PM2 for process management
#
# Usage: sudo bash setup.sh
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

log_info "Starting Vionex Backend Services Setup..."
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
    software-properties-common

log_success "System preparation completed"

################################################################################
# 2. CUDA 12.8 Installation
################################################################################
log_info "Step 2: Installing CUDA 12.8..."

# Check if CUDA is already installed
if [ -d "/usr/local/cuda-12.8" ]; then
    log_warning "CUDA 12.8 already installed, skipping..."
else
    log_info "Downloading CUDA keyring..."
    wget -q https://developer.download.nvidia.com/compute/cuda/repos/ubuntu2204/x86_64/cuda-keyring_1.1-1_all.deb
    
    log_info "Installing CUDA keyring..."
    dpkg -i cuda-keyring_1.1-1_all.deb
    rm cuda-keyring_1.1-1_all.deb
    
    log_info "Installing CUDA runtime and compatibility..."
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y cuda-cudart-12-8 cuda-compat-12-8
    
    log_success "CUDA 12.8 installed"
fi

################################################################################
# 3. cuDNN 9 Installation
################################################################################
log_info "Step 3: Installing cuDNN 9..."

if dpkg -l | grep -q libcudnn9-cuda-12; then
    log_warning "cuDNN 9 already installed, skipping..."
else
    log_info "Installing cuDNN 9 for CUDA 12..."
    DEBIAN_FRONTEND=noninteractive apt-get install -y libcudnn9-cuda-12 libcudnn9-dev-cuda-12
    log_success "cuDNN 9 installed"
fi

################################################################################
# 4. Environment Variables Setup
################################################################################
log_info "Step 4: Setting up environment variables..."

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

################################################################################
# 5. Python 3 Installation
################################################################################
log_info "Step 5: Installing Python 3 and pip..."

DEBIAN_FRONTEND=noninteractive apt-get install -y python3 python3-pip python3-venv python3-dev

log_success "Python 3 installed"

################################################################################
# 6. Audio Processing Dependencies
################################################################################
log_info "Step 6: Installing audio processing dependencies..."

# Install Opus codec library
log_info "Installing Opus codec..."
DEBIAN_FRONTEND=noninteractive apt-get install -y libopus0 libopus-dev

# Install FFmpeg
log_info "Installing FFmpeg..."
DEBIAN_FRONTEND=noninteractive apt-get install -y ffmpeg

# Install PortAudio (for audio I/O)
log_info "Installing PortAudio..."
DEBIAN_FRONTEND=noninteractive apt-get install -y portaudio19-dev

log_success "Audio dependencies installed"

################################################################################
# 7. Audio Service Setup
################################################################################
log_info "Step 7: Setting up Audio Service..."

AUDIO_SERVICE_DIR="vionex-audio-service"
if [ -d "$AUDIO_SERVICE_DIR" ]; then
    cd "$AUDIO_SERVICE_DIR"
    
    # Create virtual environment
    if [ ! -d "venv" ]; then
        log_info "Creating Python virtual environment for Audio Service..."
        python3 -m venv venv
    fi
    
    # Activate virtual environment and install dependencies
    log_info "Installing Audio Service Python packages..."
    source venv/bin/activate
    
    # Upgrade pip
    pip install --upgrade pip
    
    # Install requirements
    if [ -f "requirements.txt" ]; then
        pip install -r requirements.txt
        log_success "Audio Service dependencies installed"
    else
        log_error "requirements.txt not found in $AUDIO_SERVICE_DIR"
    fi
    
    # Verify CUDA installation with PyTorch
    log_info "Verifying CUDA installation with PyTorch..."
    python3 -c "import torch; print('PyTorch version:', torch.__version__); print('CUDA available:', torch.cuda.is_available()); print('CUDA version:', torch.version.cuda); print('cuDNN version:', torch.backends.cudnn.version()); print('cuDNN available:', torch.backends.cudnn.is_available())" || log_warning "CUDA verification failed"
    
    # Verify Opus library
    log_info "Verifying Opus library..."
    python3 -c "import opuslib; print('OpusLib version:', opuslib.__version__)" || log_warning "OpusLib not installed properly"
    
    deactivate
    cd ..
else
    log_error "Audio Service directory not found: $AUDIO_SERVICE_DIR"
fi

################################################################################
# 8. Chatbot Service Setup
################################################################################
log_info "Step 8: Setting up Chatbot Service..."

CHATBOT_SERVICE_DIR="vionex-chatbot-service"
if [ -d "$CHATBOT_SERVICE_DIR" ]; then
    cd "$CHATBOT_SERVICE_DIR"
    
    # Create virtual environment
    if [ ! -d "venv" ]; then
        log_info "Creating Python virtual environment for Chatbot Service..."
        python3 -m venv venv
    fi
    
    # Activate virtual environment and install dependencies
    log_info "Installing Chatbot Service Python packages..."
    source venv/bin/activate
    
    # Upgrade pip
    pip install --upgrade pip
    
    # Install requirements
    if [ -f "requirements.txt" ]; then
        pip install -r requirements.txt
        log_success "Chatbot Service dependencies installed"
    else
        log_error "requirements.txt not found in $CHATBOT_SERVICE_DIR"
    fi
    
    deactivate
    cd ..
else
    log_error "Chatbot Service directory not found: $CHATBOT_SERVICE_DIR"
fi

################################################################################
# 9. Node.js and PM2 Installation
################################################################################
log_info "Step 9: Installing Node.js and PM2..."

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
pm2 startup systemd -u $SUDO_USER --hp /home/$SUDO_USER
log_success "PM2 configured to start on boot"

################################################################################
# 10. Firewall Configuration
################################################################################
log_info "Step 10: Configuring firewall..."

# Check if ufw is installed
if command -v ufw &> /dev/null; then
    log_info "Configuring UFW firewall rules..."
    
    # Allow SSH
    ufw allow ssh
    
    # Allow Audio Service ports
    ufw allow 30005/tcp comment 'Audio Service gRPC'
    ufw allow 35000/udp comment 'Audio Service Shared Socket'
    
    # Allow Chatbot Service port
    ufw allow 30007/tcp comment 'Chatbot Service gRPC'
    
    # Enable firewall if not already enabled
    ufw --force enable
    
    log_success "Firewall rules configured"
    ufw status
else
    log_warning "UFW not installed, skipping firewall configuration"
fi

################################################################################
# 11. Create PM2 Ecosystem Configuration
################################################################################
log_info "Step 11: Creating PM2 ecosystem configuration..."

cat > ecosystem.config.js << 'EOF'
module.exports = {
  apps: [
    {
      name: 'audio-service',
      script: 'venv/bin/python',
      args: 'audio_service.py',
      cwd: './vionex-audio-service',
      interpreter: 'none',
      env: {
        CUDA_HOME: '/usr/local/cuda-12.8',
        LD_LIBRARY_PATH: '/usr/local/cuda-12.8/lib64:/usr/lib/x86_64-linux-gnu',
        PATH: '/usr/local/cuda-12.8/bin:' + process.env.PATH,
        PYTHONUNBUFFERED: '1'
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
    },
    {
      name: 'chatbot-service',
      script: 'venv/bin/python',
      args: 'chatbot_service.py',
      cwd: './vionex-chatbot-service',
      interpreter: 'none',
      env: {
        CUDA_HOME: '/usr/local/cuda-12.8',
        LD_LIBRARY_PATH: '/usr/local/cuda-12.8/lib64:/usr/lib/x86_64-linux-gnu',
        PATH: '/usr/local/cuda-12.8/bin:' + process.env.PATH,
        PYTHONUNBUFFERED: '1'
      },
      error_file: './logs/chatbot-service-error.log',
      out_file: './logs/chatbot-service-out.log',
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
chown -R $SUDO_USER:$SUDO_USER logs

################################################################################
# 12. Create Management Scripts
################################################################################
log_info "Step 12: Creating management scripts..."

# Start script
cat > start-services.sh << 'EOF'
#!/bin/bash
echo "Starting Vionex Backend Services..."
pm2 start ecosystem.config.js
pm2 save
echo "Services started. Use 'pm2 status' to check status."
EOF
chmod +x start-services.sh

# Stop script
cat > stop-services.sh << 'EOF'
#!/bin/bash
echo "Stopping Vionex Backend Services..."
pm2 stop ecosystem.config.js
echo "Services stopped."
EOF
chmod +x stop-services.sh

# Restart script
cat > restart-services.sh << 'EOF'
#!/bin/bash
echo "Restarting Vionex Backend Services..."
pm2 restart ecosystem.config.js
echo "Services restarted."
EOF
chmod +x restart-services.sh

# Status script
cat > status-services.sh << 'EOF'
#!/bin/bash
echo "==================================="
echo "Vionex Backend Services Status"
echo "==================================="
pm2 status
echo ""
echo "==================================="
echo "System Resources"
echo "==================================="
echo "GPU Status:"
nvidia-smi --query-gpu=index,name,temperature.gpu,utilization.gpu,utilization.memory,memory.used,memory.total --format=csv,noheader
echo ""
echo "Memory Usage:"
free -h
echo ""
echo "Disk Usage:"
df -h | grep -E '^/dev/|Filesystem'
EOF
chmod +x status-services.sh

# Logs script
cat > logs-services.sh << 'EOF'
#!/bin/bash
SERVICE=${1:-audio-service}
echo "Viewing logs for: $SERVICE"
echo "Press Ctrl+C to exit"
echo "==================================="
pm2 logs $SERVICE
EOF
chmod +x logs-services.sh

log_success "Management scripts created"

################################################################################
# Setup Complete
################################################################################
echo ""
echo "========================================"
log_success "Setup completed successfully!"
echo "========================================"
echo ""
echo "Next steps:"
echo "1. Configure .env files for both services:"
echo "   - vionex-audio-service/.env"
echo "   - vionex-chatbot-service/.env"
echo ""
echo "2. Start services:"
echo "   ./start-services.sh"
echo ""
echo "3. Check status:"
echo "   ./status-services.sh"
echo ""
echo "4. View logs:"
echo "   ./logs-services.sh audio-service"
echo "   ./logs-services.sh chatbot-service"
echo ""
echo "5. Stop services:"
echo "   ./stop-services.sh"
echo ""
echo "6. Restart services:"
echo "   ./restart-services.sh"
echo ""
echo "PM2 Commands:"
echo "  pm2 status              - View all services status"
echo "  pm2 logs                - View all logs"
echo "  pm2 logs audio-service  - View audio service logs"
echo "  pm2 logs chatbot-service - View chatbot service logs"
echo "  pm2 monit               - Monitor resources in real-time"
echo "  pm2 restart all         - Restart all services"
echo "  pm2 stop all            - Stop all services"
echo "  pm2 delete all          - Remove all services from PM2"
echo ""
log_warning "Please reboot the system to ensure all changes take effect:"
echo "  sudo reboot"
echo ""
