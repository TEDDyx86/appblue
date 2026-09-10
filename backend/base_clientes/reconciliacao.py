"""
Compara o export lido contra o que já está no banco e monta o diff.

Só os campos em CAMPOS_COMPARADOS disparam "alterado". Comparar as 27 colunas
geraria ruído inútil: `DATA STATUS` muda sozinha a cada export e acusaria 371
alterações por semana, tornando a conferência inútil e portanto ignorada.

Nada aqui escreve. A função devolve o diff; aplicar é decisão de quem confere.
"""

from datetime import date, datetime
from typing import Any, Dict, List

from .planilha import ExportLido

CAMPOS_COMPARADOS_COBERTURA = [
    "status_cobertura", "capital_segurado", "premio_atual", "premio_mensalizado",
    "premio_anualizado", "periodicidade", "forma_pagamento", "dia_vencimento",
    "fim_vigencia", "produto",
]

CAMPOS_COMPARADOS_CLIENTE = ["telefone", "email", "endereco", "profissao", "renda"]

# Diferença abaixo disso é arredondamento de float, não mudança de negócio.
TOLERANCIA = 0.01


def _igual(a: Any, b: Any) -> bool:
    if a is None and b is None:
        return True
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return abs(float(a) - float(b)) < TOLERANCIA
    if isinstance(a, (date, datetime)) or isinstance(b, (date, datetime)):
        return _texto_data(a) == _texto_data(b)
    return str(a or "").strip() == str(b or "").strip()


def _texto_data(v: Any) -> str:
    if isinstance(v, datetime):
        return v.date().isoformat()
    if isinstance(v, date):
        return v.isoformat()
    return str(v or "")[:10]


def _serializavel(v: Any) -> Any:
    """JSONB não aceita date/datetime — o diff é gravado como JSON."""
    if isinstance(v, (date, datetime)):
        return _texto_data(v)
    return v


def _comparar(novo: Dict[str, Any], atual: Dict[str, Any], campos: List[str]) -> Dict[str, list]:
    mudou = {}
    for campo in campos:
        if not _igual(novo.get(campo), atual.get(campo)):
            mudou[campo] = [_serializavel(atual.get(campo)), _serializavel(novo.get(campo))]
    return mudou


def calcular_diff(
    lido: ExportLido,
    coberturas_atuais: Dict[str, Dict[str, Any]],
    clientes_atuais: Dict[str, Dict[str, Any]],
) -> Dict[str, Any]:
    """
    Devolve {inalterados, novos, alterados, sumidos, avisos, clientes}.

    `sumidos` são itens que estavam no banco e não vieram nesta planilha. Eles
    são sinalizados e **nunca apagados**: a causa é ambígua (cancelamento ou
    recorte diferente do export) e apagar por engano não tem volta.
    """
    novos, alterados = [], []
    inalterados = 0
    vistos = set()

    for cob in lido.coberturas:
        chave = cob["item_contratado"]
        vistos.add(chave)
        atual = coberturas_atuais.get(chave)
        if atual is None:
            novos.append({
                "chave": chave,
                "cpf": cob.get("cpf"),
                "nome": cob.get("nome_segurado"),
                "produto": cob.get("produto"),
                "capital_segurado": cob.get("capital_segurado"),
                "status": cob.get("status_cobertura"),
            })
            continue
        campos = _comparar(cob, atual, CAMPOS_COMPARADOS_COBERTURA)
        if campos:
            alterados.append({
                "chave": chave,
                "cpf": cob.get("cpf"),
                "nome": cob.get("nome_segurado"),
                "campos": campos,
            })
        else:
            inalterados += 1

    sumidos = [
        {"chave": k, "cpf": (v or {}).get("cpf"), "nome": (v or {}).get("nome_segurado")}
        for k, v in coberturas_atuais.items()
        if k not in vistos
    ]

    clientes_novos, clientes_alterados = [], []
    for cpf, cli in lido.clientes.items():
        atual = clientes_atuais.get(cpf)
        if atual is None:
            clientes_novos.append({"chave": cpf, "nome": cli.get("nome")})
        else:
            campos = _comparar(cli, atual, CAMPOS_COMPARADOS_CLIENTE)
            if campos:
                clientes_alterados.append({"chave": cpf, "nome": cli.get("nome"), "campos": campos})

    return {
        "inalterados": inalterados,
        "novos": novos,
        "alterados": alterados,
        "sumidos": sumidos,
        "avisos": lido.avisos,
        "clientes": {"novos": clientes_novos, "alterados": clientes_alterados},
    }
