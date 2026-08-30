import fs from "fs";
import path from "path";
import { app } from "electron";

export enum LogLevel {
  DEBUG = "DEBUG",
  INFO = "INFO",
  WARN = "WARN",
  ERROR = "ERROR",
}

export class LoggerService {
  private logPath: string;
  private logStream: fs.WriteStream;

  constructor() {
    const logDir = path.join(app.getPath("home"), ".collaragent");
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    
    this.logPath = path.join(logDir, "agent.log");
    this.logStream = fs.createWriteStream(this.logPath, { flags: "a" });
  }

  private formatMessage(level: LogLevel, message: string, data?: any): string {
    const timestamp = new Date().toISOString();
    let logLine = `[${timestamp}] [${level}] ${message}`;
    
    if (data) {
      try {
        const serialized = data instanceof Error 
          ? JSON.stringify({ message: data.message, stack: data.stack }) 
          : JSON.stringify(data);
        logLine += ` ${serialized}`;
      } catch (err) {
        logLine += ` [Circular/Unserializable Data]`;
      }
    }
    
    return logLine + "\n";
  }

  log(level: LogLevel, message: string, data?: any) {
    const logLine = this.formatMessage(level, message, data);
    
    // Write to file
    this.logStream.write(logLine);
    
    // Also log to console in development
    if (process.env.NODE_ENV === 'development') {
      const consoleMsg = `[${level}] ${message}`;
      switch (level) {
        case LogLevel.ERROR:
          console.error(consoleMsg, data || "");
          break;
        case LogLevel.WARN:
          console.warn(consoleMsg, data || "");
          break;
        default:
          console.log(consoleMsg, data || "");
      }
    }
  }

  debug(message: string, data?: any) {
    this.log(LogLevel.DEBUG, message, data);
  }

  info(message: string, data?: any) {
    this.log(LogLevel.INFO, message, data);
  }

  warn(message: string, data?: any) {
    this.log(LogLevel.WARN, message, data);
  }

  error(message: string, data?: any) {
    this.log(LogLevel.ERROR, message, data);
  }
}

export const logger = new LoggerService();
