import { randomUUID } from 'node:crypto';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

/** Public pi-subagents event RPC; no private registry, process manager, polling or UI. */
export function subagentRpc(pi: ExtensionAPI, method: string, params: Record<string, unknown>): Promise<any> {
 return new Promise((resolve,reject)=>{
  const requestId=randomUUID();
  const dispose=pi.events.on(`subagents:rpc:v1:reply:${requestId}`,(reply:any)=>{
   clearTimeout(timer);dispose();
   if(reply?.success) resolve(reply.data); else reject(new Error(reply?.error?.message ?? 'pi-subagents request failed'));
  });
  const timer=setTimeout(()=>{dispose();reject(new Error('No pi-subagents reply; inspect native status before retrying. The launch may already exist.'));},30000);
  pi.events.emit('subagents:rpc:v1:request',{version:1,requestId,method,params});
 });
}
export function coordinatorTask(pkg:string,cwd:string,stages:number,parallel:number,merge:boolean):string {
 return [
  `Native Noodle coordination in ${cwd}. At most ${stages} stage launches, ${parallel} independent stages concurrently.`,
  `Read ${cwd}/.noodle.json when present, ${cwd}/todos.md, and ${pkg}/skills/noodle-plan/SKILL.md, ${pkg}/skills/noodle-execute/SKILL.md, ${pkg}/skills/noodle-review/SKILL.md.`,
  'Do not execute /noodle loop or start standalone pi processes. Use native subagent calls for every planning, implementation and review stage; do not implement in coordinator.',
  'Native subagent tooling must be available. If absent, report blocker and stop; no CLI fallback. Delegate subagent fanout only for the bounded stages authorized here.',
  'For every stage use its skill-specific routing first (routing["noodle-plan"], routing["noodle-execute"], routing["noodle-review"]), then routing.default. Review must use a distinct reviewer model. If independent review model is missing or identical, stop before review/merge.',
  'Pass full task context, skill paths, relevant domain skills and exact worktree/base/branch to children. Name branches noodle/<item-id>; create .noodle/.gitignore containing * before worktrees. One writer per worktree. Give reviewer the full committed diff text and verification output when its tools cannot execute Git; never rely on watchdog_diff for already committed changes.',
  'For complex work plan first. Execute every phase, verify completion and tests. Never treat a plan commit as implementation success. Review current implementation independently. CONTESTED/REJECT or inaccessible evidence blocks merge; coordinator may gather evidence and request another independent review but must not upgrade that verdict itself.',
  merge ? 'Local merge is authorized only after independent PASS and full-item completion. Never push.' : 'No merge or push is authorized. Leave branches for parent inspection.',
  'Return native child run IDs, branches/worktrees, verification commands/results, review verdicts and blockers. Do not claim durable /noodle loop recovery for this native coordination path.',
 ].join('\n');
}
