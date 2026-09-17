import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, appendFileSync, cpSync, existsSync, statfsSync } from 'node:fs';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { webSources } from '../../../scripts/web-artifact.mjs';
const out=resolve('.cache/private-values-final/supplement');
mkdirSync(out,{recursive:true});
const report={status:'RUNNING',started:new Date().toISOString(),head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sources:webSources(),checks:[],scope:'Remaining full browser API/routing/native-transport/curve/certificate coverage and rebuilt Linux desktop; no physical device claim.'};
const save=()=>writeFileSync(out+'/report.json',JSON.stringify(report,null,2)+'\n');
async function check(name,args,extra={}) {
 const disk=statfsSync('.'); if(disk.bavail*disk.bsize<15*1024**3) throw Error('15 GiB reserve required');
 const log=out+'/'+name+'.log'; writeFileSync(log,''); const started=Date.now();
 const env={...process.env,RELAYLOOM_LAUNCH_URL:'',TMPDIR:resolve('.cache/tmp'),XDG_CACHE_HOME:resolve('.cache/private-values-final/runtime'),PLAYWRIGHT_BROWSERS_PATH:resolve('.cache/playwright'),...extra};
 const child=spawn(process.execPath,args,{env,stdio:['ignore','pipe','pipe']});
 report.current={name,pid:child.pid,args}; save();
 for(const pipe of [child.stdout,child.stderr]) pipe.on('data',d=>appendFileSync(log,d));
 const exitCode=await new Promise((done,fail)=>{child.on('error',fail);child.on('exit',done)});
 report.checks.push({name,command:[process.execPath,...args],environment:extra,exitCode,durationMs:Date.now()-started}); delete report.current; save(); console.log(name+': '+exitCode);
 if(exitCode!==0) throw Error('Failed '+name);
}
save();
try {
 for(const engine of ['chromium','firefox','webkit']) {
  await check('remaining-browser-'+engine,['scripts/e2e.mjs','--config','tests/browser/matrix.config.ts',
   'tests/browser/application-api.spec.ts','tests/browser/routing.spec.ts','tests/browser/native-transport.spec.ts',
   'tests/browser/group-certificates.spec.ts','tests/browser/site-revisions.spec.ts','tests/browser/x25519.spec.ts'],{RELAYLOOM_MATRIX_ENGINE:engine});
  cpSync('.cache/browser-matrix/'+engine+'/playwright.json',out+'/browser-'+engine+'.json');
 }
 for(const [name,args] of [
  ['desktop-build',['scripts/desktop-build.mjs']],
  ['desktop-run',['scripts/desktop-run.mjs','--smoke','--x11']],
  ['desktop-package',['scripts/desktop-package.mjs','--dir']],
  ['desktop-packaged-run',['scripts/desktop-packaged-smoke.mjs']],
 ]) await check(name,args);
 if(!isDeepStrictEqual(report.sources,webSources())) throw Error('Sources changed during gate');
 report.status='PASS';
} catch(error) {report.status='FAIL';report.error=String(error);process.exitCode=1}
finally {report.finished=new Date().toISOString();save()}
