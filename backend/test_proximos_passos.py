"""
A tarefa PRÓXIMOS PASSOS nasce nos três caminhos, não só em um.

Rodar: backend/venv/Scripts/python.exe test_proximos_passos.py
Não há pytest no projeto — este arquivo é executável e imprime o resultado.

Ela era criada só quando o automático anexava numa reunião R1/R2/R3 existente.
Não nascia quando o automático criava uma `tactiq`, nem em atribuição manual
nenhuma — e as decisões da reunião existem igual nos três casos. Medido em 8
transcrições vinculadas: apenas 3 tinham a tarefa, e uma das sem tinha 13
decisões registradas.

Pipedrive dublado. Nenhuma chamada sai para produção.
"""

import asyncio
import io
import os
import sys

if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))

import httpx

import main

falhas = []


def checar(rotulo, obtido, esperado):
    ok = obtido == esperado
    print(f"  {'ok   ' if ok else 'FALHA'} {rotulo:56} obtido={obtido!r}")
    if not ok:
        falhas.append(f"{rotulo}: esperado {esperado!r}, obtido {obtido!r}")


BRIEFING = {
    "dados_cliente": {"nome": "Iderval Nanes Farias"},
    "data_reuniao": "02/09/2026",
    "decisoes_proximos_passos": [
        "Enviar proposta de seguro de vida até sexta",
        "Cliente vai levantar os dados dos imóveis",
    ],
}


def _pipedrive_dublado(atividades_por_negocio):
    """Devolve (criadas, atualizadas) e instala os dublês. Restaure depois."""
    criadas, atualizadas = [], []

    async def _buscar(client, nome):
        return [{"item": {"id": 639, "title": "Iderval Nanes Farias"}}]

    class _Cliente:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def get(self, url, **kw):
            did = int(url.rstrip("/").split("/deals/")[1].split("/")[0])

            class R:
                status_code = 200

                @staticmethod
                def json():
                    return {"success": True, "data": atividades_por_negocio.get(did, [])}

            return R()

    async def _create(**kw):
        criadas.append(kw)
        return {"id": 9000 + len(criadas)}

    async def _update(aid, campos):
        atualizadas.append((aid, campos))
        return {"id": aid}

    originais = (
        main.buscar_negocio_por_nome, main.create_pipedrive_activity,
        main.update_pipedrive_activity, httpx.AsyncClient,
    )
    main.buscar_negocio_por_nome = _buscar
    main.create_pipedrive_activity = _create
    main.update_pipedrive_activity = _update
    httpx.AsyncClient = lambda *a, **k: _Cliente()
    return criadas, atualizadas, originais


def _restaurar(originais):
    (
        main.buscar_negocio_por_nome, main.create_pipedrive_activity,
        main.update_pipedrive_activity, httpx.AsyncClient,
    ) = originais


def teste_caminho_que_ja_funcionava():
    print("\n=== automatico, anexou em reuniao existente ===")
    atividade = {"id": 555, "type": "meeting", "due_date": "2026-09-02", "done": False}
    criadas, _, originais = _pipedrive_dublado({639: [atividade]})
    try:
        v = asyncio.run(main.vincular_briefing_na_atividade(dict(BRIEFING), "Iderval | R1", "d"))
    finally:
        _restaurar(originais)

    checar("vinculou na existente", v.get("motivo"), "OK")
    checar("criou a tarefa", len(criadas), 1)
    checar("e uma task", criadas[0].get("activity_type") if criadas else None, "task")
    checar("com o assunto certo", criadas[0].get("subject") if criadas else None, "PRÓXIMOS PASSOS")
    checar("nao nasce concluida", criadas[0].get("done") if criadas else None, False)
    checar("id devolvido no vinculo", v.get("proximos_passos_activity_id"), "9001")


def teste_caminho_da_tactiq():
    """O primeiro que estava faltando: sem reunião na agenda."""
    print("\n=== automatico, criou tactiq ===")
    criadas, _, originais = _pipedrive_dublado({639: []})
    try:
        v = asyncio.run(main.vincular_briefing_na_atividade(dict(BRIEFING), "Iderval | R1", "d"))
    finally:
        _restaurar(originais)

    checar("criou a tactiq", v.get("motivo"), "ATIVIDADE_CRIADA")
    checar("criou DUAS atividades: a tactiq e a tarefa", len(criadas), 2)
    tipos = [c.get("activity_type") for c in criadas]
    checar("uma tactiq e uma task", sorted(tipos), ["tactiq", "task"])
    checar("a tarefa foi para o mesmo negocio",
           [c.get("deal_id") for c in criadas if c.get("activity_type") == "task"], ["639"])
    checar("id guardado no vinculo", v.get("proximos_passos_activity_id"), "9002")


def teste_sem_decisoes_nao_cria():
    """Reunião sem nada combinado não gera pendência vazia."""
    print("\n=== reuniao sem decisoes ===")
    sem = dict(BRIEFING)
    sem["decisoes_proximos_passos"] = []
    criadas, _, originais = _pipedrive_dublado({639: []})
    try:
        v = asyncio.run(main.vincular_briefing_na_atividade(sem, "Iderval | R1", "d"))
    finally:
        _restaurar(originais)

    checar("criou a tactiq", v.get("motivo"), "ATIVIDADE_CRIADA")
    checar("criou SO a tactiq, sem tarefa", len(criadas), 1)
    checar("sem id de proximos passos", v.get("proximos_passos_activity_id"), None)


def teste_nao_duplica_na_reexecucao():
    """
    Reavaliar atualiza a tarefa existente em vez de abrir outra.

    É o que permite ligar isto sem encher a agenda de duplicata a cada
    reprocessamento.
    """
    print("\n=== reexecucao nao duplica ===")
    b = dict(BRIEFING)
    b["pipedrive"] = {"proximos_passos_activity_id": "8217"}
    criadas, atualizadas, originais = _pipedrive_dublado({639: []})
    try:
        asyncio.run(main.vincular_briefing_na_atividade(b, "Iderval | R1", "d"))
    finally:
        _restaurar(originais)

    tasks = [c for c in criadas if c.get("activity_type") == "task"]
    checar("nao criou outra tarefa", len(tasks), 0)
    checar("atualizou a que existia", [a for a, _ in atualizadas], ["8217"])


if __name__ == "__main__":
    teste_caminho_que_ja_funcionava()
    teste_caminho_da_tactiq()
    teste_sem_decisoes_nao_cria()
    teste_nao_duplica_na_reexecucao()
    print(f"\n{'FALHOU' if falhas else 'TUDO OK'}")
    for f in falhas:
        print(f"   {f}")
    sys.exit(1 if falhas else 0)
