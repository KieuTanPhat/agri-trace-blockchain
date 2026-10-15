// Demo installer: run on the enterprise Linux VPS. Only public/ is exchanged.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID, randomBytes } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { isIP } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
export const PEER_IMAGE =
  "hyperledger/fabric-peer@sha256:09ee75042de9983bfde31ca88a5bf033386351f10a990e4c48264ee50172dee0";
export const CA_IMAGE =
  "hyperledger/fabric-ca@sha256:a70b6ba64a08b4d856802fe1fa66af9f2e03a26a63ceaff0de7c852ca7178b72";
const hostname = /^[a-zA-Z0-9][a-zA-Z0-9.-]{0,252}$/;
const label = "agritrace.enterprise.owner";
export function validateSpec(spec) {
  assert.equal(spec.protocol, "agritrace-enterprise-peer/1");
  assert.match(spec.instance, /^agri-enterprise-[a-z0-9-]{3,40}$/);
  assert.match(spec.mspId, /^[A-Za-z][A-Za-z0-9]{0,99}$/);
  for (const key of [
    "domain",
    "publicHost",
    "peerServerName",
    "ordererServerName",
  ])
    assert.match(spec[key], hostname);
  assert.equal(spec.peerServerName, `peer0.${spec.domain}`);
  for (const key of ["channelId", "chaincodeName", "chaincodeVersion"])
    assert.match(spec[key], /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/);
  assert.match(spec.ordererEndpoint, /^[a-zA-Z0-9.-]+:[1-9][0-9]{0,4}$/);
  assert.ok(Number(spec.ordererEndpoint.split(":").at(-1)) <= 65535);
  assert.ok(
    Number.isInteger(spec.peerPort) &&
      spec.peerPort > 1024 &&
      spec.peerPort <= 65535,
  );
  assert.ok(["127.0.0.1", "0.0.0.0"].includes(spec.bindAddress ?? "127.0.0.1"));
  assert.ok(
    Number.isInteger(spec.chaincodeSequence) && spec.chaincodeSequence > 0,
  );
  assert.match(
    spec.chaincodeImage,
    /^(?:ghcr\.io\/kieutanphat\/agri-trace-blockchain\/chaincode@sha256:|sha256:)[a-f0-9]{64}$/,
  );
  assert.match(
    spec.endorsementPolicy,
    /^AND\('[A-Za-z][A-Za-z0-9]*\.peer','[A-Za-z][A-Za-z0-9]*\.peer'\)$/,
  );
  assert.ok(spec.endorsementPolicy.includes(`'${spec.mspId}.peer'`));
  assert.ok(
    spec.hosts === undefined ||
      (spec.hosts &&
        typeof spec.hosts === "object" &&
        !Array.isArray(spec.hosts)),
  );
  for (const [name, address] of Object.entries(spec.hosts ?? {})) {
    assert.match(name, hostname);
    assert.equal(typeof address, "string");
    assert.ok(isIP(address), "Aliases need reviewed VPN IPs");
  }
  return spec;
}
const run = (file, args, options = {}) =>
  execFileSync(file, args, { stdio: "inherit", timeout: 180000, ...options });
const json = (file, value) =>
  writeFileSync(file, JSON.stringify(value, null, 2), { mode: 0o600 });
const inspect = (kind, name) => {
  try {
    return JSON.parse(
      run("docker", [kind, "inspect", name], {
        stdio: "pipe",
        encoding: "utf8",
      }),
    )[0];
  } catch (error) {
    if (
      /No such (?:object|container|network|volume)|network .+ not found/i.test(
        String(error.stderr),
      )
    )
      return null;
    throw error;
  }
};
function ensureResource(kind, name, owner) {
  const existing = inspect(kind, name);
  if (existing)
    assert.equal(existing.Labels?.[label], owner, `Refusing foreign ${kind}`);
  else run("docker", [kind, "create", "--label", `${label}=${owner}`, name]);
}
function startContainer(name, image, args, owner, digest, command = []) {
  const existing = inspect("container", name);
  if (existing) {
    assert.equal(
      existing.Config.Labels?.[label],
      owner,
      "Refusing foreign container",
    );
    assert.equal(
      existing.Config.Labels?.["agritrace.enterprise.spec"],
      digest,
      "Installed spec differs",
    );
    if (!existing.State.Running) run("docker", ["start", name]);
    return;
  }
  run("docker", [
    "run",
    "-d",
    "--name",
    name,
    "--label",
    `${label}=${owner}`,
    "--label",
    `agritrace.enterprise.spec=${digest}`,
    "--restart",
    "unless-stopped",
    "--cpus",
    "1",
    ...args,
    image,
    ...command,
  ]);
}
async function enrollIdentities(spec, root, owner) {
  const ca = path.join(root, "ca"),
    name = `${spec.instance}-ca`,
    caname = "ca-enterprise";
  const passwords = Object.fromEntries(
    ["bootstrap", "peer0", "orgadmin"].map((key) => [
      key,
      randomBytes(24).toString("hex"),
    ]),
  );
  mkdirSync(ca, { mode: 0o700 });
  json(path.join(root, "ca-credentials.json"), passwords);
  try {
    startContainer(
      name,
      CA_IMAGE,
      [
        "--memory",
        "256m",
        "--memory-swap",
        "256m",
        "-p",
        "127.0.0.1::7054",
        "-e",
        "FABRIC_CA_HOME=/etc/hyperledger/fabric-ca-server",
        "-e",
        `FABRIC_CA_SERVER_CA_NAME=${caname}`,
        "-e",
        "FABRIC_CA_SERVER_TLS_ENABLED=true",
        "-e",
        "FABRIC_CA_SERVER_CSR_HOSTS=localhost,127.0.0.1",
        "-v",
        `${ca}:/etc/hyperledger/fabric-ca-server`,
      ],
      owner,
      "initial-ca",
      ["fabric-ca-server", "start", "-b", `admin:${passwords.bootstrap}`],
    );
  } catch {
    throw new Error("Local CA startup failed; inspect the owned CA container");
  }
  const port = run("docker", ["port", name, "7054/tcp"], {
    stdio: "pipe",
    encoding: "utf8",
  })
    .trim()
    .split(":")
    .at(-1);
  const tls = path.join(ca, "ca-cert.pem"),
    org = path.join(root, "crypto/peerOrganizations", spec.domain);
  const client = (args) => {
    try {
      return run(
        "fabric-ca-client",
        [...args, "--caname", caname, "--tls.certfiles", tls],
        { stdio: "pipe", env: { ...process.env, FABRIC_CA_CLIENT_HOME: org } },
      );
    } catch {
      throw new Error(
        "Local CA enrollment/registration failed; credentials remain in the private directory",
      );
    }
  };
  for (let i = 0; i < 60; i++) {
    try {
      if (!existsSync(tls)) throw new Error("not ready");
      client([
        "enroll",
        "-u",
        `https://admin:${passwords.bootstrap}@localhost:${port}`,
        "-M",
        `${org}/msp`,
      ]);
      break;
    } catch (error) {
      if (i === 59) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  const caFile = readdirSync(`${org}/msp/cacerts`);
  assert.equal(caFile.length, 1);
  const nodeOUs = {
    NodeOUs: {
      Enable: true,
      ...Object.fromEntries(
        ["Client", "Peer", "Admin", "Orderer"].map((role) => [
          `${role}OUIdentifier`,
          {
            Certificate: `cacerts/${caFile[0]}`,
            OrganizationalUnitIdentifier: role.toLowerCase(),
          },
        ]),
      ),
    },
  };
  json(`${org}/msp/config.yaml`, nodeOUs);
  for (const [id, type] of [
    ["peer0", "peer"],
    ["orgadmin", "admin"],
  ])
    client([
      "register",
      "--id.name",
      id,
      "--id.secret",
      passwords[id],
      "--id.type",
      type,
      ...(type === "admin" ? ["--id.attrs", "app.role=admin:ecert"] : []),
    ]);
  const peer = `${org}/peers/${spec.peerServerName}`,
    admin = `${org}/users/Admin@${spec.domain}/msp`;
  const hosts = [
    ...new Set([
      spec.peerServerName,
      spec.publicHost,
      "localhost",
      "127.0.0.1",
    ]),
  ].flatMap((host) => ["--csr.hosts", host]);
  client([
    "enroll",
    "-u",
    `https://peer0:${passwords.peer0}@localhost:${port}`,
    "-M",
    `${peer}/msp`,
    ...hosts,
  ]);
  client([
    "enroll",
    "-u",
    `https://peer0:${passwords.peer0}@localhost:${port}`,
    "-M",
    `${peer}/tls`,
    "--enrollment.profile",
    "tls",
    ...hosts,
  ]);
  client([
    "enroll",
    "-u",
    `https://orgadmin:${passwords.orgadmin}@localhost:${port}`,
    "-M",
    admin,
  ]);
  for (const dir of [`${peer}/msp`, admin])
    cpSync(`${org}/msp/config.yaml`, `${dir}/config.yaml`);
  for (const [dir, file] of [
    ["tlscacerts", "ca.crt"],
    ["signcerts", "server.crt"],
    ["keystore", "server.key"],
  ]) {
    const files = readdirSync(`${peer}/tls/${dir}`);
    assert.equal(files.length, 1);
    cpSync(`${peer}/tls/${dir}/${files[0]}`, `${peer}/tls/${file}`);
  }
  mkdirSync(`${org}/msp/tlscacerts`);
  cpSync(`${peer}/tls/ca.crt`, `${org}/msp/tlscacerts/ca.crt`);
}
async function main() {
  assert.equal(process.platform, "linux", "Run on the enterprise Linux VPS");
  process.umask(0o077);
  const [operation, specFile, rootArg] = process.argv.slice(2);
  assert.ok(
    ["init", "start", "join", "install", "approve"].includes(operation) &&
      specFile &&
      rootArg,
    "Usage: node peer.mjs <init|start|join|install|approve> spec.json <private-root>",
  );
  const spec = validateSpec(JSON.parse(readFileSync(specFile, "utf8"))),
    root = path.resolve(rootArg);
  assert.ok(
    root !== "/" && root.split("/").filter(Boolean).length >= 3,
    "Use a dedicated private directory",
  );
  if (operation === "init") {
    assert.ok(
      !existsSync(root),
      "Refusing to replace existing identity or data",
    );
    mkdirSync(root, { recursive: true, mode: 0o700 });
    mkdirSync(path.join(root, "public"), { mode: 0o700 });
    const owner = randomUUID();
    json(path.join(root, "installation.json"), { spec, owner });
    await enrollIdentities(spec, root, owner);
    const org = path.join(root, "crypto/peerOrganizations", spec.domain),
      pub = path.join(root, "public/msp");
    mkdirSync(pub);
    for (const name of ["cacerts", "tlscacerts", "config.yaml"])
      cpSync(path.join(org, "msp", name), path.join(pub, name), {
        recursive: true,
      });
    json(path.join(root, "public/connection.json"), {
      peerHost: spec.publicHost,
      peerPort: spec.peerPort,
      peerServerName: spec.peerServerName,
      mspId: spec.mspId,
      tlsCaPem: readFileSync(
        path.join(org, "peers", spec.peerServerName, "tls/ca.crt"),
        "utf8",
      ),
    });
    console.log(
      "Local CA/admin/peer identities created. Share only public/msp and public/connection.json.",
    );
    return;
  }
  const installation = JSON.parse(
    readFileSync(path.join(root, "installation.json"), "utf8"),
  );
  assert.deepEqual(
    spec,
    installation.spec,
    "Identity spec is immutable; prepare an operator migration for changes",
  );
  const owner = installation.owner,
    digest = createHash("sha256")
      .update(JSON.stringify(installation.spec))
      .digest("hex");
  const network = `${spec.instance}-net`,
    volume = `${spec.instance}-data`,
    peer = `${spec.instance}-peer`;
  if (operation === "start") {
    ensureResource("network", network, owner);
    ensureResource("volume", volume, owner);
    const org = path.join(root, "crypto/peerOrganizations", spec.domain);
    const env = {
      CORE_PEER_ID: spec.peerServerName,
      CORE_PEER_ADDRESS: `${spec.peerServerName}:${spec.peerPort}`,
      CORE_PEER_LISTENADDRESS: `0.0.0.0:${spec.peerPort}`,
      CORE_PEER_GOSSIP_EXTERNALENDPOINT: `${spec.publicHost}:${spec.peerPort}`,
      CORE_PEER_GOSSIP_BOOTSTRAP: `${spec.peerServerName}:${spec.peerPort}`,
      CORE_PEER_LOCALMSPID: spec.mspId,
      CORE_PEER_MSPCONFIGPATH: "/etc/hyperledger/msp",
      CORE_PEER_TLS_ENABLED: "true",
      CORE_PEER_TLS_CERT_FILE: "/etc/hyperledger/tls/server.crt",
      CORE_PEER_TLS_KEY_FILE: "/etc/hyperledger/tls/server.key",
      CORE_PEER_TLS_ROOTCERT_FILE: "/etc/hyperledger/tls/ca.crt",
      CHAINCODE_AS_A_SERVICE_BUILDER_CONFIG: JSON.stringify({
        peername: spec.instance,
      }),
      FABRIC_LOGGING_SPEC: "INFO",
    };
    const mounts = [
      `${org}/peers/${spec.peerServerName}/msp:/etc/hyperledger/msp:ro`,
      `${org}/peers/${spec.peerServerName}/tls:/etc/hyperledger/tls:ro`,
      `${org}/users/Admin@${spec.domain}/msp:/admin:ro`,
      `${root}/public:/onboarding:ro`,
      `${volume}:/var/hyperledger/production`,
    ];
    startContainer(
      peer,
      PEER_IMAGE,
      [
        "--network",
        network,
        "--network-alias",
        spec.peerServerName,
        "--hostname",
        spec.peerServerName,
        "--memory",
        "512m",
        "--memory-swap",
        "512m",
        "-p",
        `${spec.bindAddress ?? "127.0.0.1"}:${spec.peerPort}:${spec.peerPort}`,
        ...Object.entries(env).flatMap(([k, v]) => ["-e", `${k}=${v}`]),
        ...Object.entries(spec.hosts ?? {}).flatMap(([k, v]) => [
          "--add-host",
          `${k}:${v}`,
        ]),
        ...mounts.flatMap((v) => ["-v", v]),
      ],
      owner,
      digest,
      ["peer", "node", "start"],
    );
    return;
  }
  assert.equal(
    inspect("container", peer)?.Config.Labels?.[label],
    owner,
    "Start the owned peer first",
  );
  const cli = (args, options = {}) =>
    run(
      "docker",
      [
        "exec",
        "-e",
        `CORE_PEER_LOCALMSPID=${spec.mspId}`,
        "-e",
        "CORE_PEER_MSPCONFIGPATH=/admin",
        "-e",
        `CORE_PEER_ADDRESS=localhost:${spec.peerPort}`,
        "-e",
        `CORE_PEER_TLS_SERVERHOSTOVERRIDE=${spec.peerServerName}`,
        peer,
        "peer",
        ...args,
      ],
      options,
    );
  if (operation === "join") {
    assert.ok(
      existsSync(path.join(root, "public/channel.block")),
      "Operator must provide the reviewed channel block",
    );
    const digest = createHash("sha256")
      .update(readFileSync(path.join(root, "public/channel.block")))
      .digest("hex");
    const receipt = path.join(root, "channel-block.json");
    if (existsSync(receipt))
      assert.equal(
        JSON.parse(readFileSync(receipt, "utf8")).digest,
        digest,
        "Refusing a different channel genesis block",
      );
    json(receipt, { digest });
    let joined = false;
    try {
      cli(["channel", "getinfo", "-c", spec.channelId], { stdio: "pipe" });
      joined = true;
    } catch {
      /* Same reviewed block may be retried after a lost join response. */
    }
    if (!joined) cli(["channel", "join", "-b", "/onboarding/channel.block"]);
    return;
  }
  if (operation === "install") {
    const pkg = path.join(root, "public/chaincode.tgz");
    assert.ok(
      existsSync(pkg),
      "Operator must provide the reviewed CaaS package",
    );
    const packageId = cli(
      ["lifecycle", "chaincode", "calculatepackageid", '/onboarding/chaincode.tgz'],
      { stdio: "pipe", encoding: "utf8" },
    ).trim();
    assert.match(packageId, /^[A-Za-z0-9._-]+:[a-f0-9]{64}$/);
    const old = path.join(root, "package-id.json");
    if (existsSync(old))
      assert.equal(
        JSON.parse(readFileSync(old, "utf8")).packageId,
        packageId,
        "Refusing a different chaincode package",
      );
    const installed =
      JSON.parse(
        cli(["lifecycle", "chaincode", "queryinstalled", "--output", "json"], {
          stdio: "pipe",
          encoding: "utf8",
        }),
      ).installed_chaincodes ?? [];
    if (!installed.some((item) => item.package_id === packageId))
      cli(["lifecycle", "chaincode", "install", "/onboarding/chaincode.tgz"]);
    startContainer(
      `${spec.instance}-cc`,
      spec.chaincodeImage,
      [
        "--network",
        network,
        "--network-alias",
        "cc-org3",
        "--memory",
        "256m",
        "--memory-swap",
        "256m",
        "-e",
        `CHAINCODE_ID=${packageId}`,
        "-e",
        "CHAINCODE_SERVER_ADDRESS=0.0.0.0:9999",
      ],
      owner,
      digest,
    );
    json(old, { packageId });
    return;
  }
  const { packageId } = JSON.parse(
    readFileSync(path.join(root, "package-id.json"), "utf8"),
  );
  assert.ok(
    existsSync(path.join(root, "public/orderer-ca.crt")),
    "Operator must provide the orderer public TLS root",
  );
  cli([
    "lifecycle",
    "chaincode",
    "approveformyorg",
    "-o",
    spec.ordererEndpoint,
    "--ordererTLSHostnameOverride",
    spec.ordererServerName,
    "--tls",
    "--cafile",
    "/onboarding/orderer-ca.crt",
    "--channelID",
    spec.channelId,
    "--name",
    spec.chaincodeName,
    "--version",
    spec.chaincodeVersion,
    "--sequence",
    String(spec.chaincodeSequence),
    "--package-id",
    packageId,
    "--signature-policy",
    spec.endorsementPolicy,
  ]);
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
