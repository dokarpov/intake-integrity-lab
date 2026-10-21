import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
// Approved review baseline before source-import iteration. Any change must be
// explicitly approved as a separate design task, never bundled with backend work.
const locked={
  'demo/integrity.html':'9853b6a3cb304b2cf110a8575eadb765d8e12136',
  'demo/source-comparison.html':'27000c1cf715c22530e58e3d915de115cce11163'
};
let invalid=0;
for(const [path,expected] of Object.entries(locked)){
 const bytes=readFileSync(resolve(root,path));
 const actual=createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
 if(actual!==expected){
  console.error('DESIGN LOCK VIOLATION: '+path);
  console.error('Approved git blob: '+expected);
  console.error('Current git blob:  '+actual);
  console.error('Do not modify approved pages to implement unrelated functionality.');
  console.error('First obtain explicit design approval, then update the locked baseline in a separate review.');
  invalid++;
 }else console.log('DESIGN LOCK OK '+path+' '+actual);
}
if(invalid)process.exit(1);
