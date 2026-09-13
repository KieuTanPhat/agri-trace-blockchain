#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BLOCKCHAIN_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
RUNTIME_DIR="${BLOCKCHAIN_DIR}/.fabric"
SAMPLES_DIR="${RUNTIME_DIR}/fabric-samples"
TEST_NETWORK_DIR="${SAMPLES_DIR}/test-network"
CHAINCODE_DIR="${BLOCKCHAIN_DIR}/chaincode"
GATEWAY_DIR="${BLOCKCHAIN_DIR}/gateway"
IDENTITIES_DIR="${SCRIPT_DIR}/identities"

if [[ -f "${SCRIPT_DIR}/.env" ]]; then
  # shellcheck disable=SC1091
  source "${SCRIPT_DIR}/.env"
fi

FABRIC_VERSION="${FABRIC_VERSION:-2.5.16}"
FABRIC_CA_VERSION="${FABRIC_CA_VERSION:-1.5.22}"
FABRIC_CHANNEL_NAME="${FABRIC_CHANNEL_NAME:-agritrace}"
FABRIC_CHAINCODE_NAME="${FABRIC_CHAINCODE_NAME:-agritrace}"
FABRIC_CHAINCODE_VERSION="${FABRIC_CHAINCODE_VERSION:-1.0}"
FABRIC_CHAINCODE_SEQUENCE="${FABRIC_CHAINCODE_SEQUENCE:-1}"
RELAYER_NAME="${RELAYER_NAME:-agri-relayer}"
RELAYER_SECRET="${RELAYER_SECRET:-relayerpw}"

usage() {
  cat <<'EOF'
Usage: ./network.sh <command>

Commands:
  bootstrap        Download pinned Fabric samples, binaries, and Docker images
  up               Start the CA-backed test network and create the channel
  deploy           Build and deploy the TypeScript chaincode
  enroll-relayer   Register a dedicated client identity with app.role=relayer
  smoke            Deploy, submit BATCH_CREATED, and query proof/history/state
  down             Stop and remove the local test network
EOF
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Required command not found: $1" >&2
    exit 1
  fi
}

require_runtime() {
  if [[ ! -x "${TEST_NETWORK_DIR}/network.sh" ]]; then
    echo "Fabric runtime not found. Run ./network.sh bootstrap first." >&2
    exit 1
  fi
}

bootstrap() {
  require_command curl
  require_command docker
  mkdir -p "${RUNTIME_DIR}"
  if [[ ! -f "${RUNTIME_DIR}/install-fabric.sh" ]]; then
    curl --fail --location --retry 3 \
      --output "${RUNTIME_DIR}/install-fabric.sh" \
      "https://raw.githubusercontent.com/hyperledger/fabric/main/scripts/install-fabric.sh"
    chmod +x "${RUNTIME_DIR}/install-fabric.sh"
  fi
  (
    cd "${RUNTIME_DIR}"
    GIT_CONFIG_COUNT=2 \
    GIT_CONFIG_KEY_0=core.autocrlf \
    GIT_CONFIG_VALUE_0=false \
    GIT_CONFIG_KEY_1=core.longpaths \
    GIT_CONFIG_VALUE_1=true \
    ./install-fabric.sh \
      --fabric-version "${FABRIC_VERSION}" \
      --ca-version "${FABRIC_CA_VERSION}" \
      samples binary docker
  )
}

up() {
  require_runtime
  require_command docker
  (
    cd "${TEST_NETWORK_DIR}"
    ./network.sh up createChannel -ca -c "${FABRIC_CHANNEL_NAME}"
  )
}

deploy() {
  require_runtime
  (
    cd "${TEST_NETWORK_DIR}"
    ./network.sh deployCC \
      -c "${FABRIC_CHANNEL_NAME}" \
      -ccn "${FABRIC_CHAINCODE_NAME}" \
      -ccp "${CHAINCODE_DIR}" \
      -ccl typescript \
      -ccv "${FABRIC_CHAINCODE_VERSION}" \
      -ccs "${FABRIC_CHAINCODE_SEQUENCE}"
  )
}

enroll_relayer() {
  require_runtime
  local ca_client="${SAMPLES_DIR}/bin/fabric-ca-client"
  local ca_tls_cert="${TEST_NETWORK_DIR}/organizations/fabric-ca/org1/tls-cert.pem"
  local admin_home="${IDENTITIES_DIR}/ca-admin"
  local relayer_home="${IDENTITIES_DIR}/relayer"

  if [[ ! -x "${ca_client}" ]]; then
    echo "fabric-ca-client not found. Run ./network.sh bootstrap first." >&2
    exit 1
  fi
  if [[ ! -f "${ca_tls_cert}" ]]; then
    echo "Org1 CA is not running. Run ./network.sh up first." >&2
    exit 1
  fi

  mkdir -p "${admin_home}" "${relayer_home}"
  if [[ ! -f "${admin_home}/msp/signcerts/cert.pem" ]]; then
    FABRIC_CA_CLIENT_HOME="${admin_home}" "${ca_client}" enroll \
      -u "https://admin:adminpw@localhost:7054" \
      --caname ca-org1 \
      --tls.certfiles "${ca_tls_cert}"
  fi

  if ! FABRIC_CA_CLIENT_HOME="${admin_home}" "${ca_client}" identity list \
    --caname ca-org1 \
    --tls.certfiles "${ca_tls_cert}" 2>/dev/null | grep -q "Name: ${RELAYER_NAME},"; then
    FABRIC_CA_CLIENT_HOME="${admin_home}" "${ca_client}" register \
      --caname ca-org1 \
      --id.name "${RELAYER_NAME}" \
      --id.secret "${RELAYER_SECRET}" \
      --id.type client \
      --id.affiliation org1.department1 \
      --id.attrs "app.role=relayer:ecert" \
      --tls.certfiles "${ca_tls_cert}"
  fi

  if [[ ! -f "${relayer_home}/msp/signcerts/cert.pem" ]]; then
    FABRIC_CA_CLIENT_HOME="${relayer_home}" "${ca_client}" enroll \
      -u "https://${RELAYER_NAME}:${RELAYER_SECRET}@localhost:7054" \
      --caname ca-org1 \
      --enrollment.attrs "app.role" \
      --tls.certfiles "${ca_tls_cert}"
  fi
  echo "Relayer MSP created under ${relayer_home}/msp"
}

smoke() {
  deploy
  if [[ ! -f "${IDENTITIES_DIR}/relayer/msp/signcerts/cert.pem" ]]; then
    echo "Relayer identity not found. Run ./network.sh enroll-relayer first." >&2
    exit 1
  fi
  (
    cd "${GATEWAY_DIR}"
    npm ci
    FABRIC_SAMPLES_DIR="${SAMPLES_DIR}" \
    RELAYER_MSP_DIR="${IDENTITIES_DIR}/relayer/msp" \
    FABRIC_CHANNEL_NAME="${FABRIC_CHANNEL_NAME}" \
    FABRIC_CHAINCODE_NAME="${FABRIC_CHAINCODE_NAME}" \
    npm run smoke
  )
}

down() {
  require_runtime
  (
    cd "${TEST_NETWORK_DIR}"
    ./network.sh down
  )
}

case "${1:-}" in
  bootstrap) bootstrap ;;
  up) up ;;
  deploy) deploy ;;
  enroll-relayer) enroll_relayer ;;
  smoke) smoke ;;
  down) down ;;
  *) usage; exit 1 ;;
esac
