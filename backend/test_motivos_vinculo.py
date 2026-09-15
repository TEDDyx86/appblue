"""
Os motivos do vínculo e seus textos na tela não podem sair de sincronia.

Rodar: backend/venv/Scripts/python.exe test_motivos_vinculo.py
Não há pytest no projeto — este arquivo é executável e imprime o resultado.

O problema: o backend devolve um código (`COMPATIBILIDADE_BAIXA`) e
`MotivoVinculo.tsx` traduz para uma frase. São arquivos diferentes, em
linguagens diferentes, sem vínculo declarado. Quando divergem **nada falha** —
o usuário é que vê o código cru na tela.

Não é grave: ninguém perde dado. É frequente, que é o problema. Foram quatro
motivos novos em um único dia de trabalho, e a única defesa era lembrar de ler o
CLAUDE.md.

Mesma ideia do `assert` que já guarda `FERRAMENTAS` x `EXECUTORES` em
`assistente.py`: transformar "lembrar" em "não passa".
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

import main

TELA = os.path.join(AQUI, "..", "frontend", "src", "components", "MotivoVinculo.tsx")
FONTE = os.path.join(AQUI, "main.py")

falhas = []


def checar(rotulo, obtido, esperado):
    ok = obtido == esperado
    print(f"  {'ok   ' if ok else 'FALHA'} {rotulo:56} obtido={obtido!r}")
    if not ok:
        falhas.append(f"{rotulo}: esperado {esperado!r}, obtido {obtido!r}")


def motivos_no_codigo():
    """
    Varre o `main.py` atrás de literais com cara de motivo.

    É heurística — regex sobre fonte — e fica de propósito no teste, não em
    produção: um falso positivo aqui vira teste vermelho, que alguém vê, em vez
    de comportamento estranho em silêncio.

    As duas formas que o código usa:
        return None, "MOTIVO", detalhe
        {"motivo": "MOTIVO", ...}
    """
    fonte = io.open(FONTE, encoding="utf-8").read()

    # Comentário não é código. Sem isto, o exemplo escrito no comentário da
    # própria constante — `return None, "MOTIVO", detalhe` — era varrido como se
    # fosse um motivo de verdade.
    fonte = "\n".join(l for l in fonte.splitlines() if not l.lstrip().startswith("#"))

    # E o próprio dicionário sai da varredura: ele é a resposta, não a pergunta.
    inicio = fonte.find("MOTIVOS_VINCULO = {")
    fim = fonte.find("}", inicio)
    sem_a_constante = fonte[:inicio] + fonte[fim:]

    achados = set(re.findall(r'"motivo":\s*"([A-Z_]{2,})"', sem_a_constante))
    achados |= set(re.findall(r'return None,\s*"([A-Z_]{2,})"', sem_a_constante))
    return achados


def textos_na_tela():
    return set(re.findall(r"^  ([A-Z_]{2,}):", io.open(TELA, encoding="utf-8").read(), re.M))


def teste_codigo_dentro_da_constante():
    print("\n=== todo motivo usado no codigo esta declarado ===")
    nao_declarados = sorted(motivos_no_codigo() - set(main.MOTIVOS_VINCULO))
    checar("nenhum motivo fora de MOTIVOS_VINCULO", nao_declarados, [])


def teste_constante_e_usada():
    """Motivo declarado e nunca usado é resíduo — engana quem lê depois."""
    print("\n=== todo motivo declarado e usado no codigo ===")
    orfaos = sorted(set(main.MOTIVOS_VINCULO) - motivos_no_codigo())
    checar("nenhum motivo declarado sem uso", orfaos, [])


def teste_tela_traduz_todos():
    print("\n=== todo motivo tem texto na tela ===")
    precisam = set(main.MOTIVOS_VINCULO) - main.MOTIVOS_SEM_TEXTO_NA_TELA
    sem_texto = sorted(precisam - textos_na_tela())
    checar("nenhum motivo apareceria cru para o usuario", sem_texto, [])


def teste_sem_traducao_orfa():
    """Texto na tela para motivo que não existe mais também é dívida."""
    print("\n=== nenhuma traducao sobrando ===")
    orfas = sorted(textos_na_tela() - set(main.MOTIVOS_VINCULO))
    checar("nenhuma traducao sem motivo correspondente", orfas, [])


def teste_a_excecao_e_deliberada():
    print("\n=== a excecao do OK ===")
    checar("OK e a unica excecao", main.MOTIVOS_SEM_TEXTO_NA_TELA, {"OK"})
    checar("e ele esta declarado", "OK" in main.MOTIVOS_VINCULO, True)
    # Se alguém traduzir OK um dia, a exceção deixa de fazer sentido.
    checar("OK realmente nao tem texto na tela", "OK" in textos_na_tela(), False)


def teste_todos_tem_descricao():
    print("\n=== a constante descreve cada motivo ===")
    vazios = sorted(k for k, v in main.MOTIVOS_VINCULO.items() if not (v or "").strip())
    checar("nenhum motivo sem descricao", vazios, [])


if __name__ == "__main__":
    print(f"  {len(main.MOTIVOS_VINCULO)} motivos declarados")
    teste_codigo_dentro_da_constante()
    teste_constante_e_usada()
    teste_tela_traduz_todos()
    teste_sem_traducao_orfa()
    teste_a_excecao_e_deliberada()
    teste_todos_tem_descricao()
    print(f"\n{'FALHOU' if falhas else 'TUDO OK'}")
    for f in falhas:
        print(f"   {f}")
    sys.exit(1 if falhas else 0)
