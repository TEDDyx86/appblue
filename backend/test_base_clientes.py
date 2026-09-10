"""
Testes da Base de Clientes contra as duas planilhas reais.

Rodar: backend/venv/Scripts/python.exe test_base_clientes.py
Não há pytest no projeto — este arquivo é executável e imprime o resultado.
"""

import io
import os
import sys

if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from base_clientes.planilha import ler_export_mag
from base_clientes.reconciliacao import calcular_diff

RAIZ = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
BRUTA = os.path.join(RAIZ, "PRODUTOS CONTRATADOS POR PROPOSTA - VIDA INDIVIDUAL (16).xlsx")

falhas = []


def checar(rotulo, obtido, esperado):
    ok = obtido == esperado
    print(f"  {'ok   ' if ok else 'FALHA'} {rotulo:52} obtido={obtido!r}")
    if not ok:
        falhas.append(f"{rotulo}: esperado {esperado!r}, obtido {obtido!r}")


def teste_leitura():
    print("\n=== leitura e normalizacao ===")
    with open(BRUTA, "rb") as f:
        r = ler_export_mag(f.read())

    checar("coberturas lidas", len(r.coberturas), 371)
    checar("clientes agregados", len(r.clientes), 209)
    checar("linhas descartadas (vazias no rodape)", r.linhas_descartadas, 3)

    c = r.coberturas[0]
    checar("item_contratado e str", isinstance(c["item_contratado"], str), True)
    checar("item_contratado sem notacao cientifica", "e+" in c["item_contratado"], False)
    checar("item_contratado integro", c["item_contratado"], "112023223239210591")
    checar("cpf com 11 digitos", len(c["cpf"]), 11)
    checar("cpf com zero a esquerda", c["cpf"], "07286584707")

    cli = r.clientes["07286584707"]
    checar("agregado: qtd_coberturas", cli["qtd_coberturas"], 1)
    checar("agregado: capital segurado", round(cli["total_capital_segurado"], 2), 456902.55)


def teste_reconciliacao():
    print("\n=== reconciliacao ===")
    with open(BRUTA, "rb") as f:
        lido = ler_export_mag(f.read())

    # Base vazia: tudo é novo.
    d = calcular_diff(lido, coberturas_atuais={}, clientes_atuais={})
    checar("base vazia: novos", len(d["novos"]), 371)
    checar("base vazia: alterados", len(d["alterados"]), 0)
    checar("base vazia: inalterados", d["inalterados"], 0)

    # Idempotência: importar de novo o que já está gravado não muda nada.
    atuais = {c["item_contratado"]: dict(c) for c in lido.coberturas}
    cli_atuais = {k: dict(v) for k, v in lido.clientes.items()}
    d2 = calcular_diff(lido, coberturas_atuais=atuais, clientes_atuais=cli_atuais)
    checar("reimportacao: novos", len(d2["novos"]), 0)
    checar("reimportacao: alterados", len(d2["alterados"]), 0)
    checar("reimportacao: inalterados", d2["inalterados"], 371)
    checar("reimportacao: sumidos", len(d2["sumidos"]), 0)

    # Um campo comparado muda -> vira alterado.
    alterada = {k: dict(v) for k, v in atuais.items()}
    alvo = lido.coberturas[0]["item_contratado"]
    alterada[alvo]["status_cobertura"] = "REMIDO - D02"
    d3 = calcular_diff(lido, coberturas_atuais=alterada, clientes_atuais=cli_atuais)
    checar("status mudou: alterados", len(d3["alterados"]), 1)
    checar("status mudou: campo certo",
           list(d3["alterados"][0]["campos"]), ["status_cobertura"])

    # Um campo NÃO comparado muda -> continua inalterado (evita ruído semanal).
    ruido = {k: dict(v) for k, v in atuais.items()}
    ruido[alvo]["am"] = "AM9999"
    d4 = calcular_diff(lido, coberturas_atuais=ruido, clientes_atuais=cli_atuais)
    checar("campo nao comparado: alterados", len(d4["alterados"]), 0)

    # Item que existia e não veio -> sumido, e nunca apagado.
    com_extra = {k: dict(v) for k, v in atuais.items()}
    com_extra["999999999999999999"] = {"item_contratado": "999999999999999999", "cpf": "00000000000"}
    d5 = calcular_diff(lido, coberturas_atuais=com_extra, clientes_atuais=cli_atuais)
    checar("sumido detectado", len(d5["sumidos"]), 1)


if __name__ == "__main__":
    teste_leitura()
    teste_reconciliacao()
    print(f"\n{'FALHOU' if falhas else 'TUDO OK'}")
    for f in falhas:
        print(f"   {f}")
    sys.exit(1 if falhas else 0)
