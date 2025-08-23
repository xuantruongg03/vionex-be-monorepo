# Vionex Backend Setup and Run Script
# Tự động cài đặt, build và chạy tất cả services với PM2

param(
    [string]$Mode = "dev",  # dev hoặc prod
    [string]$Action = "all" # install, build, start, stop, restart, all
)

# Colors for output
$RED = "Red"
$GREEN = "Green"
$YELLOW = "Yellow"
$BLUE = "Cyan"

function Write-ColorOutput($Message, $Color = "White") {
    Write-Host $Message -ForegroundColor $Color
}

function Write-Header($Message) {
    Write-Host "`n========================================" -ForegroundColor $BLUE
    Write-Host " $Message" -ForegroundColor $BLUE
    Write-Host "========================================`n" -ForegroundColor $BLUE
}

function Write-Success($Message) {
    Write-ColorOutput "[✓] $Message" $GREEN
}

function Write-Warning($Message) {
    Write-ColorOutput "[⚠] $Message" $YELLOW
}

function Write-Error($Message) {
    Write-ColorOutput "[✗] $Message" $RED
}

# Check if Node.js is installed
function Test-NodeJS {
    try {
        $nodeVersion = node --version
        Write-Success "Node.js is installed: $nodeVersion"
        return $true
    }
    catch {
        Write-Error "Node.js is not installed. Please install Node.js first."
        return $false
    }
}

# Check if PM2 is installed
function Test-PM2 {
    try {
        $pm2Version = pm2 --version
        Write-Success "PM2 is installed: $pm2Version"
        return $true
    }
    catch {
        Write-Warning "PM2 is not installed. Installing PM2..."
        npm install -g pm2
        Write-Success "PM2 installed successfully"
        return $true
    }
}

# Create or update environment files
function Set-EnvironmentFiles {
    Write-Header "Setting up Environment Files"
    
    $services = @(
        @{
            name = "vionex-auth-service"
            content = @"
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
NODE_ENV=$Mode
"@
        },
        @{
            name = "vionex-api-getway"
            content = @"
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
NODE_ENV=$Mode
"@
        },
        @{
            name = "vionex-room-service"
            content = @"
ROOM_GRPC_PORT=30001

# Database Configuration (if needed)
# DATABASE_URL=mongodb://localhost:27017/room-service

# Other configurations
NODE_ENV=$Mode
"@
        },
        @{
            name = "vionex-sfu-service"
            content = @"
SFU_GRPC_PORT=30004
SFU_SERVICE_HOST=0.0.0.0
MEDIASOUP_LOG_LEVEL=warn
MEDIASOUP_LISTEN_IP=0.0.0.0
MEDIASOUP_ANNOUNCED_IP=192.168.1.8
MEDIASOUP_PORT=55555
MEDIASOUP_RTC_MIN_PORT=10000
MEDIASOUP_RTC_MAX_PORT=25999
STUN_SERVER_URL=stun:103.109.37.4:3478
TURN_SERVER_URL=turn:103.109.37.4:3478
TURN_SERVER_USERNAME=guest
TURN_SERVER_PASSWORD=videomeet
AUDIO_SERVICE_HOST=127.0.0.1
AUDIO_SERVICE_PORT=30005
AUDIO_SERVICE_RX_PORT=35000
USE_ICE_SERVERS=false
NODE_ENV=$Mode
"@
        },
        @{
            name = "vionex-interaction-service"
            content = @"
# Interaction Service Configuration
INTERACTION_GRPC_PORT=30003

# Room Service Configuration
ROOM_SERVICE_GRPC_PORT=99996
ROOM_SERVICE_HOST=localhost

# Node Environment
NODE_ENV=$Mode
"@
        },
        @{
            name = "vionex-chat-service"
            content = @"
CHAT_GRPC_PORT=30002
CHAT_GRPC_HOST=0.0.0.0
NODE_ENV=$Mode
"@
        }
    )
    
    foreach ($service in $services) {
        $envPath = Join-Path $service.name ".env"
        if (Test-Path $envPath) {
            Write-Warning "Environment file exists for $($service.name), backing up..."
            Copy-Item $envPath "$envPath.backup"
        }
        
        $service.content | Out-File -FilePath $envPath -Encoding UTF8
        Write-Success "Created/Updated environment file for $($service.name)"
    }
}

# Install dependencies for all services
function Install-Dependencies {
    Write-Header "Installing Dependencies for All Services"
    
    $services = @(
        "vionex-auth-service",
        "vionex-api-getway", 
        "vionex-room-service",
        "vionex-sfu-service",
        "vionex-interaction-service",
        "vionex-chat-service"
    )
    
    foreach ($service in $services) {
        if (Test-Path $service) {
            Write-ColorOutput "Installing dependencies for $service..." $BLUE
            Push-Location $service
            try {
                npm install
                Write-Success "Dependencies installed for $service"
            }
            catch {
                Write-Error "Failed to install dependencies for $service"
            }
            finally {
                Pop-Location
            }
        } else {
            Write-Warning "Directory $service not found, skipping..."
        }
    }
}

# Build all services
function Build-Services {
    Write-Header "Building All Services"
    
    $services = @(
        "vionex-auth-service",
        "vionex-api-getway", 
        "vionex-room-service",
        "vionex-sfu-service",
        "vionex-interaction-service",
        "vionex-chat-service"
    )
    
    foreach ($service in $services) {
        if (Test-Path $service) {
            Write-ColorOutput "Building $service..." $BLUE
            Push-Location $service
            try {
                npm run build
                Write-Success "Built $service successfully"
            }
            catch {
                Write-Error "Failed to build $service"
            }
            finally {
                Pop-Location
            }
        }
    }
}

# Create PM2 ecosystem file
function Set-PM2Config {
    Write-Header "Creating PM2 Ecosystem Configuration"
    
    $ecosystemConfig = @"
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
"@
    
    $ecosystemConfig | Out-File -FilePath "ecosystem.config.js" -Encoding UTF8
    Write-Success "PM2 ecosystem configuration created"
}

# Start services with PM2
function Start-Services {
    Write-Header "Starting All Services with PM2"
    
    try {
        if ($Mode -eq "prod") {
            pm2 start ecosystem.config.js --env production
        } else {
            pm2 start ecosystem.config.js
        }
        Write-Success "All services started successfully"
        
        # Show PM2 status
        pm2 status
        pm2 logs --lines 50
    }
    catch {
        Write-Error "Failed to start services with PM2"
    }
}

# Stop services
function Stop-Services {
    Write-Header "Stopping All Services"
    try {
        pm2 stop ecosystem.config.js
        Write-Success "All services stopped"
    }
    catch {
        Write-Error "Failed to stop services"
    }
}

# Restart services
function Restart-Services {
    Write-Header "Restarting All Services"
    try {
        pm2 reload ecosystem.config.js
        Write-Success "All services restarted"
        pm2 status
    }
    catch {
        Write-Error "Failed to restart services"
    }
}

# Main execution logic
function Main {
    Write-Header "Vionex Backend Setup & Management Script"
    Write-ColorOutput "Mode: $Mode | Action: $Action" $BLUE
    
    # Check prerequisites
    if (-not (Test-NodeJS)) { return }
    if (-not (Test-PM2)) { return }
    
    switch ($Action.ToLower()) {
        "install" {
            Set-EnvironmentFiles
            Install-Dependencies
        }
        "build" {
            Build-Services
        }
        "start" {
            Set-PM2Config
            Start-Services
        }
        "stop" {
            Stop-Services
        }
        "restart" {
            Restart-Services
        }
        "all" {
            Set-EnvironmentFiles
            Install-Dependencies
            Build-Services
            Set-PM2Config
            Start-Services
        }
        default {
            Write-Error "Invalid action: $Action"
            Write-ColorOutput "Available actions: install, build, start, stop, restart, all" $YELLOW
        }
    }
}

# Run main function
Main

Write-Header "Script Execution Completed"
Write-ColorOutput "Use 'pm2 status' to check service status" $GREEN
Write-ColorOutput "Use 'pm2 logs' to view logs" $GREEN
Write-ColorOutput "Use 'pm2 monit' to monitor services" $GREEN
