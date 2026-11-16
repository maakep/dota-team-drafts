import {readFile,writeFile,lstat,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateDraft,cleanDraft} from '../src/domain.js';

const projectRoot=fileURLToPath(new URL('../',import.meta.url));
export async function saveDraft(json,previous='',root=projectRoot) {
  if(typeof json!=='string' || Buffer.byteLength(json,'utf8')>24576) throw new Error('Draft JSON must be under 24 KB.');
  let value;
  try {value=JSON.parse(json);} catch {throw new Error('Invalid draft JSON.');}
  const heroes=JSON.parse(await readFile(path.join(root,'data/heroes.json'),'utf8'));
  const errors=validateDraft(value,new Set(heroes.map(h=>h.id)));
  if(errors.length) throw new Error(errors.join(' '));
  const draft=cleanDraft(value);
  const folder=path.join(root,'data/drafts');
  const resolved=await realpath(folder);
  if(resolved!==path.resolve(folder)) throw new Error('Draft directory must not be a symlink.');
  const target=path.join(folder,`${draft.id}.json`);
  let existing=null;
  try {
    if(!(await lstat(target)).isFile()) throw new Error('Draft path must be a regular file.');
    existing=JSON.parse(await readFile(target,'utf8'));
  } catch(error) {if(error.code!=='ENOENT')throw error;}
  if(existing) {
    const fingerprint=createHash('sha256').update(JSON.stringify(cleanDraft(existing))).digest('hex');
    if(previous!==fingerprint)throw new Error('Draft changed on GitHub. Reload before saving.');
  } else if(previous) throw new Error('The original draft no longer exists.');
  const output=`${JSON.stringify(draft,null,2)}\n`;
  await writeFile(target,output);
  return {id:draft.id,changed:!existing || JSON.stringify(cleanDraft(existing))!==JSON.stringify(draft)};
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const result=await saveDraft(process.env.DRAFT_JSON,process.env.DRAFT_PREVIOUS || '');
  console.log(`Validated draft ${result.id}.`);
}
