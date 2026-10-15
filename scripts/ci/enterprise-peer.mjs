import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BindingLedgerClient,
  RegistryOperator,
  certificateFingerprint,
  connectGateway,
} from "../../blockchain/gateway/dist/index.js";
import { bindingDigest as digestBinding } from "../../blockchain/chaincode/dist/binding.js";
import { PEER_IMAGE } from "../../blockchain/network/enterprise/peer.mjs";
assert.equal(
  process.platform,
  "linux",
  "Run the isolated enterprise peer harness on Linux",
);
const repo = fileURLToPath(new URL("../../", import.meta.url));
assert.equal(
  execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], {
    cwd: repo,
    encoding: "utf8",
  }).trim(),
  "",
  "Commit source before collecting acceptance evidence",
);
const sha = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repo,
    encoding: "utf8",
  }).trim(),
  suffix = randomBytes(5).toString("hex");
const instance = `agri-split-${suffix}`,
  enterprise = `agri-enterprise-split-${suffix}`;
const root = path.join(repo, "blockchain/.fabric", instance),
  ownerRoot = path.join(repo, "blockchain/.fabric", enterprise),
  out = path.join(repo, "artifacts/enterprise-onboarding");
mkdirSync(out, { recursive: true, mode: 0o700 });
writeFileSync(
  path.join(out, "receipt.json"),
  JSON.stringify({ sha, passed: false, cleanup: false, stage: "preflight" }),
  { mode: 0o600 },
);
// Run after hybrid-fabric.mjs: that harness builds this exact candidate image.
const version = `ci-${sha.slice(0, 12)}`,
  image = execFileSync(
    "docker",
    ["image", "inspect", `agritrace-cc:${version}`, "--format", "{{.Id}}"],
    { encoding: "utf8" },
  ).trim();
const bridge = execFileSync(
  "docker",
  [
    "network",
    "inspect",
    "bridge",
    "--format",
    "{{(index .IPAM.Config 0).Gateway}}",
  ],
  { encoding: "utf8" },
).trim();
assert.ok(net.isIP(bridge));
mkdirSync(root, { recursive: true, mode: 0o700 });
mkdirSync(out, { recursive: true, mode: 0o700 });
const specFile = path.join(out, `${enterprise}.json`),
  reviewFile = path.join(out, `${enterprise}-review.json`);
const spec = {
  protocol: "agritrace-enterprise-peer/1",
  instance: enterprise,
  domain: "org3.example.com",
  mspId: "Org3MSP",
  publicHost: bridge,
  peerServerName: "peer0.org3.example.com",
  peerPort: 11051,
  bindAddress: "127.0.0.1",
  channelId: "hybrid-self",
  chaincodeName: "agritrace",
  chaincodeVersion: version,
  chaincodeSequence: 1,
  chaincodeImage: image,
  endorsementPolicy: "AND('Org1MSP.peer','Org3MSP.peer')",
  ordererEndpoint: `${bridge}:7050`,
  ordererServerName: "orderer.example.com",
  hosts: { "orderer.example.com": bridge, "peer0.org1.example.com": bridge },
};
writeFileSync(specFile, JSON.stringify(spec), { mode: 0o600 });
const tools =
  process.env.HYBRID_FABRIC_BIN_DIR ??
  path.join(repo, "blockchain/.fabric/fabric-samples");
cpSync(path.join(tools, "bin"), path.join(root, "fabric-samples/bin"), {
  recursive: true,
});
cpSync(path.join(tools, "config"), path.join(root, "fabric-samples/config"), {
  recursive: true,
});
const env = {
  ...process.env,
  PATH: `${tools}/bin:${process.env.PATH}`,
  AGRI_FABRIC_ROOT: root,
  AGRI_FABRIC_INSTANCE: instance,
  AGRI_FABRIC_PORT_OFFSET: "0",
  AGRI_FABRIC_BIND_ADDRESS: "127.0.0.1",
  AGRI_FABRIC_MEMORY: "512m",
  AGRI_FABRIC_CPUS: "1",
  CC_VERSION: version,
  CC_SEQUENCE: "1",
  AGRI_SELF_PUBLIC_MSP: path.join(ownerRoot, "public/msp"),
  AGRI_SELF_PEER_ENDPOINT: `${bridge}:11051`,
};
let stage = "init",
  started = false,
  owner;
const connections = [],
  servers = [],
  sockets = new Set();
const receipt = {
  sha,
  suite: "enterprise-peer",
  instance,
  enterprise,
  topology: "two Docker networks on one Linux host; not two VPS",
  passed: false,
};
const run = (file, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd: repo,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      ...options,
    });
    let output = "";
    for (const stream of [child.stdout, child.stderr])
      stream.on("data", (d) => {
        output += d.toString();
      });
    const timeout = setTimeout(() => child.kill("SIGTERM"), 240000);
    child.on("error", () => {
      clearTimeout(timeout);
      reject(new Error(`${stage}: command could not start`));
    });
    child.on("exit", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve(output);
      else {
        writeFileSync(path.join(out, "split-smoke-private.log"), output, {
          mode: 0o600,
        });
        reject(new Error(`${stage}: command exited ${code}`));
      }
    });
  });
const installer = (operation) =>
  run(process.execPath, [
    "blockchain/network/enterprise/peer.mjs",
    operation,
    specFile,
    ownerRoot,
  ]);
const network = (operation) =>
  run("bash", ["blockchain/network/hybrid/hybrid-network.sh", operation]);
async function client(org, user, location, endpoint, peerOrg = org) {
  const base = path.join(
    location,
    org === "org1"
      ? "net/organizations/peerOrganizations/org1.example.com"
      : "crypto/peerOrganizations/org3.example.com",
  );
  const msp = path.join(base, "users", `${user}@${org}.example.com`, "msp");
  const cert = path.join(
    msp,
    "signcerts",
    readdirSync(path.join(msp, "signcerts"))[0],
  );
  const connection = await connectGateway({
    channelName: "hybrid-self",
    chaincodeName: "agritrace",
    contractName: "AgriTraceContract",
    mspId: org === "org1" ? "Org1MSP" : "Org3MSP",
    peerEndpoint: endpoint,
    peerHostAlias: `peer0.${peerOrg}.example.com`,
    tlsCertPath:
      peerOrg === "org3"
        ? path.join(ownerRoot, "public/msp/tlscacerts/ca.crt")
        : path.join(base, "peers", `peer0.${org}.example.com`, "tls/ca.crt"),
    identityCertPath: cert,
    identityKeyDirectory: path.join(msp, "keystore"),
  });
  connections.push(connection);
  return {
    client: new BindingLedgerClient(connection.gateway, {
      channelName: "hybrid-self",
      chaincodeName: "agritrace",
      contractName: "AgriTraceContract",
    }),
    fingerprint: certificateFingerprint(readFileSync(cert)),
  };
}
try {
  await installer("init");
  owner = JSON.parse(
    readFileSync(path.join(ownerRoot, "installation.json")),
  ).owner;
  // Bridge-bound relay ports simulate routing between hosts without exposing
  // any peer/orderer outside the local Docker host interface.
  for (const port of [7050, 7051, 11051]) {
    const server = net.createServer((socket) => {
      const target = net.connect({ host: "127.0.0.1", port });
      for (const s of [socket, target]) {
        sockets.add(s);
        s.on("close", () => sockets.delete(s));
        s.on("error", () => {
          socket.destroy();
          target.destroy();
        });
      }
      socket.pipe(target).pipe(socket);
    });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, bridge, resolve);
    });
    servers.push(server);
  }
  stage = "platform-up";
  started = true;
  await network("up");
  assert.equal(
    existsSync(
      path.join(root, "self/organizations/peerOrganizations/org3.example.com"),
    ),
    false,
    "Platform must never generate enterprise private identities",
  );
  stage = "platform-deploy";
  await network("deploy");
  assert.equal(
    (
      await run("docker", [
        "image",
        "inspect",
        `agritrace-cc:${version}`,
        "--format",
        "{{.Id}}",
      ])
    ).trim(),
    image,
  );
  for (const file of ["channel.block", "chaincode.tgz", "orderer-ca.crt"])
    cpSync(
      path.join(root, "remote-bundle", file),
      path.join(ownerRoot, "public", file),
    );
  stage = "enterprise-start";
  await installer("start");
  await new Promise((r) => setTimeout(r, 3000));
  for (const op of ["join", "install", "approve"]) {
    stage = `enterprise-${op}`;
    await installer(op);
    await installer(op);
  }
  stage = "platform-commit";
  await network("commit-remote");
  const controller = await client("org1", "controller", root, "localhost:7051"),
    admin = await client("org1", "Admin", root, "localhost:7051"),
    relayer = await client("org1", "relayer", root, "localhost:7051");
  const remote = await client(
    "org1",
    "relayer",
    root,
    "localhost:11051",
    "org3",
  );
  const operator = new RegistryOperator(controller.client, {
    Org1MSP: admin.client,
  });
  const health = await relayer.client.health(),
    governanceDigest = health.governanceDigest;
  const chainRef = randomUUID();
  const binding = {
    network: instance,
    channelId: "hybrid-self",
    chaincodeName: "agritrace",
    contractName: "AgriTraceContract",
    chainRef,
    envelopeVersion: "4.0.0",
    writerAuthority: "agritrace-relayer-b",
    writerMspId: "Org1MSP",
    writerRole: "relayer",
    governanceDigest,
  };
  const bindingDigest = digestBinding(binding);
  for (const [kind, payload] of [
    [
      "CHANNEL_BOOTSTRAP",
      { channelId: "hybrid-self", strictB: true, allowLegacyV3Writes: false },
    ],
    ["BINDING_REGISTER", { binding, bindingDigest }],
    [
      "CREDENTIAL_APPROVE",
      {
        bindingDigest,
        authority: binding.writerAuthority,
        certFingerprint: relayer.fingerprint,
      },
    ],
  ]) {
    stage = `registry-${kind}`;
    const proposalId = await operator.propose(kind, payload, "0", randomUUID());
    await operator.approve(proposalId, "Org1MSP");
    const review = {
      channelId: "hybrid-self",
      chaincodeName: "agritrace",
      contractName: "AgriTraceContract",
      governanceDigest,
      proposal: await controller.client.getRegistryProposal(proposalId),
    };
    writeFileSync(reviewFile, JSON.stringify(review), { mode: 0o600 });
    const inspected = JSON.parse(
      await run(process.execPath, [
        "blockchain/network/enterprise/approve-registry.mjs",
        "inspect",
        specFile,
        ownerRoot,
        reviewFile,
      ]),
    );
    await run(process.execPath, [
      "blockchain/network/enterprise/approve-registry.mjs",
      "approve",
      specFile,
      ownerRoot,
      reviewFile,
      inspected.reviewedSha256,
    ]);
    await operator.execute(proposalId);
  }
  stage = "connection-proof";
  const challenge = randomUUID(),
    organizationRef = randomUUID();
  const endorsed = await relayer.client
    .prepare(
      "RecordConnectionProbe",
      [bindingDigest, challenge, organizationRef],
      { endorsingOrganizations: ["Org1MSP", "Org3MSP"] },
    )
    .endorse();
  const result = await endorsed.submit();
  assert.ok(result.successful);
  const a = await relayer.client.query(
      "GetConnectionProbe",
      bindingDigest,
      challenge,
    ),
    b = await remote.client.query(
      "GetConnectionProbe",
      bindingDigest,
      challenge,
    );
  assert.deepEqual(a, b);
  assert.equal(a.txId, result.transactionId);
  assert.equal(
    await relayer.client.transactionValidationCode(result.transactionId),
    0,
  );
  receipt.txId = result.transactionId;
  stage = "enterprise-restart-recovery";
  const identitySnapshot = (directory) => {
    const files = readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const file = path.join(directory, entry.name);
      return entry.isDirectory() ? identitySnapshot(file) : [[file, createHash("sha256").update(readFileSync(file)).digest("hex")]];
    });
    return files.sort(([a], [b]) => a.localeCompare(b));
  };
  // Compare in private memory only: never publish hashes of private-key files.
  const identities = JSON.stringify(identitySnapshot(path.join(ownerRoot, "crypto")));
  const installation = readFileSync(path.join(ownerRoot, "installation.json"), "utf8");
  const restartNames = [`${enterprise}-peer`, `${enterprise}-cc`];
  const beforeRestart = JSON.parse(await run("docker", ["inspect", ...restartNames]));
  for (const container of beforeRestart) {
    assert.equal(container.Config.Labels?.["agritrace.enterprise.owner"], owner);
    assert.equal(container.State.OOMKilled, false);
  }
  await run("docker", ["stop", ...restartNames]);
  await assert.rejects(() => relayer.client.prepare("RecordConnectionProbe",
    [bindingDigest, randomUUID(), organizationRef], { endorsingOrganizations: ["Org1MSP", "Org3MSP"] }).endorse(),
  "An offline owner peer must prevent endorsement before broadcast");
  await installer("start");
  await new Promise((resolve) => setTimeout(resolve, 3000));
  for (const operation of ["join", "install", "approve"]) await installer(operation);
  let recovered = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const proof = await remote.client.query("GetConnectionProbe", bindingDigest, challenge);
      assert.ok(JSON.stringify(proof) === JSON.stringify(a), "Restart must preserve the original ledger proof");
      recovered = true;
      break;
    } catch { await new Promise((resolve) => setTimeout(resolve, 500)); }
  }
  assert.ok(recovered, "The original owner ledger proof must be readable after restart");
  assert.ok(identities === JSON.stringify(identitySnapshot(path.join(ownerRoot, "crypto"))), "Restart must preserve identity files");
  assert.ok(installation === readFileSync(path.join(ownerRoot, "installation.json"), "utf8"), "Restart must preserve installation identity");
  const afterRestart = JSON.parse(await run("docker", ["inspect", ...restartNames]));
  assert.ok(beforeRestart.every((container, index) => container.Id === afterRestart[index].Id), "Restart must reuse owned containers and volumes");
  assert.equal(await remote.client.transactionValidationCode(result.transactionId), 0);
  receipt.restartRecovery = { peerAndChaincode: true, endorsementDeniedWhileOffline: true,
    identityPreserved: true, installationPreserved: true, originalProofPreserved: true,
    originalTxId: result.transactionId, validationCode: 0 };
  const ownedIds = (
    await run("docker", [
      "ps",
      "-q",
      "--filter",
      `label=agritrace.enterprise.owner=${owner}`,
    ])
  )
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  receipt.enterpriseResources = JSON.parse(
    await run("docker", ["inspect", ...ownedIds]),
  ).map((c) => ({
    name: c.Name,
    limitMiB: c.HostConfig.Memory / 1024 / 1024,
    cpus: c.HostConfig.NanoCpus / 1e9,
    oomKilled: c.State.OOMKilled,
    imageDigest: c.Image,
  }));
  receipt.enterpriseUsageSnapshot = (
    await run("docker", [
      "stats",
      "--no-stream",
      "--format",
      "{{json .}}",
      ...ownedIds,
    ])
  )
    .trim()
    .split("\n")
    .map((row) => {
      const r = JSON.parse(row);
      return { name: r.Name, memory: r.MemUsage, cpu: r.CPUPerc };
    });
  receipt.passed = true;
} catch (error) {
  receipt.failure = { stage, message: error.message };
  throw error;
} finally {
  for (const c of connections) c.close();
  for (const socket of sockets) socket.destroy();
  for (const s of servers) await new Promise((r) => s.close(r));
  if (started) {
    stage = "platform-cleanup";
    await network("down");
  }
  if (!owner) {
    try {
      owner = JSON.parse(
        readFileSync(path.join(ownerRoot, "installation.json")),
      ).owner;
    } catch {}
  }
  if (owner) {
    for (const kind of ["container", "volume", "network"]) {
      const args = kind === "container" ? ["ps", "-aq"] : [kind, "ls", "-q"];
      const ids = (
        await run("docker", [
          ...args,
          "--filter",
          `label=agritrace.enterprise.owner=${owner}`,
        ])
      )
        .trim()
        .split(/\s+/)
        .filter(Boolean);
      for (const id of ids) {
        const format =
          kind === "container"
            ? '{{index .Config.Labels "agritrace.enterprise.owner"}}'
            : '{{index .Labels "agritrace.enterprise.owner"}}';
        assert.equal(
          (
            await run("docker", [kind, "inspect", "--format", format, id])
          ).trim(),
          owner,
        );
        await run(
          "docker",
          kind === "container" ? ["rm", "-f", id] : [kind, "rm", id],
        );
      }
    }
  }
  if (receipt.passed) {
    for (const privateRoot of [root, ownerRoot]) {
      assert.equal(
        path.dirname(privateRoot),
        path.join(repo, "blockchain/.fabric"),
      );
      assert.ok([instance, enterprise].includes(path.basename(privateRoot)));
      await run("docker", [
        "run",
        "--rm",
        "--network",
        "none",
        "--user",
        "0",
        "--cpus",
        "0.5",
        "--memory",
        "128m",
        "--memory-swap",
        "128m",
        "--entrypoint",
        "sh",
        "-v",
        `${privateRoot}:/owned`,
        PEER_IMAGE,
        "-c",
        "rm -rf /owned/ca /owned/crypto /owned/net /owned/self",
      ]);
      rmSync(privateRoot, { recursive: true });
    }
    rmSync(specFile);
    rmSync(reviewFile);
  }
  receipt.cleanup = true;
  writeFileSync(
    path.join(out, "receipt.json"),
    JSON.stringify(receipt, null, 2),
    { mode: 0o600 },
  );
}
