"""Base de Clientes: importação reconciliada do export de apólices da MAG."""

from .planilha import ler_export_mag, ExportLido

__all__ = ["ler_export_mag", "ExportLido"]
