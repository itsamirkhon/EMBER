/** A historical score is not evidence for a changed corpus or scientific engine. */
export function currentEvaluation(report:Record<string,unknown>,corpusVersion:string,engineVersion:string):Record<string,unknown>{
  if(report.status==='not_measured')return report;
  if(report.corpusVersion!==corpusVersion||report.engineVersion!==engineVersion){
    return {status:'not_measured',message:'Stored evaluation belongs to an older engine/corpus. Rerun evaluation; older results are not evidence for this version.'};
  }
  return report;
}
