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

import openpyxl

from base_clientes.planilha import (
    ler_export_mag, COLUNAS_COBERTURA, COLUNAS_CLIENTE, CabecalhoAmbiguo, ColunasFaltando,
)
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

    # Dados de contato desta planilha foram medidos como 100% completos: o
    # esperado é zero avisos. Se der diferente, é achado sobre os dados, não bug
    # do teste — não troque o valor esperado.
    checar("avisos de leitura na planilha real", len(r.avisos), 0)


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


def _cabecalho_completo():
    """
    Todas as colunas que o leitor usa, sem repetir CPF/SEGURADO — que aparecem
    nos dois mapeamentos (cobertura e cliente) mas são uma coluna só na planilha.
    """
    vistas = []
    for col in list(COLUNAS_COBERTURA) + list(COLUNAS_CLIENTE):
        if col not in vistas:
            vistas.append(col)
    return vistas


def _planilha(cabecalho, linhas):
    """Monta um .xlsx mínimo em memória, com aba 'Export', para os testes de robustez."""
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Export"
    ws.append(cabecalho)
    for linha in linhas:
        ws.append(linha)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def teste_robustez():
    print("\n=== robustez (planilhas minimas em memoria, sem depender do arquivo real) ===")
    cabecalho = _cabecalho_completo()

    # 1) ITEM CONTRATADO preenchido e CPF vazio: descarta a linha, avisa, e nao
    # cria cliente de chave None juntando coberturas de gente diferente.
    linha = [None] * len(cabecalho)
    linha[cabecalho.index("ITEM CONTRATADO")] = "999888777666555444"
    r = ler_export_mag(_planilha(cabecalho, [linha]))
    checar("sem cpf: nao cria cliente de chave None", None in r.clientes, False)
    checar("sem cpf: coberturas lidas", len(r.coberturas), 0)
    checar("sem cpf: linhas descartadas", r.linhas_descartadas, 1)
    checar("sem cpf: gerou aviso", len(r.avisos) >= 1, True)

    # 2) cabecalho com nome duplicado entre colunas usadas: recusa, nao adivinha
    # qual das duas colunas ler.
    cabecalho_dup = cabecalho + ["CPF"]
    try:
        ler_export_mag(_planilha(cabecalho_dup, []))
        checar("cabecalho duplicado: levanta CabecalhoAmbiguo", "nao levantou nada", "CabecalhoAmbiguo")
    except CabecalhoAmbiguo:
        checar("cabecalho duplicado: levanta CabecalhoAmbiguo", True, True)

    # 3) falta coluna de cliente (TELEFONE CLIENTE): recusa citando a coluna.
    cabecalho_sem_telefone = [c for c in cabecalho if c != "TELEFONE CLIENTE"]
    try:
        ler_export_mag(_planilha(cabecalho_sem_telefone, []))
        checar("falta coluna cliente: levanta ColunasFaltando", "nao levantou nada", "ColunasFaltando")
    except ColunasFaltando as e:
        checar("falta coluna cliente: levanta ColunasFaltando", True, True)
        checar("falta coluna cliente: mensagem cita a coluna", "TELEFONE CLIENTE" in str(e), True)

    # 4) valor numerico ilegivel: vira aviso, nao derruba a leitura nem vira null calado.
    linha_ilegivel = [None] * len(cabecalho)
    linha_ilegivel[cabecalho.index("ITEM CONTRATADO")] = "111222333444555666"
    linha_ilegivel[cabecalho.index("CPF")] = "12345678901"
    linha_ilegivel[cabecalho.index("CAPITAL SEGURADO")] = "abc"
    r2 = ler_export_mag(_planilha(cabecalho, [linha_ilegivel]))
    checar("numero ilegivel: leitura nao derruba", len(r2.coberturas), 1)
    checar("numero ilegivel: campo vira None", r2.coberturas[0]["capital_segurado"], None)
    checar("numero ilegivel: vira aviso", any("capital_segurado" in a for a in r2.avisos), True)


if __name__ == "__main__":
    teste_leitura()
    teste_reconciliacao()
    teste_robustez()
    print(f"\n{'FALHOU' if falhas else 'TUDO OK'}")
    for f in falhas:
        print(f"   {f}")
    sys.exit(1 if falhas else 0)
