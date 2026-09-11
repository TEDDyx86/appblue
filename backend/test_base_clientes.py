"""
Testes da Base de Clientes contra as duas planilhas reais.

Rodar: backend/venv/Scripts/python.exe test_base_clientes.py
Não há pytest no projeto — este arquivo é executável e imprime o resultado.
"""

import io
import os
import sys
from datetime import date, datetime

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


from base_clientes.consultas import montar_fila_oportunidade, montar_resumo, RIDERS


def teste_fila():
    print("\n=== fila de oportunidade ===")
    with open(BRUTA, "rb") as f:
        lido = ler_export_mag(f.read())

    clientes = list(lido.clientes.values())
    coberturas = lido.coberturas
    fila = montar_fila_oportunidade(clientes, coberturas)

    checar("cobertura unica: 162 clientes", len(fila["cobertura_unica"]), 162)
    checar("lacuna: todos os clientes com renda", len(fila["maior_lacuna"]), 209)

    # A fila de lacuna e ordenada decrescente por reais, nao filtrada.
    valores = [c["lacuna"] for c in fila["maior_lacuna"]]
    checar("lacuna ordenada decrescente", valores == sorted(valores, reverse=True), True)
    checar("riders conhecidos", len(RIDERS), 3)
    checar("parou de pagar (REMIDO) detectado", len(fila["parou_de_pagar"]) > 0, True)

    resumo = montar_resumo(clientes, coberturas)
    checar("resumo: clientes", resumo["clientes"], 209)
    checar("resumo: coberturas", resumo["coberturas"], 371)
    checar("resumo: capital segurado total",
           round(resumo["capital_segurado_total"]), 216889839)

    # Idade e a que a pessoa TEM, nao a que vai fazer: quem faz aniversario
    # depois de hoje dentro do mes corrente ainda nao somou o ano.
    for a in fila["aniversariantes"]:
        if a["dia"] > date.today().day:
            checar("aniversariante que ainda nao fez: idade nao adiantada",
                   a["idade"] < date.today().year - 1900, True)
            break

    # O MESMO dicionario vindo do Supabase: NUMERIC volta string, DATE volta
    # "1976-05-04". Sem coercao a fila funciona aqui e quebra em producao.
    como_banco = [
        {**c, "renda": str(c.get("renda") or 0),
         "total_capital_segurado": str(c.get("total_capital_segurado") or 0),
         "data_nascimento": (c["data_nascimento"].isoformat()
                             if c.get("data_nascimento") else None)}
        for c in clientes
    ]
    cob_banco = [{**c, "capital_segurado": str(c.get("capital_segurado") or 0)} for c in coberturas]
    fila_banco = montar_fila_oportunidade(como_banco, cob_banco)
    checar("vindo do banco: mesma cobertura unica",
           len(fila_banco["cobertura_unica"]), len(fila["cobertura_unica"]))
    checar("vindo do banco: mesma lacuna",
           len(fila_banco["maior_lacuna"]), len(fila["maior_lacuna"]))
    checar("vindo do banco: mesmos aniversariantes",
           len(fila_banco["aniversariantes"]), len(fila["aniversariantes"]))
    checar("vindo do banco: mesmo capital total",
           round(montar_resumo(como_banco, cob_banco)["capital_segurado_total"]),
           round(resumo["capital_segurado_total"]))


def teste_exportacao():
    print("\n=== exportacao xlsx ===")
    import openpyxl

    from base_clientes.exportacao import gerar_xlsx

    with open(BRUTA, "rb") as f:
        lido = ler_export_mag(f.read())

    # Como o Supabase devolve: NUMERIC e DATE viram texto. O export precisa
    # reconverter, senao a planilha sai com numero que nao soma e data que nao
    # ordena — e o usuario abre o arquivo no Excel para justamente fazer isso.
    cob_banco = [
        {**c,
         "capital_segurado": str(c.get("capital_segurado") or 0),
         "inicio_vigencia": (c["inicio_vigencia"].isoformat()
                             if c.get("inicio_vigencia") else None)}
        for c in lido.coberturas
    ]
    wb = openpyxl.load_workbook(io.BytesIO(gerar_xlsx(list(lido.clientes.values()), cob_banco)))

    checar("abas geradas", wb.sheetnames, ["1_CLIENTES", "2_APÓLICES_E_COBERTURAS"])

    ws = wb["2_APÓLICES_E_COBERTURAS"]
    cabecalho = [c.value for c in ws[1]]
    col_id = cabecalho.index("ID Item Cobertura") + 1
    col_cs = cabecalho.index("Capital Segurado (R$)") + 1
    col_iv = cabecalho.index("Início Vigência") + 1

    ids = {ws.cell(row=l, column=col_id).value for l in range(2, ws.max_row + 1)}
    checar("ID sai como texto", all(isinstance(v, str) for v in ids), True)
    checar("ID sem notacao cientifica", any("e+" in v.lower() for v in ids), False)
    checar("ID de 18 digitos integro", "112023223239210591" in ids, True)
    checar("linhas exportadas", ws.max_row - 1, 371)

    valores_cs = [ws.cell(row=l, column=col_cs).value for l in range(2, ws.max_row + 1)]
    checar("capital segurado e numero (da para somar)",
           all(isinstance(v, (int, float)) for v in valores_cs if v is not None), True)

    datas = [ws.cell(row=l, column=col_iv).value for l in range(2, ws.max_row + 1)]
    checar("inicio de vigencia e data (da para ordenar)",
           all(isinstance(v, (date, datetime)) for v in datas if v is not None), True)


def teste_arquivo_errado_se_explica():
    """
    Mandar a base tratada no lugar do export bruto é o engano provável.

    Os dois arquivos moram na mesma pasta e têm nomes parecidos. Quando isso
    acontece, faltam TODAS as 34 colunas — e listar as 34 é a mensagem menos
    útil possível: o problema não é coluna faltando, é arquivo trocado. A
    listagem continua valendo para o caso real de a MAG renomear uma ou outra.
    """
    print("\n=== recusa explica o arquivo trocado ===")

    # A base tratada é o que a própria aba "Exportar dados" gera.
    from base_clientes.exportacao import gerar_xlsx

    tratada = gerar_xlsx(
        [{"cpf": "07286584707", "nome": "FULANO"}],
        [{"item_contratado": "112023223239210591", "cpf": "07286584707"}],
    )
    try:
        ler_export_mag(tratada)
        checar("recusou a base tratada", False, True)
    except ColunasFaltando as e:
        msg = str(e)
        checar("recusou a base tratada", True, True)
        checar("aponta que e a base tratada", "tratada" in msg.lower(), True)
        checar("diz qual arquivo enviar", "export" in msg.lower(), True)
        # 34 nomes de coluna não ajudam ninguém a entender que trocou o arquivo.
        checar("nao despeja as 34 colunas", msg.count(",") < 10, True)

    # Faltar UMA coluna continua listando a coluna, que é o caso útil.
    cabecalho = [c for c in COLUNAS_COBERTURA] + [
        c for c in COLUNAS_CLIENTE if c not in COLUNAS_COBERTURA
    ]
    cabecalho.remove("TELEFONE CLIENTE")
    try:
        ler_export_mag(_planilha(cabecalho, []))
        checar("recusou por coluna faltando", False, True)
    except ColunasFaltando as e:
        checar("recusou por coluna faltando", True, True)
        checar("cita a coluna que faltou", "TELEFONE CLIENTE" in str(e), True)


if __name__ == "__main__":
    teste_leitura()
    teste_reconciliacao()
    teste_robustez()
    teste_fila()
    teste_exportacao()
    teste_arquivo_errado_se_explica()
    print(f"\n{'FALHOU' if falhas else 'TUDO OK'}")
    for f in falhas:
        print(f"   {f}")
    sys.exit(1 if falhas else 0)
