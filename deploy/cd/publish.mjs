import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {github} from './gate.mjs';

export function deploymentTarget(env) {
  const targets = {
    production: {branch:'main',origin:'https://agritrace.dev',prefix:'prod',project:'agritrace-prod',profile:'fabric'},
  };
  const target=targets[env.CD_ENVIRONMENT];
  assert.ok(target,'Unknown deployment environment');
  assert.equal(env.GITHUB_REF,`refs/heads/${target.branch}`,'Deployment branch mismatch');
  assert.equal(env.PUBLIC_ORIGIN,target.origin,'Deployment origin mismatch');
  const project=env.CD_PROJECT||target.project,profile=env.CD_PROFILE||target.profile;
  assert.equal(project,target.project,'Deployment project mismatch');
  assert.equal(profile,'fabric','Deployment profile mismatch');
  assert.match(env.GITHUB_SHA,/^[a-f0-9]{40}$/);
  return {...target,project,profile,environment:env.CD_ENVIRONMENT};
}

export function requireImage(metadata,labels) {
  for(const [key,value] of Object.entries(labels))assert.equal(metadata.Config.Labels?.[key],value,`Immutable image ${key} mismatch`);
  assert.ok(!['','root','0','0:0'].includes(metadata.Config.User),'Image must run without root');
}

async function main() {
  const target=deploymentTarget(process.env);
  const branch=await github(`git/ref/heads/${target.branch}`);
  assert.equal(branch.object.sha,process.env.GITHUB_SHA,'Candidate is no longer latest branch HEAD');
  const repository=process.env.GITHUB_REPOSITORY;
  assert.equal(repository.toLowerCase(),'kieutanphat/agri-trace-blockchain');
  const registry=`ghcr.io/${repository.toLowerCase()}`;
  const labels={'org.opencontainers.image.source':`https://github.com/${repository}`,
    'org.opencontainers.image.revision':process.env.GITHUB_SHA,'agritrace.public-origin':target.origin,
    'agritrace.environment':target.environment,'agritrace.branch':target.branch,'agritrace.format':'2'};
  execFileSync('docker',['login','ghcr.io','-u',process.env.GITHUB_ACTOR,'--password-stdin'],{input:process.env.GH_TOKEN,stdio:['pipe','pipe','pipe']});
  const images={};
  const chaincodeFingerprint=execFileSync('python3',['-c',
    "import sys; sys.path.insert(0,'deploy/cd'); from package import source_fingerprint; print(source_fingerprint(sys.argv[1]))",process.env.GITHUB_SHA],{encoding:'utf8'}).trim();
  for(const component of ['api','web','chaincode']) {
    const componentLabels=component==='chaincode'?{...labels,'agritrace.chaincode-fingerprint':chaincodeFingerprint}:labels;
    const tag=`${registry}/${component}:${target.prefix}-${process.env.GITHUB_SHA}`;
    let exists=true;
    try {execFileSync('docker',['manifest','inspect',tag],{stdio:'pipe'});}
    catch(error){
      if(!/manifest unknown|no such manifest|not found/i.test(String(error.stderr)))throw new Error('Registry lookup failed; refusing to overwrite an immutable tag');
      exists=false;
    }
    if(exists)execFileSync('docker',['pull',tag],{stdio:'inherit'});
    else {
      const args=['build',...Object.entries(componentLabels).flatMap(([k,v])=>['--label',`${k}=${v}`]),'-t',tag,'-f',
        component==='chaincode'?'blockchain/network/hybrid/ccaas/Dockerfile':`apps/${component}/Dockerfile`];
      if(component==='web')args.push('--build-arg',`NEXT_PUBLIC_API_BASE_URL=${target.origin}/api`,
        '--build-arg','NEXT_PUBLIC_API_SAME_ORIGIN=true','--build-arg',`NEXT_PUBLIC_TRACE_BASE_URL=${target.origin}/trace`,'--build-arg','NEXT_PUBLIC_MOCK_API=false');
      execFileSync('docker',[...args,component==='chaincode'?'blockchain/chaincode':'.'],{stdio:'inherit'});
    }
    requireImage(JSON.parse(execFileSync('docker',['inspect',tag],{encoding:'utf8'}))[0],componentLabels);
    if(!exists)execFileSync('docker',['push',tag],{stdio:'inherit'});
    const metadata=JSON.parse(execFileSync('docker',['inspect',tag],{encoding:'utf8'}))[0];
    images[component]=metadata.RepoDigests.find(value=>value.startsWith(`${registry}/${component}@sha256:`));
    assert.match(images[component]??'',/@sha256:[a-f0-9]{64}$/);
  }
  execFileSync('python3',['deploy/cd/package.py','--sha',process.env.GITHUB_SHA,'--api',images.api,'--web',images.web,
    '--repository',repository,'--origin',target.origin,'--dist','blockchain/chaincode/dist',
    '--environment',target.environment,'--project',target.project,'--profile',target.profile,'--chaincode-image',images.chaincode,
    '--output',path.join(process.env.RUNNER_TEMP,`${target.prefix}-release.tar.gz`)],{stdio:'inherit'});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{
  console.error('Immutable publication failed; check branch, target, registry access and image metadata');process.exitCode=1;
});
