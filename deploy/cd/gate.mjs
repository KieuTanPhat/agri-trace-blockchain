import {appendFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

export const requiredWorkflows = ['application-ci.yml', 'blockchain-ci.yml', 'dependency-audit.yml'];

export function evaluate(runs, sha, mainSha) {
  if (mainSha !== sha) return {status: 'stale'};
  const selected = requiredWorkflows.map(file => runs.filter(run => run.head_sha === sha && run.head_branch === 'main' &&
    run.event === 'push' && run.path === `.github/workflows/${file}`).sort((a,b) => b.id - a.id)[0]);
  if (selected.some(run => run?.status === 'completed' && run.conclusion !== 'success')) return {status: 'failed'};
  if (selected.some(run => !run || run.status !== 'completed')) return {status: 'pending'};
  return {status: 'success', runs: selected.map(run => ({id: run.id, url: run.html_url, attempt: run.run_attempt}))};
}

export async function github(route) {
  const response = await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/${route}`, {
    headers: {Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28'},
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`GitHub gate API returned HTTP ${response.status}`);
  return response.json();
}

async function main() {
  const sha = process.env.GITHUB_SHA;
  if (!/^[a-f0-9]{40}$/.test(sha ?? '') || process.env.GITHUB_REF !== 'refs/heads/main') throw new Error('CD only accepts main commits');
  const deadline = Date.now() + 55 * 60_000;
  let previous;
  while (Date.now() < deadline) {
    const [branch, data] = await Promise.all([github('git/ref/heads/main'), github(`actions/runs?head_sha=${sha}&event=push&per_page=100`)]);
    const result = evaluate(data.workflow_runs, sha, branch.object.sha);
    if (result.status !== previous) console.log(JSON.stringify(result));
    previous = result.status;
    if (result.status === 'stale' || result.status === 'success') {
      appendFileSync(process.env.GITHUB_OUTPUT, `current=${result.status === 'success'}\n`);
      return;
    }
    if (result.status === 'failed') throw new Error('Required CI failed; deployment is blocked');
    await new Promise(resolve => setTimeout(resolve, 20000));
  }
  throw new Error('Required exact-SHA CI did not finish before the deployment gate deadline');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => {console.error(error.message);process.exitCode=1;});
