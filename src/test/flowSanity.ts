import 'reflect-metadata';
import { container } from '../di/container';
import JournalTransactionFlow from '../flows/JournalTransactionFlow';

async function run() {
  // DI resolve to ensure constructors wiring
  const flow = container.resolve(JournalTransactionFlow as any);

  console.log('JournalTransactionFlow resolved:', !!flow);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
