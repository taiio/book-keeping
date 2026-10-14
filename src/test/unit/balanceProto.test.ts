import * as assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join } from 'path';

import { foldBalances } from '../../helpers';
import { parseGetBalance, parseGetBalances } from '../../validation';
import type { GetBalanceRequest, GetBalancesRequest } from '../../types';

const proto = readFileSync(join(__dirname, '..', '..', 'proto', 'balance.proto'), 'utf8');

const camel = (name: string): string => name.replace(/_(\w)/g, (_, letter: string) => letter.toUpperCase());

interface ProtoField {
  name: string;
  type: string;
  repeated: boolean;
  number: number;
}

function messageFields(message: string): ProtoField[] {
  const body = proto.match(new RegExp(`message ${message} \\{([^}]*)\\}`))![1];

  return [...body.matchAll(/(repeated )?(\w+) (\w+) = (\d+);/g)].map((match) => ({ repeated: match[1] !== undefined, type: match[2], name: match[3], number: Number(match[4]) }));
}

const numbers = (message: string) => messageFields(message).map((field) => `${field.name}=${field.number}`);

function sample(message: string): Record<string, unknown> {
  const value: Record<string, unknown> = {};

  for (const field of messageFields(message)) {
    const item = field.type === 'string' ? 'ETH' : field.type === 'int32' ? 5 : sample(field.type);

    value[camel(field.name)] = field.repeated ? [item] : item;
  }

  return value;
}

describe('balance.proto', () => {
  it('declares the service with its two methods', () => {
    assert.match(proto, /syntax = "proto3";/);
    assert.match(proto, /package bookkeeping\.v1;/);
    assert.match(proto, /service BalanceService \{/);
    assert.match(proto, /rpc GetBalance\(GetBalanceRequest\) returns \(GetBalanceResponse\);/);
    assert.match(proto, /rpc GetBalances\(GetBalancesRequest\) returns \(GetBalanceResponse\);/);
  });

  it('keeps the field numbers that clients depend on', () => {
    assert.deepEqual(numbers('AssetRef'), ['asset_type_id=1', 'wallet_type_id=2']);
    assert.deepEqual(numbers('GetBalanceRequest'), ['client_id=1', 'account_id=2', 'assets=3']);
    assert.deepEqual(numbers('GetBalancesRequest'), ['client_id=1', 'account_id=2']);
    assert.deepEqual(numbers('AssetBalance'), ['asset_id=1', 'asset_type_id=2', 'wallet_type_id=3', 'asset_ticker=4', 'balance=5', 'available_balance=6']);
    assert.deepEqual(numbers('GetBalanceResponse'), ['client_id=1', 'account_id=2', 'balances=3']);
  });

  it('uses unique field numbers inside every message', () => {
    for (const message of ['AssetRef', 'GetBalanceRequest', 'GetBalancesRequest', 'AssetBalance', 'GetBalanceResponse']) {
      const values = messageFields(message).map((field) => field.number);

      assert.equal(new Set(values).size, values.length, message);
    }
  });

  it('carries amounts as text so that large values are never rounded', () => {
    const types = Object.fromEntries(messageFields('AssetBalance').map((field) => [field.name, field.type]));

    assert.equal(types.balance, 'string');
    assert.equal(types.available_balance, 'string');
  });

  it('is fully understood by the code: every request field is honored', () => {
    const balance = parseGetBalance(sample('GetBalanceRequest') as unknown as GetBalanceRequest);

    assert.deepEqual(balance, { clientId: 5, accountId: 5, assets: [{ assetTypeId: 5, walletTypeId: 5 }] });
    assert.deepEqual(parseGetBalances(sample('GetBalancesRequest') as unknown as GetBalancesRequest), { clientId: 5, accountId: 5, assets: null });
  });

  it('is fully produced by the code: every field of a balance is filled', () => {
    const [entry] = foldBalances([{ assetId: 1, assetTypeId: 2, walletTypeId: 3, assetTicker: 'ETH', transactionStateId: 5, amount: '1' }]);

    assert.deepEqual(Object.keys(entry).sort(), messageFields('AssetBalance').map((field) => camel(field.name)).sort());
  });
});
