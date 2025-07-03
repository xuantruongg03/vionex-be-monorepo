import { Injectable, OnModuleInit } from '@nestjs/common';
import * as mediasoup from 'mediasoup';
import * as os from 'os';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class WorkerPoolService implements OnModuleInit {
  private workers: {
    worker: mediasoup.types.Worker;
    webRtcServer: mediasoup.types.WebRtcServer;
  }[] = [];
  private nextWorkerIndex = 0;
  private readonly numWorkers: number;
  private workerLoads = new Map<
    string,
    { rooms: number; consumers: number; producers: number }
  >();
  private webRtcServers = new Map<
    string,
    mediasoup.types.WebRtcServer | undefined
  >();
  private sharedWebRtcServer: mediasoup.types.WebRtcServer;
  private isInitializing = false;
  private initializationComplete = false;

  constructor(private readonly configService: ConfigService) {
    // Get number of CPU cores, with a maximum of 4 (to avoid creating too many workers)
    const numCores = os.cpus().length;
    this.numWorkers = Math.min(numCores, 16);
    // this.numWorkers = 1;
    console.log(`Creating ${this.numWorkers} mediasoup Workers...`);
  }

  async onModuleInit() {
    try {
      await this.createWorkers();
    } catch (error) {
      console.error(
        'WorkerPoolService: Failed to create workers during initialization:',
        error,
      );
      // Make sure flags are reset in case of error
      this.isInitializing = false;
      // Re-throw to make sure NestJS knows initialization failed
      throw error;
    }
  }

  setSharedWebRtcServer(webRtcServer: mediasoup.types.WebRtcServer) {
    this.sharedWebRtcServer = webRtcServer;
    console.log(`Shared WebRTC server set with ID: ${webRtcServer.id}`);
  }

  getSharedWebRtcServer(
    workerId?: string | undefined,
  ): mediasoup.types.WebRtcServer | undefined {
    // If there's a workerId, try to get the specific server for that worker
    if (workerId) {
      const workerSpecificServer = this.webRtcServers.get(workerId);
      if (workerSpecificServer) {
        return workerSpecificServer;
      }
    }

    // Fall back to the shared WebRTC server if available
    if (this.sharedWebRtcServer) {
      return this.sharedWebRtcServer;
    }

    // If no shared WebRTC server and we have at least one worker, return the first worker's server
    if (this.workers.length > 0 && this.workers[0].webRtcServer) {
      return this.workers[0].webRtcServer;
    }

    return undefined;
  }

  public async createWorkers(): Promise<void> {
    // Check if workers have already been created or if initialization is in progress
    if (this.initializationComplete) {
      console.log('Workers already created, skipping initialization');
      return;
    }

    if (this.isInitializing) {
      console.log('Worker initialization already in progress, waiting...');
      // Wait for the current initialization to complete
      while (this.isInitializing) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return;
    }

    // Set flag to indicate initialization is in progress
    this.isInitializing = true;
    console.log(`Starting creation of ${this.numWorkers} mediasoup workers...`);

    try {
      // const baseMinPort = parseInt(this.configService.get('MEDIASOUP_RTC_MIN_PORT') || '10000', 10);
      const baseMinPort = 10000;
      const portRangePerWorker = 1000;
      for (let i = 0; i < this.numWorkers; i++) {
        const worker = await mediasoup.createWorker({
          logLevel: 'warn',
          logTags: ['info', 'ice', 'dtls', 'rtp', 'srtp', 'rtcp'],
          rtcMinPort: baseMinPort + i * portRangePerWorker,
          rtcMaxPort: baseMinPort + (i + 1) * portRangePerWorker - 1,
        });

        // Create a WebRTC server for each worker with dynamic port finding
        let webRtcServer;
        let basePort = parseInt(
          this.configService.get('MEDIASOUP_PORT') || '55555',
        );
        let attempts = 0;
        let maxAttempts = 10;
        let error;

        // Start offset based on worker index to avoid immediate conflicts
        const initialOffset = 1000 + i * 10;

        while (attempts < maxAttempts) {
          const portOffset = initialOffset + attempts;
          const port = basePort + portOffset;

          try {
            console.log(
              `Worker ${i}: Attempting to create WebRTC server on port ${port}...`,
            );
            webRtcServer = await worker.createWebRtcServer({
              listenInfos: [
                {
                  protocol: 'udp',
                  ip:
                    this.configService.get('MEDIASOUP_LISTEN_IP') || '0.0.0.0',
                  announcedIp: this.configService.get('MEDIASOUP_ANNOUNCED_IP'),
                  port: port,
                },
                {
                  protocol: 'tcp',
                  ip:
                    this.configService.get('MEDIASOUP_LISTEN_IP') || '0.0.0.0',
                  announcedIp: this.configService.get('MEDIASOUP_ANNOUNCED_IP'),
                  port: port,
                },
              ],
            });
            console.log(
              `Worker ${i}: WebRTC server created successfully on port ${port}`,
            );
            break; // Success, exit the loop
          } catch (err) {
            error = err;
            console.warn(
              `Worker ${i}: Failed to create WebRTC server on port ${port}: ${err.message}`,
            );
            attempts++;
          }
        }

        if (!webRtcServer) {
          console.error(
            `Worker ${i}: Failed to create WebRTC server after ${maxAttempts} attempts`,
          );
          throw (
            error || new Error('Could not create WebRTC server on any port')
          );
        }

        // Store the worker and its WebRTC server
        this.workers.push({ worker, webRtcServer });
        this.webRtcServers.set(worker.pid.toString(), webRtcServer);
        console.log(`Created worker ${i} with ID ${worker.pid}`);

        worker.on('died', () => this.handleWorkerDied(worker, i));

        this.workerLoads.set(worker.pid.toString(), {
          rooms: 0,
          consumers: 0,
          producers: 0,
        });

        // setInterval(async () => {
        //   const usage = await worker.getResourceUsage();
        //   console.log(
        //     `mediasoup Worker ${i} resource usage: ${JSON.stringify(usage)}`,
        //   );
        // }, 120000);
      }

      console.log(
        `${this.workers.length} mediasoup Workers created successfully`,
      );

      // Check if we actually created any workers
      if (this.workers.length === 0) {
        const error = new Error('Failed to create any mediasoup workers');
        console.error(error);
        this.isInitializing = false;
        throw error;
      }

      // Mark initialization as complete
      this.initializationComplete = true;
      this.isInitializing = false;
    } catch (error) {
      console.error('Failed to create mediasoup workers:', error);
      this.isInitializing = false;
      throw error;
    }
  }

  async getWorkerAsync(): Promise<mediasoup.types.Worker> {
    // If initialization is in progress, wait for it to complete
    if (this.isInitializing) {
      console.log('Workers are currently being initialized, waiting...');
      while (this.isInitializing) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    // Make sure workers are initialized
    if (this.workers.length === 0) {
      console.log('No workers available, creating workers now');
      await this.createWorkers();
    }

    // Check again after attempting to create workers
    if (this.workers.length === 0) {
      throw new Error('Failed to create workers in the worker pool');
    }

    const worker = this.workers[this.nextWorkerIndex].worker;
    this.nextWorkerIndex = (this.nextWorkerIndex + 1) % this.workers.length;

    return worker;
  }

  getWorker(): mediasoup.types.Worker {
    // This is a synchronous version that should only be called after workers are created
    if (this.workers.length === 0) {
      throw new Error(
        'No mediasoup workers available. Make sure the worker pool is initialized before calling getWorker()',
      );
    }

    const worker = this.workers[this.nextWorkerIndex].worker;
    this.nextWorkerIndex = (this.nextWorkerIndex + 1) % this.workers.length;

    return worker;
  }

  async getLeastLoadedWorker(): Promise<mediasoup.types.Worker> {
    if (this.workers.length === 1) {
      return this.workers[0].worker;
    }

    let leastLoadedWorker = this.workers[0].worker;
    let lowestLoad = Infinity;

    for (const { worker } of this.workers) {
      const usage = await worker.getResourceUsage();
      const cpuTime = usage.ru_utime + usage.ru_stime;
      const memory = usage.ru_maxrss;

      const load = cpuTime * 1000 + memory;

      if (load < lowestLoad) {
        lowestLoad = load;
        leastLoadedWorker = worker;
      }
    }

    return leastLoadedWorker;
  }

  getWorkerByRoomId(roomId: string): mediasoup.types.Worker {
    if (this.workers.length === 0) {
      throw new Error(
        'No mediasoup workers available. Make sure the worker pool is initialized before calling getWorkerByRoomId()',
      );
    }

    const sum = roomId
      .split('')
      .reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const workerIndex = sum % this.workers.length;

    return this.workers[workerIndex].worker;
  }

  async getWorkerByRoomIdAsync(
    roomId: string,
  ): Promise<mediasoup.types.Worker> {
    // If initialization is in progress, wait for it to complete
    if (this.isInitializing) {
      console.log('Workers are currently being initialized, waiting...');
      while (this.isInitializing) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    if (this.workers.length === 0) {
      console.log('No workers available, creating workers now');
      await this.createWorkers();
    }

    if (this.workers.length === 0) {
      throw new Error('Failed to create workers in the worker pool');
    }

    const sum = roomId
      .split('')
      .reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const workerIndex = sum % this.workers.length;

    return this.workers[workerIndex].worker;
  }

  getAllWorkers(): mediasoup.types.Worker[] {
    return this.workers.map((entry) => entry.worker);
  }

  async closeAll() {
    for (const { worker } of this.workers) {
      await worker.close();
    }
  }

  updateWorkerLoad(
    workerId: string,
    data: { rooms?: number; consumers?: number; producers?: number },
  ) {
    const currentLoad = this.workerLoads.get(workerId) || {
      rooms: 0,
      consumers: 0,
      producers: 0,
    };

    this.workerLoads.set(workerId, {
      rooms: data.rooms !== undefined ? data.rooms : currentLoad.rooms,
      consumers:
        data.consumers !== undefined ? data.consumers : currentLoad.consumers,
      producers:
        data.producers !== undefined ? data.producers : currentLoad.producers,
    });
  }

  getWebRtcServerForWorker(
    workerId: string,
  ): mediasoup.types.WebRtcServer | undefined {
    return this.webRtcServers.get(workerId);
  }

  private async handleWorkerDied(
    worker: mediasoup.types.Worker,
    index: number,
  ) {
    console.error(`mediasoup Worker ${index} died, creating a new one...`);

    const deadWorkerId = worker.pid.toString();
    this.workers.splice(index, 1);
    this.workerLoads.delete(deadWorkerId);

    const newWorker = await mediasoup.createWorker({
      logLevel: 'warn',
      logTags: ['info', 'ice', 'dtls', 'rtp', 'srtp', 'rtcp'],
      rtcMinPort: 10000 + index * 1000,
      rtcMaxPort: 10999 + index * 1000,
    });

    // Create a WebRTC server with dynamic port finding
    let webRtcServer;
    let basePort = parseInt(
      this.configService.get('MEDIASOUP_PORT') || '55555',
    );
    let attempts = 0;
    let maxAttempts = 10;
    let error;

    // Start offset based on worker index plus a large value to avoid conflicts
    const initialOffset = 2000 + index * 10;

    while (attempts < maxAttempts) {
      const portOffset = initialOffset + attempts;
      const port = basePort + portOffset;

      try {
        webRtcServer = await newWorker.createWebRtcServer({
          listenInfos: [
            {
              protocol: 'udp',
              ip: this.configService.get('MEDIASOUP_LISTEN_IP') || '0.0.0.0',
              announcedIp: this.configService.get('MEDIASOUP_ANNOUNCED_IP'),
              port: port,
            },
            {
              protocol: 'tcp',
              ip: this.configService.get('MEDIASOUP_LISTEN_IP') || '0.0.0.0',
              announcedIp: this.configService.get('MEDIASOUP_ANNOUNCED_IP'),
              port: port,
            },
          ],
        });
        console.log(
          `Recovery Worker ${index}: WebRTC server created successfully on port ${port}`,
        );
        break; // Success, exit the loop
      } catch (err) {
        error = err;
        console.warn(
          `Recovery Worker ${index}: Failed to create WebRTC server on port ${port}: ${err.message}`,
        );
        attempts++;
      }
    }

    if (!webRtcServer) {
      console.error(
        `Recovery Worker ${index}: Failed to create WebRTC server after ${maxAttempts} attempts`,
      );
      throw error || new Error('Could not create WebRTC server on any port');
    }

    newWorker.on('died', () => this.handleWorkerDied(newWorker, index));

    this.workers.splice(index, 0, { worker: newWorker, webRtcServer });

    console.log(`New mediasoup Worker created with pid ${newWorker.pid}`);
    // Removed event emitter for now
    // this.eventEmitter.emit('worker.replaced', {
    //   oldWorkerId: deadWorkerId,
    //   newWorkerId: newWorker.pid.toString(),
    // });
  }
}
