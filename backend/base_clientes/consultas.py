"""
Consultas que alimentam o dashboard.

A fila de oportunidade é o produto da feature. Ela ordena, não filtra: medindo
contra a base real, qualquer limiar absoluto de "subsegurado" marcaria de 56% a
96% dos clientes, e uma lista com 201 de 209 nomes não é prioridade — é a lista
de clientes com outro nome. A mediana da carteira é 1,7x a renda anual.
"""

from datetime import date, datetime
from typing import Any, Dict, List, Optional

# Riders vendáveis presentes na carteira, por trecho identificador do produto.
RIDERS = {
    "DOENÇAS GRAVES": "Doenças Graves Plus",
    "IPA COM MAJORAÇÃO": "IPA com Majoração + IFPD",
    "DIH ADICIONAL": "DIH Adicional UTI",
}

# Referência de mercado para cobertura de vida. Só decide a ORDEM da fila —
# errar reordena a lista, não exclui ninguém nem inunda de falso positivo.
REFERENCIA_RENDA_ANUAL = 10


def _num(v: Any) -> float:
    """
    Coerção obrigatória, não defensiva.

    O mesmo dicionário chega por dois caminhos: recém-lido da planilha (float e
    `date` de verdade) ou vindo do Supabase, onde `NUMERIC` volta como string e
    `DATE` como `"1976-05-04"`. Sem coagir, a fila funciona no teste e quebra em
    produção — que é o pior lugar para descobrir.
    """
    if v is None or v == "":
        return 0.0
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def _data(v: Any) -> Optional[date]:
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    if isinstance(v, str) and len(v) >= 10:
        try:
            return date.fromisoformat(v[:10])
        except ValueError:
            return None
    return None


def _idade_em(nasc: date, hoje: date) -> int:
    """
    Idade que a pessoa tem hoje, não a que vai fazer.

    `hoje.year - nasc.year` erra para quem ainda não fez aniversário — e como
    esta lista é justamente a dos aniversariantes do mês, metade dela cai nesse
    caso todo mês.
    """
    return hoje.year - nasc.year - ((hoje.month, hoje.day) < (nasc.month, nasc.day))


def _riders_do_cliente(coberturas: List[Dict[str, Any]]) -> set:
    tem = set()
    for c in coberturas:
        produto = (c.get("produto") or "").upper()
        for chave, nome in RIDERS.items():
            if chave in produto:
                tem.add(nome)
    return tem


def montar_fila_oportunidade(
    clientes: List[Dict[str, Any]], coberturas: List[Dict[str, Any]]
) -> Dict[str, List[Dict[str, Any]]]:
    por_cpf: Dict[str, List[Dict[str, Any]]] = {}
    for c in coberturas:
        cpf = c.get("cpf")
        # Cobertura sem CPF não tem a quem pertencer. planilha.py já descarta
        # essas linhas na entrada; aqui a guarda existe porque este caminho
        # também recebe o que veio do banco, gravado por versões anteriores.
        if not cpf:
            continue
        por_cpf.setdefault(cpf, []).append(c)

    cobertura_unica, maior_lacuna, aniversariantes, parou_de_pagar = [], [], [], []
    hoje = date.today()

    for cli in clientes:
        cpf = cli.get("cpf")
        minhas = por_cpf.get(cpf, [])
        base = {
            "cpf": cpf,
            "nome": cli.get("nome"),
            "telefone": cli.get("telefone"),
            "profissao": cli.get("profissao"),
        }

        if len(minhas) == 1:
            faltam = [n for n in RIDERS.values() if n not in _riders_do_cliente(minhas)]
            cobertura_unica.append({
                **base,
                "produto_atual": minhas[0].get("produto"),
                "riders_que_faltam": faltam,
            })

        # Parou de pagar: status atual da cobertura, não o diff. Assim o card
        # continua correto mesmo para quem entrou como REMIDO já na primeira
        # importação, que não tem diff anterior com que comparar.
        remidas = [c for c in minhas if "REMIDO" in (c.get("status_cobertura") or "").upper()]
        if remidas:
            parou_de_pagar.append({
                **base,
                "coberturas": [c.get("produto") for c in remidas if c.get("produto")],
                "capital_parado": round(sum(_num(c.get("capital_segurado")) for c in remidas), 2),
            })

        renda = _num(cli.get("renda"))
        capital = _num(cli.get("total_capital_segurado"))
        if renda > 0:
            renda_anual = renda * 12
            maior_lacuna.append({
                **base,
                "renda_mensal": renda,
                "capital_segurado": capital,
                "razao_renda_anual": round(capital / renda_anual, 2),
                "lacuna": round(renda_anual * REFERENCIA_RENDA_ANUAL - capital, 2),
            })

        nasc = _data(cli.get("data_nascimento"))
        if nasc and nasc.month == hoje.month:
            aniversariantes.append({**base, "dia": nasc.day, "idade": _idade_em(nasc, hoje)})

    maior_lacuna.sort(key=lambda x: x["lacuna"], reverse=True)
    parou_de_pagar.sort(key=lambda x: x["capital_parado"], reverse=True)
    aniversariantes.sort(key=lambda x: x["dia"])
    cobertura_unica.sort(key=lambda x: x["nome"] or "")

    return {
        "cobertura_unica": cobertura_unica,
        "parou_de_pagar": parou_de_pagar,
        "maior_lacuna": maior_lacuna,
        "aniversariantes": aniversariantes,
    }


def analisar_cliente(
    cliente: Dict[str, Any], coberturas: List[Dict[str, Any]]
) -> Dict[str, Any]:
    """
    Os mesmos números da fila, para um cliente só.

    Vive aqui e não na tela porque a régua é regra de negócio: se a referência
    de 10x a renda anual mudar, ela muda em um lugar. Reimplementar no front
    faria a tela do cliente e a fila discordarem sem ninguém perceber.
    """
    renda = _num(cliente.get("renda"))
    capital = _num(cliente.get("total_capital_segurado"))
    renda_anual = renda * 12
    nasc = _data(cliente.get("data_nascimento"))
    hoje = date.today()

    return {
        "renda_mensal": renda,
        "capital_segurado": capital,
        "razao_renda_anual": round(capital / renda_anual, 2) if renda_anual else None,
        "lacuna": round(renda_anual * REFERENCIA_RENDA_ANUAL - capital, 2) if renda_anual else None,
        "riders_que_faltam": [
            n for n in RIDERS.values() if n not in _riders_do_cliente(coberturas)
        ],
        "idade": _idade_em(nasc, hoje) if nasc else None,
        "parou_de_pagar": any(
            "REMIDO" in (c.get("status_cobertura") or "").upper() for c in coberturas
        ),
    }


def montar_resumo(clientes: List[Dict[str, Any]], coberturas: List[Dict[str, Any]]) -> Dict[str, Any]:
    return {
        "clientes": len(clientes),
        "coberturas": len(coberturas),
        "capital_segurado_total": round(sum(_num(c.get("capital_segurado")) for c in coberturas), 2),
        "premio_anualizado_total": round(
            sum(_num(c.get("premio_mensalizado")) for c in coberturas) * 12, 2
        ),
    }
