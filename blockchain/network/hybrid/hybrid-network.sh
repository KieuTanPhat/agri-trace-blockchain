#!/usr/bin/env bash
# Local three-organization Fabric pilot for the hybrid release (pilot only; it
# is not a production runbook). Run inside Linux/WSL with Docker.
#
#   AgriTraceMSP (Org1)  orderer + peer + technical relayer/controller/admin
#   OwnerMSP     (Org2)  hosted by AgriTrace (MANAGED_ORG: AgriTrace holds the keys)
#   SelfMSP      (Org3)  own CA, peer and key directory (SELF_MANAGED_ORG)
#
# Channels (one per collaboration group, so unrelated history is never shared):
#   hybrid-b    Org1 + Org2        endorsement AND(Org1 peer, Org2 peer)
#   hybrid-self Org1 + Org3        endorsement AND(Org1 peer, Org3 peer)
set -Eeuo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "${HERE}/../../.." && pwd)"
ROOT="${AGRI_FABRIC_ROOT:-${HOME}/agritrace-fabric}"
INSTANCE="${AGRI_FABRIC_INSTANCE:?Set AGRI_FABRIC_INSTANCE to an isolated test resource prefix}"
[[ "${INSTANCE}" =~ ^[a-z][a-z0-9-]{3,48}$ ]] || { echo 'Invalid Fabric instance' >&2; exit 2; }
# Loopback by default. WSL2 NAT cannot forward a 127.0.0.1-bound port to the Windows
# host, so a Windows test run sets AGRI_FABRIC_BIND_ADDRESS=0.0.0.0 on a private machine.
BIND_ADDRESS="${AGRI_FABRIC_BIND_ADDRESS:-127.0.0.1}"
[[ "${BIND_ADDRESS}" =~ ^[0-9.]{7,15}$ ]] || { echo 'Invalid Fabric bind address' >&2; exit 2; }
PORT_OFFSET="${AGRI_FABRIC_PORT_OFFSET:-0}"
[[ "${PORT_OFFSET}" =~ ^[0-9]{1,5}$ ]] && ((PORT_OFFSET <= 50000)) || { echo 'Invalid Fabric port offset' >&2; exit 2; }
ROOT="$(realpath -m "${ROOT}")"
[[ "${ROOT}" != / && "${ROOT}" != "${HOME}" ]] || { echo 'Unsafe Fabric root' >&2; exit 2; }
umask 077
NET="${ROOT}/net"
SELF="${ROOT}/self"
REMOTE_SELF_MSP="${AGRI_SELF_PUBLIC_MSP:-}"
REMOTE_SELF_ENDPOINT="${AGRI_SELF_PEER_ENDPOINT:-}"
if [[ -n "${REMOTE_SELF_MSP}" ]]; then
  [[ -d "${REMOTE_SELF_MSP}/cacerts" && -d "${REMOTE_SELF_MSP}/tlscacerts" && -f "${REMOTE_SELF_MSP}/config.yaml" ]] || { echo 'A public MSP export is required' >&2; exit 2; }
  [[ "${REMOTE_SELF_ENDPOINT}" =~ ^[A-Za-z0-9.-]+:[1-9][0-9]{0,4}$ ]] || { echo 'A reviewed remote peer endpoint is required' >&2; exit 2; }
fi
export PATH="${ROOT}/fabric-samples/bin:${PATH}"
FABRIC_SAMPLES_CFG="${ROOT}/fabric-samples/config"

CHANNEL_B="hybrid-b"
CHANNEL_SELF="hybrid-self"
CC_NAME="${CC_NAME:-agritrace}"
CC_VERSION="${CC_VERSION:-2.0}"
CC_SEQUENCE="${CC_SEQUENCE:-1}"
CC_LABEL="${CC_NAME}_${CC_VERSION}"
CC_IMAGE="agritrace-cc:${CC_VERSION}"
POLICY_B="AND('Org1MSP.peer','Org2MSP.peer')"
POLICY_SELF="AND('Org1MSP.peer','Org3MSP.peer')"
RELAYER_AUTHORITY="${RELAYER_AUTHORITY:-agritrace-relayer-b}"

ORDERER_DIR="${NET}/organizations/ordererOrganizations/example.com"
ORDERER_TLS="${ORDERER_DIR}/orderers/orderer.example.com/tls"
ORDERER_CA="${ORDERER_TLS}/ca.crt"

log() { printf '[hybrid] %s\n' "$*"; }
need() { command -v "$1" >/dev/null 2>&1 || { echo "Missing required command: $1" >&2; exit 1; }; }

host_port() { echo "$(( $1 + PORT_OFFSET ))"; }
resource() { echo "${INSTANCE}-$1"; }
known_resource() { [[ "$1" =~ ^(ca-(orderer|org[123])|orderer\.example\.com|peer0\.org[123]\.example\.com|cc-org[123])$ ]]; }
assert_owned() { # kind, scoped resource; absent resources remain harmless
  local label
  command docker "$1" inspect "$2" >/dev/null 2>&1 || return 0
  label="$(command docker "$1" inspect --format '{{index .Labels "agritrace.hybrid.instance"}}' "$2" 2>/dev/null || true)"
  if [[ "$1" == container ]]; then
    label="$(command docker inspect --format '{{index .Config.Labels "agritrace.hybrid.instance"}}' "$2")"
  fi
  [[ "${label}" == "${INSTANCE}" ]] || { echo 'Fabric resource ownership mismatch' >&2; return 3; }
}

# All Docker calls below are scoped. Canonical DNS names remain network aliases
# for TLS/channel config; published ports are loopback-only and offsettable.
# This adapter never selects unrelated containers, networks or volumes.
docker() {
  local args=() current next name original operation="${1:-}" kind="${1:-}" action="${2:-}"
  if [[ "${kind}" == volume && "${action}" == create ]]; then
    args=(volume create --label "agritrace.hybrid.instance=${INSTANCE}"); shift 2
  fi
  if [[ "${operation}" == run ]]; then
    args=(run --label "agritrace.hybrid.instance=${INSTANCE}" --label agritrace.purpose=hybrid-test
      --cpus "${AGRI_FABRIC_CPUS:-1}" --memory "${AGRI_FABRIC_MEMORY:-512m}" --memory-swap "${AGRI_FABRIC_MEMORY:-512m}")
    shift
  fi
  while (($#)); do
    current="$1"; shift
    case "${current}" in
      --name)
        original="$1"; shift; name="$(resource "${original}")"
        assert_owned container "${name}" || return
        args+=(--name "${name}" --hostname "${original}" --network-alias "${original}") ;;
      --network)
        next="$1"; shift; [[ "${next}" != agritrace_hybrid ]] || next="$(resource network)"
        args+=(--network "${next}") ;;
      -p)
        next="$1"; shift
        args+=(-p "${BIND_ADDRESS}:$(host_port "${next%%:*}"):${next##*:}") ;;
      -v)
        next="$1"; shift; original="${next%%:*}"
        if known_resource "${original}"; then next="$(resource "${original}"):${next#*:}"; fi
        args+=(-v "${next}") ;;
      unless-stopped) args+=(no) ;;
      agritrace_hybrid)
        next="$(resource network)"; assert_owned network "${next}" || return; args+=("${next}") ;;
      *)
        if [[ "${operation}" =~ ^(rm|stop|start|inspect)$ || "${kind}" == volume ]]; then
          if known_resource "${current}"; then
            current="$(resource "${current}")"
            if [[ "${kind}" == volume ]]; then assert_owned volume "${current}" || return
            else assert_owned container "${current}" || return; fi
          fi
        fi
        args+=("${current}") ;;
    esac
  done
  command docker "${args[@]}"
}

render() { sed -e "s|@NET@|${NET}|g" -e "s|@SELF@|${SELF}|g" "$1" > "$2"; }

org_base() { case "$1" in org3) echo "${SELF}" ;; *) echo "${NET}" ;; esac; }
org_msp() { case "$1" in org1) echo Org1MSP ;; org2) echo Org2MSP ;; org3) echo Org3MSP ;; esac; }
org_port() { case "$1" in org1) echo 7051 ;; org2) echo 9051 ;; org3) echo 11051 ;; esac; }
org_dir() { echo "$(org_base "$1")/organizations/peerOrganizations/$1.example.com"; }
peer_tls_ca() {
  if [[ "$1" == org3 && -n "${REMOTE_SELF_MSP}" ]]; then
    local files=("${REMOTE_SELF_MSP}"/tlscacerts/*); [[ ${#files[@]} == 1 ]] || return 2; echo "${files[0]}"
  else echo "$(org_dir "$1")/peers/peer0.$1.example.com/tls/ca.crt"; fi
}

# Environment for the `peer` CLI acting as an organization's admin.
peer_env() {
  local org="$1"
  [[ "${org}" != org3 || -z "${REMOTE_SELF_MSP}" ]] || { echo 'Org3 admin runs only on the enterprise VPS' >&2; return 2; }
  export FABRIC_CFG_PATH="${FABRIC_SAMPLES_CFG}"
  export CORE_PEER_TLS_ENABLED=true
  export CORE_PEER_LOCALMSPID="$(org_msp "${org}")"
  export CORE_PEER_ADDRESS="localhost:$(host_port "$(org_port "${org}")")"
  export CORE_PEER_MSPCONFIGPATH="$(org_dir "${org}")/users/Admin@${org}.example.com/msp"
  export CORE_PEER_TLS_ROOTCERT_FILE="$(peer_tls_ca "${org}")"
}
as() { local org="$1"; shift; ( peer_env "${org}"; "$@" ); }

wait_for_ca() {
  local port="$1"
  for _ in $(seq 1 60); do
    curl -sk "https://localhost:$(host_port "${port}")/cainfo" >/dev/null 2>&1 && return 0
    sleep 1
  done
  echo "CA on port ${port} did not become ready" >&2
  return 1
}

write_node_ou() {
  local file="$1" ca="$2"
  cat > "${file}" <<YAML
NodeOUs:
  Enable: true
  ClientOUIdentifier:
    Certificate: ${ca}
    OrganizationalUnitIdentifier: client
  PeerOUIdentifier:
    Certificate: ${ca}
    OrganizationalUnitIdentifier: peer
  AdminOUIdentifier:
    Certificate: ${ca}
    OrganizationalUnitIdentifier: admin
  OrdererOUIdentifier:
    Certificate: ${ca}
    OrganizationalUnitIdentifier: orderer
YAML
}

register() { # caname tlscert name secret type [attrs]
  fabric-ca-client register --caname "$1" --tls.certfiles "$2" \
    --id.name "$3" --id.secret "$4" --id.type "$5" ${6:+--id.attrs "$6"} 2>&1 \
    | grep -v "is already registered" || true
}

collect_tls() { # tls-dir
  local dir="$1"
  cp "${dir}"/tlscacerts/* "${dir}/ca.crt"
  cp "${dir}"/signcerts/* "${dir}/server.crt"
  cp "${dir}"/keystore/* "${dir}/server.key"
}

setup_peer_org() { # org  (enroll CA admin, peer, admin and technical identities)
  local org="$1" base domain port caname tls orgdir
  base="$(org_base "${org}")"; domain="${org}.example.com"
  port="$(host_port "$(case "${org}" in org1) echo 7054 ;; org2) echo 8054 ;; org3) echo 11054 ;; esac)")"
  caname="ca-${org}"; tls="${base}/fabric-ca/${org}/ca-cert.pem"; orgdir="$(org_dir "${org}")"
  mkdir -p "${orgdir}"
  export FABRIC_CA_CLIENT_HOME="${orgdir}"
  fabric-ca-client enroll -u "https://admin:adminpw@localhost:${port}" --caname "${caname}" --tls.certfiles "${tls}" >/dev/null 2>&1
  write_node_ou "${orgdir}/msp/config.yaml" "cacerts/localhost-${port}-${caname}.pem"
  mkdir -p "${orgdir}/msp/tlscacerts" "${orgdir}/tlsca" "${orgdir}/ca"
  cp "${tls}" "${orgdir}/msp/tlscacerts/ca.crt"
  cp "${tls}" "${orgdir}/tlsca/tlsca.${domain}-cert.pem"
  cp "${tls}" "${orgdir}/ca/ca.${domain}-cert.pem"

  register "${caname}" "${tls}" peer0 peer0pw peer
  register "${caname}" "${tls}" orgadmin orgadminpw admin "app.role=admin:ecert"
  if [[ "${org}" == "org1" ]]; then
    register "${caname}" "${tls}" relayer relayerpw client \
      "app.role=relayer:ecert,app.authority=${RELAYER_AUTHORITY}:ecert"
    register "${caname}" "${tls}" controller controllerpw client "app.role=controller:ecert"
  fi

  local peerdir="${orgdir}/peers/peer0.${domain}"
  fabric-ca-client enroll -u "https://peer0:peer0pw@localhost:${port}" --caname "${caname}" \
    -M "${peerdir}/msp" --csr.hosts "peer0.${domain}" --csr.hosts localhost --tls.certfiles "${tls}" >/dev/null 2>&1
  cp "${orgdir}/msp/config.yaml" "${peerdir}/msp/config.yaml"
  fabric-ca-client enroll -u "https://peer0:peer0pw@localhost:${port}" --caname "${caname}" \
    -M "${peerdir}/tls" --enrollment.profile tls --csr.hosts "peer0.${domain}" --csr.hosts localhost \
    --tls.certfiles "${tls}" >/dev/null 2>&1
  collect_tls "${peerdir}/tls"

  enroll_user "${org}" orgadmin orgadminpw "Admin@${domain}"
  if [[ "${org}" == "org1" ]]; then
    enroll_user org1 relayer relayerpw "relayer@${domain}"
    enroll_user org1 controller controllerpw "controller@${domain}"
  fi
}

enroll_user() { # org id secret dir-name
  local org="$1" id="$2" secret="$3" name="$4" base port caname tls orgdir
  base="$(org_base "${org}")"
  port="$(host_port "$(case "${org}" in org1) echo 7054 ;; org2) echo 8054 ;; org3) echo 11054 ;; esac)")"
  caname="ca-${org}"; tls="${base}/fabric-ca/${org}/ca-cert.pem"; orgdir="$(org_dir "${org}")"
  export FABRIC_CA_CLIENT_HOME="${orgdir}"
  fabric-ca-client enroll -u "https://${id}:${secret}@localhost:${port}" --caname "${caname}" \
    -M "${orgdir}/users/${name}/msp" --tls.certfiles "${tls}" >/dev/null 2>&1
  cp "${orgdir}/msp/config.yaml" "${orgdir}/users/${name}/msp/config.yaml"
}

setup_orderer_org() {
  local tls="${NET}/fabric-ca/orderer/ca-cert.pem" domain="example.com"
  mkdir -p "${ORDERER_DIR}"
  export FABRIC_CA_CLIENT_HOME="${ORDERER_DIR}"
  fabric-ca-client enroll -u "https://admin:adminpw@localhost:$(host_port 9054)" --caname ca-orderer --tls.certfiles "${tls}" >/dev/null 2>&1
  write_node_ou "${ORDERER_DIR}/msp/config.yaml" "cacerts/localhost-$(host_port 9054)-ca-orderer.pem"
  mkdir -p "${ORDERER_DIR}/msp/tlscacerts" "${ORDERER_DIR}/tlsca"
  cp "${tls}" "${ORDERER_DIR}/msp/tlscacerts/tlsca.${domain}-cert.pem"
  cp "${tls}" "${ORDERER_DIR}/tlsca/tlsca.${domain}-cert.pem"
  register ca-orderer "${tls}" orderer ordererpw orderer
  register ca-orderer "${tls}" ordereradmin ordereradminpw admin
  local odir="${ORDERER_DIR}/orderers/orderer.${domain}"
  fabric-ca-client enroll -u "https://orderer:ordererpw@localhost:$(host_port 9054)" --caname ca-orderer \
    -M "${odir}/msp" --csr.hosts "orderer.${domain}" --csr.hosts localhost --tls.certfiles "${tls}" >/dev/null 2>&1
  cp "${ORDERER_DIR}/msp/config.yaml" "${odir}/msp/config.yaml"
  fabric-ca-client enroll -u "https://orderer:ordererpw@localhost:$(host_port 9054)" --caname ca-orderer \
    -M "${odir}/tls" --enrollment.profile tls --csr.hosts "orderer.${domain}" --csr.hosts localhost \
    --tls.certfiles "${tls}" >/dev/null 2>&1
  collect_tls "${odir}/tls"
  mkdir -p "${odir}/msp/tlscacerts"
  cp "${odir}/tls/ca.crt" "${odir}/msp/tlscacerts/tlsca.${domain}-cert.pem"
}

export_public_msp() { # Org3 public MSP for the shared channel configuration
  local src dst
  src="${REMOTE_SELF_MSP:-$(org_dir org3)/msp}"; dst="${NET}/public/org3.example.com/msp"
  mkdir -p "${dst}"
  cp -r "${src}/cacerts" "${src}/tlscacerts" "${dst}/"
  cp "${src}/config.yaml" "${dst}/config.yaml"
}

create_network() {
  docker network inspect agritrace_hybrid >/dev/null 2>&1 || docker network create --label "agritrace.hybrid.instance=${INSTANCE}" agritrace_hybrid >/dev/null
  local volume
  for volume in "${HYBRID_VOLUMES[@]}"; do
    assert_owned volume "$(resource "${volume}")"
    docker volume create --label "agritrace.hybrid.instance=${INSTANCE}" "${volume}" >/dev/null
  done
}

HYBRID_CONTAINERS=(ca-orderer ca-org1 ca-org2 ca-org3 orderer.example.com peer0.org1.example.com peer0.org2.example.com peer0.org3.example.com)
HYBRID_VOLUMES=(orderer.example.com peer0.org1.example.com peer0.org2.example.com peer0.org3.example.com)

run_ca() { # org port base
  local org="$1" port="$2" base="$3"
  docker rm -f "ca-${org}" >/dev/null 2>&1 || true
  docker run -d --restart unless-stopped --name "ca-${org}" --network agritrace_hybrid -p "${port}:${port}"     -e FABRIC_CA_HOME=/etc/hyperledger/fabric-ca-server -e "FABRIC_CA_SERVER_CA_NAME=ca-${org}"     -e FABRIC_CA_SERVER_TLS_ENABLED=true -e "FABRIC_CA_SERVER_PORT=${port}"     -e "FABRIC_CA_SERVER_CSR_HOSTS=localhost,ca.${org}.example.com"     -v "${base}/fabric-ca/${org}:/etc/hyperledger/fabric-ca-server"     hyperledger/fabric-ca:1.5.22 fabric-ca-server start -b admin:adminpw -d >/dev/null
}

run_orderer() {
  local tls="${ORDERER_TLS}" msp="${ORDERER_DIR}/orderers/orderer.example.com/msp"
  docker rm -f orderer.example.com >/dev/null 2>&1 || true
  docker run -d --restart unless-stopped --name orderer.example.com --network agritrace_hybrid     -p 7050:7050 -p 7053:7053     -e FABRIC_LOGGING_SPEC=INFO -e ORDERER_GENERAL_LISTENADDRESS=0.0.0.0 -e ORDERER_GENERAL_LISTENPORT=7050     -e ORDERER_GENERAL_LOCALMSPID=OrdererMSP -e ORDERER_GENERAL_LOCALMSPDIR=/var/hyperledger/orderer/msp     -e ORDERER_GENERAL_TLS_ENABLED=true     -e ORDERER_GENERAL_TLS_PRIVATEKEY=/var/hyperledger/orderer/tls/server.key     -e ORDERER_GENERAL_TLS_CERTIFICATE=/var/hyperledger/orderer/tls/server.crt     -e "ORDERER_GENERAL_TLS_ROOTCAS=[/var/hyperledger/orderer/tls/ca.crt]"     -e ORDERER_GENERAL_CLUSTER_CLIENTCERTIFICATE=/var/hyperledger/orderer/tls/server.crt     -e ORDERER_GENERAL_CLUSTER_CLIENTPRIVATEKEY=/var/hyperledger/orderer/tls/server.key     -e "ORDERER_GENERAL_CLUSTER_ROOTCAS=[/var/hyperledger/orderer/tls/ca.crt]"     -e ORDERER_GENERAL_BOOTSTRAPMETHOD=none -e ORDERER_CHANNELPARTICIPATION_ENABLED=true     -e ORDERER_ADMIN_TLS_ENABLED=true     -e ORDERER_ADMIN_TLS_CERTIFICATE=/var/hyperledger/orderer/tls/server.crt     -e ORDERER_ADMIN_TLS_PRIVATEKEY=/var/hyperledger/orderer/tls/server.key     -e "ORDERER_ADMIN_TLS_ROOTCAS=[/var/hyperledger/orderer/tls/ca.crt]"     -e "ORDERER_ADMIN_TLS_CLIENTROOTCAS=[/var/hyperledger/orderer/tls/ca.crt]"     -e ORDERER_ADMIN_LISTENADDRESS=0.0.0.0:7053 -e ORDERER_OPERATIONS_LISTENADDRESS=0.0.0.0:9443     -v "${msp}:/var/hyperledger/orderer/msp" -v "${tls}:/var/hyperledger/orderer/tls"     -v orderer.example.com:/var/hyperledger/production/orderer     hyperledger/fabric-orderer:2.5.16 orderer >/dev/null
}

run_peer() { # org   (ports: org1 7051, org2 9051, org3 11051; operations 9444+)
  local org="$1" port msp ops dir
  port="$(org_port "${org}")"; msp="$(org_msp "${org}")"; dir="$(org_dir "${org}")/peers/peer0.${org}.example.com"
  ops="$(case "${org}" in org1) echo 9444 ;; org2) echo 9445 ;; org3) echo 9446 ;; esac)"
  docker rm -f "peer0.${org}.example.com" >/dev/null 2>&1 || true
  docker run -d --restart unless-stopped --name "peer0.${org}.example.com" --network agritrace_hybrid -p "${port}:${port}"     -e FABRIC_LOGGING_SPEC=INFO -e CORE_PEER_TLS_ENABLED=true -e CORE_PEER_PROFILE_ENABLED=false     -e CORE_PEER_TLS_CERT_FILE=/etc/hyperledger/tls/server.crt -e CORE_PEER_TLS_KEY_FILE=/etc/hyperledger/tls/server.key     -e CORE_PEER_TLS_ROOTCERT_FILE=/etc/hyperledger/tls/ca.crt -e CORE_PEER_MSPCONFIGPATH=/etc/hyperledger/msp     -e "CORE_PEER_ID=peer0.${org}.example.com" -e "CORE_PEER_ADDRESS=peer0.${org}.example.com:${port}"     -e "CORE_PEER_LISTENADDRESS=0.0.0.0:${port}"     -e "CORE_PEER_CHAINCODEADDRESS=peer0.${org}.example.com:$((port + 1))"     -e "CORE_PEER_CHAINCODELISTENADDRESS=0.0.0.0:$((port + 1))"     -e "CORE_PEER_GOSSIP_BOOTSTRAP=peer0.${org}.example.com:${port}"     -e "CORE_PEER_GOSSIP_EXTERNALENDPOINT=peer0.${org}.example.com:${port}"     -e "CORE_PEER_LOCALMSPID=${msp}" -e "CORE_OPERATIONS_LISTENADDRESS=0.0.0.0:${ops}"     -e "CHAINCODE_AS_A_SERVICE_BUILDER_CONFIG={\"peername\":\"peer0${org}\"}"     -v "${dir}/msp:/etc/hyperledger/msp" -v "${dir}/tls:/etc/hyperledger/tls"     -v "peer0.${org}.example.com:/var/hyperledger/production"     hyperledger/fabric-peer:2.5.16 peer node start >/dev/null
}

cmd_up() {
  need docker; need curl; need fabric-ca-client; need configtxgen; need osnadmin; need peer
  mkdir -p "${ROOT}"
  if [[ -e "${ROOT}/.agritrace-instance" ]]; then
    [[ "$(cat "${ROOT}/.agritrace-instance")" == "${INSTANCE}" ]] || { echo 'Fabric root ownership mismatch' >&2; exit 2; }
  elif [[ -d "${NET}" || -d "${SELF}" ]]; then
    echo 'Existing unowned Fabric root; use a fresh isolated path' >&2; exit 2
  else printf '%s\n' "${INSTANCE}" > "${ROOT}/.agritrace-instance"; fi
  create_network
  mkdir -p "${NET}/fabric-ca/orderer" "${NET}/fabric-ca/org1" "${NET}/fabric-ca/org2" \
    "${NET}/channel-artifacts" "${NET}/configtx" "${SELF}/fabric-ca/org3"
  render "${HERE}/templates/configtx.yaml.tmpl" "${NET}/configtx/configtx.yaml"
  if [[ -n "${REMOTE_SELF_MSP}" ]]; then
    sed -i "s/Host: peer0.org3.example.com, Port: 11051/Host: ${REMOTE_SELF_ENDPOINT%:*}, Port: ${REMOTE_SELF_ENDPOINT##*:}/" "${NET}/configtx/configtx.yaml"
  fi

  log "starting certificate authorities"
  run_ca orderer 9054 "${NET}"; run_ca org1 7054 "${NET}"; run_ca org2 8054 "${NET}"
  if [[ -z "${REMOTE_SELF_MSP}" ]]; then run_ca org3 11054 "${SELF}"; fi
  for port in 9054 7054 8054; do wait_for_ca "${port}"; done
  if [[ -z "${REMOTE_SELF_MSP}" ]]; then wait_for_ca 11054; fi

  log "enrolling identities (Org3 keys stay in ${SELF})"
  setup_orderer_org
  setup_peer_org org1
  setup_peer_org org2
  if [[ -z "${REMOTE_SELF_MSP}" ]]; then setup_peer_org org3; fi
  export_public_msp

  log "creating channel genesis blocks"
  FABRIC_CFG_PATH="${NET}/configtx" configtxgen -profile HybridB -channelID "${CHANNEL_B}" \
    -outputBlock "${NET}/channel-artifacts/${CHANNEL_B}.block"
  FABRIC_CFG_PATH="${NET}/configtx" configtxgen -profile HybridSelf -channelID "${CHANNEL_SELF}" \
    -outputBlock "${NET}/channel-artifacts/${CHANNEL_SELF}.block"

  log "starting orderer and peers"
  run_orderer
  run_peer org1; run_peer org2
  if [[ -z "${REMOTE_SELF_MSP}" ]]; then run_peer org3; fi
  sleep 5
  for channel in "${CHANNEL_B}" "${CHANNEL_SELF}"; do
    osnadmin channel join --channelID "${channel}" --config-block "${NET}/channel-artifacts/${channel}.block" \
      -o "localhost:$(host_port 7053)" --ca-file "${ORDERER_CA}" --client-cert "${ORDERER_TLS}/server.crt" \
      --client-key "${ORDERER_TLS}/server.key" >/dev/null
  done
  sleep 3
  as org1 peer channel join -b "${NET}/channel-artifacts/${CHANNEL_B}.block"
  as org2 peer channel join -b "${NET}/channel-artifacts/${CHANNEL_B}.block"
  as org1 peer channel join -b "${NET}/channel-artifacts/${CHANNEL_SELF}.block"
  if [[ -z "${REMOTE_SELF_MSP}" ]]; then as org3 peer channel join -b "${NET}/channel-artifacts/${CHANNEL_SELF}.block"; fi
  log "network is up"
}

# ---- chaincode lifecycle (chaincode-as-a-service, one container per org) ----

build_cc_image() {
  local src="${REPO}/blockchain/chaincode" stage="${ROOT}/cc-build"
  [[ -d "${src}/dist" ]] || { echo "Build the chaincode first (npm run build in blockchain/chaincode)" >&2; exit 1; }
  rm -rf "${stage}"; mkdir -p "${stage}"
  cp "${src}/package.json" "${src}/package-lock.json" "${stage}/"
  cp -r "${src}/dist" "${stage}/dist"
  # umask 077 makes the staged files unreadable to the image's non-root user.
  chmod -R a+rX "${stage}"
  docker build -q -t "${CC_IMAGE}" -f "${HERE}/ccaas/Dockerfile" "${stage}" >/dev/null
}

package_cc() { # org -> path
  local org="$1" dir
  dir="${ROOT}/cc-package/${org}"
  rm -rf "${dir}"; mkdir -p "${dir}"
  printf '{"address":"cc-%s:9999","dial_timeout":"10s","tls_required":false}' "${org}" > "${dir}/connection.json"
  ( cd "${dir}" && tar cfz code.tar.gz connection.json )
  printf '{"type":"ccaas","label":"%s"}' "${CC_LABEL}" > "${dir}/metadata.json"
  ( cd "${dir}" && tar cfz "${CC_NAME}-${org}.tgz" metadata.json code.tar.gz )
  echo "${dir}/${CC_NAME}-${org}.tgz"
}

installed_package_id() { # org
  as "$1" peer lifecycle chaincode queryinstalled --output json \
    | jq -r --arg label "${CC_LABEL}" '.installed_chaincodes[]? | select(.label==$label) | .package_id' | head -1
}

install_cc() { # org : installs the package and starts that organization's chaincode container
  local org="$1" pkg id
  pkg="$(package_cc "${org}")"
  as "${org}" peer lifecycle chaincode install "${pkg}" >/dev/null 2>&1 || true
  id="$(installed_package_id "${org}")"
  [[ -n "${id}" ]] || { echo "Chaincode package was not installed for ${org}" >&2; exit 1; }
  docker rm -f "cc-${org}" >/dev/null 2>&1 || true
  docker run -d --restart unless-stopped --name "cc-${org}" --network agritrace_hybrid \
    -e CHAINCODE_SERVER_ADDRESS=0.0.0.0:9999 -e "CHAINCODE_ID=${id}" "${CC_IMAGE}" >/dev/null
  echo "${id}" > "${ROOT}/cc-package/${org}/package-id"
  log "${org}: installed ${id}"
}

approve_cc() { # org channel policy
  local org="$1" channel="$2" policy="$3" id
  id="$(cat "${ROOT}/cc-package/${org}/package-id")"
  as "${org}" peer lifecycle chaincode approveformyorg -o "localhost:$(host_port 7050)" --tls --cafile "${ORDERER_CA}" \
    --channelID "${channel}" --name "${CC_NAME}" --version "${CC_VERSION}" --package-id "${id}" \
    --sequence "${CC_SEQUENCE}" --signature-policy "${policy}" >/dev/null
  log "${org}: approved ${CC_NAME} ${CC_VERSION}#${CC_SEQUENCE} on ${channel}"
}

commit_cc() { # channel policy org...
  local channel="$1" policy="$2"; shift 2
  local args=() org
  for org in "$@"; do
    if [[ "${org}" == org3 && -n "${REMOTE_SELF_MSP}" ]]; then
      args+=(--peerAddresses "${REMOTE_SELF_ENDPOINT}" --tlsRootCertFiles "$(peer_tls_ca org3)")
    else args+=(--peerAddresses "localhost:$(host_port "$(org_port "${org}")")" --tlsRootCertFiles "$(peer_tls_ca "${org}")"); fi
  done
  as "$1" peer lifecycle chaincode commit -o "localhost:$(host_port 7050)" --tls --cafile "${ORDERER_CA}" \
    --channelID "${channel}" --name "${CC_NAME}" --version "${CC_VERSION}" --sequence "${CC_SEQUENCE}" \
    --signature-policy "${policy}" "${args[@]}" >/dev/null
  log "committed ${CC_NAME} ${CC_VERSION}#${CC_SEQUENCE} on ${channel}"
}

cmd_deploy() {
  need jq
  mkdir -p "${ROOT}/cc-package"
  build_cc_image
  # AgriTrace and the hosted owner operate their own chaincode containers.
  install_cc org1
  install_cc org2
  # The self-managed owner installs and approves with its own identity (`self-deploy`
  # may also be run separately on the owner's machine).
  if [[ -z "${REMOTE_SELF_MSP}" ]]; then install_cc org3; fi
  approve_cc org1 "${CHANNEL_B}" "${POLICY_B}"
  approve_cc org2 "${CHANNEL_B}" "${POLICY_B}"
  commit_cc "${CHANNEL_B}" "${POLICY_B}" org1 org2
  approve_cc org1 "${CHANNEL_SELF}" "${POLICY_SELF}"
  if [[ -n "${REMOTE_SELF_MSP}" ]]; then
    mkdir -p "${ROOT}/remote-bundle"
    cp "$(package_cc org3)" "${ROOT}/remote-bundle/chaincode.tgz"
    cp "${NET}/channel-artifacts/${CHANNEL_SELF}.block" "${ROOT}/remote-bundle/channel.block"
    cp "${ORDERER_CA}" "${ROOT}/remote-bundle/orderer-ca.crt"
    command docker image save "${CC_IMAGE}" -o "${ROOT}/remote-bundle/chaincode-image.tar"
    log 'Send only remote-bundle to the enterprise; join/install/approve there, then run commit-remote here'
    command docker image inspect --format '{{.Id}}' "${CC_IMAGE}"
    return
  fi
  approve_cc org3 "${CHANNEL_SELF}" "${POLICY_SELF}"
  commit_cc "${CHANNEL_SELF}" "${POLICY_SELF}" org1 org3
}

cmd_status() {
  docker ps --format 'table {{.Names}}\t{{.Status}}' | grep -E 'NAMES|ca-|peer0|orderer|cc-' || true
  for pair in "org1:${CHANNEL_B}" "org2:${CHANNEL_B}" "org1:${CHANNEL_SELF}" "org3:${CHANNEL_SELF}"; do
    org="${pair%%:*}"; channel="${pair##*:}"
    height="$(as "${org}" peer channel getinfo -c "${channel}" 2>&1 | grep -o '"height":[0-9]*' || echo 'n/a')"
    printf '%s on %s height %s\n' "${org}" "${channel}" "${height}"
  done
}

# Public connection material for the AgriTrace Worker/API on the host. Org3's
# private material is never exported; only its public TLS root certificate.
cmd_export() {
  local out="${1:-${REPO}/blockchain/.fabric/runtime}" org1
  org1="$(org_dir org1)"
  rm -rf "${out}"; mkdir -p "${out}/agritrace" "${out}/tls"
  for user in relayer controller; do
    mkdir -p "${out}/agritrace/${user}"
    cp -r "${org1}/users/${user}@org1.example.com/msp/signcerts" "${out}/agritrace/${user}/"
    cp -r "${org1}/users/${user}@org1.example.com/msp/keystore" "${out}/agritrace/${user}/"
  done
  mkdir -p "${out}/agritrace/admin"
  cp -r "${org1}/users/Admin@org1.example.com/msp/signcerts" "${out}/agritrace/admin/"
  cp -r "${org1}/users/Admin@org1.example.com/msp/keystore" "${out}/agritrace/admin/"
  for org in org1 org2 org3; do cp "$(peer_tls_ca "${org}")" "${out}/tls/${org}-peer-ca.crt"; done
  cp "${ORDERER_CA}" "${out}/tls/orderer-ca.crt"
  mkdir -p "${out}/org2-admin"
  cp -r "$(org_dir org2)/users/Admin@org2.example.com/msp/signcerts" "${out}/org2-admin/"
  cp -r "$(org_dir org2)/users/Admin@org2.example.com/msp/keystore" "${out}/org2-admin/"
  log "exported AgriTrace connection material to ${out}"
}

# Issues a fresh certificate for the AgriTrace technical relayer (same authority
# attributes, new key) to rehearse credential rotation. The suffix names the dir.
cmd_rotate_relayer() {
  local suffix="${1:-r2}"
  rm -rf "$(org_dir org1)/users/relayer-${suffix}@org1.example.com"
  enroll_user org1 relayer relayerpw "relayer-${suffix}@org1.example.com"
  log "issued relayer certificate relayer-${suffix}@org1.example.com"
}

# Starts stopped containers (after a WSL/Docker restart) in dependency order.
cmd_start() {
  docker start ca-orderer ca-org1 ca-org2 >/dev/null
  docker start orderer.example.com >/dev/null
  docker start peer0.org1.example.com peer0.org2.example.com >/dev/null
  docker start cc-org1 cc-org2 >/dev/null 2>&1 || true
  if [[ -z "${REMOTE_SELF_MSP}" ]]; then
    docker start ca-org3 peer0.org3.example.com >/dev/null
    docker start cc-org3 >/dev/null 2>&1 || true
  fi
  log "containers started"
}

# Consistent offline copy of every ledger volume plus AgriTrace's own crypto
# material. Org3's keys live in its own directory and are never in this archive;
# its owner backs them up separately. The archive holds CA keys: keep it private.
cmd_backup() {
  [[ -z "${REMOTE_SELF_MSP}" ]] || { echo 'Split-host backups require separate platform and enterprise recovery procedures' >&2; return 2; }
  local out="${1:?usage: backup <dir>}" volume
  mkdir -p "${out}"; chmod 700 "${out}"
  log "stopping peers and the orderer for a consistent copy"
  docker stop peer0.org1.example.com peer0.org2.example.com peer0.org3.example.com orderer.example.com >/dev/null
  for volume in "${HYBRID_VOLUMES[@]}"; do
    docker run --rm -v "${volume}:/data:ro" -v "${out}:/backup" alpine tar czf "/backup/${volume}.tgz" -C /data .
  done
  # CA keys are root-owned by the CA containers, so the archive is made as root.
  docker run --rm -v "${NET}:/net:ro" -v "${out}:/backup" alpine sh -c \
    'tar czf /backup/agritrace-crypto.tgz -C /net organizations fabric-ca public channel-artifacts configtx && chmod 600 /backup/*.tgz'
  docker start orderer.example.com peer0.org1.example.com peer0.org2.example.com peer0.org3.example.com >/dev/null
  log "backup written to ${out}"
}

peer_height() { # org channel
  as "$1" peer channel getinfo -c "$2" 2>&1 | grep -o '"height":[0-9]*' | grep -o '[0-9]*' || echo 0
}

# Recreates one peer from a backup (a relocation to a new host is the same
# steps with the same MSP/TLS material): it starts at the backup height and
# must catch up from the ordering service before it is trusted again.
cmd_restore_peer() {
  [[ -z "${REMOTE_SELF_MSP}" ]] || { echo 'Use the reviewed split-host recovery procedure' >&2; return 2; }
  local org="${1:?usage: restore-peer <org1|org2|org3> <backup-dir>}" from="${2:?backup dir}" volume
  volume="peer0.${org}.example.com"
  [[ -f "${from}/${volume}.tgz" ]] || { echo "No backup of ${volume} in ${from}" >&2; exit 1; }
  docker rm -f "${volume}" >/dev/null 2>&1 || true
  docker volume rm "${volume}" >/dev/null 2>&1 || true
  docker volume create "${volume}" >/dev/null
  docker run --rm -v "${volume}:/data" -v "${from}:/backup:ro" alpine tar xzf "/backup/${volume}.tgz" -C /data
  run_peer "${org}"
  local channel reference target
  for channel in "${CHANNEL_B}" "${CHANNEL_SELF}"; do
    reference="$(channel_peer_other "${channel}" "${org}")"
    [[ -n "${reference}" ]] || continue
    target="$(peer_height "${reference}" "${channel}")"
    for _ in $(seq 1 90); do
      [[ "$(peer_height "${org}" "${channel}")" -ge "${target}" ]] && break
      sleep 1
    done
    log "${org} on ${channel}: height $(peer_height "${org}" "${channel}") (reference ${target})"
    [[ "$(peer_height "${org}" "${channel}")" -ge "${target}" ]] || { echo "${org} did not catch up on ${channel}" >&2; exit 1; }
  done
}

# The other organization on a channel (empty when `org` is not a member).
channel_peer_other() { # channel org
  case "$1:$2" in
    "${CHANNEL_B}:org1") echo org2 ;;
    "${CHANNEL_B}:org2") echo org1 ;;
    "${CHANNEL_SELF}:org1") echo org3 ;;
    "${CHANNEL_SELF}:org3") echo org1 ;;
  esac
}

cmd_down() {
  docker rm -f cc-org1 cc-org2 cc-org3 >/dev/null 2>&1 || true
  docker rm -f "${HYBRID_CONTAINERS[@]}" >/dev/null 2>&1 || true
  docker volume rm "${HYBRID_VOLUMES[@]}" >/dev/null 2>&1 || true
  docker network rm agritrace_hybrid >/dev/null
  log "network stopped; volumes removed"
}

cmd_clean() {
  [[ -f "${ROOT}/.agritrace-instance" && "$(cat "${ROOT}/.agritrace-instance")" == "${INSTANCE}" ]] || { echo 'Unowned Fabric root' >&2; return 2; }
  cmd_down
  docker run --rm -v "${ROOT}:/w" alpine sh -c 'rm -rf /w/net /w/self /w/cc-build /w/cc-package'
  log "generated material removed"
}

case "${1:-}" in
  commit-remote) [[ -n "${REMOTE_SELF_MSP}" ]] || { echo 'Remote owner MSP not configured' >&2; exit 2; }; commit_cc "${CHANNEL_SELF}" "${POLICY_SELF}" org1 org3 ;;
  up) cmd_up ;;
  deploy) cmd_deploy ;;
  status) cmd_status ;;
  export) shift; cmd_export "$@" ;;
  rotate-relayer) shift; cmd_rotate_relayer "$@" ;;
  start) cmd_start ;;
  backup) shift; cmd_backup "$@" ;;
  restore-peer) shift; cmd_restore_peer "$@" ;;
  down) cmd_down ;;
  clean) cmd_clean ;;
  *) echo "Usage: $0 {up|deploy|start|status|export [dir]|rotate-relayer [suffix]|backup <dir>|restore-peer <org> <dir>|down|clean}" >&2; exit 2 ;;
esac
