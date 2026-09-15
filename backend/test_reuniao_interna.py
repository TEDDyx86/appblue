"""
Regressão: quem conduz a reunião nunca é o cliente.

Rodar: backend/venv/Scripts/python.exe test_reuniao_interna.py
Não há pytest no projeto — este arquivo é executável e imprime o resultado.

O caso real, de 10/09: uma reunião interna entre Roberto Righetti e Robson
Vieira foi processada, o briefing nomeou como cliente um "Sérgio Paulo Araújo"
que só havia sido **mencionado** na conversa, e o vínculo casou com score 1,00
contra o negócio real dele. A nota da reunião interna foi parar na atividade de
um cliente de verdade, e uma tarefa PRÓXIMOS PASSOS foi criada no negócio dele.

A automação não tinha como desconfiar: nome idêntico e atividade na data exata.
A defesa possível é anterior à busca — recusar o nome quando ele é de quem
conduz, ou quando o próprio briefing declara que a reunião é interna.

Medido antes de escolher a regra: usar "o cliente precisa estar entre os
participantes" teria bloqueado dois vínculos corretos (João Carlos Bontempo e
Cimara e Luiz), porque cliente presencial não entra na lista do Tactiq. Por isso
a regra é sobre os nomes internos, não sobre a lista de participantes.
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

import main

falhas = []


def checar(rotulo, obtido, esperado):
    ok = obtido == esperado
    print(f"  {'ok   ' if ok else 'FALHA'} {rotulo:56} obtido={obtido!r}")
    if not ok:
        falhas.append(f"{rotulo}: esperado {esperado!r}, obtido {obtido!r}")


def motivo_de(nome):
    """Roda só a guarda de entrada: nenhuma chamada sai para o Pipedrive."""
    _, motivo, _ = asyncio.run(
        main.encontrar_atividade_da_reuniao(nome, "10/09/2026", "")
    )
    return motivo


def teste_recusa_quem_conduz():
    print("\n=== nome de quem conduz nao vira cliente ===")
    for nome in (
        "Robson Vieira Tavernard De Oliveira",
        "Robson Vieira",
        "robson vieira tavernard",
        "Roberto Righetti Neto",
        "ROBERTO RIGHETTI",
    ):
        checar(f"recusa {nome[:34]!r}", motivo_de(nome), "REUNIAO_INTERNA")


def teste_recusa_saidas_do_tactiq():
    print("\n=== saidas que o Tactiq devolve quando nao ha cliente ===")
    checar("'Reunião interna'", motivo_de("Reunião interna"), "REUNIAO_INTERNA")
    checar("'Reuniao interna' sem acento", motivo_de("Reuniao interna"), "REUNIAO_INTERNA")
    # Já existia e continua valendo, com o motivo que sempre teve.
    checar("'Cliente não identificado'", motivo_de("Cliente não identificado"), "SEM_NOME_CLIENTE")


def teste_nao_recusa_cliente_de_verdade():
    """
    A guarda não pode pegar cliente cujo nome contenha um token interno.

    "Oliveira" e "Vieira" são sobrenomes comuns; recusar por conterem parte do
    nome de quem conduz trocaria um erro raro por um erro frequente.
    """
    print("\n=== cliente de verdade passa pela guarda ===")
    for nome in (
        "Sérgio Paulo Araújo",
        "Roberto Carlos Menezes",        # primeiro nome igual ao do Roberto
        "Ana Paula Vieira",              # sobrenome igual ao do Robson
        "João Oliveira Santos",
        "Robson Carvalho Dias",          # primeiro nome igual, pessoa diferente
    ):
        checar(f"deixa passar {nome[:32]!r}", motivo_de(nome) == "REUNIAO_INTERNA", False)


if __name__ == "__main__":
    teste_recusa_quem_conduz()
    teste_recusa_saidas_do_tactiq()
    teste_nao_recusa_cliente_de_verdade()
    print(f"\n{'FALHOU' if falhas else 'TUDO OK'}")
    for f in falhas:
        print(f"   {f}")
    sys.exit(1 if falhas else 0)
