import { publicBlockchainDeliveryError } from './trace-evidence.js';

describe('public blockchain diagnostics', () => {
  it('does not return raw worker errors to API consumers', () => {
    const diagnostic = 'gateway failed with token=private-value';
    const response = publicBlockchainDeliveryError(diagnostic);
    expect(response).toBeTruthy();
    expect(response).not.toContain('private-value');
    expect(response).not.toContain('token=');
  });

  it('returns null when no worker error exists', () => {
    expect(publicBlockchainDeliveryError(null)).toBeNull();
  });
});
