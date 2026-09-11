"""
Extração da ficha cadastral da XP, contra os PDFs reais de `Treinamento/`.

Rodar: backend/venv/Scripts/python.exe test_ficha_cadastral.py
Não há pytest no projeto — este arquivo é executável e imprime o resultado.

Os PDFs são formulários AcroForm com 68 campos nomeados (`Cliente_Nome_Pai`,
`Cliente_Endereco_Cidade`, ...). O parser antigo ignorava isso e adivinhava por
faixa de coordenada y/x, o que produzia erro sistemático:

  - pai e mãe vinham colados no mesmo campo, e `nome_pai` ficava sempre vazio;
  - `nome_conjuge` recebia o CPF do cônjuge, não o nome;
  - "SAO PAULO" virava bairro "JARDIM PAULISTA SAO" + cidade "PAULO";
  - "ENGENHEIRO CIVIL / DIRETOR TECNICO" virava "ENGENHEIRO" / "TECNICO";
  - `sexo` nunca era preenchido (é caixa de seleção, não texto).

**Este arquivo não contém dado pessoal.** Valores exatos são conferidos só no
PDF de dados fictícios. Nos PDFs reais valem invariantes — que os campos existem,
que pai e mãe são pessoas diferentes, que a cidade não foi partida ao meio.
Os PDFs estão no .gitignore e não acompanham o repositório: sem eles, o teste
avisa e sai sem falhar.
"""

import io
import os
import re
import sys

if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)

from dotenv import load_dotenv

load_dotenv(os.path.join(AQUI, ".env"))

import httpx

import main

PASTA = os.path.join(AQUI, "..", "Treinamento")
FICTICIO = "ficha-cadastral-dados-ficticios.pdf"

falhas = []


def checar(rotulo, obtido, esperado):
    ok = obtido == esperado
    print(f"  {'ok   ' if ok else 'FALHA'} {rotulo:48} obtido={obtido!r}")
    if not ok:
        falhas.append(f"{rotulo}: esperado {esperado!r}, obtido {obtido!r}")


def _ler(nome):
    with open(os.path.join(PASTA, nome), "rb") as f:
        return main.parse_xp_ficha_cadastral(f.read())


def teste_valores_exatos():
    """Gabarito completo, conferido campo a campo no PDF de dados fictícios."""
    print("\n=== valores exatos (PDF ficticio) ===")
    r = _ler(FICTICIO)

    # O código da conta vem "99999999-9"; o dígito depois do hífen não interessa.
    checar("codigo_xp sem o digito apos o hifen", r["codigo_xp"], "99999999")
    checar("nome_completo", r["nome_completo"], "JOAO CARLOS PEREIRA DA SILVA")
    checar("cpf", r["cpf"], "111.444.777-35")
    checar("nome_pai", r["nome_pai"], "ANTONIO PEREIRA DA SILVA")
    checar("nome_mae", r["nome_mae"], "MARIA APARECIDA PEREIRA")
    checar("data_nascimento", r["data_nascimento"], "05/03/1985")
    checar("data_nascimento_iso", r["data_nascimento_iso"], "1985-03-05")
    checar("naturalidade", r["naturalidade"], "CAMPINAS")
    checar("sexo", r["sexo"], "Masculino")
    checar("estado_civil", r["estado_civil"], "Casado(a)")
    checar("nome_conjuge e nome, nao CPF", r["nome_conjuge"], "ANA BEATRIZ MARTINS PEREIRA")
    checar("cpf_conjuge", r["cpf_conjuge"], "529.982.247-25")
    checar("documento_identidade", r["documento_identidade"], "RG 12345678 SSP SP 10/06/2010")
    checar("email em minusculas", r["email"], "joao.silva@example.com")
    checar("telefone", r["telefone"], "(11) 40041234")
    checar("celular", r["celular"], "(11) 999998888")
    checar("logradouro com numero e complemento",
           r["logradouro"], "RUA DAS ACACIAS, 150, APTO 72")
    checar("bairro", r["bairro"], "JARDIM PAULISTA")
    checar("cidade com duas palavras inteira", r["cidade"], "SAO PAULO")
    checar("uf", r["uf"], "SP")
    checar("cep", r["cep"], "01415-000")
    # Formato acordado: rua e numero, cidade, UF. Sem bairro e sem CEP.
    checar("endereco_completo", r["endereco_completo"],
           "RUA DAS ACACIAS, 150, APTO 72, SAO PAULO - SP")
    checar("endereco sem bairro", "JARDIM PAULISTA" in (r["endereco_completo"] or ""), False)
    checar("endereco sem cep", "01415-000" in (r["endereco_completo"] or ""), False)
    checar("profissao completa", r["profissao"], "ENGENHEIRO CIVIL")
    checar("ocupacao completa", r["ocupacao"], "DIRETOR TECNICO")
    checar("empresa_nome", r["empresa_nome"], "CONSTRUTORA MODELO LTDA")
    checar("empresa_cnpj", r["empresa_cnpj"], "11.222.333/0001-81")
    checar("renda numerica", r["renda_mensal"], 25000.0)
    checar("renda formatada em pt-BR", r["renda_mensal_fmt"], "R$ 25.000,00")
    checar("dados_bancarios", r["dados_bancarios"], "348 - BCO XP S.A. Ag 0001 Conta 12345-6")


def teste_invariantes_nos_reais():
    """
    Nos PDFs reais não se confere valor — confere-se que o erro sumiu.

    Cada asserção aqui corresponde a um dos defeitos que o parser por coordenada
    cometia, sem precisar escrever o dado de ninguém neste arquivo.
    """
    print("\n=== invariantes (PDFs reais, sem expor dado) ===")
    reais = [n for n in sorted(os.listdir(PASTA))
             if n.lower().endswith(".pdf") and n != FICTICIO]
    checar("ha PDFs reais para conferir", len(reais) > 0, True)

    for nome in reais:
        r = _ler(nome)
        rotulo = nome[:18]

        checar(f"[{rotulo}] codigo_xp so digitos",
               bool(re.fullmatch(r"\d+", r["codigo_xp"] or "")), True)
        checar(f"[{rotulo}] cpf no formato",
               bool(re.fullmatch(r"\d{3}\.\d{3}\.\d{3}-\d{2}", r["cpf"] or "")), True)
        checar(f"[{rotulo}] nome_completo preenchido", bool(r["nome_completo"]), True)
        checar(f"[{rotulo}] mae preenchida", bool(r["nome_mae"]), True)
        # O bug antigo colava os dois no mesmo campo.
        checar(f"[{rotulo}] pai e mae nao sao o mesmo texto",
               r["nome_pai"] == r["nome_mae"] and bool(r["nome_mae"]), False)
        # nome_conjuge recebia o CPF.
        checar(f"[{rotulo}] conjuge nao e um CPF",
               bool(re.fullmatch(r"[\d.\-]+", r["nome_conjuge"] or "x")), False)
        checar(f"[{rotulo}] uf com 2 letras", len(r["uf"] or ""), 2)
        # "SAO PAULO" virava cidade "PAULO".
        checar(f"[{rotulo}] cidade nao termina em UF solta",
               bool(re.search(r"\s[A-Z]{2}$", r["cidade"] or "")), False)
        checar(f"[{rotulo}] sexo reconhecido", r["sexo"] in ("Masculino", "Feminino"), True)
        checar(f"[{rotulo}] renda em pt-BR",
               bool(re.fullmatch(r"R\$ [\d.]+,\d{2}", r["renda_mensal_fmt"] or "")), True)


def teste_ficha_achatada_se_declara():
    """
    Ficha sem formulário: a leitura cai no parser por coordenadas.

    Esse caminho erra — pai e mãe colados, cidade partida — e errava **em
    silêncio**, o que é o pior modo de falha: quem confere não tem como saber
    que deveria desconfiar. Não é hipotético: basta imprimir a ficha para PDF ou
    recebê-la digitalizada e o formulário some.

    A ficha achatada é gerada aqui com `bake()`, que é exatamente o que uma
    impressão faz: converte os campos em conteúdo de página.
    """
    print("\n=== ficha sem formulario (impressa/digitalizada) ===")
    import pymupdf

    with open(os.path.join(PASTA, FICTICIO), "rb") as f:
        original = f.read()

    checar("com formulario: origem declarada",
           main.parse_xp_ficha_cadastral(original)["origem_extracao"], "formulario")

    doc = pymupdf.open(stream=original, filetype="pdf")
    doc.bake()
    achatada = doc.tobytes()
    checar("achatada nao tem mais formulario",
           len(list(pymupdf.open(stream=achatada, filetype="pdf")[0].widgets() or [])), 0)

    r = main.parse_xp_ficha_cadastral(achatada)
    checar("sem formulario: origem declarada", r["origem_extracao"], "aproximada")
    # Ainda precisa extrair alguma coisa: é reserva, não desistência.
    checar("ainda acha o nome", r["nome_completo"], "JOAO CARLOS PEREIRA DA SILVA")
    checar("ainda acha o cpf", r["cpf"], "111.444.777-35")
    # A regra do código da conta vale nos dois caminhos.
    checar("codigo_xp sem o digito tambem aqui",
           bool(re.fullmatch(r"\d+", r["codigo_xp"] or "")), True)


def teste_sync_usa_v1():
    """
    A gravação da pessoa tem que sair na v1, com PUT.

    O payload é v1 do começo ao fim: campo customizado nas chaves de primeiro
    nível, contato em `email`/`phone`. A v2 quer `custom_fields` aninhado e
    `emails`/`phones`, e não aceita PUT — devolve 405 ERR_METHOD_NOT_ALLOWED.
    Criar pela v2 era pior que o 405: não dava erro e a pessoa nascia só com o
    nome, porque os campos customizados eram ignorados em silêncio.

    Nada sai para o Pipedrive aqui: o cliente HTTP é dublado.
    """
    print("\n=== gravacao da pessoa: v1 e PUT ===")
    import asyncio

    chamadas = []

    class _Resp:
        status_code = 200

        @staticmethod
        def json():
            return {"success": True, "data": {"id": 4242}}

    class _Cliente:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def put(self, url, **kw):
            chamadas.append(("PUT", url, kw.get("json") or {}))
            return _Resp()

        async def post(self, url, **kw):
            chamadas.append(("POST", url, kw.get("json") or {}))
            return _Resp()

        async def get(self, url, **kw):
            return _Resp()

    class _Q:
        def __getattr__(self, _):
            return lambda *a, **k: self

        def execute(self):
            class R:
                data = [{"role": "admin"}]

            return R()

    class _SB:
        def table(self, _):
            return _Q()

    req = main.SyncPersonFichaRequest(
        person_id="777",
        create_new=False,
        nome_completo="FULANO DE TESTE",
        cpf="111.444.777-35",
        endereco_completo="RUA X, 1, SAO PAULO - SP",
        codigo_xp="8480811",
        custom_field_mapping={"cpf": "chave_cpf", "endereco_completo": "chave_end",
                              "codigo_xp": "chave_xp"},
        create_history_activity=False,
    )

    originais = (httpx.AsyncClient, main.supabase)
    httpx.AsyncClient = lambda *a, **k: _Cliente()
    main.supabase = _SB()
    try:
        asyncio.run(main.sync_person_ficha_endpoint(req, user={"sub": "u1"}))
    except Exception as e:
        print(f"  (rota terminou com {type(e).__name__}, o que importa e a chamada HTTP)")
    finally:
        httpx.AsyncClient, main.supabase = originais

    gravacoes = [c for c in chamadas if c[0] in ("PUT", "POST")]
    checar("houve uma gravacao de pessoa", len(gravacoes) >= 1, True)
    if gravacoes:
        metodo, url, corpo = gravacoes[0]
        checar("metodo PUT", metodo, "PUT")
        checar("url na v1", "/v1/persons/" in url, True)
        checar("nao usa a v2", "/api/v2/" in url, False)
        # Campo customizado no topo é o formato v1; na v2 iria em custom_fields.
        checar("campo customizado no primeiro nivel", corpo.get("chave_cpf"), "111.444.777-35")
        checar("endereco mapeado", corpo.get("chave_end"), "RUA X, 1, SAO PAULO - SP")
        checar("codigo xp mapeado", corpo.get("chave_xp"), "8480811")
        checar("sem custom_fields aninhado", "custom_fields" in corpo, False)


if __name__ == "__main__":
    if not os.path.isdir(PASTA):
        print(f"Pasta {PASTA} ausente — os PDFs não acompanham o repositório.")
        sys.exit(0)
    teste_valores_exatos()
    teste_invariantes_nos_reais()
    teste_ficha_achatada_se_declara()
    teste_sync_usa_v1()
    print(f"\n{'FALHOU' if falhas else 'TUDO OK'}")
    for f in falhas:
        print(f"   {f}")
    sys.exit(1 if falhas else 0)
