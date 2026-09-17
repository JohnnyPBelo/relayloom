import {readFileSync,writeFileSync,mkdirSync,appendFileSync,cpSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
const out='.cache/private-values-final/live';mkdirSync(out,{recursive:true});
const deployment=JSON.parse(readFileSync('.cache/public-web/deployment.json','utf8'));
if(deployment.status!=='DEPLOYMENT_REQUESTED')throw Error('Deploy verified assets first');
const base='https://johnnypbelo.github.io/relayloom',report={status:'RUNNING',started:new Date().toISOString(),sourceCommit:deployment.sourceCommit,deploymentCommit:deployment.deploymentCommit,checks:[],files:[],scope:'Published HTTPS static bytes and independent synthetic browser profiles on this Linux host. Not two physical devices.'};
const verifierFiles=['docs/evidence/private-values/verify-live.mjs','tests/browser/large-site-draft.spec.ts','tests/browser/app-host.ts','tests/site-pages-journey.ts','tests/browser/site-pages.spec.ts','tests/browser/mobile-navigation.spec.ts','tests/browser/onboarding-language.spec.ts','tests/browser/site-language.spec.ts','tests/browser/site-studio.spec.ts','tests/browser/launch.checks.ts','tests/browser/browser.config.ts','tests/browser/launch.config.ts','scripts/e2e.mjs','playwright.config.ts','apps/ios/Tests/Fixtures/synthetic-photo.png'];
const verifiers=()=>Object.fromEntries(verifierFiles.map(path=>[path,createHash('sha256').update(readFileSync(path)).digest('hex')]));
report.verifierSources=verifiers();
const save=()=>writeFileSync(out+'/report.json',JSON.stringify(report,null,2)+'\n');save();
try{
 const response=await fetch(base+'/release.json?revision='+deployment.deploymentCommit,{signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw Error('HTTP release '+response.status);
 const release=await response.json();if(release.sourceCommit!==deployment.sourceCommit)throw Error('Published source still differs');report.release=release;save();
 for(const [file,expected] of Object.entries(deployment.verifiedArtifacts)){
  if(file==='.nojekyll')continue; // Build marker, not a runtime HTTP asset.
  const r=await fetch(base+'/'+file+'?revision='+deployment.deploymentCommit,{signal:AbortSignal.timeout(15000)});
  if(!r.ok)throw Error(file+': HTTP '+r.status);
  const bytes=Buffer.from(await r.arrayBuffer()),sha256=createHash('sha256').update(bytes).digest('hex');
  const pass=sha256===expected.sha256&&bytes.length===expected.bytes;
  report.files.push({path:file,sha256,bytes:bytes.length,pass});save();
  if(!pass)throw Error('HTTP artifact mismatch: '+file);
 }
 for(const [name,args] of [
  ['studio',['scripts/e2e.mjs','--config','tests/browser/browser.config.ts','tests/browser/onboarding-language.spec.ts','tests/browser/site-language.spec.ts','tests/browser/site-studio.spec.ts','tests/browser/site-pages.spec.ts','tests/browser/mobile-navigation.spec.ts','tests/browser/large-site-draft.spec.ts']],
  ['two-processes',['scripts/e2e.mjs','--config','tests/browser/launch.config.ts']]
 ]){
  const log=out+'/'+name+'.log';writeFileSync(log,'');const at=Date.now();
  const child=spawn(process.execPath,args,{env:{...process.env,RELAYLOOM_LAUNCH_URL:base},stdio:['ignore','pipe','pipe']});
  report.current={name,args,pid:child.pid};save();
  for(const stream of [child.stdout,child.stderr])stream.on('data',bytes=>appendFileSync(log,bytes));
  const exitCode=await new Promise((done,fail)=>{child.on('error',fail);child.on('close',done)});
  report.checks.push({name,command:'node',args,env:{RELAYLOOM_LAUNCH_URL:base},exitCode,durationMs:Date.now()-at});delete report.current;save();
  if(exitCode!==0)throw Error('Failed '+name);
  if(name==='studio')cpSync('.cache/site-studio/ui-chromium',out+'/studio',{recursive:true});
 }
 if(JSON.stringify(verifiers())!==JSON.stringify(report.verifierSources))throw Error('Verifier sources changed during execution');
 report.status='PASS';
}catch(e){report.status='FAIL';report.error=e.message;process.exitCode=1}
finally{report.finished=new Date().toISOString();save();console.log(JSON.stringify({status:report.status,files:report.files.length,checks:report.checks,error:report.error},null,2))}
