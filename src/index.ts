import 'reflect-metadata';

import { sequelize } from './config/database';

async function main(): Promise<void> {
  await sequelize.authenticate();
  console.log('[db] connection established');
}

main().catch((error) => {
  console.error('[bootstrap] failed to start service', error);
  process.exit(1);
});
