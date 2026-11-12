import { describe, expect, it } from "vitest";

const { parseWorkerDeployment, parsePagesDeployment, behindCount } =
  require("../../scripts/deploy-status.cjs") as {
    parseWorkerDeployment: (l: unknown[]) => {
      commit: string | null;
      dirty?: boolean;
      at: string | null;
    };
    parsePagesDeployment: (l: unknown[]) => {
      commit: string | null;
      at: string | null;
    };
    behindCount: (s: string) => number;
  };

describe("deploy:status parsing", () => {
  it("reads the commit from the newest Worker deployment message", () => {
    const list = [
      { created_on: "2026-11-08T00:00:00Z", annotations: {} },
      {
        created_on: "2026-11-10T00:00:00Z",
        annotations: { "workers/message": "0a994d66a39c docs: x" },
      },
    ];
    expect(parseWorkerDeployment(list)).toEqual({
      commit: "0a994d66a39c",
      dirty: false,
      at: "2026-11-10T00:00:00Z",
    });
  });

  it("flags a dirty deploy and an unknown commit", () => {
    const dirty = [
      {
        created_on: "t",
        annotations: { "workers/message": "abc1234-dirty fix" },
      },
    ];
    expect(parseWorkerDeployment(dirty).dirty).toBe(true);
    expect(
      parseWorkerDeployment([{ created_on: "t", annotations: {} }]).commit,
    ).toBeNull();
    expect(parseWorkerDeployment([]).commit).toBeNull();
  });

  it("takes the first production Pages deployment", () => {
    const list = [
      { Environment: "Preview", Source: "1111111", Status: "1 min ago" },
      { Environment: "Production", Source: "4862214", Status: "1 hour ago" },
    ];
    expect(parsePagesDeployment(list)).toEqual({
      commit: "4862214",
      at: "1 hour ago",
    });
    expect(
      parsePagesDeployment([{ Environment: "Production", Source: "-" }]).commit,
    ).toBeNull();
  });

  it("counts commits behind", () => {
    expect(behindCount("")).toBe(0);
    expect(behindCount("abc one\ndef two\n")).toBe(2);
  });
});
