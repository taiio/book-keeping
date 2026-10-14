import * as grpc from '@grpc/grpc-js';
import { readFileSync } from 'fs';

import type { GrpcSettings } from '../types';

export function isTlsConfigured(settings: GrpcSettings): boolean {
  return settings.tlsCertFile !== '' && settings.tlsKeyFile !== '';
}

export function buildCredentials(settings: GrpcSettings): grpc.ServerCredentials {
  if (!isTlsConfigured(settings)) return grpc.ServerCredentials.createInsecure();

  const rootCerts = settings.tlsCaFile === '' ? null : readFileSync(settings.tlsCaFile);

  return grpc.ServerCredentials.createSsl(rootCerts, [{ cert_chain: readFileSync(settings.tlsCertFile), private_key: readFileSync(settings.tlsKeyFile) }], rootCerts !== null);
}
