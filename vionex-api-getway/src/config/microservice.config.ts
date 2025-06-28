// config/microservice.config.ts
export interface MicroserviceConfig {
  gateway: {
    port: number;
    cors: {
      origin: string;
      credentials: boolean;
    };
    rateLimiting: {
      windowMs: number;
      max: number;
    };
    timeouts: {
      default: number;
      mediaOperations: number;
    };
  };
  services: {
    room: {
      host: string;
      port: number;
      retries: number;
      timeout: number;
    };
    signaling: {
      host: string;
      port: number;
      retries: number;
      timeout: number;
    };
    sfu: {
      host: string;
      port: number;
      retries: number;
      timeout: number;
    };
  };
  redis: {
    host: string;
    port: number;
    db: number;
  };
  monitoring: {
    enabled: boolean;
    metricsPort: number;
  };
}

export const microserviceConfig: MicroserviceConfig = {
  gateway: {
    port: parseInt(process.env.GATEWAY_PORT || '3000'),
    cors: {
      origin: process.env.CORS_ORIGIN || '*',
      credentials: true,
    },
    rateLimiting: {
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 100, // limit each IP to 100 requests per windowMs
    },
    timeouts: {
      default: 30000, // 30 seconds
      mediaOperations: 60000, // 60 seconds for media operations
    },
  },
  services: {
    room: {
      host: process.env.ROOM_SERVICE_HOST || 'localhost',
      port: parseInt(process.env.ROOM_SERVICE_PORT || '50051'),
      retries: 3,
      timeout: 10000,
    },
    signaling: {
      host: process.env.SIGNALING_SERVICE_HOST || 'localhost',
      port: parseInt(process.env.SIGNALING_SERVICE_PORT || '50052'),
      retries: 3,
      timeout: 10000,
    },
    sfu: {
      host: process.env.SFU_SERVICE_HOST || 'localhost',
      port: parseInt(process.env.SFU_SERVICE_PORT || '50053'),
      retries: 3,
      timeout: 15000,
    },
  },
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    db: parseInt(process.env.REDIS_DB || '0'),
  },
  monitoring: {
    enabled: process.env.MONITORING_ENABLED === 'true',
    metricsPort: parseInt(process.env.METRICS_PORT || '9090'),
  },
};
