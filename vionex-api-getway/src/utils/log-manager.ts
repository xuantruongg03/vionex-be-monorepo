import * as fs from 'fs';
import * as path from 'path';

export class LogManager {
    private static instance: LogManager;
    private logFilePath: string;
    private logStream: fs.WriteStream;
    private lineNumber: number = 0;
    private sessionId: string;

    private constructor() {
        this.sessionId = this.generateRandomId(6);
        this.initializeLogFile();
    }

    /**
     * Get singleton instance of LogManager
     */
    public static getInstance(): LogManager {
        if (!LogManager.instance) {
            LogManager.instance = new LogManager();
        }
        return LogManager.instance;
    }

    /**
     * Generate random ID for log file
     */
    private generateRandomId(length: number): string {
        const characters = 'abcdefghijklmnopqrstuvwxyz0123456789';
        let result = '';
        for (let i = 0; i < length; i++) {
            result += characters.charAt(
                Math.floor(Math.random() * characters.length),
            );
        }
        return result;
    }

    /**
     * Initialize log file with date_gateway_randomID format
     */
    private initializeLogFile(): void {
        try {
            // Create logs directory if not exists
            const logsDir = path.join(process.cwd(), 'logs');
            if (!fs.existsSync(logsDir)) {
                fs.mkdirSync(logsDir, { recursive: true });
            }

            // Generate filename: YYYY-MM-DD_gateway.log (one file per day)
            const date = new Date();
            const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD
            const fileName = `${dateStr}_gateway.log`;
            this.logFilePath = path.join(logsDir, fileName);

            // Check if file already exists to determine if we need header
            const fileExists = fs.existsSync(this.logFilePath);

            // Create write stream with append mode
            this.logStream = fs.createWriteStream(this.logFilePath, {
                flags: 'a', // append mode
                encoding: 'utf8',
            });

            // Get current line number from existing file
            if (fileExists) {
                const content = fs.readFileSync(this.logFilePath, 'utf8');
                const lines = content.split('\n').filter((line) => line.trim());
                // Find the last line number
                if (lines.length > 0) {
                    const lastLine = lines[lines.length - 1];
                    const match = lastLine.match(/^\[(\d+)\]/);
                    if (match) {
                        this.lineNumber = parseInt(match[1], 10);
                    }
                }
            }

            // Write header only if new file
            if (!fileExists) {
                const timestamp = date.toISOString();
                this.writeLine(
                    'log-manager.ts',
                    `=== Gateway Log File Created at ${timestamp} ===`,
                );
                this.writeLine(
                    'log-manager.ts',
                    `Log File: ${this.logFilePath}`,
                );
                this.writeLine('log-manager.ts', '='.repeat(80));
            } else {
                // Write session separator
                const timestamp = date.toISOString();
                this.writeLine('log-manager.ts', '');
                this.writeLine(
                    'log-manager.ts',
                    `=== New Session Started at ${timestamp} (Session ID: ${this.sessionId}) ===`,
                );
            }

            console.log(`[LogManager] Logging to: ${this.logFilePath}`);
        } catch (error) {
            console.error('[LogManager] Failed to initialize log file:', error);
        }
    }

    /**
     * Write a log line with format: [lineNumber] [fileName] message
     */
    private writeLine(fileName: string, message: string): void {
        if (!this.logStream) {
            console.error('[LogManager] Log stream not initialized');
            return;
        }

        try {
            this.lineNumber++;
            const timestamp = new Date().toISOString();
            const logLine = `[${this.lineNumber}] [${timestamp}] [${fileName}] ${message}\n`;

            this.logStream.write(logLine);
        } catch (error) {
            console.error('[LogManager] Failed to write log:', error);
        }
    }

    /**
     * Log a message with source file information
     * @param fileName - The source file name where log is called
     * @param message - The log message
     * @param level - Log level (INFO, WARN, ERROR, DEBUG)
     */
    public log(
        fileName: string,
        message: string,
        level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG' = 'INFO',
    ): void {
        const formattedMessage = `[${level}] ${message}`;
        this.writeLine(fileName, formattedMessage);
    }

    /**
     * Log info message
     */
    public info(fileName: string, message: string): void {
        this.log(fileName, message, 'INFO');
    }

    /**
     * Log warning message
     */
    public warn(fileName: string, message: string): void {
        this.log(fileName, message, 'WARN');
    }

    /**
     * Log error message
     */
    public error(fileName: string, message: string, error?: any): void {
        let errorMessage = message;
        if (error) {
            errorMessage += ` - ${error.message || JSON.stringify(error)}`;
            if (error.stack) {
                errorMessage += `\nStack: ${error.stack}`;
            }
        }
        this.log(fileName, errorMessage, 'ERROR');
    }

    /**
     * Log debug message
     */
    public debug(fileName: string, message: string): void {
        this.log(fileName, message, 'DEBUG');
    }

    /**
     * Log object/data with JSON formatting
     */
    public logData(fileName: string, message: string, data: any): void {
        const dataStr = JSON.stringify(data, null, 2);
        this.log(fileName, `${message}\nData: ${dataStr}`, 'INFO');
    }

    /**
     * Get current log file path
     */
    public getLogFilePath(): string {
        return this.logFilePath;
    }

    /**
     * Get current line number
     */
    public getCurrentLineNumber(): number {
        return this.lineNumber;
    }

    /**
     * Get session ID
     */
    public getSessionId(): string {
        return this.sessionId;
    }

    /**
     * Close log stream (call on application shutdown)
     */
    public close(): void {
        if (this.logStream) {
            this.writeLine(
                'log-manager.ts',
                '=== Gateway Log Session Ended ===',
            );
            this.logStream.end();
            console.log('[LogManager] Log stream closed');
        }
    }

    /**
     * Rotate log file (create new log file)
     */
    public rotate(): void {
        this.close();
        this.lineNumber = 0;
        this.sessionId = this.generateRandomId(6);
        this.initializeLogFile();
    }
}

// Export singleton instance for easy access
export const logger = LogManager.getInstance();
