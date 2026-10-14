import * as assert from 'node:assert/strict';

jest.mock('../../config/database', () => ({ sequelize: {} }));

import { ValidationError } from '../../common/errors';
import { GRPC_ERROR_MESSAGE, GRPC_STATUS } from '../../constants';
import { BalanceGrpcHandler } from '../../grpc/BalanceGrpcHandler';
import { toGrpcError } from '../../grpc/grpcError';
import type { GetBalanceRequest, GetBalanceResponse, GetBalancesRequest, GrpcError } from '../../types';

interface Outcome {
  error: GrpcError | null;
  value: GetBalanceResponse | null | undefined;
}

const RESPONSE: GetBalanceResponse = { clientId: 1, accountId: 2, balances: [] };

function handlerOver(overrides: { getBalance?: (request: GetBalanceRequest) => Promise<GetBalanceResponse>; getBalances?: (request: GetBalancesRequest) => Promise<GetBalanceResponse> }) {
  const service = {
    getBalance: overrides.getBalance ?? (async () => RESPONSE),
    getBalances: overrides.getBalances ?? (async () => RESPONSE),
  };

  return new BalanceGrpcHandler(service as never);
}

const run = (invoke: (callback: (error: unknown, value?: GetBalanceResponse | null) => void) => void): Promise<Outcome> =>
  new Promise((resolve) => invoke((error, value) => resolve({ error: error as GrpcError | null, value })));

const getBalance = (handler: BalanceGrpcHandler, request: GetBalanceRequest = { clientId: 1, accountId: 2 }) => run((callback) => handler.getBalance({ request } as never, callback));

const getBalances = (handler: BalanceGrpcHandler, request: GetBalancesRequest = { clientId: 1, accountId: 2 }) => run((callback) => handler.getBalances({ request } as never, callback));

describe('BalanceGrpcHandler', () => {
  it('GetBalance passes the request on and returns the response', async () => {
    let received: GetBalanceRequest | undefined;
    const request: GetBalanceRequest = { clientId: 4, accountId: 8, assets: [{ assetTypeId: 2, walletTypeId: 1 }] };

    const outcome = await getBalance(
      handlerOver({
        getBalance: async (input) => {
          received = input;

          return RESPONSE;
        },
      }),
      request,
    );

    assert.equal(received, request);
    assert.equal(outcome.error, null);
    assert.equal(outcome.value, RESPONSE);
  });

  it('GetBalances passes the request on and returns the response', async () => {
    let received: GetBalancesRequest | undefined;

    const outcome = await getBalances(
      handlerOver({
        getBalances: async (input) => {
          received = input;

          return RESPONSE;
        },
      }),
      { clientId: 4, accountId: 8 },
    );

    assert.deepEqual(received, { clientId: 4, accountId: 8 });
    assert.equal(outcome.value, RESPONSE);
  });

  it('keeps the two methods apart', async () => {
    const calls: string[] = [];
    const handler = handlerOver({
      getBalance: async () => {
        calls.push('GetBalance');

        return RESPONSE;
      },
      getBalances: async () => {
        calls.push('GetBalances');

        return RESPONSE;
      },
    });

    await getBalance(handler);
    await getBalances(handler);

    assert.deepEqual(calls, ['GetBalance', 'GetBalances']);
  });

  it('answers an invalid request with INVALID_ARGUMENT and the reason', async () => {
    const handler = handlerOver({
      getBalance: async () => {
        throw new ValidationError('assets must contain at least one asset');
      },
    });

    const outcome = await getBalance(handler);

    assert.deepEqual(outcome.error, { code: GRPC_STATUS.INVALID_ARGUMENT, details: 'assets must contain at least one asset' });
    assert.equal(outcome.value, null);
  });

  it('answers an unexpected failure with INTERNAL and does not leak its message', async () => {
    const original = console.error;

    console.error = () => {};

    const outcome = await getBalances(
      handlerOver({
        getBalances: async () => {
          throw new Error('connection to 10.0.0.5:5432 refused');
        },
      }),
    );

    console.error = original;

    assert.deepEqual(outcome.error, { code: GRPC_STATUS.INTERNAL, details: GRPC_ERROR_MESSAGE.INTERNAL });
    assert.ok(!JSON.stringify(outcome.error).includes('10.0.0.5'));
  });

  it('turns even a synchronous failure into an error response instead of throwing', async () => {
    const original = console.error;

    console.error = () => {};

    const outcome = await getBalance(
      handlerOver({
        getBalance: () => {
          throw new Error('boom');
        },
      }),
    );

    console.error = original;

    assert.equal(outcome.error?.code, GRPC_STATUS.INTERNAL);
  });
});

describe('toGrpcError', () => {
  it('uses the standard gRPC status codes', () => {
    assert.equal(GRPC_STATUS.INVALID_ARGUMENT, 3);
    assert.equal(GRPC_STATUS.INTERNAL, 13);
    assert.equal(toGrpcError(new ValidationError('x')).code, 3);
  });
});
