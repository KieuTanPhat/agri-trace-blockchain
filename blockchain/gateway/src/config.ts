import path from "node:path";

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

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): GatewayConfig {
  const fabricSamples = requireValue(environment.FABRIC_SAMPLES_DIR, "FABRIC_SAMPLES_DIR");
  const identityMsp = requireValue(environment.RELAYER_MSP_DIR, "RELAYER_MSP_DIR");
  return {
    channelName: environment.FABRIC_CHANNEL_NAME ?? "agritrace",
    chaincodeName: environment.FABRIC_CHAINCODE_NAME ?? "agritrace",
    contractName: environment.FABRIC_CONTRACT_NAME ?? "AgriTraceContract",
    mspId: environment.FABRIC_MSP_ID ?? "Org1MSP",
    peerEndpoint: environment.FABRIC_PEER_ENDPOINT ?? "localhost:7051",
    peerHostAlias: environment.FABRIC_PEER_HOST_ALIAS ?? "peer0.org1.example.com",
    tlsCertPath: environment.FABRIC_TLS_CERT_PATH ?? path.join(
      fabricSamples,
      "test-network",
      "organizations",
      "peerOrganizations",
      "org1.example.com",
      "peers",
      "peer0.org1.example.com",
      "tls",
      "ca.crt"
    ),
    identityCertPath: environment.FABRIC_IDENTITY_CERT_PATH ?? path.join(identityMsp, "signcerts", "cert.pem"),
    identityKeyDirectory: environment.FABRIC_IDENTITY_KEY_DIR ?? path.join(identityMsp, "keystore")
  };
}

function requireValue(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required`);
  return path.resolve(value);
}
