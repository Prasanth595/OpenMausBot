// A turn that ended without error is not work done. Routine runs and
// teammate requests used to close as "completed" on the turn's own success:
// 9 routine runs that did not deliver (3 of 10 Sentry reviews, 5 passes of
// the Atendimento routine whose writes were refused) and 47 of 653 teammate
// requests whose answer said the main part was not done were all counted as
// done, and a failure streak that should have alerted stayed at zero. The
// turn now ends with one RESULTADO line, and only "feito" with a proof
// someone can check (or a quiet pass that says what it checked) closes it as
// done. The server checks the proof's form (a link, a number, a commit, an
// ID, an owner item, a quoted command), not its content: that is the
// requester's or a dedicated verifier's job.

const OPTIONS = [
  "- `RESULTADO: feito — <prova>`: a prova é algo que outra pessoa consegue conferir (link, ID da mensagem enviada, número da PR ou da issue, commit, o id do item em \"Precisa de você\" como o149, ou o comando entre crases com a saída que mostra o efeito).",
  "- `RESULTADO: nada a fazer — <o que você conferiu e como>`: a passada conferiu e não havia trabalho (vigia, medição, revisão sem novidade).",
  "- `RESULTADO: em andamento — <o que falta e o que vai retomar>`: o trabalho segue em outro lugar (gate, release, sessão) e voltará.",
  "- `RESULTADO: parcial — <o que faltou e por quê>`",
  "- `RESULTADO: não feito — <motivo>`",
];

/** Added to every routine run's prompt, and to the turn that resumes it. */
export const ROUTINE_RESULT_CONTRACT = [
  "Ao terminar, a última linha da sua resposta precisa ser uma destas, exatamente neste formato:",
  ...OPTIONS,
  "Se a sua parte está feita e o resto é decisão do dono, use feito com o id do item em \"Precisa de você\" como prova.",
  "O servidor só conta a execução como concluída com feito e uma prova conferível, ou com nada a fazer ou em andamento dizendo o que foi conferido; sem a linha, ela fica como não verificada.",
].join("\n");

/** Added to a teammate's request. */
export const HANDOFF_RESULT_CONTRACT = [
  "Ao terminar, a última linha da sua resposta precisa ser uma destas, exatamente neste formato:",
  ...OPTIONS,
  "- `RESULTADO: consulta — <resumo>` quando o pedido foi só opinião ou revisão, sem ação a executar.",
  "Quem pediu recebe o resultado como \"não verificado\" se faltar a linha ou a prova.",
].join("\n");

export type ResultKind = "done" | "nothing" | "ongoing" | "partial" | "not-done" | "consult" | "unproven" | "malformed";
export type DeclaredResult = { kind: ResultKind; detail: string } | { kind: "missing" };

// "RESULTADO: feito — x", "- **RESULTADO:** parcial: x", "> RESULTADO: não feito (x)."
const LINE = /^\s*(?:(?:[>#*+-]|\d+[.)])\s*)*[*_`]*\s*resultado\s*(?::\s*[*_`]*|[*_`]+\s*:)\s*[*_`]*\s*(feito|nada\s+a\s+fazer|em\s+andamento|parcial(?:mente)?|n[ãa]o\s+feito|consulta)\b\s*[*_`]*\s*(?:[—–:.(,-]+\s*(.*?))?[\s.)]*$/i;
const MENTIONS = /^\s*(?:(?:[>#*+-]|\d+[.)])\s*)*[*_`]*\s*resultado\b\s*[*_`]*\s*[:—–-]/i;

/** The verdict the last RESULTADO line of a turn's answer declares (code
 * blocks are not the answer: a quoted example there is not the verdict). */
export function declaredResult(text: string): DeclaredResult {
  const lines = text.replace(/```[\s\S]*?(?:```|$)/g, "").split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!;
    const match = LINE.exec(line);
    if (!match) {
      if (MENTIONS.test(line)) return { kind: "malformed", detail: line.trim().slice(0, 200) };
      continue;
    }
    const verdict = match[1]!.toLowerCase().replace(/\s+/g, " ");
    const detail = (match[2] ?? "").trim().slice(0, 500);
    if (verdict === "feito") return { kind: hasCheckableProof(detail) ? "done" : "unproven", detail };
    if (verdict === "nada a fazer") return { kind: detail ? "nothing" : "unproven", detail };
    if (verdict === "em andamento") return { kind: detail ? "ongoing" : "unproven", detail };
    if (verdict.startsWith("parcial")) return { kind: "partial", detail };
    if (verdict === "consulta") return { kind: "consult", detail };
    return { kind: "not-done", detail };
  }
  return { kind: "missing" };
}

/** A proof someone else can check: a link, a PR/issue number, a commit, an
 * ID ("ID da mensagem: spaces/…"), an owner item ("o149"), or a quoted
 * command. "Deu tudo certo" or "sem ID" is not one. */
export function hasCheckableProof(text: string): boolean {
  const said = text.replace(/\bsem\s+(?:o\s+|a\s+)?(?:ID|link|prova)\b/giu, "");
  return /https?:\/\/\S+/.test(said)
    || /#\d{2,7}\b/.test(said)
    || /\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b/i.test(said)
    || /\bID\b(?:\s+\p{L}+){0,3}\s*[:=]?\s*(?!(?:nenhum|nada|n\/a)\b)[^\s,;]{4,}/iu.test(said)
    || /\bspaces\/[^\s/]+\/messages\/\S+/.test(said)
    || /\bo\d{1,5}\b/.test(said)
    || /`[^`]{3,}`/.test(said);
}

/** Why a declared verdict does not close the work as done, in pt-BR, for a
 * receipt or a chip; null when it does. */
export function resultProblem(result: DeclaredResult): string | null {
  switch (result.kind) {
    case "done":
    case "consult":
    case "nothing":
    case "ongoing":
      return null;
    case "partial":
      return `Resultado parcial: ${result.detail || "sem detalhe"}`;
    case "not-done":
      return `Resultado não feito: ${result.detail || "sem motivo"}`;
    case "unproven":
      return `Resultado não verificado: sem prova conferível ou sem dizer o que foi conferido${result.detail ? ` (${result.detail})` : ""}`;
    case "malformed":
      return `Resultado não verificado: linha RESULTADO fora do formato (${result.detail})`;
    case "missing":
      return "Resultado não verificado: a resposta não terminou com a linha RESULTADO";
  }
}

/** How a teammate's answer settles a request that ended without error. Only
 * "não feito" fails it (reason first). Done with proof, a consultation or a
 * quiet pass complete it as is; partial, in progress, or an answer without a
 * proved line complete it with a server note in front, for the requester to
 * act on — a partial is news for the requester, not a reason to redo it. */
export function settleHandoff(text: string): { failed: boolean; text: string } {
  const declared = declaredResult(text);
  if (declared.kind === "not-done") return { failed: true, text: `${resultProblem(declared)}\n\n${text}` };
  const note = declared.kind === "ongoing" ? `Em andamento: ${declared.detail}` : resultProblem(declared);
  return { failed: false, text: note ? `[Servidor: ${note}]\n${text}` : text };
}
