"""
Criar atividade exige mais certeza do que anexar a uma existente.

Rodar: backend/venv/Scripts/python.exe test_criar_atividade.py
Não há pytest no projeto — este arquivo é executável e imprime o resultado.

Por quê: quando existe reunião na data, ela **corrobora** o palpite do nome —
duas evidências independentes apontando para o mesmo negócio. Quando não existe
e criamos uma `tactiq`, o nome fica sozinho, e o limiar de 0,90 foi calibrado
para o caso com corroboração.

O caso real: "Carlos Eduardo Martins Fernandes" casou **0,95** com o negócio
"Carlos Eduardo Stevanato" e uma atividade foi criada no negócio da pessoa
errada. O 0,95 vem do ramo `proporcao >= 0.6` de `compatibilidade_nome`: dois
tokens em comum de três bastam, e "Carlos Eduardo" se repete em muita gente.

A regra nova é estrutural, não um limiar maior: **nenhum token pode
contradizer**. Um dos nomes tem que caber inteiro dentro do outro, e o menor
precisa ter pelo menos dois tokens. Assim ela vale igual para "João Silva" e
para "Ariovaldo Tonon Latanzio" — não depende de o nome ser longo.
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
    print(f"  {'ok   ' if ok else 'FALHA'} {rotulo:64} obtido={obtido!r}")
    if not ok:
        falhas.append(f"{rotulo}: esperado {esperado!r}, obtido {obtido!r}")


def teste_o_caso_que_deu_errado():
    print("\n=== o caso real de 11/09 ===")
    checar(
        "Martins Fernandes NAO cria no negocio do Stevanato",
        main.nome_confiavel_para_criar("Carlos Eduardo Martins Fernandes", "Carlos Eduardo Stevanato"),
        False,
    )
    # A mesma dupla continua com score alto — a defesa é estrutural, não de nota.
    checar(
        "e o score continua alto, provando que o limiar nao resolveria",
        main.compatibilidade_nome("Carlos Eduardo Martins Fernandes", "Carlos Eduardo Stevanato") >= 0.9,
        True,
    )
    checar(
        "o outro caso do mesmo dia continua permitido",
        main.nome_confiavel_para_criar("João Paullo Ferreira", "Joao Paullo Ferreira"),
        True,
    )


def teste_nomes_curtos():
    """
    Um nome e um sobrenome é o caso comum, e a regra precisa valer ali.

    Com dois tokens, "caber inteiro dentro do outro" significa que os dois
    batem — que é a exigência mais forte possível para um nome curto.
    """
    print("\n=== nome + sobrenome (dois tokens) ===")
    casos = [
        ("João Silva", "João Silva", True, "iguais"),
        ("João Silva", "Joao Silva", True, "sem acento"),
        ("Maria Souza", "Maria Souza Lima", True, "o curto cabe no longo"),
        ("Maria Souza Lima", "Maria Souza", True, "e o inverso tambem"),
        ("João Silva", "João Santos", False, "sobrenome diferente"),
        ("João Silva", "Pedro Silva", False, "primeiro nome diferente"),
        ("Ana Costa", "Ana Paula Costa", True, "nome do meio a mais"),
        ("Ari Latanzio", "Ariovaldo Tonon Latanzio", True, "apelido com sobrenome confere"),
    ]
    for nome, titulo, esperado, porque in casos:
        checar(f"{porque:28} {nome!r} x {titulo!r}"[:62],
               main.nome_confiavel_para_criar(nome, titulo), esperado)


def teste_um_token_nunca_cria():
    """
    Só o primeiro nome não basta para escrever no negócio de alguém.

    Anexar a uma reunião existente com esse nome continua valendo: lá a data
    confirma. Criar, não.
    """
    print("\n=== nome com um token so ===")
    for nome, titulo in (
        ("Sérgio", "Sérgio Paulo Araújo"),
        ("Márcio", "Marcio de Souza Aguiar"),
        ("Ari", "Ariovaldo Tonon Latanzio"),
        ("Karinne", "KARINNE PEREIRA DE SIQUEIRA"),
    ):
        checar(f"{nome!r} x {titulo[:30]!r}", main.nome_confiavel_para_criar(nome, titulo), False)


def teste_entradas_degeneradas():
    print("\n=== entradas vazias ou invalidas ===")
    checar("nome vazio", main.nome_confiavel_para_criar("", "João Silva"), False)
    checar("titulo vazio", main.nome_confiavel_para_criar("João Silva", ""), False)
    checar("os dois vazios", main.nome_confiavel_para_criar("", ""), False)
    checar("titulo None", main.nome_confiavel_para_criar("João Silva", None), False)
    # Conectivos não contam como token e não podem virar a segunda palavra.
    checar("'de Souza' nao vale como dois tokens",
           main.nome_confiavel_para_criar("de Souza", "Marcio de Souza Aguiar"), False)


if __name__ == "__main__":
    teste_o_caso_que_deu_errado()
    teste_nomes_curtos()
    teste_um_token_nunca_cria()
    teste_entradas_degeneradas()
    print(f"\n{'FALHOU' if falhas else 'TUDO OK'}")
    for f in falhas:
        print(f"   {f}")
    sys.exit(1 if falhas else 0)
