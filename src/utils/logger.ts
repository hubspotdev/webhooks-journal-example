type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

class Logger {
  private context: string;

  constructor(context: string) {
    this.context = context;
  }

  private format(level: LogLevel, message: string): string {
    const timestamp = new Date().toISOString();
    return `[${timestamp}] [${level}] [${this.context}] ${message}`;
  }

  debug(message: string): void {
    console.debug(this.format('DEBUG', message));
  }

  info(message: string): void {
    console.info(this.format('INFO', message));
  }

  warn(message: string): void {
    console.warn(this.format('WARN', message));
  }

  error(message: string, error?: unknown): void {
    const errMsg = error instanceof Error ? `: ${error.message}` : '';
    console.error(this.format('ERROR', `${message}${errMsg}`));
    if (error instanceof Error && error.stack) {
      console.error(error.stack);
    }
  }
}

export function createLogger(context: string): Logger {
  return new Logger(context);
}
