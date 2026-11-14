import {describe,expect,it} from 'vitest';
import {materialsCompatible,normalizeMaterialName} from '../src/core/applicability';
import {parseResearchQuery} from '../src/core/queryParser';

describe('material identity at the scientific boundary',()=>{
  it.each([['polyethylene','ethylene'],['polypropylene','propylene'],['polymethane','methane'],['cotton','paper']])('does not qualify %s evidence as %s', (a,b)=>{
    expect(materialsCompatible(a,b)).toBe(false);
  });
  it.each([['acrylic','PMMA'],['polymethyl methacrylate','PMMA'],['PTFE','Teflon'],['cotton fiberglass','SIBAL'],['C2H4','ethylene']])('preserves documented aliases %s / %s',(a,b)=>{
    expect(materialsCompatible(a,b)).toBe(true);
  });
  it('keeps polyethylene distinct when parsing a research question',()=>{
    const q=parseResearchQuery('polyethylene sheet flame spread in microgravity');
    expect(normalizeMaterialName(q.material)).toBe('polyethylene');
    expect(q.fuelPhase).toBe('solid');
  });
});
