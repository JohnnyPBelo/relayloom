import { spawn, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, createWriteStream, existsSync, copyFileSync, statfsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
const root=process.cwd(),out=resolve('.cache/resource-relay-final');
if(existsSync(join(out,'report.json')))throw Error('Inspect the existing performance gate; never overwrite it');
mkdirSync(out,{recursive:true});
function sources(){const paths=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{encoding:'utf8'}).split('\0').filter(p=>/^(apps|packages|native|tests|scripts|adapters|\.github)\//.test(p)||/^(package.*\.json|.*config\.ts)$/.test(p));return Object.fromEntries([...new Set(paths)].sort().map(p=>[p,createHash('sha256').update(readFileSync(p)).digest('hex')]));}
const phases=[
 ['typecheck',['node_modules/typescript/bin/tsc','--noEmit']],
 ['contracts',['--import','tsx','--test','--test-concurrency=1','tests/site-contribution.test.ts','tests/site-contribution-interop.test.ts','tests/site-resource-inspection.test.ts','tests/site-resource-ui-controller.test.ts','tests/site-resource-document.test.ts','tests/site-resource.test.ts','tests/site-content.test.ts']],
 ['go-sites-race',['scripts/go.mjs','test','-race','-p=1','./sites','-count=1']],
 ['web-build',['node_modules/vite/bin/vite.js','build']],
 ...['webkit'].map(engine=>['browser-'+engine,['scripts/e2e.mjs','--config','tests/browser/matrix.config.ts','--output',join(out,engine+'-artifacts')],{RELAYLOOM_MATRIX_ENGINE:engine}]),
 ...['node','native'].map(backend=>['resource-ui-'+backend,['scripts/e2e.mjs','--config','playwright.config.ts','tests/e2e/site-resources.spec.ts','--output',join(out,backend+'-artifacts')],{RELAYLOOM_TEST_BACKEND:backend}]),
 ['desktop-build',['scripts/desktop-build.mjs']],
 ['desktop-run',['scripts/desktop-run.mjs','--smoke','--x11']],
 ['desktop-package',['scripts/desktop-package.mjs','--linux','--x64','--dir']],
 ['desktop-packaged-run',['scripts/desktop-packaged-smoke.mjs']],
];
const env={...process.env,RELAYLOOM_LAUNCH_URL:'',TMPDIR:resolve('.cache/tmp'),TMP:resolve('.cache/tmp'),TEMP:resolve('.cache/tmp'),XDG_CACHE_HOME:resolve('.cache/resource-performance-runtime'),PLAYWRIGHT_BROWSERS_PATH:resolve('.cache/playwright')};
const report={status:'RUNNING',started:new Date().toISOString(),base:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sources:sources(),scope:'Final WebKit regression, native resource UI and Linux packaging after the reproduced relay-pause race fix and clock alignment. Complete Chromium104 and Firefox104 passes before these two narrow changes remain in resource-performance-full/resumed; current directed routing/relay/contribution suites passed12 in each engine, recorded separately. No old report is relabelled as a current-source full run. Also checks the new standalone visitor-contribution contract; that contract has no application/API/inbox/approval/form UI integration yet. Previous unaffected Node/Go/transport gates are recorded separately. No updated deployment, physical-device/radio, Apple signing or independent review claim.',previousReports: ['.cache/resource-performance-full/report.json','.cache/resource-performance-resumed/report.json',...['chromium','firefox','webkit'].map(e=>'.cache/relay-clock-'+e+'-report.json')],checks:[]};
const save=()=>writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2)+'\n');save();
try{for(const [name,args,extra={}]of phases){
 const disk=statfsSync(root);if(disk.bavail*disk.bsize<15*1024**3)throw Error('15 GiB reserve required');
 if(JSON.stringify(sources())!==JSON.stringify(report.sources))throw Error('Source changed before '+name);
 const log=createWriteStream(join(out,name+'.log')),start=Date.now(),check={name,command:[process.execPath,...args],env:extra,status:'RUNNING',started:new Date().toISOString()};report.checks.push(check);save();console.log('START '+name);
 const code=await new Promise((done,reject)=>{const child=spawn(process.execPath,args,{cwd:root,env:{...env,...extra},stdio:['ignore','pipe','pipe']});check.pid=child.pid;save();child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});child.once('error',reject);child.once('exit',(code,signal)=>{check.signal=signal;log.end(()=>done(code));});});
 check.exitCode=code;check.elapsedMs=Date.now()-start;check.status=code===0?'PASS':'FAIL';save();console.log(check.status+' '+name);
 const result=name.startsWith('browser-')?'.cache/browser-matrix/'+name.slice(8)+'/playwright.json':name.startsWith('resource-ui-')?'test-results/e2e.json':null;
 if(result&&existsSync(result))copyFileSync(result,join(out,name+'.json'));
 if(code!==0)throw Error('Failed '+name+'; inspect original results');
 }
 report.sourcesAfter=sources();if(JSON.stringify(report.sourcesAfter)!==JSON.stringify(report.sources))throw Error('Final source mismatch');report.status='PASS';
}catch(error){report.status='FAIL';report.error=String(error);process.exitCode=1;}finally{report.finished=new Date().toISOString();save();}
