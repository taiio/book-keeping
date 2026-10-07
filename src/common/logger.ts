import { createLogger as createWinstonLogger, format, transports } from 'winston';
import type { Logger } from 'winston';

import { env } from '../config/env';

const LEVELS = ['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly'] as const;

type LogLevel = (typeof LEVELS)[number];

const RESERVED_KEYS = new Set(['level', 'message', 'timestamp', 'context', 'stack']);

const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
  brightBlue: '\x1b[94m',
  brightMagenta: '\x1b[95m',
  brightCyan: '\x1b[96m',
} as const;

const LEVEL_COLOR: Record<LogLevel, string> = {
  error: ANSI.bold + ANSI.red,
  warn: ANSI.yellow,
  info: ANSI.green,
  http: ANSI.magenta,
  verbose: ANSI.cyan,
  debug: ANSI.blue,
  silly: ANSI.gray,
};

// Each context (inbox, outbox, kafka, ...) gets its own stable colour so a busy log is easy to scan.
const CONTEXT_PALETTE = [ANSI.cyan, ANSI.magenta, ANSI.brightBlue, ANSI.brightCyan, ANSI.brightMagenta, ANSI.yellow];

const LEVEL_WIDTH = Math.max(...LEVELS.map((level) => level.length));

const isSilent = env.log.level === 'silent';
const level: LogLevel = (LEVELS as readonly string[]).includes(env.log.level) ? (env.log.level as LogLevel) : 'info';

function paint(color: string, text: string): string {
  return env.log.colorize ? `${color}${text}${ANSI.reset}` : text;
}

function contextColor(context: string): string {
  let hash = 0;

  for (const char of context) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;

  return CONTEXT_PALETTE[hash % CONTEXT_PALETTE.length];
}

function formatValue(value: unknown): string {
  if (typeof value === 'string') return /[\s"=]/.test(value) || value === '' ? JSON.stringify(value) : value;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value !== null && typeof value === 'object')
    return JSON.stringify(value, (_key, nested) => (typeof nested === 'bigint' ? nested.toString() : nested));

  return String(value);
}

function formatMeta(info: Record<string, unknown>): string {
  const parts: string[] = [];

  for (const key of Object.keys(info)) {
    if (RESERVED_KEYS.has(key) || info[key] === undefined) continue;

    parts.push(`${paint(ANSI.gray, `${key}=`)}${formatValue(info[key])}`);
  }

  return parts.length > 0 ? ` ${parts.join(' ')}` : '';
}

const pretty = format.combine(
  format.errors({ stack: true }),
  format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  format.printf((info) => {
    const lvl = info.level as LogLevel;
    const context = typeof info.context === 'string' ? info.context : 'app';
    const message =
      lvl === 'error' ? paint(ANSI.red, String(info.message)) : lvl === 'warn' ? paint(ANSI.yellow, String(info.message)) : String(info.message);

    const head = [
      paint(ANSI.gray, String(info.timestamp)),
      paint(LEVEL_COLOR[lvl] ?? '', lvl.toUpperCase().padEnd(LEVEL_WIDTH)),
      paint(contextColor(context), `[${context}]`),
      message,
    ].join(' ');

    const stack = typeof info.stack === 'string' ? `\n${paint(ANSI.gray, info.stack)}` : '';

    return `${head}${formatMeta(info)}${stack}`;
  }),
);

const structured = format.combine(format.errors({ stack: true }), format.timestamp(), format.json());

export const logger: Logger = createWinstonLogger({
  level,
  silent: isSilent,
  format: env.log.json ? structured : pretty,
  transports: [new transports.Console()],
  exitOnError: false,
});

/** A logger whose lines are tagged with `[context]`, e.g. createLogger('inbox'). */
export function createLogger(context: string): Logger {
  return logger.child({ context });
}

/**
 * Turns anything that was thrown into log fields. Spread it into the meta object:
 *   log.error('inbox event failed', { eventId, ...errorMeta(error) });
 * Pass { stack: false } for expected failures (retries, parked events) to keep the output short.
 */
export function errorMeta(error: unknown, options: { stack?: boolean } = {}): Record<string, unknown> {
  const { stack = true } = options;

  if (!(error instanceof Error)) return { error: String(error) };

  const retryable = (error as { retryable?: unknown }).retryable;

  return {
    errorName: error.name,
    error: error.message,
    ...(typeof retryable === 'boolean' ? { retryable } : {}),
    ...(stack && error.stack ? { stack: error.stack } : {}),
  };
}
