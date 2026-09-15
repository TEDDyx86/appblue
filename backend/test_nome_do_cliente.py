"""
Quem decide o cliente da reunião, e quem grava o negócio no briefing.

Rodar: backend/venv/Scripts/python.exe test_nome_do_cliente.py
Não há pytest no projeto — este arquivo é executável e imprime o resultado.

Dois problemas do mesmo bloco:

1. A mesma pergunta — "de quem é esta reunião?" — era respondida em dois
   lugares com regras opostas. O vínculo usa limiar, comparação por token e
   desempate; um bloco anterior em `process_new_transcription` pegava
   `person_results[0]` e `deals[0]`, sem nenhum critério, e gravava em
   `pipedrive.deal_id` — que é o campo que a tela lê para dizer "Vinculado".
   Resultado medido: 3 de 20 transcrições NÃO vinculadas apareciam como
   vinculadas, entre elas uma reunião interna recusada por REUNIAO_INTERNA.

2. Quando o briefing não traz cliente utilizável, o nome do arquivo traz. Ele é
   a saída do passo do Tactiq cuja única função é acertar o cliente, e que tem
   a regra "nunca quem conduz" embutida. Confere com o briefing em 18 de 20, e
   nos dois que divergem é o arquivo que está certo.
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
    print(f"  {'ok   ' if ok else 'FALHA'} {rotulo:60} obtido={obtido!r}")
    if not ok:
        falhas.append(f"{rotulo}: esperado {esperado!r}, obtido {obtido!r}")


def teste_nome_vem_do_briefing():
    print("\n=== o briefing traz cliente utilizavel ===")
    nome, origem = main.nome_do_cliente(
        {"dados_cliente": {"nome": "Karinne Pereira de Siqueira"}},
        "Karinne Pereira De Siqueira | R1 | Gestão Patrimonial",
    )
    checar("usa o nome do briefing", nome, "Karinne Pereira de Siqueira")
    checar("origem registrada", origem, "briefing")


def teste_cai_para_o_nome_do_arquivo():
    """O caso do Rafael: o briefing nomeou quem conduz, o arquivo acertou."""
    print("\n=== briefing nomeou quem conduz ===")
    nome, origem = main.nome_do_cliente(
        {"dados_cliente": {"nome": "Robson Vieira Tavernard De Oliveira"}},
        "Rafael Menegatto Rodrigues | Robson <> Menegatto",
    )
    checar("recupera pelo nome do arquivo", nome, "Rafael Menegatto Rodrigues")
    checar("origem registrada", origem, "nome_do_arquivo")

    print("\n=== briefing veio vazio ===")
    nome, origem = main.nome_do_cliente(
        {"dados_cliente": {"nome": ""}}, "Aldecina Cruz | Aldecina"
    )
    checar("recupera pelo nome do arquivo", nome, "Aldecina Cruz")
    checar("origem registrada", origem, "nome_do_arquivo")


def teste_arquivo_tambem_ruim():
    """
    O fallback não pode inventar. O caso da 'Tina': nem o corpo nem o arquivo
    trazem cliente, e admitir isso é melhor que escolher qualquer coisa.
    """
    print("\n=== nem o briefing nem o arquivo servem ===")
    for briefing_nome, titulo, porque in (
        ("", "Tavernard De Oliveira | alteração forma de pagamento", "arquivo traz quem conduz"),
        ("Roberto Righetti Neto", "Roberto Righetti Neto | Roberto <> Robson", "reuniao interna"),
        ("", "Cliente não identificado | Bate-papo", "Tactiq nao identificou"),
        ("", "Reunião interna | Roberto <> Robson", "Tactiq declarou interna"),
        ("", "", "sem titulo nenhum"),
    ):
        nome, origem = main.nome_do_cliente({"dados_cliente": {"nome": briefing_nome}}, titulo)
        checar(f"{porque}", (nome, origem), ("", "nenhum"))


def teste_titulo_sem_separador():
    """Nem todo título tem '|'. Sem separador, não há segmento de cliente."""
    print("\n=== titulo sem o separador ===")
    nome, origem = main.nome_do_cliente(
        {"dados_cliente": {"nome": ""}}, "Reunião de alinhamento semanal"
    )
    checar("nao usa o titulo inteiro como nome", origem, "nenhum")


def teste_briefing_nao_grava_mais_negocio_sem_vinculo():
    """
    Só `gravar_vinculo_no_briefing` escreve `deal_id`, e só quando vinculou.

    Antes, um bloco anterior gravava o primeiro negócio do primeiro resultado
    da busca — e a tela passava a mostrar "Vinculado" para uma reunião que o
    vínculo tinha recusado.
    """
    print("\n=== negocio so e gravado quando o vinculo da certo ===")
    b = {"pipedrive": {}}
    main.gravar_vinculo_no_briefing(b, {
        "status": "nao_vinculado", "motivo": "REUNIAO_INTERNA", "detalhe": {"deal_id": 614},
    })
    checar("recusado nao grava deal_id", (b["pipedrive"]).get("deal_id"), None)
    checar("recusado nao grava person_id", (b["pipedrive"]).get("person_id"), None)

    b2 = {"pipedrive": {}}
    main.gravar_vinculo_no_briefing(b2, {
        "status": "vinculado", "motivo": "OK", "activity_id": "1",
        "activity_origem": "existente", "detalhe": {"deal_id": 622},
    })
    checar("vinculado grava deal_id", (b2["pipedrive"]).get("deal_id"), "622")


if __name__ == "__main__":
    teste_nome_vem_do_briefing()
    teste_cai_para_o_nome_do_arquivo()
    teste_arquivo_tambem_ruim()
    teste_titulo_sem_separador()
    teste_briefing_nao_grava_mais_negocio_sem_vinculo()
    print(f"\n{'FALHOU' if falhas else 'TUDO OK'}")
    for f in falhas:
        print(f"   {f}")
    sys.exit(1 if falhas else 0)
