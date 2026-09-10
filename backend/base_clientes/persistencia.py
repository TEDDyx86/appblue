"""
Grava e lê as três tabelas. Isolado para que planilha.py e reconciliacao.py
continuem puros — eles não conhecem Supabase e são testáveis sem banco.
"""

from datetime import date, datetime
from typing import Any, Dict, List


def _para_banco(d: Dict[str, Any]) -> Dict[str, Any]:
    saida = {}
    for k, v in d.items():
        if k.startswith("_"):
            continue
        if isinstance(v, datetime):
            saida[k] = v.isoformat()
        elif isinstance(v, date):
            saida[k] = v.isoformat()
        else:
            saida[k] = v
    return saida


def carregar_estado_atual(supabase) -> tuple:
    """Devolve (coberturas_por_item, clientes_por_cpf) do que já está gravado."""
    cob, pagina = {}, 0
    while True:
        r = (
            supabase.table("base_coberturas").select("*")
            .range(pagina * 1000, pagina * 1000 + 999).execute()
        )
        for linha in r.data or []:
            cob[linha["item_contratado"]] = linha
        if not r.data or len(r.data) < 1000:
            break
        pagina += 1

    cli = {}
    r = supabase.table("base_clientes").select("*").limit(5000).execute()
    for linha in r.data or []:
        cli[linha["cpf"]] = linha
    return cob, cli


def aplicar_importacao(supabase, importacao_id: str, lido) -> Dict[str, int]:
    """
    Grava clientes e coberturas. Upsert pela chave primária.

    Não apaga nada: o que sumiu do export permanece na base, sinalizado no diff.
    """
    clientes = [
        _para_banco({**c, "ultima_importacao_id": importacao_id})
        for c in lido.clientes.values()
    ]
    coberturas = [
        _para_banco({
            **c,
            "ultima_importacao_id": importacao_id,
            "visto_em": datetime.utcnow().isoformat(),
        })
        for c in lido.coberturas
    ]

    for i in range(0, len(clientes), 200):
        supabase.table("base_clientes").upsert(clientes[i:i + 200], on_conflict="cpf").execute()
    for i in range(0, len(coberturas), 200):
        supabase.table("base_coberturas").upsert(
            coberturas[i:i + 200], on_conflict="item_contratado"
        ).execute()

    return {"clientes": len(clientes), "coberturas": len(coberturas)}
