"""
Consulta de Condições Gerais na SUSEP.

Rodar: backend/venv/Scripts/python.exe test_susep.py
Não há pytest no projeto — este arquivo é executável e imprime o resultado.

Divide-se em duas partes:

  - **offline**: extração do número do processo e leitura da tabela, contra
    HTML fixo neste arquivo. Roda sempre, não depende da SUSEP estar no ar.
  - **online**: uma consulta e um download reais. Só roda com `--online`,
    porque bate num site público de terceiro e não deve ser exercitada a cada
    execução.

As apólices de exemplo ficam em `Treinamento/`, fora do git (PII).
"""

import io
import os
import re
import sys

if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)

from susep.consulta import (
    extrair_processo,
    ler_versoes_do_html,
    versao_vigente,
)

PASTA_APOLICES = os.path.join(AQUI, "..", "Treinamento")

falhas = []


def checar(rotulo, obtido, esperado):
    ok = obtido == esperado
    print(f"  {'ok   ' if ok else 'FALHA'} {rotulo:52} obtido={obtido!r}")
    if not ok:
        falhas.append(f"{rotulo}: esperado {esperado!r}, obtido {obtido!r}")


# Duas linhas reais da tabela da SUSEP, encurtadas. A vigente é a de data-fim
# vazia — não a primeira, de propósito, para o teste provar que o critério é o
# campo e não a posição.
HTML_TABELA = """
<table class="table"><tbody>
<tr class="item">
  <td><a class="linkDownloadRelatorio" onclick="location.href='/safe/menumercado/REP2/Produto.aspx/DownloadConsultaPublica/481108'">
      <span>CG_antiga.pdf</span>&nbsp;Download</a></td>
  <td>05/11/2025</td><td>26/11/2025</td>
</tr>
<tr class="altItem">
  <td><a class="linkDownloadRelatorio" onclick="location.href='/safe/menumercado/REP2/Produto.aspx/DownloadConsultaPublica/482289'">
      <span>CG_vigente.pdf</span>&nbsp;Download</a></td>
  <td>27/11/2025</td><td></td>
</tr>
</tbody></table>
"""


def teste_extrair_numero_do_processo():
    print("\n=== extracao do numero do processo ===")

    checar("formato padrao", extrair_processo("PROCESSO SUSEP Nº 15414.902186/2014-52."),
           "15414.902186/2014-52")
    checar("com ano de 2 digitos", extrair_processo("processo 15414.002186/99-11"),
           "15414.002186/99-11")
    checar("formato antigo com hifen", extrair_processo("Processo SUSEP 101-12345/95"),
           "101-12345/95")

    # A armadilha real: a apólice traz "Cód. SUSEP: 202011542", que é código de
    # corretora. Procurar a palavra SUSEP pegaria esse número.
    codigo_corretora = "REDE DE CORR DE SEGUROS Código: 156210 Cód. SUSEP: 202011542 Endereço:"
    checar("ignora o codigo da corretora", extrair_processo(codigo_corretora), None)

    # CNPJ tem pontuação parecida e aparece na mesma página.
    checar("ignora CNPJ", extrair_processo("CNPJ: 04.529.055/0001-44"), None)
    checar("texto sem processo", extrair_processo("apolice sem numero"), None)


def teste_ler_tabela():
    print("\n=== leitura da tabela de versoes ===")
    versoes = ler_versoes_do_html(HTML_TABELA)

    checar("quantas versoes", len(versoes), 2)
    checar("id da primeira", versoes[0]["download_id"], "481108")
    checar("nome da primeira", versoes[0]["nome_arquivo"], "CG_antiga.pdf")
    checar("inicio da primeira", versoes[0]["data_inicio"], "05/11/2025")
    checar("fim da primeira", versoes[0]["data_fim"], "26/11/2025")
    checar("primeira nao e vigente", versoes[0]["vigente"], False)
    checar("segunda e vigente", versoes[1]["vigente"], True)
    checar("fim da vigente fica vazio", versoes[1]["data_fim"], None)

    # O critério é a data-fim vazia, não "a primeira da lista". A automação
    # antiga pegava rows[0] e teria baixado a versão já substituída.
    v = versao_vigente(versoes)
    checar("vigente escolhida pelo campo, nao pela ordem", v["download_id"], "482289")
    checar("sem nenhuma vigente devolve None", versao_vigente([versoes[0]]), None)
    checar("lista vazia devolve None", versao_vigente([]), None)


def teste_apolices_reais():
    print("\n=== apolices de exemplo ===")
    import pymupdf

    esperado = {
        "APOLICE_TESTE1.pdf": "15414.900142/2017-31",
        "APOLICE_TESTE2.pdf": "15414.902186/2014-52",
    }
    for arquivo, numero in esperado.items():
        caminho = os.path.join(PASTA_APOLICES, arquivo)
        if not os.path.exists(caminho):
            print(f"  --    {arquivo} ausente (fica fora do git); pulando")
            continue
        doc = pymupdf.open(caminho)
        texto = "".join(p.get_text() for p in doc)
        checar(f"{arquivo}", extrair_processo(texto), numero)


def teste_online():
    """Uma consulta e um download de verdade. Só com --online."""
    print("\n=== consulta real na SUSEP (rede) ===")
    from susep.consulta import baixar_versao, consultar_processo

    versoes = consultar_processo("15414.902186/2014-52")
    checar("achou versoes", len(versoes) > 5, True)
    checar("exatamente uma vigente", sum(1 for v in versoes if v["vigente"]), 1)

    v = versao_vigente(versoes)
    conteudo, nome = baixar_versao(v["download_id"])
    checar("veio um PDF", conteudo[:5], b"%PDF-")
    checar("nome veio do content-disposition", nome.lower().endswith(".pdf"), True)
    checar("tamanho plausivel", len(conteudo) > 100_000, True)
    print(f"        {nome}  {len(conteudo) / 1024:.1f} KB")


if __name__ == "__main__":
    teste_extrair_numero_do_processo()
    teste_ler_tabela()
    teste_apolices_reais()
    if "--online" in sys.argv:
        teste_online()
    else:
        print("\n(use --online para exercitar a consulta real na SUSEP)")
    print(f"\n{'FALHOU' if falhas else 'TUDO OK'}")
    for f in falhas:
        print(f"   {f}")
    sys.exit(1 if falhas else 0)
