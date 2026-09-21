import {spawn} from 'node:child_process';
import {readFileSync,writeFileSync,copyFileSync,mkdirSync,createWriteStream,statfsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
const out=resolve('.cache/site-form-v4-browser-final');mkdirSync(out,{recursive:true});
const base=JSON.parse(readFileSync('.cache/site-form-v4-current-source.json','utf8'));
const report={...base,status:'RUNNING',scope:base.scope+' Real browser catalogue tests and regression of the existing UI page-copy journey, not a forms submission UI.',checks:[]};
const save=()=>writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
function unchanged(){for(const [p,h]of Object.entries(base.sources))if(createHash('sha256').update(readFileSync(p)).digest('hex')!==h)throw Error('Source changed '+p);}
const phases=[['build',['node_modules/vite/bin/vite.js','build'],{}],...['chromium','firefox','webkit'].map(engine=>[engine,['scripts/e2e.mjs','--config','tests/browser/matrix.config.ts','tests/browser/site-form-document.spec.ts','tests/browser/site-pages.spec.ts','--output',join(out,engine+'-artifacts')],{RELAYLOOM_MATRIX_ENGINE:engine}])];save();
try{for(const [name,args,extra]of phases){
 unchanged();const disk=statfsSync('.');if(disk.bavail*disk.bsize<15*1024**3)throw Error('15GiB reserve required');
 const check={name,command:['node',...args],env:extra,status:'RUNNING',started:new Date().toISOString()};report.checks.push(check);save();console.log('START '+name);
 const log=createWriteStream(join(out,name+'.log'));
 const code=await new Promise((done,reject)=>{const child=spawn(process.execPath,args,{env:{...process.env,...extra},stdio:['ignore','pipe','pipe']});check.pid=child.pid;save();child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});child.once('error',reject);child.once('exit',code=>log.end(()=>done(code)));});
 check.exitCode=code;check.status=code===0?'PASS':'FAIL';check.finished=new Date().toISOString();save();console.log(check.status+' '+name);
 if(name!=='build'){copyFileSync('.cache/browser-matrix/'+name+'/playwright.json',join(out,name+'.json'));copyFileSync('.cache/site-form-document-browser/'+name+'.json',join(out,name+'-control.json'));}
 if(code!==0)throw Error('Failed '+name);
 } unchanged();report.status='PASS';
}catch(error){report.status='FAIL';report.error=String(error);process.exitCode=1;}finally{report.finished=new Date().toISOString();save();}
