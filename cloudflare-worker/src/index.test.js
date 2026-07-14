import { afterEach, describe, expect, it, vi } from "vitest";
import worker, { triggerGitHubAction } from "./index.js";

const env = {
  GITHUB_OWNER: "owner",
  GITHUB_REPO: "repo",
  GITHUB_WORKFLOW_FILE: "check.yml",
  GITHUB_REF: "main",
  GITHUB_TOKEN: "secret",
};

afterEach(() => vi.restoreAllMocks());

describe("scheduled worker", () => {
  it("does not expose a public fetch handler", () => {
    expect(worker.fetch).toBeUndefined();
  });

  it("dispatches the configured workflow without exposing the token", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    const result = await triggerGitHubAction(env, { cron: "7 * * * *" });

    expect(result).toEqual({ ok: true, status: 204 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/actions/workflows/check.yml/dispatches");
    expect(init.headers.Authorization).toBe("Bearer secret");
    expect(JSON.parse(init.body)).toEqual({ ref: "main" });
  });
});
