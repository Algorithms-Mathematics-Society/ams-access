// Build an isolated web copy so production export never rewrites the live dev .next.
import { cp, mkdir, mkdtemp, symlink, writeFile, access } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
const root=process.cwd();
const workspace=await mkdtemp(path.join(os.tmpdir(),'ams-web-review-'));
const web=path.join(workspace,'apps/web');
await mkdir(web,{recursive:true});
const excluded=new Set(['node_modules','.next','out','dashboard-ui','theme-p0','theme-p1','onboarding-ui']);
await cp(path.join(root,'apps/web'),web,{recursive:true,filter:p=>!path.relative(path.join(root,'apps/web'),p).split(path.sep).some(part=>excluded.has(part))});
for(const file of ['package.json','pnpm-workspace.yaml','tsconfig.json']){
 try{await access(path.join(root,file));await cp(path.join(root,file),path.join(workspace,file));}catch(e){if(e.code!=='ENOENT')throw e;}
}
await symlink(path.join(root,'node_modules'),path.join(workspace,'node_modules'),'dir');
await symlink(path.join(root,'apps/web/node_modules'),path.join(web,'node_modules'),'dir');
await symlink(path.join(root,'packages'),path.join(workspace,'packages'),'dir');
const evidenceDirectory=path.resolve(root,process.env.AMS_BUILD_EVIDENCE_DIR || 'apps/web/dashboard-ui/validation');
await mkdir(evidenceDirectory,{recursive:true});
const logFile=path.join(evidenceDirectory,process.env.AMS_BUILD_EVIDENCE_DIR ? 'build.log' : 'claude-build.log');
const log=createWriteStream(logFile);
const child=spawn('npm',['run','build'],{cwd:web,env:process.env,stdio:['ignore','pipe','pipe']});
child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});
const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve)});
await new Promise(resolve=>log.end(resolve));
await writeFile(path.join(evidenceDirectory,'isolated-build.json'),JSON.stringify({workspace,exportDirectory:path.join(web,'out'),exitCode:code,liveDevBuildUntouched:true},null,2)+'\n');
console.log(JSON.stringify({workspace,exitCode:code}));process.exitCode=code||0;
