const FILLERS = ["can you", "could you", "please", "quickly", "hey", "just", "now"];
const MOMENT_WORDS = new Set(["this", "that", "it", "here", "there", "these", "those", "them"]);
const MAX_SENTENCE = 280;

const wordPattern = (phrase: string, flags: string) =>
  new RegExp(`(?<![\\p{L}\\p{N}])${phrase}(?![\\p{L}\\p{N}])`, flags);
const FILLER_PATTERNS = [...FILLERS]
  .sort((a, b) => b.length - a.length)
  .map((phrase) => wordPattern(phrase, "gu"));

export function requestKey(text: string): string {
  let key = text.normalize("NFKC").toLowerCase().replace(/[\p{P}\p{S}]+/gu, " ").replace(/\s+/g, " ");
  for (const pattern of FILLER_PATTERNS) key = key.replace(pattern, " ");
  return key.replace(/\s+/g, " ").trim();
}

export function hasMomentWords(text: string): boolean {
  return requestKey(text).split(" ").some((token) => MOMENT_WORDS.has(token));
}

export function inRequest(fragment: string, request: string): boolean {
  const trimmed = fragment.trim();
  if (!trimmed) return false;
  return wordPattern(trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "iu").test(request);
}

export function firstSentence(text: string): string | null {
  const trimmed = text.trim();
  if (!/[\p{L}\p{N}]/u.test(trimmed)) return null;
  const match = /^[\s\S]*?[.!?](?=\s|$)/.exec(trimmed);
  const sentence = match ? match[0] : trimmed;
  if (sentence.length <= MAX_SENTENCE) return sentence;
  const cut = sentence.slice(0, MAX_SENTENCE);
  const space = cut.lastIndexOf(" ");
  return `${(space > 0 ? cut.slice(0, space) : cut).trimEnd()}…`;
}
