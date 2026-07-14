export default {
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(triggerGitHubAction(env, controller));
  },
};

export async function triggerGitHubAction(env, controller) {
  const owner = env.GITHUB_OWNER;
  const repo = env.GITHUB_REPO;
  const workflowFile = env.GITHUB_WORKFLOW_FILE;
  const ref = env.GITHUB_REF || "main";

  const endpoint =
    `https://api.github.com/repos/${owner}/${repo}` +
    `/actions/workflows/${workflowFile}/dispatches`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Accept": "application/vnd.github+json",
      "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
      "X-GitHub-Api-Version": "2026-03-10",
      "User-Agent": "jc-lightchecker-cloudflare-worker",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ref,
    }),
  });

  if (!response.ok) {
    console.error("GitHub workflow_dispatch failed", {
      status: response.status,
      cron: controller.cron,
    });

    return {
      ok: false,
      status: response.status,
    };
  }

  console.log("GitHub workflow_dispatch succeeded", {
    status: response.status,
    cron: controller.cron,
  });

  return {
    ok: true,
    status: response.status,
  };
}
