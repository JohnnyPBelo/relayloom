import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, symlinkSync, readdirSync, lstatSync, statfsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { webArtifacts } from '../../../scripts/web-artifact.mjs';
const disk=statfsSync('.'); if(disk.bavail*disk.bsize<15*1024**3) throw Error('15 GiB reserve required');
const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const root=resolve('.cache/private-values-final/committed-'+randomUUID()); mkdirSync(root,{recursive:true});
const archive=execFileSync('git',['archive',head,'apps','packages','scripts','tests','package.json','package-lock.json','tsconfig.json','vite.config.ts','docs/licenses'],{maxBuffer:64*1024*1024});
execFileSync('tar',['-xf','-','-C',root],{input:archive});
symlinkSync(resolve('node_modules'),join(root,'node_modules'),'dir');
const log=join(root,'build.log');
try {
 const output=execFileSync(process.execPath,[resolve('node_modules/vite/bin/vite.js'),'build','--mode','public-web','--base','/relayloom/'],{cwd:root,encoding:'utf8',maxBuffer:8*1024*1024,env:{...process.env,XDG_CACHE_HOME:resolve('.cache/private-values-final/runtime')}});
 writeFileSync(log,output);
 const dir=join(root,'dist/public-web'), artifacts={};
 function visit(sub='') { for(const name of readdirSync(join(dir,sub)).sort()) {
  const file=sub?sub+'/'+name:name, path=join(dir,file), stat=lstatSync(path);
  if(stat.isDirectory()) visit(file);
  else {if(!stat.isFile()) throw Error('Unexpected committed artifact'); const bytes=readFileSync(path); artifacts[file]={sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length};}
 }}
 visit();
 const passed=isDeepStrictEqual(artifacts,webArtifacts());
 const report={status:passed?'PASS':'FAIL',head,artifactCount:Object.keys(artifacts).length,artifacts,independentCommittedCheckout:true,dependencies:'Existing project-scoped node_modules; no installation or download',runtimeSourceMatchesPublishedCandidate:passed};
 writeFileSync('.cache/private-values-final/committed-build.json',JSON.stringify(report,null,2)+'\n');
 if(!passed) throw Error('Committed source build differs from tested artifacts');
 console.log(JSON.stringify({status:report.status,head,artifactCount:report.artifactCount}));
} catch(error) {if(error.stdout||error.stderr) writeFileSync(log,String(error.stdout??'')+String(error.stderr??''));throw error}
