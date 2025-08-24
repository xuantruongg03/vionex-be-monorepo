#!/bin/bash

# Vionex Backend Setup and Run Script for Linux/macOS
# Tự động cài đặt, build và chạy tất cả services với PM2

set -e  # Exit on any error

# Default parameters
MODE="dev"  # dev hoặc prod
ACTION="all"  # install, build, start, stop, restart, all

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --mode)
            MODE="$2"
            shift 2
            ;;
        --action)
            ACTION="$2"
            shift 2
            ;;
        *)
            echo "Unknown option $1"
            exit 1
            ;;
    esac
done

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_success() {
    echo -e "${GREEN}[✓]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[⚠]${NC} $1"
}

print_error() {
    echo -e "${RED}[✗]${NC} $1"
}

print_header() {
    echo -e "\n${BLUE}========================================${NC}"
    echo -e "${BLUE} $1${NC}"
    echo -e "${BLUE}========================================${NC}\n"
}

print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

# Check if Node.js is installed
check_nodejs() {
    if command -v node &> /dev/null; then
        NODE_VERSION=$(node --version)
        print_success "Node.js is installed: $NODE_VERSION"
        return 0
    else
        print_error "Node.js is not installed. Please install Node.js first."
        return 1
    fi
}

# Check if PM2 is installed
check_pm2() {
    if command -v pm2 &> /dev/null; then
        PM2_VERSION=$(pm2 --version)
        print_success "PM2 is installed: $PM2_VERSION"
        return 0
    else
        print_warning "PM2 is not installed. Installing PM2..."
        npm install -g pm2
        print_success "PM2 installed successfully"
        return 0
    fi
}

# Create or update environment files
setup_env_files() {
    print_header "Setting up Environment Files"
    
    # Auth Service .env
    if [ -d "vionex-auth-service" ]; then
        if [ -f "vionex-auth-service/.env" ]; then
            print_warning "Backing up existing .env for vionex-auth-service"
            cp "vionex-auth-service/.env" "vionex-auth-service/.env.backup"
        fi
        
        cat > vionex-auth-service/.env << EOF
AUTH_GRPC_PORT=30008

# Database Configuration
DB_HOST=localhost
DB_PORT=3306
DB_USERNAME=root
DB_PASS=lexuantruong2k3
DB_NAME=vionex_auth_service

# JWT Configuration
JWT_SECRET=vionex-jwt-secret-key
JWT_REFRESH_SECRET=vionex-jwt-refresh-secret-key
JWT_EXPIRES_IN=1d
JWT_REFRESH_EXPIRES_IN=3d

# Other configurations
NODE_ENV=$MODE
EOF
        print_success "Created/Updated environment file for vionex-auth-service"
    fi
    
    # API Gateway .env
    if [ -d "vionex-api-getway" ]; then
        if [ -f "vionex-api-getway/.env" ]; then
            print_warning "Backing up existing .env for vionex-api-getway"
            cp "vionex-api-getway/.env" "vionex-api-getway/.env.backup"
        fi
        
        cat > vionex-api-getway/.env << EOF
PORT=3000
HOST=0.0.0.0

# Room Service
ROOM_SERVICE_HOST=localhost
ROOM_SERVICE_GRPC_PORT=30001

# Chat Service
CHAT_SERVICE_HOST=localhost
CHAT_SERVICE_GRPC_PORT=30002

# Interaction Service
INTERACTION_SERVICE_HOST=localhost
INTERACTION_SERVICE_GRPC_PORT=30003

# SFU Service
SFU_SERVICE_HOST=localhost
SFU_SERVICE_GRPC_PORT=30004

# Audio Service
AUDIO_SERVICE_HOST=localhost
AUDIO_SERVICE_GRPC_PORT=30005

# Chatbot Service
CHATBOT_SERVICE_HOST=localhost
CHATBOT_SERVICE_GRPC_PORT=30007

# Auth Service
AUTH_SERVICE_HOST=localhost
AUTH_SERVICE_GRPC_PORT=30008

PROTO_DIR=../../protos
NODE_ENV=$MODE
EOF
        print_success "Created/Updated environment file for vionex-api-getway"
    fi
    
    # Room Service .env
    if [ -d "vionex-room-service" ]; then
        if [ -f "vionex-room-service/.env" ]; then
            print_warning "Backing up existing .env for vionex-room-service"
            cp "vionex-room-service/.env" "vionex-room-service/.env.backup"
        fi
        
        cat > vionex-room-service/.env << EOF
ROOM_GRPC_PORT=30001

# Other configurations
NODE_ENV=$MODE
EOF
        print_success "Created/Updated environment file for vionex-room-service"
    fi
    
    # SFU Service .env
    if [ -d "vionex-sfu-service" ]; then
        if [ -f "vionex-sfu-service/.env" ]; then
            print_warning "Backing up existing .env for vionex-sfu-service"
            cp "vionex-sfu-service/.env" "vionex-sfu-service/.env.backup"
        fi
        
        cat > vionex-sfu-service/.env << EOF
SFU_GRPC_PORT=30004
SFU_SERVICE_HOST=0.0.0.0
MEDIASOUP_LOG_LEVEL=warn
MEDIASOUP_LISTEN_IP=0.0.0.0
MEDIASOUP_ANNOUNCED_IP=103.82.22.185
MEDIASOUP_PORT=55555
MEDIASOUP_RTC_MIN_PORT=10000
MEDIASOUP_RTC_MAX_PORT=25999
STUN_SERVER_URL=stun:103.179.173.240:3478
TURN_SERVER_URL=turn:103.179.173.240:3478
TURN_SERVER_USERNAME=guest
TURN_SERVER_PASSWORD=videomeet
AUDIO_SERVICE_HOST=127.0.0.1
AUDIO_SERVICE_PORT=30005
AUDIO_SERVICE_RX_PORT=35000
USE_ICE_SERVERS=true
NODE_ENV=$MODE
EOF
        print_success "Created/Updated environment file for vionex-sfu-service"
    fi
    
    # Interaction Service .env
    if [ -d "vionex-interaction-service" ]; then
        if [ -f "vionex-interaction-service/.env" ]; then
            print_warning "Backing up existing .env for vionex-interaction-service"
            cp "vionex-interaction-service/.env" "vionex-interaction-service/.env.backup"
        fi
        
        cat > vionex-interaction-service/.env << EOF
# Interaction Service Configuration
INTERACTION_GRPC_PORT=30003

# Room Service Configuration
ROOM_SERVICE_GRPC_PORT=30001
ROOM_SERVICE_HOST=localhost

# Node Environment
NODE_ENV=$MODE
EOF
        print_success "Created/Updated environment file for vionex-interaction-service"
    fi
    
    # Chat Service .env
    if [ -d "vionex-chat-service" ]; then
        if [ -f "vionex-chat-service/.env" ]; then
            print_warning "Backing up existing .env for vionex-chat-service"
            cp "vionex-chat-service/.env" "vionex-chat-service/.env.backup"
        fi
        
        cat > vionex-chat-service/.env << EOF
CHAT_GRPC_PORT=30002
CHAT_GRPC_HOST=localhost
NODE_ENV=$MODE
EOF
        print_success "Created/Updated environment file for vionex-chat-service"
    fi
}

# Install dependencies for all services
install_dependencies() {
    print_header "Installing Dependencies for All Services"
    
    services=("vionex-auth-service" "vionex-api-getway" "vionex-room-service" "vionex-sfu-service" "vionex-interaction-service" "vionex-chat-service")
    
    for service in "${services[@]}"; do
        if [ -d "$service" ]; then
            print_info "Installing dependencies for $service..."
            cd "$service"
            npm install
            cd ..
            print_success "Dependencies installed for $service"
        else
            print_warning "Directory $service not found, skipping..."
        fi
    done
}

# Build all services
build_services() {
    print_header "Building All Services"
    
    services=("vionex-auth-service" "vionex-api-getway" "vionex-room-service" "vionex-sfu-service" "vionex-interaction-service" "vionex-chat-service")
    
    for service in "${services[@]}"; do
        if [ -d "$service" ]; then
            print_info "Building $service..."
            cd "$service"
            npm run build
            cd ..
            print_success "Built $service successfully"
        fi
    done
}

# Create PM2 ecosystem file
setup_pm2_config() {
    print_header "Creating PM2 Ecosystem Configuration"
    
    cat > ecosystem.config.js << 'EOF'
module.exports = {
  apps: [
    {
      name: 'vionex-auth-service',
      cwd: './vionex-auth-service',
      script: 'dist/main.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'development'
      },
      env_production: {
        NODE_ENV: 'production'
      }
    },
    {
      name: 'vionex-api-gateway',
      cwd: './vionex-api-getway',
      script: 'dist/main.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'development'
      },
      env_production: {
        NODE_ENV: 'production'
      }
    },
    {
      name: 'vionex-room-service',
      cwd: './vionex-room-service',
      script: 'dist/main.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'development'
      },
      env_production: {
        NODE_ENV: 'production'
      }
    },
    {
      name: 'vionex-sfu-service',
      cwd: './vionex-sfu-service',
      script: 'dist/main.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '2G',
      env: {
        NODE_ENV: 'development'
      },
      env_production: {
        NODE_ENV: 'production'
      }
    },
    {
      name: 'vionex-interaction-service',
      cwd: './vionex-interaction-service',
      script: 'dist/main.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'development'
      },
      env_production: {
        NODE_ENV: 'production'
      }
    },
    {
      name: 'vionex-chat-service',
      cwd: './vionex-chat-service',
      script: 'dist/main.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'development'
      },
      env_production: {
        NODE_ENV: 'production'
      }
    }
  ]
}
EOF
    
    print_success "PM2 ecosystem configuration created"
}

# Start services with PM2
start_services() {
    print_header "Starting All Services with PM2"
    
    if [ "$MODE" = "prod" ]; then
        pm2 start ecosystem.config.js --env production
    else
        pm2 start ecosystem.config.js
    fi
    
    print_success "All services started successfully"
    
    # Show PM2 status
    pm2 status
    print_info "Use 'pm2 logs' to view logs"
}

# Stop services
stop_services() {
    print_header "Stopping All Services"
    pm2 stop ecosystem.config.js
    print_success "All services stopped"
}

# Restart services
restart_services() {
    print_header "Restarting All Services"
    pm2 reload ecosystem.config.js
    print_success "All services restarted"
    pm2 status
}

# Main execution logic
main() {
    print_header "Vionex Backend Setup & Management Script"
    print_info "Mode: $MODE | Action: $ACTION"
    
    # Check prerequisites
    if ! check_nodejs; then
        exit 1
    fi
    
    if ! check_pm2; then
        exit 1
    fi
    
    case $ACTION in
        "install")
            setup_env_files
            install_dependencies
            ;;
        "build")
            build_services
            ;;
        "start")
            setup_pm2_config
            start_services
            ;;
        "stop")
            stop_services
            ;;
        "restart")
            restart_services
            ;;
        "all")
            setup_env_files
            install_dependencies
            build_services
            setup_pm2_config
            start_services
            ;;
        *)
            print_error "Invalid action: $ACTION"
            echo "Available actions: install, build, start, stop, restart, all"
            exit 1
            ;;
    esac
}

# Run main function
main

print_header "Script Execution Completed"
print_success "Use 'pm2 status' to check service status"
print_success "Use 'pm2 logs' to view logs"
print_success "Use 'pm2 monit' to monitor services"
