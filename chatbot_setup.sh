#!/bin/bash

################################################################################
# Vionex Chatbot Service Setup Script for Ubuntu 24.04
# 
# This script installs and configures:
# - CUDA 12.8 + cuDNN 9 (for GPU support)
# - Python environment with all dependencies
# - Chatbot Service dependencies (Transformers, PEFT, bitsandbytes)
# - PM2 for process management
#
# Usage: sudo bash chatbot_setup.sh
# 
# NOTE: Run this script from the vionex-backend directory
################################################################################

################################################################################
# ⚠️  CONFIGURATION - CHANGE THESE VALUES BEFORE RUNNING
################################################################################

# Hugging Face Token (REQUIRED - get from https://huggingface.co/settings/tokens)
HUGGINGFACE_TOKEN="YOUR_HUGGINGFACE_TOKEN_HERE"

# Model repositories
BASE_MODEL_REPO="xuantruongg003/openchat-3.5-0106"
LORA_MODEL_REPO="xuantruongg003/openchat-lora-only"

# Semantic Service configuration
SEMANTIC_SERVICE_HOST="localhost"
SEMANTIC_SERVICE_PORT="30006"

# Chatbot Service gRPC port
CHATBOT_GRPC_PORT="30007"

# GPU Configuration (which GPU to use, 0 = first GPU)
CUDA_VISIBLE_DEVICES="0"

# Model cache directory
MODEL_CACHE_DIR="./models/.cache"

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

log_info "Starting Vionex Chatbot Service Setup for Ubuntu 24.04..."
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
    log_error "No NVIDIA GPU detected. Chatbot service REQUIRES GPU!"
    log_error "Please ensure you have an NVIDIA GPU installed."
    exit 1
fi

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

DEBIAN_FRONTEND=noninteractive apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    python3-dev \
    python3-full

log_success "Python 3 installed"

################################################################################
# 6. Chatbot Service Setup
################################################################################
log_info "Step 6: Setting up Chatbot Service..."

CHATBOT_SERVICE_DIR="vionex-chatbot-service"
if [ -d "$CHATBOT_SERVICE_DIR" ]; then
    cd "$CHATBOT_SERVICE_DIR"
    
    # Create required directories
    log_info "Creating required directories..."
    mkdir -p models/.cache logs
    
    # Create virtual environment
    if [ ! -d "venv" ]; then
        log_info "Creating Python virtual environment for Chatbot Service..."
        python3 -m venv venv
    fi
    
    # Activate virtual environment and install dependencies
    log_info "Installing Chatbot Service Python packages..."
    source venv/bin/activate
    
    # Upgrade pip, setuptools, wheel
    pip install --upgrade pip setuptools wheel
    
    # Install PyTorch with CUDA support first
    log_info "Installing PyTorch with CUDA support..."
    pip install torch>=2.6.0 --index-url https://download.pytorch.org/whl/cu124
    
    # Install requirements
    if [ -f "requirements.txt" ]; then
        log_info "Installing requirements.txt..."
        pip install -r requirements.txt
        log_success "Chatbot Service dependencies installed"
    else
        log_error "requirements.txt not found in $CHATBOT_SERVICE_DIR"
    fi
    
    # Verify installations
    log_info "Verifying installations..."
    
    python3 -c "import torch; print('PyTorch:', torch.__version__, '| CUDA:', torch.cuda.is_available())" || log_warning "PyTorch verification failed"
    python3 -c "import transformers; print('Transformers:', transformers.__version__)" || log_warning "Transformers not installed properly"
    python3 -c "import peft; print('PEFT:', peft.__version__)" || log_warning "PEFT not installed properly"
    python3 -c "import bitsandbytes; print('Bitsandbytes: OK')" || log_warning "Bitsandbytes not installed properly"
    
    deactivate
    
    # Create .env file if it doesn't exist
    if [ ! -f ".env" ]; then
        log_info "Creating .env file for Chatbot Service..."
        
        cat > .env << ENVEOF
CHATBOT_GRPC_PORT=${CHATBOT_GRPC_PORT}
SEMANTIC_SERVICE_HOST=${SEMANTIC_SERVICE_HOST}
SEMANTIC_SERVICE_PORT=${SEMANTIC_SERVICE_PORT}

# Hugging Face Configuration
HUGGINGFACE_TOKEN=${HUGGINGFACE_TOKEN}
BASE_MODEL_REPO=${BASE_MODEL_REPO}
LORA_MODEL_REPO=${LORA_MODEL_REPO}

# Model Cache Configuration
MODEL_CACHE_DIR=${MODEL_CACHE_DIR}
TRANSFORMERS_CACHE=${MODEL_CACHE_DIR}
HF_HOME=${MODEL_CACHE_DIR}

# GPU Configuration
CUDA_VISIBLE_DEVICES=${CUDA_VISIBLE_DEVICES}
PYTORCH_CUDA_ALLOC_CONF=max_split_size_mb:512
ENVEOF
        log_success ".env file created for Chatbot Service"
        log_warning "Please verify HUGGINGFACE_TOKEN in vionex-chatbot-service/.env"
    else
        log_warning ".env file already exists for Chatbot Service"
    fi
    
    # Set correct ownership
    chown -R $ACTUAL_USER:$ACTUAL_USER .
    
    cd ..
else
    log_error "Chatbot Service directory not found: $CHATBOT_SERVICE_DIR"
    exit 1
fi

################################################################################
# 7. Node.js and PM2 Installation
################################################################################
log_info "Step 7: Installing Node.js and PM2..."

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
# 8. Firewall Configuration
################################################################################
log_info "Step 8: Configuring firewall..."

# Check if ufw is installed
if command -v ufw &> /dev/null; then
    log_info "Configuring UFW firewall rules..."
    
    # Allow SSH
    ufw allow ssh
    
    # Allow Chatbot Service port
    ufw allow ${CHATBOT_GRPC_PORT}/tcp comment 'Chatbot Service gRPC'
    
    # Enable firewall if not already enabled
    ufw --force enable
    
    log_success "Firewall rules configured"
    ufw status
else
    log_warning "UFW not installed, skipping firewall configuration"
fi

################################################################################
# 9. Create PM2 Ecosystem Configuration
################################################################################
log_info "Step 9: Creating PM2 ecosystem configuration..."

cat > ecosystem.chatbot.config.js << EOF
module.exports = {
  apps: [
    {
      name: 'chatbot-service',
      script: 'venv/bin/python',
      args: 'main.py',
      cwd: './vionex-chatbot-service',
      interpreter: 'none',
      env: {
        CUDA_HOME: '/usr/local/cuda-12.8',
        LD_LIBRARY_PATH: '/usr/local/cuda-12.8/lib64:/usr/lib/x86_64-linux-gnu',
        PATH: '/usr/local/cuda-12.8/bin:' + process.env.PATH,
        PYTHONUNBUFFERED: '1',
        CUDA_VISIBLE_DEVICES: '${CUDA_VISIBLE_DEVICES}'
      },
      error_file: './logs/chatbot-service-error.log',
      out_file: './logs/chatbot-service-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      autorestart: true,
      watch: false,
      max_memory_restart: '12G',
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
chown $ACTUAL_USER:$ACTUAL_USER ecosystem.chatbot.config.js

################################################################################
# 10. Create Management Scripts
################################################################################
log_info "Step 10: Creating management scripts..."

# Start script
cat > start-chatbot.sh << 'EOF'
#!/bin/bash
echo "Starting Vionex Chatbot Service..."
cd "$(dirname "$0")"
pm2 start ecosystem.chatbot.config.js
pm2 save
echo "Chatbot Service started. Use 'pm2 status' to check status."
EOF
chmod +x start-chatbot.sh
chown $ACTUAL_USER:$ACTUAL_USER start-chatbot.sh

# Stop script
cat > stop-chatbot.sh << 'EOF'
#!/bin/bash
echo "Stopping Vionex Chatbot Service..."
pm2 stop chatbot-service
echo "Chatbot Service stopped."
EOF
chmod +x stop-chatbot.sh
chown $ACTUAL_USER:$ACTUAL_USER stop-chatbot.sh

# Restart script
cat > restart-chatbot.sh << 'EOF'
#!/bin/bash
echo "Restarting Vionex Chatbot Service..."
pm2 restart chatbot-service
echo "Chatbot Service restarted."
EOF
chmod +x restart-chatbot.sh
chown $ACTUAL_USER:$ACTUAL_USER restart-chatbot.sh

# Status script
cat > status-chatbot.sh << 'EOF'
#!/bin/bash
echo "==================================="
echo "Vionex Chatbot Service Status"
echo "==================================="
pm2 status chatbot-service
echo ""
echo "==================================="
echo "System Resources"
echo "==================================="
echo "GPU Status:"
nvidia-smi --query-gpu=index,name,temperature.gpu,utilization.gpu,memory.used,memory.total --format=csv,noheader 2>/dev/null || echo "No GPU detected"
echo ""
echo "Memory Usage:"
free -h
echo ""
echo "Disk Usage:"
df -h | grep -E '^/dev/|Filesystem'
EOF
chmod +x status-chatbot.sh
chown $ACTUAL_USER:$ACTUAL_USER status-chatbot.sh

# Logs script
cat > logs-chatbot.sh << 'EOF'
#!/bin/bash
echo "Viewing logs for Chatbot Service"
echo "Press Ctrl+C to exit"
echo "==================================="
pm2 logs chatbot-service
EOF
chmod +x logs-chatbot.sh
chown $ACTUAL_USER:$ACTUAL_USER logs-chatbot.sh

# Run directly script (without PM2)
cat > run-chatbot-direct.sh << 'EOF'
#!/bin/bash
echo "Running Chatbot Service directly..."
cd "$(dirname "$0")/vionex-chatbot-service"
source venv/bin/activate
export CUDA_VISIBLE_DEVICES=0
python main.py
EOF
chmod +x run-chatbot-direct.sh
chown $ACTUAL_USER:$ACTUAL_USER run-chatbot-direct.sh

log_success "Management scripts created"

################################################################################
# Setup Complete
################################################################################
echo ""
echo "========================================"
log_success "Chatbot Service Setup completed successfully!"
echo "========================================"
echo ""
echo "Next steps:"
echo "1. Verify .env file has correct Hugging Face token:"
echo "   nano vionex-chatbot-service/.env"
echo "   -> Ensure HUGGINGFACE_TOKEN is valid"
echo ""
echo "2. Start Chatbot Service:"
echo "   ./start-chatbot.sh"
echo ""
echo "3. Or run directly (for debugging):"
echo "   ./run-chatbot-direct.sh"
echo ""
echo "4. Check status:"
echo "   ./status-chatbot.sh"
echo ""
echo "5. View logs:"
echo "   ./logs-chatbot.sh"
echo ""
echo "NOTE: First run will download models (~7GB for OpenChat-3.5)"
echo "      This may take 10-30 minutes depending on internet speed."
echo ""
echo "PM2 Commands:"
echo "  pm2 status               - View service status"
echo "  pm2 logs chatbot-service - View logs"
echo "  pm2 monit                - Monitor resources"
echo "  pm2 restart chatbot-service - Restart service"
echo ""
log_warning "IMPORTANT: Reboot the system to ensure all changes take effect:"
echo "  sudo reboot"
echo ""
