/** Union of every property value of an object type (e.g. the ids of an `as const` lookup). */
export type ValueOf<T> = T[keyof T];

/** Result of a `getOrCreate*` repository call: the entity plus whether it was newly inserted. */
export type GetOrCreateResult<T> = T & { created: boolean };

export interface CreatedByParams {
  createdBy?: number | null;
}

export interface UpdatedByParams {
  updatedBy?: number | null;
}

/** Shared shape of the params used to append a row to a `*_history` table. */
export interface HistoryRecordParams extends CreatedByParams {
  historyTransactionTypeId: number;
}
