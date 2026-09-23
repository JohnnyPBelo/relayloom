// Single sequential diagnosis. This is not a suite retry and does not mutate source.
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, existsSync, writeFileSync, readFileSync, readdirSync, createWriteStream, statfsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { formPayload } from '../tests/fixtures/site-form';
const root=process.cwd(), out=resolve('.cache/receipt-cold-measurement');
if(existsSync(join(out,'report.json')))throw Error('Preserve prior diagnosis');
mkdirSync(out,{recursive:true});
const go=resolve('.cache/toolchains/go1.26.8/bin/go');
if(!existsSync(go))throw Error('Use the existing project Go toolchain');
const report:any={status:'RUNNING',commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),started:new Date().toISOString(),scope:'One cold combined command, then separately bounded cold compilation and execution with unchanged product source. Only owned detached test process groups may be stopped at their recorded deadline. No service/configuration changes.',phases:[]};
const save=()=>writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
async function run(name:string,command:string,args:string[],timeoutMs:number,cache:string,form:string){
 const disk=statfsSync('.');if(disk.bavail*disk.bsize<15*1024**3)throw Error('15GiB reserve required');
 const tmp=join(out,name+'-tmp');mkdirSync(tmp,{recursive:true});mkdirSync(cache,{recursive:true});
 const p:any={name,command:[command,...args],timeoutMs,cache,cacheFilesAtStart:readdirSync(cache).length,status:'RUNNING',started:new Date().toISOString(),freeBytes:disk.bavail*disk.bsize};report.phases.push(p);save();
 const env={...process.env,GOTOOLCHAIN:'local',GOCACHE:cache,GOMODCACHE:resolve('.cache/go-mod'),GOPATH:resolve('.cache/go'),TMPDIR:tmp,TMP:tmp,TEMP:tmp,RELAYLOOM_RECEIPT_BUDGET_FORM:form};
 const log=createWriteStream(join(out,name+'.log'));
 const started=performance.now();
 const child=spawn(command,args,{cwd:resolve('native'),env,detached:true,stdio:['ignore','pipe','pipe']});p.pid=child.pid;save();
 child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});
 let timedOut=false,guard:any,kill:any;
 const stop=(reason:string)=>{if(timedOut)return;timedOut=true;p.stopReason=reason;save();try{process.kill(-child.pid!,'SIGTERM');}catch{} kill=setTimeout(()=>{try{process.kill(-child.pid!,'SIGKILL');}catch{}},2000);};
 const deadline=setTimeout(()=>stop('owned phase deadline'),timeoutMs);
 guard=setInterval(()=>{const d=statfsSync('.');if(d.bavail*d.bsize<15*1024**3)stop('disk reserve');},1000);
 try{const done:any=await new Promise((ok,fail)=>{child.once('error',fail);child.once('close',(code,signal)=>ok({code,signal}));});p.exitCode=done.code;p.signal=done.signal;p.status=timedOut?'TIMEOUT':done.code===0?'PASS':'FAIL';}
 finally{clearTimeout(deadline);clearTimeout(kill);clearInterval(guard);await new Promise<void>(done=>log.end(done));p.durationMs=Math.round(performance.now()-started);p.finished=new Date().toISOString();p.resultExists=existsSync(form+'.result.json');save();}
 return p;
}
try{
 const originalForm=join(out,'original-form.json');writeFileSync(originalForm,JSON.stringify(formPayload()),{mode:0o600});
 const original=await run('cold-combined',go,['test','-race','-p=1','-x','./app','-run','^TestReceiptRuntimeBudgetWorker$','-count=1','-v'],60000,join(out,'combined-cache'),originalForm);
 // Always preserve the observed outcome; a local pass does not reproduce remote failure.
 if(original.stopReason==='disk reserve')throw Error('Reserve reached during diagnosis');
 if(!['PASS','TIMEOUT'].includes(original.status))throw Error('Unexpected combined-command failure; inspect before continuing');
 const fixedForm=join(out,'separate-form.json');writeFileSync(fixedForm,JSON.stringify(formPayload()),{mode:0o600});
 const binary=join(out,'app.test');
 const built=await run('cold-build',go,['test','-c','-race','-p=1','-o',binary,'./app'],120000,join(out,'separate-cache'),fixedForm);
 if(built.status!=='PASS')throw Error('Compilation did not complete; inspect before another attempt');
 const executed=await run('bounded-execution',binary,['-test.run=^TestReceiptRuntimeBudgetWorker$','-test.count=1','-test.v','-test.timeout=55s'],60000,join(out,'separate-cache'),fixedForm);
 if(executed.status!=='PASS')throw Error('Execution did not complete; inspect before another attempt');
 const value=JSON.parse(readFileSync(fixedForm+'.result.json','utf8'));
 if(JSON.stringify(value)!==JSON.stringify({copyQuota:true,normal:true,preservedEnvelopeIDs:true}))throw Error('Worker result disagrees');
 report.separateWorkerResult=value;report.combinedReproducedTimeout=original.status==='TIMEOUT';report.status='PASS';
}catch(e){report.status='FAIL';report.error=String(e);process.exitCode=1;}
finally{report.finished=new Date().toISOString();save();console.log(JSON.stringify({status:report.status,phases:report.phases.map((p:any)=>({name:p.name,status:p.status,durationMs:p.durationMs,resultExists:p.resultExists}))}));}
