"""
Regressão: vínculo bem-sucedido tem que aparecer como vinculado na tela.

Rodar: backend/venv/Scripts/python.exe test_estado_vinculo.py
Não há pytest no projeto — este arquivo é executável e imprime o resultado.

O caso real: a transcrição do Carlos Eduardo teve a atividade #8196 criada no
CRM e `vinculo.status = "vinculado"`, mas o card continuava mostrando "Pendente
de Vínculo". A tela decide por `pipedrive.deal_id || pipedrive.person_id`, e o
vínculo automático gravava só `activity_id`, `activity_origem` e
`activity_type` — nunca o negócio.

Dois lugares no código faziam essa gravação, copiada um do outro. Era também
onde `activity_origem` ficava fixo em "existente". Agora há uma função só.
"""

import io
import os
import sys

if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))

import main

falhas = []


def checar(rotulo, obtido, esperado):
    ok = obtido == esperado
    print(f"  {'ok   ' if ok else 'FALHA'} {rotulo:56} obtido={obtido!r}")
    if not ok:
        falhas.append(f"{rotulo}: esperado {esperado!r}, obtido {obtido!r}")


def tela_mostra_vinculado(briefing):
    """A mesma condição que o card usa: deal_id ou person_id preenchidos."""
    p = briefing.get("pipedrive") or {}
    return bool(p.get("deal_id") or p.get("person_id"))


def teste_atividade_existente():
    print("\n=== anexou em reuniao existente ===")
    b = {"pipedrive": {}}
    main.gravar_vinculo_no_briefing(b, {
        "status": "vinculado", "motivo": "OK",
        "activity_id": "7618", "activity_origem": "existente", "activity_type": "R3",
        "detalhe": {"deal_id": 622}, "proximos_passos_activity_id": "8217",
    })
    p = b["pipedrive"]
    checar("activity_id gravado", p.get("activity_id"), "7618")
    checar("origem preservada", p.get("activity_origem"), "existente")
    checar("deal_id gravado", p.get("deal_id"), "622")
    checar("deal_url montada", p.get("deal_url"), "https://investimentosblue.pipedrive.com/deal/622")
    checar("proximos passos guardado", p.get("proximos_passos_activity_id"), "8217")
    checar("a TELA mostra vinculado", tela_mostra_vinculado(b), True)


def teste_atividade_criada():
    """O caso do Carlos Eduardo: tactiq criada, card dizia pendente."""
    print("\n=== criou atividade tactiq ===")
    b = {"pipedrive": {}}
    main.gravar_vinculo_no_briefing(b, {
        "status": "vinculado", "motivo": "ATIVIDADE_CRIADA",
        "activity_id": "8196", "activity_origem": "criada", "activity_type": "tactiq",
        "detalhe": {"deal_id": 184},
    })
    p = b["pipedrive"]
    checar("origem 'criada' preservada", p.get("activity_origem"), "criada")
    checar("deal_id gravado", p.get("deal_id"), "184")
    checar("a TELA mostra vinculado", tela_mostra_vinculado(b), True)


def teste_nao_vinculado_nao_suja():
    print("\n=== nao vinculou: nao inventa negocio ===")
    b = {"pipedrive": {"deal_id": "999"}}
    main.gravar_vinculo_no_briefing(b, {
        "status": "nao_vinculado", "motivo": "COMPATIBILIDADE_BAIXA",
        "detalhe": {"score": 0.64},
    })
    p = b["pipedrive"]
    checar("nao grava activity_id", p.get("activity_id"), None)
    # O que já estava lá foi posto por atribuição manual e não pode ser perdido.
    checar("preserva deal que ja existia", p.get("deal_id"), "999")


def teste_sem_deal_no_detalhe():
    """SEM_NOME_CLIENTE e afins não trazem deal; não pode explodir."""
    print("\n=== vinculo sem deal_id no detalhe ===")
    b = {"pipedrive": {}}
    main.gravar_vinculo_no_briefing(b, {
        "status": "vinculado", "motivo": "OK",
        "activity_id": "1", "activity_origem": "existente", "detalhe": {},
    })
    checar("nao inventa deal_id", (b["pipedrive"]).get("deal_id"), None)
    checar("activity_id ainda gravado", (b["pipedrive"]).get("activity_id"), "1")


def teste_desvincular_reseta_o_veredito():
    """
    Desvincular tem que apagar o veredito, não só os ids.

    Antes, `desanexar_transcricao_do_crm` zerava `proximos_passos_activity_id` e
    `activity_origem` e deixava o bloco `vinculo` dizendo "vinculado". A
    transcrição do Pablo e a do Sérgio ficaram assim depois da limpeza no CRM:
    sem atividade nenhuma e ainda marcadas como vinculadas.
    """
    print("\n=== desvincular reseta o bloco vinculo ===")
    import asyncio

    chamadas = []

    async def _apagar(aid):
        chamadas.append(("delete", aid))
        return True

    async def _atualizar(aid, campos):
        chamadas.append(("update", aid))
        return {"id": aid}

    b = {
        "pipedrive": {
            "activity_id": "8196", "activity_origem": "criada", "activity_type": "tactiq",
            "deal_id": "184", "proximos_passos_activity_id": "8217",
        },
        "vinculo": {"status": "vinculado", "motivo": "ATIVIDADE_CRIADA", "detalhe": {"deal_id": 184}},
    }

    originais = (main.delete_pipedrive_activity, main.update_pipedrive_activity)
    main.delete_pipedrive_activity, main.update_pipedrive_activity = _apagar, _atualizar
    try:
        r = asyncio.run(main.desanexar_transcricao_do_crm(b))
    finally:
        main.delete_pipedrive_activity, main.update_pipedrive_activity = originais

    checar("apagou a tactiq que era nossa", r["atividade_apagada"], True)
    checar("apagou a tarefa de proximos passos", r["proximos_passos_apagada"], True)
    checar("vinculo deixou de dizer vinculado", b["vinculo"]["status"], "nao_vinculado")
    checar("motivo registra o desvinculo", b["vinculo"]["motivo"], "DESVINCULADO_MANUALMENTE")
    checar("activity_id limpo", b["pipedrive"].get("activity_id"), None)
    checar("origem limpa", b["pipedrive"].get("activity_origem"), None)
    checar("proximos passos limpo", b["pipedrive"].get("proximos_passos_activity_id"), None)
    checar("a TELA deixa de mostrar vinculado por atividade",
           bool(b["pipedrive"].get("activity_id")), False)


def teste_desvincular_atividade_do_cliente():
    """Reunião do cliente não se apaga: limpa a nota e a atividade fica."""
    print("\n=== desvincular atividade 'existente' ===")
    import asyncio

    apagadas, limpas = [], []

    async def _apagar(aid):
        apagadas.append(aid)
        return True

    async def _atualizar(aid, campos):
        limpas.append((aid, campos))
        return {"id": aid}

    b = {
        "pipedrive": {"activity_id": "7618", "activity_origem": "existente", "deal_id": "622"},
        "vinculo": {"status": "vinculado", "motivo": "OK"},
    }
    originais = (main.delete_pipedrive_activity, main.update_pipedrive_activity)
    main.delete_pipedrive_activity, main.update_pipedrive_activity = _apagar, _atualizar
    try:
        r = asyncio.run(main.desanexar_transcricao_do_crm(b))
    finally:
        main.delete_pipedrive_activity, main.update_pipedrive_activity = originais

    checar("NAO apagou a reuniao do cliente", apagadas, [])
    checar("limpou a nota", r["nota_limpa"], True)
    checar("vinculo resetado tambem aqui", b["vinculo"]["status"], "nao_vinculado")


if __name__ == "__main__":
    teste_atividade_existente()
    teste_atividade_criada()
    teste_nao_vinculado_nao_suja()
    teste_sem_deal_no_detalhe()
    teste_desvincular_reseta_o_veredito()
    teste_desvincular_atividade_do_cliente()
    print(f"\n{'FALHOU' if falhas else 'TUDO OK'}")
    for f in falhas:
        print(f"   {f}")
    sys.exit(1 if falhas else 0)
