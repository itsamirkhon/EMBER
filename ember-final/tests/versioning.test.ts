import {mkdtemp,writeFile,mkdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {describe,it,expect} from 'vitest';
import {EmberStore} from '../server/store';
import {ENGINE_VERSION} from '../src/core/reviewEngine';
describe('evaluation version guard',()=>{
 it('does not present an older engine/corpus evaluation as current evidence',async()=>{
  const root=await mkdtemp(join(tmpdir(),'ember-version-'));
  try{
   await mkdir(join(root,'public/data'),{recursive:true});
   await writeFile(join(root,'public/data/corpus_v2.json'),JSON.stringify({corpusVersion:'new',tests:[],investigations:[],sources:[]}));
   await writeFile(join(root,'public/data/eval_report.json'),JSON.stringify({engineVersion:'old',corpusVersion:'old',variants:[{overall:{accuracy:1}}]}));
   const report=await new EmberStore({rootDir:root}).getEvaluationReport();
   expect(report.status).toBe('not_measured');
   expect(report.variants).toBeUndefined();
   await writeFile(join(root,'public/data/eval_report.json'),JSON.stringify({engineVersion:ENGINE_VERSION,corpusVersion:'new',variants:[]}));
   expect((await new EmberStore({rootDir:root}).getEvaluationReport()).variants).toEqual([]);
  }finally{await rm(root,{recursive:true,force:true});}
 });
});
