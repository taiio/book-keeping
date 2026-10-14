export const GRPC_STATUS = {
  INVALID_ARGUMENT: 3,
  INTERNAL: 13,
} as const;

export const GRPC_ERROR_MESSAGE = {
  INTERNAL: 'Internal error',
} as const;

export const BALANCE_QUERY = {
  MAX_ASSETS: 100,
  MAX_ID: 2_147_483_647,
} as const;
