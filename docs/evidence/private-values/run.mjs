import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, appendFileSync, cpSync, existsSync, statfsSync } from 'node:fs';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { webSources } from '../../../scripts/web-artifact.mjs';
const out=resolve('.cache/private-values-final');
const report={status:'RUNNING',started:new Date().toISOString(),head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sources:webSources(),checks:[],scope:'Sequential Linux browser and native UI regression for private value persistence; no physical device claim.'};
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
 for(const engine of ['chromium','firefox']) {
  await check('private-'+engine,['scripts/e2e.mjs','--config','tests/browser/matrix.config.ts','tests/browser/private-values.spec.ts','tests/browser/foundation.spec.ts','tests/browser/large-site-draft.spec.ts'],{RELAYLOOM_MATRIX_ENGINE:engine});
  cpSync('.cache/browser-matrix/'+engine+'/playwright.json',out+'/private-'+engine+'.json');
 }
 if(existsSync('.cache/public-web/gate')) cpSync('.cache/public-web/gate',out+'/previous-public-gate',{recursive:true});
 await check('public-web',['scripts/verify-public-web.mjs']);
 cpSync('.cache/public-web/gate',out+'/public-gate',{recursive:true});
 for(const backend of ['node','go']) await check('native-studio-'+backend,['scripts/e2e.mjs','tests/e2e/site-studio.spec.ts','tests/e2e/site-pages.spec.ts'],{RELAYLOOM_TEST_BACKEND:backend});
 if(!isDeepStrictEqual(report.sources,webSources())) throw Error('Sources changed during gate');
 report.status='PASS';
} catch(error) {report.status='FAIL';report.error=String(error);process.exitCode=1}
finally {report.finished=new Date().toISOString();save()}
