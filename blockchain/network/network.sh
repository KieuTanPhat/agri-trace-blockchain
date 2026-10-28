#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BLOCKCHAIN_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
RUNTIME_DIR="${BLOCKCHAIN_DIR}/.fabric"
SAMPLES_DIR="${RUNTIME_DIR}/fabric-samples"

if [[ -f "${SCRIPT_DIR}/.env" ]]; then
  # shellcheck disable=SC1091
  source "${SCRIPT_DIR}/.env"
fi

FABRIC_VERSION="${FABRIC_VERSION:-2.5.16}"
FABRIC_CA_VERSION="${FABRIC_CA_VERSION:-1.5.22}"
# Installer from Fabric v2.5.16; samples revision validated by the hybrid CI job.
FABRIC_INSTALLER_COMMIT="${FABRIC_INSTALLER_COMMIT:-f871cf92a026aba7b12e6f06d71ded3e6e659d71}"
FABRIC_SAMPLES_COMMIT="${FABRIC_SAMPLES_COMMIT:-5789681b4f4d24e58fa40f19a69f5496892374b6}"

usage() {
  cat <<'EOF'
Usage: ./network.sh <command>

Commands:
  bootstrap        Download pinned Fabric samples, binaries, and Docker images

The hybrid network (hybrid/hybrid-network.sh) uses these pinned binaries and
configuration; it never starts the Fabric samples test network.
EOF
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Required command not found: $1" >&2
    exit 1
  fi
}

bootstrap() {
  require_command curl
  require_command docker
  require_command git
  if [[ ! "${FABRIC_INSTALLER_COMMIT}" =~ ^[a-f0-9]{40}$ || ! "${FABRIC_SAMPLES_COMMIT}" =~ ^[a-f0-9]{40}$ ]]; then
    echo "Fabric installer and samples must be pinned to full commit SHAs." >&2
    exit 1
  fi
  local installer="${RUNTIME_DIR}/install-fabric-${FABRIC_INSTALLER_COMMIT}.sh"
  mkdir -p "${RUNTIME_DIR}"
  if [[ ! -f "${installer}" ]]; then
    curl --fail --location --retry 3 \
      --output "${installer}.download" \
      "https://raw.githubusercontent.com/hyperledger/fabric/${FABRIC_INSTALLER_COMMIT}/scripts/install-fabric.sh"
    chmod +x "${installer}.download"
    mv "${installer}.download" "${installer}"
  fi
  if [[ ! -d "${SAMPLES_DIR}/.git" ]]; then
    git -c core.autocrlf=false -c core.longpaths=true clone --no-checkout \
      https://github.com/hyperledger/fabric-samples.git "${SAMPLES_DIR}"
  fi
  git -C "${SAMPLES_DIR}" fetch --depth 1 origin "${FABRIC_SAMPLES_COMMIT}"
  git -c core.autocrlf=false -c core.longpaths=true -C "${SAMPLES_DIR}" \
    checkout --detach "${FABRIC_SAMPLES_COMMIT}"
  echo "Fabric samples commit: $(git -C "${SAMPLES_DIR}" rev-parse HEAD)"
  (
    cd "${RUNTIME_DIR}"
    GIT_CONFIG_COUNT=2 \
    GIT_CONFIG_KEY_0=core.autocrlf \
    GIT_CONFIG_VALUE_0=false \
    GIT_CONFIG_KEY_1=core.longpaths \
    GIT_CONFIG_VALUE_1=true \
    "${installer}" \
      --fabric-version "${FABRIC_VERSION}" \
      --ca-version "${FABRIC_CA_VERSION}" \
      binary docker
  )
}

case "${1:-}" in
  bootstrap) bootstrap ;;
  *) usage; exit 1 ;;
esac
