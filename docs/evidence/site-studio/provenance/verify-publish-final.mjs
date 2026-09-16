// Resume the UI gates after a strictly checked CSS/test-only correction.
// The complete clean-run command remains scripts/verify-site-studio.mjs.
import {spawn,execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,appendFileSync,statfsSync,cpSync,readdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
const root=resolve('.'),out=resolve('.cache/site-studio/publish-final');mkdirSync(out,{recursive:true});
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
function sources(){
 const files=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{encoding:'utf8'}).split('\0').filter(p=>/^(apps\/|packages\/|tests\/|native\/|scripts\/|docs\/licenses\/)|^(package.*\.json|.*config\.ts)$/.test(p));
 return Object.fromEntries([...new Set(files)].sort().map(p=>[p,digest(readFileSync(p))]));
}
const baselinePath='.cache/site-studio/domain-final/report.json',baseline=JSON.parse(readFileSync(baselinePath,'utf8')),current=sources();
const changed=[...new Set([...Object.keys(current),...Object.keys(baseline.sources)])].filter(p=>current[p]!==baseline.sources[p]);
const permitted=new Set(['apps/web/src/site/studio.css','apps/web/src/liquid-glass.css','tests/browser/site-studio.spec.ts','tests/e2e/flows.spec.ts','apps/web/src/browser/peers.tsx']);
if(changed.some(p=>!permitted.has(p)))throw Error('This resume permits only the reviewed stylesheet and browser test changes: '+changed.join(', '));
const domains=['node-all','native-race','native-cgo-storage','interop-all'];
const inherited=domains.map(name=>{const c=baseline.checks.find(c=>c.name===name);if(!c||c.exitCode!==0)throw Error('Missing passed domain gate '+name);return c});
const report={status:'RUNNING',started:new Date().toISOString(),sources:current,baseline:{path:baselinePath,sha256:digest(readFileSync(baselinePath)),status:baseline.status,inherited,onlyChangedSources:changed},selfSha256:digest(readFileSync(import.meta.filename)),checks:[],scope:'Final UI follow-up after recorded layout corrections, status locator ambiguity and inconsistent RTC diagnostic feedback. Explicit default build precedes all browser tests; its asset hashes are checked during that matrix. Domain gates inherited only after exact source-hash comparison. Not physical devices or independent review.'};
const save=()=>writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2)+'\n');save();
function webFiles(){const result={};function visit(dir){for(const e of readdirSync(join('dist/web',dir),{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const p=dir?dir+'/'+e.name:e.name;if(e.isDirectory())visit(p);else if(e.isFile())result[p]=digest(readFileSync(join('dist/web',p)));else throw Error('Unexpected web artifact')}}visit('');return result;}
const checks=[
 ['typecheck',['node_modules/typescript/bin/tsc','--noEmit']],
 ['explicit-web-build',['node_modules/vite/bin/vite.js','build']],
 ...['chromium','firefox','webkit'].map(engine=>['browser-'+engine,['scripts/e2e.mjs','--config','tests/browser/matrix.config.ts'],{RELAYLOOM_MATRIX_ENGINE:engine}]),
 ['shared-ui-and-desktop',['scripts/verify-ui.mjs']],
 ['public-web',['scripts/verify-public-web.mjs']],
 ...['chromium','firefox','webkit'].map(engine=>['rns-ui-'+engine,['scripts/e2e.mjs','--config','tests/reticulum/ui.config.ts','--browser',engine]])
];
try{
 for(const [name,args,env={}] of checks){
  const disk=statfsSync(root);if(disk.bavail*disk.bsize<15*1024**3)throw Error('15 GiB reserve required');
  if(JSON.stringify(sources())!==JSON.stringify(current))throw Error('Sources changed during final UI gate');
  if(name.startsWith('browser-') && JSON.stringify(webFiles())!==JSON.stringify(report.browserAssets))throw Error('Browser assets changed after explicit build');
  const file=join(out,name+'.log');writeFileSync(file,'');const at=Date.now();
  const child=spawn(process.execPath,args,{cwd:root,env:{...process.env,RELAYLOOM_LAUNCH_URL:'',...env},stdio:['ignore','pipe','pipe']});
  report.current={name,args,pid:child.pid,started:new Date().toISOString()};save();
  for(const pipe of [child.stdout,child.stderr])pipe.on('data',data=>appendFileSync(file,data));
  const exitCode=await new Promise((done,fail)=>{child.on('error',fail);child.on('close',done)});
  report.checks.push({name,command:process.execPath,args,env,exitCode,durationMs:Date.now()-at});delete report.current;save();console.log(name+': '+exitCode);
  if(name==='explicit-web-build'){report.browserAssets=webFiles();save();}
  if(name.startsWith('browser-') && JSON.stringify(webFiles())!==JSON.stringify(report.browserAssets))throw Error('Browser assets changed during tests');
  if(name.startsWith('browser-'))cpSync('.cache/site-studio/ui-'+name.slice(8),join(out,name),{recursive:true});
  if(exitCode!==0)throw Error('Failed check: '+name);
 }
 report.sourcesUnchanged=JSON.stringify(sources())===JSON.stringify(current);
 if(!report.sourcesUnchanged)throw Error('Sources changed during final UI gate');report.status='PASS';
}catch(error){report.status='FAIL';report.error=error.message;process.exitCode=1}
finally{report.finished=new Date().toISOString();save()}
