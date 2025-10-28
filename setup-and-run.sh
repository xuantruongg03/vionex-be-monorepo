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
        sudo npm install -g pm2
        print_success "PM2 installed successfully"
        return 0
    fi
}

# Check if Python is installed
check_python() {
    if command -v python3 &> /dev/null; then
        PYTHON_VERSION=$(python3 --version)
        print_success "Python is installed: $PYTHON_VERSION"
        return 0
    elif command -v python &> /dev/null; then
        PYTHON_VERSION=$(python --version)
        print_success "Python is installed: $PYTHON_VERSION"
        return 0
    else
        sudo apt update
        sudo apt install -y python3 python3-pip
        print_success "Python installed successfully"
        return 0
    fi
}

# Check if Docker is installed
check_docker() {
    if command -v docker &> /dev/null; then
        DOCKER_VERSION=$(docker --version)
        print_success "Docker is installed: $DOCKER_VERSION"
        return 0
    else
        #!/bin/bash

        # Gỡ các bản Docker cũ (nếu có)
        sudo apt-get remove -y docker docker-engine docker.io containerd runc

        # Cập nhật hệ thống
        sudo apt-get update
        sudo apt-get install -y \
            ca-certificates \
            curl \
            gnupg \
            lsb-release

        # Thêm key GPG chính thức của Docker
        sudo mkdir -p /etc/apt/keyrings
        curl -fsSL https://download.docker.com/linux/ubuntu/gpg | \
            sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg

        # Thêm repository Docker vào APT sources
        echo \
        "deb [arch=$(dpkg --print-architecture) \
        signed-by=/etc/apt/keyrings/docker.gpg] \
        https://download.docker.com/linux/ubuntu \
        $(lsb_release -cs) stable" | \
        sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

        # Cập nhật và cài đặt Docker Engine
        sudo apt-get update
        sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

        # Kiểm tra Docker
        sudo docker --version
        sudo docker run hello-world
        return 0
    fi
}

# Check and install MySQL Server
check_mysql() {
    if command -v mysql &> /dev/null; then
        MYSQL_VERSION=$(mysql --version)
        print_success "MySQL is installed: $MYSQL_VERSION"
        return 0
    else
        print_warning "MySQL is not installed. Installing MySQL Server..."
        
        # Update package list
        sudo apt update
        
        # Install MySQL Server
        sudo apt install -y mysql-server mysql-client
        
        # Start MySQL service
        sudo systemctl start mysql
        sudo systemctl enable mysql
        
        print_success "MySQL Server installed and started"
        return 0
    fi
}

# Setup MySQL database for auth service
setup_mysql_database() {
    print_header "Setting up MySQL Database for Auth Service"
    
    # Default MySQL password for auth service
    MYSQL_ROOT_PASSWORD="lexuantruong2k3"
    DB_NAME="vionex_auth_service"
    
    # Check if MySQL is running
    if ! sudo systemctl is-active --quiet mysql; then
        print_info "Starting MySQL service..."
        sudo systemctl start mysql
        sleep 5
    fi
    
    # Secure MySQL installation and set root password
    print_info "Securing MySQL installation..."
    sudo mysql -e "ALTER USER 'root'@'localhost' IDENTIFIED WITH mysql_native_password BY '$MYSQL_ROOT_PASSWORD';" 2>/dev/null || true
    sudo mysql -u root -p$MYSQL_ROOT_PASSWORD -e "FLUSH PRIVILEGES;" 2>/dev/null || true
    
    # Check if database already exists and has tables
    print_info "Checking if database '$DB_NAME' already exists..."
    if mysql -u root -p$MYSQL_ROOT_PASSWORD -e "USE \`$DB_NAME\`;" &> /dev/null; then
        # Database exists, check if it has tables
        TABLE_COUNT=$(mysql -u root -p$MYSQL_ROOT_PASSWORD -e "USE \`$DB_NAME\`; SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = '$DB_NAME';" -s -N 2>/dev/null || echo "0")
        
        if [ "$TABLE_COUNT" -gt 0 ]; then
            print_success "Database '$DB_NAME' already exists with $TABLE_COUNT tables. Skipping database setup."
            return 0
        else
            print_warning "Database '$DB_NAME' exists but is empty. Will initialize with tables."
        fi
    else
        # Database doesn't exist, create it
        print_info "Database '$DB_NAME' doesn't exist. Creating new database..."
        mysql -u root -p$MYSQL_ROOT_PASSWORD -e "CREATE DATABASE IF NOT EXISTS \`$DB_NAME\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;" 2>/dev/null
        print_success "Database '$DB_NAME' created successfully"
    fi
    
    # Run initialization script if exists and database is empty
    if [ -f "vionex-auth-service/src/migrations/init.sql" ]; then
        print_info "Running database initialization script..."
        mysql -u root -p$MYSQL_ROOT_PASSWORD $DB_NAME < vionex-auth-service/src/migrations/init.sql
        print_success "Database initialization completed"
        
        # Verify tables were created
        NEW_TABLE_COUNT=$(mysql -u root -p$MYSQL_ROOT_PASSWORD -e "USE \`$DB_NAME\`; SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = '$DB_NAME';" -s -N 2>/dev/null || echo "0")
        print_success "Database '$DB_NAME' now has $NEW_TABLE_COUNT tables"
    else
        print_warning "Database initialization script not found at vionex-auth-service/src/migrations/init.sql"
    fi
    
    # Test database connection
    if mysql -u root -p$MYSQL_ROOT_PASSWORD -e "USE \`$DB_NAME\`; SHOW TABLES;" &> /dev/null; then
        print_success "Database '$DB_NAME' is ready and accessible"
    else
        print_error "Failed to connect to database '$DB_NAME'"
        return 1
    fi
    
    return 0
}

# Install and start Qdrant
setup_qdrant() {
    print_header "Setting up Qdrant Vector Database"
    
    # Check if Qdrant container is already running
    if sudo docker ps --format "table {{.Names}}" | grep -q "qdrant"; then
        print_success "Qdrant container is already running"
        
        # Test Qdrant connection
        if curl -f http://localhost:6333/health &> /dev/null; then
            print_success "Qdrant is healthy and ready to use"
        else
            print_warning "Qdrant container is running but may not be ready yet"
        fi
        return 0
    fi
    
    # Check if Qdrant container exists but stopped
    if sudo docker ps -a --format "table {{.Names}}" | grep -q "qdrant"; then
        print_info "Found existing Qdrant container. Starting it..."
        sudo docker start qdrant
        sleep 5
        
        # Test connection after starting
        if curl -f http://localhost:6333/health &> /dev/null; then
            print_success "Existing Qdrant container started and is healthy"
        else
            print_warning "Qdrant container started but may need more time to be ready"
        fi
        return 0
    fi
    
    # Create and start new Qdrant container
    print_info "No existing Qdrant container found. Creating new one..."
    sudo docker run -d \
        --name qdrant \
        -p 6333:6333 \
        -p 6334:6334 \
        -v qdrant_storage:/qdrant/storage \
        qdrant/qdrant:latest
    
    # Wait for Qdrant to be ready
    print_info "Waiting for new Qdrant container to be ready..."
    sleep 15
    
    # Test Qdrant connection with retry
    for i in {1..5}; do
        if curl -f http://localhost:6333/health &> /dev/null; then
            print_success "Qdrant is running and healthy"
            return 0
        else
            print_info "Waiting for Qdrant to be ready... (attempt $i/5)"
            sleep 5
        fi
    done
    
    print_warning "Qdrant container created but health check failed. It may need more time to be ready."
    return 0
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
CHAT_SERVICE_HOST=localhost
CHAT_SERVICE_GRPC_PORT=30002
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
MEDIASOUP_ANNOUNCED_IP=103.179.189.253
MEDIASOUP_PORT=55555
MEDIASOUP_RTC_MIN_PORT=10000
MEDIASOUP_RTC_MAX_PORT=25999
STUN_SERVER_URL=stun:20.70.128.1:3478
TURN_SERVER_URL=turn:20.70.128.1:3478
TURN_SERVER_USERNAME=guest
TURN_SERVER_PASSWORD=videomeet
AUDIO_SERVICE_HOST=103.78.3.29
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
SEMANTIC_PORT=30006
SEMANTIC_HOST=localhost
NODE_ENV=$MODE
EOF
        print_success "Created/Updated environment file for vionex-chat-service"
    fi
    
    # Semantic Service .env
    if [ -d "vionex-semantic-service" ]; then
        if [ -f "vionex-semantic-service/.env" ]; then
            print_warning "Backing up existing .env for vionex-semantic-service"
            cp "vionex-semantic-service/.env" "vionex-semantic-service/.env.backup"
        fi
        
        cat > vionex-semantic-service/.env << EOF
SEMANTIC_GRPC_PORT=30006

# Qdrant Configuration
URL_QDRANT=http://localhost:6333
API_KEY_QDRANT=localkey
COLLECTION_NAME=conversations

# Model Configuration
MODEL_VECTOR=intfloat/e5-small-v2

# Other configurations
MAX_SEARCH_RESULTS=10
LOG_LEVEL=INFO
NODE_ENV=$MODE
EOF
        print_success "Created/Updated environment file for vionex-semantic-service"
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
    
    # Install Python dependencies for semantic service
    if [ -d "vionex-semantic-service" ]; then
        print_info "Installing Python dependencies for vionex-semantic-service..."
        cd "vionex-semantic-service"
        sudo apt install -y python3.12-venv
        
        # Check if virtual environment exists
        if [ ! -d "venv" ]; then
            python3 -m venv venv
        fi
        
        source venv/bin/activate
        sudo apt-get install -y python3-dev python3-pip build-essential g++
        pip install -r requirements.txt
        deactivate
        cd ..
        print_success "Python dependencies installed for vionex-semantic-service"
    fi
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
    
    # Semantic service doesn't need building (Python)
    if [ -d "vionex-semantic-service" ]; then
        print_success "vionex-semantic-service ready (Python service - no build required)"
    fi
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
    },
    {
      name: 'vionex-semantic-service',
      cwd: './vionex-semantic-service',
      script: 'venv/bin/python',
      args: 'main.py',
      interpreter: '',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '2G',
      env: {
        PYTHONPATH: '.',
        NODE_ENV: 'development'
      },
      env_production: {
        PYTHONPATH: '.',
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
    
    # Setup Qdrant first
    setup_qdrant
    
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
    
    if ! check_python; then
        exit 1
    fi
    
    if ! check_docker; then
        exit 1
    fi
    
    if ! check_mysql; then
        exit 1
    fi
    
    if ! check_pm2; then
        exit 1
    fi
    
    case $ACTION in
        "install")
            setup_env_files
            setup_mysql_database
            install_dependencies
            ;;
        "database")
            setup_mysql_database
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
            setup_mysql_database
            install_dependencies
            build_services
            setup_pm2_config
            start_services
            ;;
        *)
            print_error "Invalid action: $ACTION"
            echo "Available actions: install, database, build, start, stop, restart, all"
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
