import { readFile } from 'node:fs/promises';

describe('Modular monolith composition roots', () => {
  it('does not start the blockchain worker from the API module', async () => {
    const source = await readFile(new URL('./app.module.ts', import.meta.url),
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
