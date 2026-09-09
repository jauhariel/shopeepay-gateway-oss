export interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
}

const MAX_LOGS = 100;
const logs: LogEntry[] = [];

export function logEvent(level: "INFO" | "WARN" | "ERROR", message: string) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [${level}] ${message}`);
  logs.push({ timestamp, level, message });
  if (logs.length > MAX_LOGS) logs.shift();
}

export function getLogs(): LogEntry[] {
  return logs;
}
