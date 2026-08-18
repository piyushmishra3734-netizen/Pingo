/**
 * How much thinking the message in front of us actually needs.
 *
 * ## Why this exists
 *
 * `MODEL_CHAIN` had a 30B and a 120B in it and never once used the 120B. The
 * chain is walked for *availability* - first name that answers wins, and
 * `workingModel` then pins it for the life of the instance - so every message
 * ever sent went to the smallest model in the list. A question that needed
 * reasoning got the model chosen for saying "haan bhai" quickly, which is why
 * the answers to hard questions read as though nobody understood the question.
 *
 * So the size of the model is chosen by the size of the demand, before the
 * call, from the text.
 *
 * ## Why not ask a model what the demand is
 *
 * That is a whole extra round trip on every message, to answer something the
 * words mostly already say - and the round trip is the single most expensive
 * thing in a turn. The retry that already exists costs a full model call and
 * measured at two thirds of a slow reply; adding another before the first even
 * starts would make every "hmm" slower to be sure that "hmm" is easy.
 *
 * Being wrong is cheap in both directions. Routing an easy message to the big
 * model costs some latency; routing a hard one to the small model is what the
 * retry is for. Neither produces a wrong answer, which is the property that
 * makes a heuristic acceptable here at all.
 */

/** Which end of the chain to start from. */
export type Demand = 'heavy' | 'light';

/**
 * Things you cannot answer without working something out.
 *
 * Deliberately generous. A false 'heavy' costs a slower reply; a false 'light'
 * costs an answer that misses the question, which is the complaint this is
 * here to fix.
 */
const HEAVY = [
  // Working something out.
  /\b(solve|calculate|compute|derive|prove|proof|integral|derivative|equation|theorem|probability)\b/i,
  /\b(hal\s*karo|hisaab|nikalo|ganit)\b/i,
  // Code.
  /\b(code|function|algorithm|debug|error|exception|stack\s*trace|regex|sql|query|api|bug)\b/i,
  /```/,
  // Explaining a mechanism, as opposed to naming a thing.
  /\b(why|how\s+does|how\s+do|explain|elaborate|walk\s+me\s+through|step\s*by\s*step|in\s+detail)\b/i,
  /\b(kyun|kyu|kaise\s+kaam|samjhao|samjha\s*do|vistaar|detail\s*me[in]?)\b/i,
  // Comparing or choosing, which needs both sides held at once.
  /\b(difference|compare|versus|vs\.?|better|pros\s+and\s+cons|trade\s*-?\s*offs?)\b/i,
  /\b(farq|antar|behtar|kaunsa\s+better)\b/i,
  // Producing something structured.
  /\b(write|draft|summari[sz]e|translate|rewrite|plan|outline|list\s+of)\b/i,
  /\b(likh\s*do|likho|banao\s+ek\s+plan|summary)\b/i,
  // Arithmetic in the text itself: two numbers and an operator between them.
  /\d\s*[+\-*/^×÷]\s*\d/,
];

/**
 * Things that are plainly not a request to think.
 *
 * Checked first, because several of them contain words the list above would
 * otherwise catch - "kaise ho" is a greeting, not "how does it work".
 */
const LIGHT = [
  /^\s*(h+i+|h+e+y+|h+e+l+o+|hlo|yo|sup|hola|namaste|salaam)\b/i,
  /^\s*kaise\s*(ho|hain|h)\s*[?!.]*\s*$/i,
  /^\s*(kya\s*(haal|chal\s*raha)|what'?s\s*up|wassup)\b/i,
  /^\s*(ok|okay|okk+|hmm+|hm|haan|han|ha|nhi|nahi|no|yes|yep|yup|sure|thik|theek|thk|acha|achha|bye|gn|gm|lol|haha+|😂|👍)\s*[?!.]*\s*$/i,
  /^\s*(thanks|thank\s*you|thx|shukriya|dhanyawad)\b/i,
];

/**
 * Long enough that somebody was explaining a situation rather than chatting.
 *
 * Length alone is weak evidence, which is why it is the last thing consulted
 * and set well above the length of an ordinary line of chat.
 */
const LONG_ENOUGH = 140;

export function reasoningDemand(userMessage: string): Demand {
  const text = (userMessage ?? '').trim();
  if (!text) return 'light';

  if (LIGHT.some((re) => re.test(text))) return 'light';
  if (HEAVY.some((re) => re.test(text))) return 'heavy';

  // A question mark is not enough on its own - "khana kha liya?" is chat - but
  // a question carried in a long message is somebody asking for something real.
  if (text.length >= LONG_ENOUGH) return 'heavy';
  if (/[?？]/.test(text) && text.length > 60) return 'heavy';

  return 'light';
}
