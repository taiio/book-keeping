import type { OutboundMessage } from '../types';

export interface IDeadLetterPublisher {
  publish(message: OutboundMessage): Promise<void>;
}

export const DEAD_LETTER_PUBLISHER = 'IDeadLetterPublisher';
