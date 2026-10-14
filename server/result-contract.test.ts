import { describe, expect, it } from "vitest";
import { declaredResult, hasCheckableProof, resultProblem, ROUTINE_RESULT_CONTRACT, HANDOFF_RESULT_CONTRACT, settleHandoff, settleHandoffNode } from "./result-contract.ts";

describe("the result a turn declares", () => {
  it("reads the last RESULTADO line: done with proof, partial, not done", () => {
    expect(declaredResult("Revisei o Sentry.\nRESULTADO: feito — issue comentada https://github.com/o/r/issues/9400#issuecomment-1")).toEqual({ kind: "done", detail: "issue comentada https://github.com/o/r/issues/9400#issuecomment-1" });
    expect(declaredResult("**RESULTADO:** parcial — a planilha recusou a escrita")).toEqual({ kind: "partial", detail: "a planilha recusou a escrita" });
    expect(declaredResult("RESULTADO: não feito - o Jev barrou o push")).toEqual({ kind: "not-done", detail: "o Jev barrou o push" });
    expect(declaredResult("resultado: nao feito — sem acesso")).toEqual({ kind: "not-done", detail: "sem acesso" });
    // the last one wins: a quoted line earlier is not the verdict
    expect(declaredResult("Antes: RESULTADO: feito — #1\nRESULTADO: parcial — faltou o aviso").kind).toBe("partial");
  });

  it("does not take done without a proof someone can check", () => {
    expect(declaredResult("RESULTADO: feito")).toEqual({ kind: "unproven", detail: "" });
    expect(declaredResult("RESULTADO: feito — tudo certo")).toEqual({ kind: "unproven", detail: "tudo certo" });
    expect(declaredResult("Terminei tudo.")).toEqual({ kind: "missing" });
    expect(declaredResult("RESULTADO: consulta — prefiro a opção B")).toEqual({ kind: "consult", detail: "prefiro a opção B" });
  });

  it("counts links, PR or issue numbers, commits, message IDs and quoted commands as checkable", () => {
    expect(hasCheckableProof("https://app.nuria.run/x")).toBe(true);
    expect(hasCheckableProof("PR #9528 mergeada")).toBe(true);
    expect(hasCheckableProof("commit 61a5d68cd")).toBe(true);
    expect(hasCheckableProof("mensagem ID spaces/AAQA/messages/abc.def")).toBe(true);
    expect(hasCheckableProof("`gh pr view 9528 --json state` → MERGED")).toBe(true);
    expect(hasCheckableProof("ID da mensagem: spaces/AAQA/messages/x1y2")).toBe(true);
    expect(hasCheckableProof("decisão com o dono no item o149")).toBe(true);
    expect(hasCheckableProof("deu tudo certo")).toBe(false);
    expect(hasCheckableProof("avisei, sem ID")).toBe(false);
    expect(hasCheckableProof("")).toBe(false);
  });

  it("reads the line however it is written: a list item, a quote, a colon, a trailing period, \"parcialmente\"", () => {
    expect(declaredResult("- RESULTADO: não feito: sem acesso ao Sentry")).toEqual({ kind: "not-done", detail: "sem acesso ao Sentry" });
    expect(declaredResult("> **RESULTADO:** parcialmente — faltou o aviso.")).toEqual({ kind: "partial", detail: "faltou o aviso" });
    expect(declaredResult("RESULTADO: feito (PR #9528).").kind).toBe("done");
    // a line that names RESULTADO but is out of the format is said as such
    expect(declaredResult("RESULTADO — tudo certo")).toEqual({ kind: "malformed", detail: "RESULTADO — tudo certo" });
    // an example inside a code block is not the verdict
    expect(declaredResult("Exemplo:\n```\nRESULTADO: feito — #1\n```\nfim").kind).toBe("missing");
  });

  it("closes a quiet pass and work that goes on elsewhere when they say what was checked", () => {
    expect(declaredResult("RESULTADO: nada a fazer — `df -h /` mostra 33 GiB livres")).toEqual({ kind: "nothing", detail: "`df -h /` mostra 33 GiB livres" });
    expect(declaredResult("RESULTADO: em andamento — gate da #9534 rodando; retomo quando terminar")).toMatchObject({ kind: "ongoing" });
    // in progress says where it goes on (a PR, a session, a link), or nothing can follow it: not verified
    expect(declaredResult("RESULTADO: em andamento — gate rodando; retomo quando terminar").kind).toBe("unproven");
    expect(declaredResult("RESULTADO: em andamento — gate rodando na sessão 9283").kind).toBe("ongoing");
    expect(declaredResult("RESULTADO: em andamento — aguardando o gate da PR 9534").kind).toBe("ongoing");
    expect(declaredResult("RESULTADO: nada a fazer").kind).toBe("unproven");
    expect(resultProblem({ kind: "nothing", detail: "x" })).toBeNull();
  });

  it("asks for the line in the prompts it adds", () => {
    expect(ROUTINE_RESULT_CONTRACT).toContain("RESULTADO: feito —");
    expect(ROUTINE_RESULT_CONTRACT).toContain("RESULTADO: parcial —");
    expect(HANDOFF_RESULT_CONTRACT).toContain("RESULTADO: consulta");
  });
});

describe("how a teammate's answer settles a request", () => {
  it("fails only a request the teammate declares not done, with the reason first", () => {
    const settled = settleHandoff("Não consegui gravar.\nRESULTADO: não feito — o Jev barrou a escrita");
    expect(settled.failed).toBe(true);
    expect(settled.text.startsWith("Resultado não feito: o Jev barrou a escrita")).toBe(true);
  });

  it("hands a partial or in-progress answer back as news for the requester, not as a failure", () => {
    expect(settleHandoff("RESULTADO: parcial — faltou o aviso")).toEqual({ failed: false, text: "[Servidor: Resultado parcial: faltou o aviso]\nRESULTADO: parcial — faltou o aviso" });
    expect(settleHandoff("RESULTADO: em andamento — gate da #9534 rodando").text.startsWith("[Servidor: Em andamento: gate da #9534 rodando]")).toBe(true);
  });

  it("completes done with proof and a consultation as they are", () => {
    expect(settleHandoff("RESULTADO: feito — PR #9528")).toEqual({ failed: false, text: "RESULTADO: feito — PR #9528" });
    expect(settleHandoff("Prefiro B.\nRESULTADO: consulta — B")).toEqual({ failed: false, text: "Prefiro B.\nRESULTADO: consulta — B" });
  });

  it("hands an unproved or undeclared answer back marked as not verified, for the requester to check", () => {
    const settled = settleHandoff("Feito, tudo certo.");
    expect(settled.failed).toBe(false);
    expect(settled.text).toBe("[Servidor: Resultado não verificado: a resposta não terminou com a linha RESULTADO]\nFeito, tudo certo.");
  });
});

describe("which requests are judged", () => {
  it("judges a teammate's answer, not the requester's own synthesis nor a room member's reply", () => {
    // the requester's synthesis (no parent) answers the person, not a requester: 12 of 12 were marked "not verified" for nothing
    expect(settleHandoffNode("Pronto, resumo para o dono.", { parentId: undefined })).toEqual({ failed: false, text: "Pronto, resumo para o dono." });
    expect(settleHandoffNode("Feito.", { parentId: "root", groupId: "room-1" })).toEqual({ failed: false, text: "Feito." });
    expect(settleHandoffNode("Feito.", { parentId: "root" }).text.startsWith("[Servidor: Resultado não verificado")).toBe(true);
  });
});
