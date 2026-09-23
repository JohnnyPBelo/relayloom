import {spawn,execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,existsSync,createWriteStream,copyFileSync,statfsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
const out=resolve('.cache/rejection-storage-reviewed');
if(existsSync(join(out,'report.json')))throw Error('Preserve previous gate');
mkdirSync(out,{recursive:true});
function sources(){const paths=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{encoding:'utf8'}).split('\0').filter(p=>/^(apps|packages|native|tests|scripts|adapters|\.github)\//.test(p)||/^(package.*\.json|.*config\.ts|tsconfig.json)$/.test(p));return Object.fromEntries([...new Set(paths)].sort().map(p=>[p,createHash('sha256').update(readFileSync(p)).digest('hex')]));}
const report={status:'RUNNING',base:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),started:new Date().toISOString(),scope:'Durable explicit owner refusal: CAS decision and proposal proof removal in one commit, authenticated recipient retained, separate private signing namespace, immutable signed/sealed/copied stages, historical receipt preservation and bounded expiry. Full Node/native race, real Node-Go crash and concurrent SQLite controls, namespace isolation, browser IndexedDB lifecycle and compiled worker negative RPC controls; existing receipt/network and browser regression retained. Refusal runtime delivery/admission, approval/publication/provenance and complete UI remain pending. No hardware or public deployment claim',sources:sources(),checks:[]};
const prior=JSON.parse(readFileSync('.cache/rejection-storage-final/report.json','utf8'));
if(prior.status!=='FAIL'||prior.checks.at(-1).name!=='native-integration')throw Error('Expected terminal resource failure');
if(JSON.stringify(report.sources)!==JSON.stringify(prior.sources))throw Error('Source changed after prior gate');
const log=readFileSync('.cache/rejection-storage-final/native-integration.log','utf8');
const blocks=log.split(/(?=^# Subtest:)/m), failures=blocks.filter(s=>/^not ok /m.test(s));
if(failures.length!==5||failures.some(s=>!s.includes('RelayLoom requer uma reserva de 15 GiB livres')||!s.includes('tests/native/site-contribution-source.test.ts')))throw Error('Unexpected prior failure');
const priorFailedNames=failures.map(s=>s.match(/^# Subtest: (.*)$/m)[1]);
report.priorGate={path:'.cache/rejection-storage-final/report.json',status:prior.status,unchangedChecks:prior.checks.filter(c=>['typecheck','full-node','native-race','native-build'].includes(c.name)),nativeIntegration:{tests:167,passed:162,failed:5,failedNames:priorFailedNames,reason:'Peer startup refused because volume fell below required 15GiB reserve; no source change.'}};
if(report.priorGate.unchangedChecks.length!==4||report.priorGate.unchangedChecks.some(c=>c.status!=='PASS'))throw Error('Prior checks incomplete');
const browsers=['site-contribution-rejection-storage','site-contribution-rejection','site-contribution-receipt-runtime','site-contribution-receipt','site-contribution-dismiss','routing','native-transport','site-contribution-inbox','site-contribution-serve-race','core-fixed-envelope','site-contribution','site-contribution-context','site-contribution-catalog','site-contribution-copy','site-contribution-send','site-contribution-worker','site-worker','site-resource-catalog','foundation','private-values','application','relay-policy-race','site-network','site-resource-network','contact-relay'].map(n=>'tests/browser/'+n+'.spec.ts');
const phases=[['native-source-recovery',['--import','tsx','--test','--test-concurrency=1','tests/native/site-contribution-source.test.ts'],{}],['web-build',['node_modules/vite/bin/vite.js','build'],{}],...['chromium','firefox','webkit'].map(engine=>['browser-'+engine,['scripts/e2e.mjs','--config','tests/browser/matrix.config.ts',...browsers,'--output',join(out,engine+'-artifacts')],{RELAYLOOM_MATRIX_ENGINE:engine}])];
const env={...process.env,TMPDIR:resolve('.cache/tmp'),TMP:resolve('.cache/tmp'),TEMP:resolve('.cache/tmp'),PLAYWRIGHT_BROWSERS_PATH:resolve('.cache/playwright')};
const save=()=>writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2)+'\n');save();
try{for(const [name,args,extra]of phases){const disk=statfsSync('.');if(disk.bavail*disk.bsize<15*1024**3)throw Error('15GiB reserve required');if(JSON.stringify(sources())!==JSON.stringify(report.sources))throw Error('Source changed before '+name);
const c={name,command:['node',...args],env:extra,status:'RUNNING',started:new Date().toISOString(),diskFreeBytes:disk.bavail*disk.bsize};report.checks.push(c);save();console.log('START '+name);
const log=createWriteStream(join(out,name+'.log'));const code=await new Promise((done,reject)=>{const child=spawn(process.execPath,args,{env:{...env,...extra},stdio:['ignore','pipe','pipe']});c.pid=child.pid;save();child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});child.on('error',reject);child.once('close',code=>log.end(()=>done(code)));});c.exitCode=code;c.status=code===0?'PASS':'FAIL';c.finished=new Date().toISOString();save();console.log(c.status+' '+name);
if(name.startsWith('browser-'))copyFileSync('.cache/browser-matrix/'+name.slice(8)+'/playwright.json',join(out,name+'.json'));
if(code!==0)throw Error('Failed '+name+'; inspect before any retry');
if(name==='native-source-recovery'){
 const rerun=readFileSync(join(out,name+'.log'),'utf8');
 const passed=[...rerun.matchAll(/^# Subtest: (.*)$/gm)].map(m=>m[1]);
 if(!rerun.includes('# tests 6')||!rerun.includes('# pass 6')||!rerun.includes('# fail 0')||!rerun.includes('# skipped 0')||priorFailedNames.some(n=>!passed.includes(n)))throw Error('Recovery did not cover every blocked case');
 report.nativeRecovery={replayedCases:6,previouslyFailedCases:5,positiveControlRepeated:1,uniqueCasesCovered:167,allPreviousFailuresCovered:true};save();
}
if(name.startsWith('browser-')){const result=JSON.parse(readFileSync(join(out,name+'.json'),'utf8'));if(result.stats.expected!==120||result.stats.unexpected||result.stats.skipped||result.stats.flaky)throw Error('Browser coverage changed');}
}
report.sourcesAfter=sources();if(JSON.stringify(report.sourcesAfter)!==JSON.stringify(report.sources))throw Error('Source changed');report.status='PASS';
}catch(e){report.status='FAIL';report.error=String(e);process.exitCode=1;}finally{report.finished=new Date().toISOString();save();}
