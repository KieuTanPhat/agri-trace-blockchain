export interface GatewayConfig {
  channelName: string;
  chaincodeName: string;
  contractName: string;
  mspId: string;
  peerEndpoint: string;
  peerHostAlias: string;
  tlsCertPath: string;
  identityCertPath: string;
  identityKeyDirectory: string;
}
