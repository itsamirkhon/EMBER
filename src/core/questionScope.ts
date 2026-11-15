import { MATERIAL_PATTERNS } from './materials';
import type { ResearchQuery } from './types';

export const QUESTION_SCOPE_REPLY = 'I help explore NASA research on combustion, smoke and spacecraft fire safety. I need a question about those topics to find useful evidence. Try asking: “How does airflow affect PMMA flame spread in microgravity?”';

/** Topic gate only: passing it does not establish relevance or scientific support. */
export function isResearchQuestion(question: string, overrides: Partial<ResearchQuery> = {}): boolean {
  const text = question.normalize('NFKC');
  if (/\b(?:combustion|flames?|fires?|flammability|flammable|burn(?:s|ing)?|ignit\w*|extinguish\w*|extinction|quench\w*|smoke|soot|aerosols?|pyrolysis|propellant)\b/i.test(text)) return true;
  if (/горени|плам|пожар|воспламен|тушени|дым|саж[аиу]|погас/i.test(text)) return true;
  if (/\b(?:BASS(?:-II)?|Saffire(?:-I{1,3})?|FLEX(?:-2)?|CFI|SAME(?:-R)?|ACME|SPICE|SLICE)\b/.test(text)) return true;
  if (MATERIAL_PATTERNS.some(({ re, material }) => !['paper', 'cotton', 'wax', 'silicone'].includes(material) && re.test(text))) return true;
  if (/\b(?:microgravity|spacecraft|space station|lunar|martian)\b/i.test(text) && /\b(?:oxygen|o2|pressure|airflow|ventilation|fuel|material|suppression|detection)\b/i.test(text)) return true;
  // Structured research forms can supply the topic independently of their title.
  return Boolean(overrides.material || overrides.targetInvIds?.length || overrides.safetyTask);
}

export class QuestionScopeError extends Error {
  readonly code = 'QUESTION_OUT_OF_SCOPE';
  constructor() {
    super(QUESTION_SCOPE_REPLY);
    this.name = 'QuestionScopeError';
  }
}

export function assertQuestionScope(question: string, overrides?: Partial<ResearchQuery>): void {
  if (!isResearchQuestion(question, overrides)) throw new QuestionScopeError();
}
