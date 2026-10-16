import { describe, expect, it } from "vitest";
import { readyNetwork, u, DIGEST } from "./helpers/network";
describe("Enterprise connection probes", () => {
  it("records one immutable challenge with the approved relayer and exposes the same proof", async () => {
    const net = await readyNetwork();
    const org = u(71),
      challenge = u(72);
    const result = JSON.parse(
      await net.contract.RecordConnectionProbe(
        net.ctx("relayer"),
        DIGEST,
        challenge,
        org,
      ),
    );
    expect(result).toMatchObject({
      organizationRef: org,
      challenge,
      bindingDigest: DIGEST,
      writerMsp: "Org1MSP",
      ownerMsp: "Org2MSP",
      channelId: "hybrid-b",
    });
    expect(
      JSON.parse(
        await net.contract.GetConnectionProbe(
          net.ctx("relayer"),
          DIGEST,
          challenge,
        ),
      ),
    ).toEqual(result);
    await expect(
      net.contract.RecordConnectionProbe(
        net.ctx("relayer"),
        DIGEST,
        challenge,
        org,
      ),
    ).rejects.toThrow("DUPLICATE_EVENT");
    await expect(
      net.contract.RecordConnectionProbe(net.ctx("admin1"), DIGEST, u(73), org),
    ).rejects.toThrow("UNAUTHORIZED");
    await expect(
      net.contract.RecordConnectionProbe(
        net.ctx("relayer"),
        "ff".repeat(32),
        u(73),
        org,
      ),
    ).rejects.toThrow("BINDING_MISMATCH");
  });
});
