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


if __name__ == "__main__":
    teste_leitura()
    print(f"\n{'FALHOU' if falhas else 'TUDO OK'}")
    for f in falhas:
        print(f"   {f}")
    sys.exit(1 if falhas else 0)
