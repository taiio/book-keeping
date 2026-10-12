import type { ILogger } from '../ports';

/**
 * Single place that touches the console. ILogger is structurally compatible with a
 * winston logger, so swapping this for `winston.createLogger(...)` needs no other change.
 */
export const logger: ILogger = {
  info: (message, meta) => console.log(JSON.stringify({ level: 'info', message, ...meta })),
  warn: (message, meta) => console.warn(JSON.stringify({ level: 'warn', message, ...meta })),
  error: (message, meta) => console.error(JSON.stringify({ level: 'error', message, ...meta })),
};
