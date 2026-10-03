export type ValueOf<T> = T[keyof T];

export type GetOrCreateResult<T> = T & { created: boolean };

export interface CreatedByParams {
  createdBy?: number | null;
}

export interface UpdatedByParams {
  updatedBy?: number | null;
}

export interface HistoryRecordParams extends CreatedByParams {
  historyTransactionTypeId: number;
}
