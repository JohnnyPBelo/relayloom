import {spawn,execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,existsSync,createWriteStream,copyFileSync,statfsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
const out=resolve('.cache/contribution-submission-reviewed');
if(existsSync(join(out,'report.json')))throw Error('Preserve previous gate');
mkdirSync(out,{recursive:true});
function sources(){const paths=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{encoding:'utf8'}).split('\0').filter(p=>/^(apps|packages|native|tests|scripts|adapters|\.github)\//.test(p)||/^(package.*\.json|.*config\.ts|tsconfig.json)$/.test(p));return Object.fromEntries([...new Set(paths)].sort().map(p=>[p,createHash('sha256').update(readFileSync(p)).digest('hex')]));}
const report={status:'RUNNING',base:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),started:new Date().toISOString(),scope:'Private contribution queue, API and real transport integration. Full Node and native race regression; contribution/mixed native processes; affected production browser worker/UI, storage, resource and relay regression in three engines. Candidate inbox is not durable review/approval. No hardware/radio/public-deployment claim.',sources:sources(),checks:[]};
const prior=JSON.parse(readFileSync('.cache/contribution-submission-final-1/report.json','utf8'));
const changed=Object.keys({...prior.sources,...report.sources}).filter(k=>prior.sources[k]!==report.sources[k]).sort();
const expected=['packages/browser/src/contribution-runtime.ts','tests/browser/harness.ts','tests/browser/site-contribution-serve-race.spec.ts'].sort();
if(JSON.stringify(changed)!==JSON.stringify(expected))throw Error('Unexpected source delta: '+changed);
report.priorGate='.cache/contribution-submission-final-1/report.json';
report.changedSincePrior=changed;
report.scope='Post-review fix for cancellation/expiry during an in-flight proposal authorization. Only browser runtime and two test sources changed; prior Node/Go and unaffected regressions retain their exact source attribution. No UI form approval or deployment claim.';
const browsers=['site-contribution-catalog','site-contribution-copy','site-contribution-send','site-contribution-worker','site-contribution-serve-race'].map(n=>'tests/browser/'+n+'.spec.ts');
const phases=[['typecheck',['node_modules/typescript/bin/tsc','--noEmit'],{}],['web-build',['node_modules/vite/bin/vite.js','build'],{}],...['chromium','firefox','webkit'].map(engine=>['browser-'+engine,['scripts/e2e.mjs','--config','tests/browser/matrix.config.ts',...browsers,'--output',join(out,engine+'-artifacts')],{RELAYLOOM_MATRIX_ENGINE:engine}])];
const env={...process.env,TMPDIR:resolve('.cache/tmp'),TMP:resolve('.cache/tmp'),TEMP:resolve('.cache/tmp'),PLAYWRIGHT_BROWSERS_PATH:resolve('.cache/playwright')};
const save=()=>writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2)+'\n');save();
try{for(const [name,args,extra]of phases){const disk=statfsSync('.');if(disk.bavail*disk.bsize<15*1024**3)throw Error('15GiB reserve required');if(JSON.stringify(sources())!==JSON.stringify(report.sources))throw Error('Source changed before '+name);
const c={name,command:['node',...args],env:extra,status:'RUNNING',started:new Date().toISOString(),diskFreeBytes:disk.bavail*disk.bsize};report.checks.push(c);save();console.log('START '+name);
const log=createWriteStream(join(out,name+'.log'));const code=await new Promise((done,reject)=>{const child=spawn(process.execPath,args,{env:{...env,...extra},stdio:['ignore','pipe','pipe']});c.pid=child.pid;save();child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});child.on('error',reject);child.once('close',code=>log.end(()=>done(code)));});c.exitCode=code;c.status=code===0?'PASS':'FAIL';c.finished=new Date().toISOString();save();console.log(c.status+' '+name);
if(name.startsWith('browser-'))copyFileSync('.cache/browser-matrix/'+name.slice(8)+'/playwright.json',join(out,name+'.json'));
if(code!==0)throw Error('Failed '+name+'; inspect before any retry');}
report.sourcesAfter=sources();if(JSON.stringify(report.sourcesAfter)!==JSON.stringify(report.sources))throw Error('Source changed');report.status='PASS';
}catch(e){report.status='FAIL';report.error=String(e);process.exitCode=1;}finally{report.finished=new Date().toISOString();save();}
