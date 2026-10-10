import { readFile } from 'node:fs/promises';

describe('Modular monolith composition roots', () => {
  it('separates lot queries/presentation from transactional harvest commands', async () => {
    const query = await readFile(
      new URL('./modules/lots/lot-query.service.ts', import.meta.url),
      'utf8',
    );
    const presenter = await readFile(
      new URL('./modules/lots/lot.presenter.ts', import.meta.url),
      'utf8',
    );
    const harvest = await readFile(
      new URL('./modules/lots/lot-harvest.service.ts', import.meta.url),
      'utf8',
    );
    expect(query).not.toContain('$transaction');
    expect(query).not.toContain('createInTransaction');
    expect(presenter).not.toContain('PrismaService');
    expect(presenter).not.toContain('@Injectable');
    const commandTransaction = await readFile(
      new URL('./common/idempotency/command-transaction.ts', import.meta.url),
      'utf8',
    );
    expect(harvest).toContain('commandTransaction(');
    expect(commandTransaction).toContain('prisma.$transaction(');
    expect(commandTransaction).toContain('tx.commandCommit.create(');
    expect(harvest).toContain('createInTransaction');
  });

  it('does not start the blockchain worker from the API module', async () => {
    const source = await readFile(
      new URL('./app.module.ts', import.meta.url),
      'utf8',
    );

    expect(source).not.toContain('BlockchainWorkerService');
    expect(source).not.toContain('BlockchainWorkerRunner');
    expect(source).not.toContain('WorkerModule');
  });

  it('keeps business HTTP modules out of the worker composition root', async () => {
    const source = await readFile(
      new URL('./worker/worker.module.ts', import.meta.url),
      'utf8',
    );

    for (const forbidden of [
      'AuthModule',
      'LotsModule',
      'ProductionCyclesModule',
      'ShipmentsModule',
      'IotModule',
      'ComplianceModule',
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });

  it('does not expose an HTTP endpoint that executes the worker loop', async () => {
    const source = await readFile(
      new URL(
        './modules/blockchain-adapter/blockchain.controller.ts',
        import.meta.url,
      ),
      'utf8',
    );

    expect(source).not.toContain("@Post('worker/run')");
    expect(source).not.toContain('processPending');
  });
});
