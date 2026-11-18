import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export type Attempt = {
 id: string; item: string; skill: string; status: 'running' | 'succeeded' | 'failed' | 'interrupted';
 started: string; finished?: string; before: string; after?: string; modelIdentity?: string;
 verdict?: string; log: string; error?: string;
};
export type MergeIntent = { item: string; base: string; head: string; destination: string; status: 'prepared' | 'backlog-pending' | 'done' | 'attention'; error?: string };
type State = { version: 1; attempts: Attempt[]; merges: Record<string, MergeIntent> };

/** Single owner required. Atomic replace: readers see old or new complete snapshot, never partial JSON. */
export class Journal {
 readonly file: string;
 constructor(dir: string) { this.file = path.join(dir, 'state.json'); }
 read(): State {
  if (!fs.existsSync(this.file)) return {version:1,attempts:[],merges:{}};
  const s = JSON.parse(fs.readFileSync(this.file,'utf8'));
  if (s.version !== 1 || !Array.isArray(s.attempts) || !s.merges || typeof s.merges !== 'object') throw new Error('Invalid Noodle state; preserve state.json and inspect before recovery.');
  return s;
 }
 private save(s: State) {
  const tmp = `${this.file}.${randomUUID()}.tmp`;
  const fd = fs.openSync(tmp,'wx',0o600);
  try { fs.writeFileSync(fd,JSON.stringify(s,null,2)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp,this.file);
  if(process.platform!=='win32') { const dir=fs.openSync(path.dirname(this.file),'r');try {fs.fsyncSync(dir);} finally {fs.closeSync(dir);} }
 }
 start(a: Omit<Attempt,'id'|'status'|'started'>): string {
  const s=this.read(), id=randomUUID();
  s.attempts.push({...a,id,status:'running',started:new Date().toISOString()});this.save(s);return id;
 }
 finish(id: string, result: Pick<Attempt,'status'> & Partial<Attempt>) {
  const s=this.read(), a=s.attempts.find(a=>a.id===id);
  if (!a || a.status !== 'running') throw new Error('Attempt is not running');
  Object.assign(a,result,{id,finished:new Date().toISOString()});this.save(s);
 }
 interrupt() {
  const s=this.read();
  for(const a of s.attempts) if(a.status==='running') Object.assign(a,{status:'interrupted',finished:new Date().toISOString(),error:'Owner ended before durable completion; inspect worktree, do not infer success.'});
  this.save(s);
 }
 acknowledge(id: string) { const s=this.read();const a=s.attempts.find(a=>a.id===id);if(!a || a.status!=='interrupted') throw new Error('Not an interrupted attempt');a.status='failed';a.error='Operator acknowledged interruption for retry';this.save(s); }
 clearMerge(item: string) { const s=this.read();delete s.merges[item];this.save(s); }
 merge(intent: MergeIntent) { const s=this.read();s.merges[intent.item]=intent;this.save(s); }
}
