import { INBOX_EVENT_KIND, INBOX_EVENT_STATUS, OUTBOX_EVENT_TYPE, TRANSACTION_STATE, TRANSACTION_TYPE } from '../constants';

/**
 * The ledger stores numeric ids; logs are only useful when they say APPLIED instead of 2.
 * These helpers turn the ids back into the names declared in constants/.
 */
type NameMap = ReadonlyMap<unknown, string>;

const invert = (definitions: Readonly<Record<string, unknown>>): NameMap => new Map(Object.entries(definitions).map(([name, id]) => [id, name]));

const STATE_NAMES: NameMap = new Map(Object.values(TRANSACTION_STATE).map((state) => [state.id, state.code ?? 'NONE']));
const TYPE_NAMES = invert(TRANSACTION_TYPE);
const INBOX_KIND_NAMES = invert(INBOX_EVENT_KIND);
const INBOX_STATUS_NAMES = invert(INBOX_EVENT_STATUS);
const OUTBOX_TYPE_NAMES = invert(OUTBOX_EVENT_TYPE);

const nameOf = (names: NameMap, id: unknown): string => names.get(id) ?? String(id);

export const stateName = (id: number | null | undefined): string => (id === null || id === undefined ? 'NONE' : nameOf(STATE_NAMES, id));
export const transactionTypeName = (id: number): string => nameOf(TYPE_NAMES, id);
export const inboxKindName = (id: number): string => nameOf(INBOX_KIND_NAMES, id);
export const inboxStatusName = (id: number): string => nameOf(INBOX_STATUS_NAMES, id);
export const outboxTypeName = (id: number): string => nameOf(OUTBOX_TYPE_NAMES, id);
