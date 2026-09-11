"""
Regra nova: achou o negócio e não achou a atividade -> cria uma `tactiq`.

Rodar: backend/venv/Scripts/python.exe test_vinculo_automatico.py
Não há pytest no projeto — este arquivo é executável e imprime o resultado.

Antes, o fluxo automático desistia com SEM_ATIVIDADE_NA_DATA e a reunião ficava
sem registro nenhum no CRM. A atribuição manual já criava a `tactiq` nessa mesma
situação; agora os dois caminhos fazem a mesma coisa.

Dois invariantes que este arquivo existe para travar:

1. `activity_origem` precisa sair "criada" quando a atividade é nossa. Se sair
   "existente", o Desvincular não a apaga e sobra lixo no CRM — e o inverso é
   pior ainda: apagaria a R1/R2/R3 real do cliente.
2. Falha na criação NÃO pode virar "vinculado". É o mesmo bug que a atribuição
   manual tinha.

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
    "decisoes_proximos_passos": [],
}


def _negocio(did, titulo="Iderval Nanes Farias"):
    return {"item": {"id": did, "title": titulo}}


def _atividade(aid, tipo="meeting", data="2026-09-02", done=False):
    return {"id": aid, "type": tipo, "due_date": data, "done": done}


def _rodar(negocios, atividades_por_negocio, criacao_funciona=True):
    """Executa vincular_briefing_na_atividade com o Pipedrive dublado."""
    criadas, atualizadas = [], []

    async def _buscar(client, nome):
        return negocios

    class _Cliente:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def get(self, url, **kwargs):
            did = int(url.rstrip("/").split("/deals/")[1].split("/")[0])

            class R:
                status_code = 200

                @staticmethod
                def json():
                    return {"success": True, "data": atividades_por_negocio.get(did, [])}

            return R()

    async def _create(**kwargs):
        criadas.append(kwargs)
        return {"id": 7777} if criacao_funciona else None

    async def _update(activity_id, updates):
        atualizadas.append((activity_id, updates))
        return {"id": activity_id}

    async def _proximos(*a, **k):
        return None

    originais = (
        main.buscar_negocio_por_nome, main.create_pipedrive_activity,
        main.update_pipedrive_activity, main.criar_atividade_proximos_passos,
        httpx.AsyncClient,
    )
    main.buscar_negocio_por_nome = _buscar
    main.create_pipedrive_activity = _create
    main.update_pipedrive_activity = _update
    main.criar_atividade_proximos_passos = _proximos
    httpx.AsyncClient = lambda *a, **k: _Cliente()
    try:
        vinculo = asyncio.run(
            main.vincular_briefing_na_atividade(dict(BRIEFING), "Iderval | R1", "doc-1")
        )
    finally:
        (
            main.buscar_negocio_por_nome, main.create_pipedrive_activity,
            main.update_pipedrive_activity, main.criar_atividade_proximos_passos,
            httpx.AsyncClient,
        ) = originais
    return vinculo, criadas, atualizadas


def teste_cria_quando_negocio_existe_sem_atividade():
    print("\n=== negocio achado, sem atividade na data ===")
    vinculo, criadas, atualizadas = _rodar([_negocio(639)], {639: []})

    checar("vinculou", vinculo.get("status"), "vinculado")
    checar("motivo diz que foi criada", vinculo.get("motivo"), "ATIVIDADE_CRIADA")
    checar("criou exatamente uma atividade", len(criadas), 1)
    checar("nao atualizou nenhuma atividade existente", len(atualizadas), 0)
    checar("tipo tactiq", criadas[0].get("activity_type") if criadas else None, "tactiq")
    checar("no negocio certo", criadas[0].get("deal_id") if criadas else None, "639")
    checar("na data da reuniao", criadas[0].get("due_date") if criadas else None, "2026-09-02")
    # Se sair "existente", o Desvincular deixa lixo no CRM em vez de limpar.
    checar("origem marcada como criada", vinculo.get("activity_origem"), "criada")
    checar("activity_id da criada", vinculo.get("activity_id"), "7777")


def teste_atividade_existente_continua_ganhando():
    print("\n=== atividade existe: comportamento antigo intacto ===")
    vinculo, criadas, atualizadas = _rodar([_negocio(639)], {639: [_atividade(555)]})

    checar("vinculou", vinculo.get("status"), "vinculado")
    checar("motivo OK", vinculo.get("motivo"), "OK")
    checar("nao criou nada", len(criadas), 0)
    checar("atualizou a atividade existente", len(atualizadas), 1)
    checar("origem existente", vinculo.get("activity_origem"), "existente")
    checar("activity_id da existente", vinculo.get("activity_id"), "555")


def teste_empate_vai_para_o_negocio_mais_novo():
    print("\n=== dois negocios empatados, nenhum com atividade ===")
    # #639 e de 2026 e esta open; #81 e de 2024 e esta lost. Id maior = mais novo.
    vinculo, criadas, _ = _rodar([_negocio(81), _negocio(639)], {81: [], 639: []})

    checar("vinculou", vinculo.get("status"), "vinculado")
    checar("criou no negocio mais novo",
           criadas[0].get("deal_id") if criadas else None, "639")
    checar("criou so uma", len(criadas), 1)


def teste_sem_negocio_nao_cria_nada():
    print("\n=== nenhum negocio encontrado ===")
    vinculo, criadas, _ = _rodar([], {})

    checar("nao vinculou", vinculo.get("status"), "nao_vinculado")
    checar("motivo preservado", vinculo.get("motivo"), "NEGOCIO_NAO_ENCONTRADO")
    checar("nao criou nada", len(criadas), 0)


def teste_nome_incompativel_nao_cria_nada():
    print("\n=== negocio de outra pessoa ===")
    vinculo, criadas, _ = _rodar([_negocio(900, "Fernanda Albuquerque")], {900: []})

    checar("nao vinculou", vinculo.get("status"), "nao_vinculado")
    checar("motivo compatibilidade baixa", vinculo.get("motivo"), "COMPATIBILIDADE_BAIXA")
    checar("nao criou nada", len(criadas), 0)


def teste_falha_na_criacao_nao_vira_sucesso():
    print("\n=== criacao falha: nao pode dizer que vinculou ===")
    vinculo, criadas, _ = _rodar([_negocio(639)], {639: []}, criacao_funciona=False)

    checar("tentou criar", len(criadas), 1)
    checar("nao vinculou", vinculo.get("status"), "nao_vinculado")
    checar("motivo de erro", vinculo.get("motivo"), "ERRO_PIPEDRIVE")
    checar("sem activity_id", vinculo.get("activity_id"), None)


if __name__ == "__main__":
    teste_cria_quando_negocio_existe_sem_atividade()
    teste_atividade_existente_continua_ganhando()
    teste_empate_vai_para_o_negocio_mais_novo()
    teste_sem_negocio_nao_cria_nada()
    teste_nome_incompativel_nao_cria_nada()
    teste_falha_na_criacao_nao_vira_sucesso()
    print(f"\n{'FALHOU' if falhas else 'TUDO OK'}")
    for f in falhas:
        print(f"   {f}")
    sys.exit(1 if falhas else 0)
