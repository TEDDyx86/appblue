"""Consulta de Condições Gerais no site da SUSEP, sem navegador."""

from .consulta import (
    SusepIndisponivel,
    baixar_versao,
    consultar_processo,
    extrair_processo,
    ler_versoes_do_html,
    versao_vigente,
)

__all__ = [
    "SusepIndisponivel",
    "baixar_versao",
    "consultar_processo",
    "extrair_processo",
    "ler_versoes_do_html",
    "versao_vigente",
]
