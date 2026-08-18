/**
 * Which size of model answers, decided from the message.
 *
 * `MODEL_CHAIN` had a 120B in it and never used it: the chain is walked for
 * availability, so the first name that answered was pinned and every message
 * went to the 30B. Hard questions got the model chosen for saying "haan bhai"
 * quickly, which is why their answers read as though nobody understood.
 *
 * Being wrong is cheap in both directions - a slow "hmm" or a retry - so these
 * are about the obvious cases, not the boundary.
 *
 * Run with `pnpm verify:demand`.
 */
import { reasoningDemand } from '../../../supabase/functions/ai-chat/demand.js';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
};
const heavy = (m: string) => {
  const got = reasoningDemand(m);
  check(got === 'heavy', `heavy: "${m.slice(0, 58)}"${got === 'heavy' ? '' : ` (got ${got})`}`);
};
const light = (m: string) => {
  const got = reasoningDemand(m);
  check(got === 'light', `light: "${m.slice(0, 58)}"${got === 'light' ? '' : ` (got ${got})`}`);
};

console.log('\n--- needs the big model ---');
heavy('quantum entanglement ko ek chhote example se samjhao');
heavy('Riemann hypothesis abhi tak prove kyun nahi hui?');
heavy('why does a transformer need positional encoding');
heavy('solve 3x + 5 = 20');
heavy('12 * 47 kitna hota hai');
heavy('is code me bug kahan hai, TypeError aa raha hai');
heavy('difference between TCP and UDP');
heavy('React aur Vue me farq kya hai');
heavy('step by step batao ki compiler kaise kaam karta hai');
heavy('ek short summary likh do is article ka');
heavy('mujhe samajh nahi aa raha ki mera dost mujhse naraz kyun hai, maine usse kal bola tha ki main aaunga par nahi ja paya aur ab wo reply nahi kar raha');

console.log('\n--- does not ---');
light('hi');
light('heyyy');
light('kaise ho?');
light('kya haal hai');
light('ok');
light('hmm');
light('haan bhai');
light('thanks yaar');
light('lol');
light('gn');
light('');
light('khana kha liya?');

console.log(failures === 0 ? '\nAll demand checks passed.' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
