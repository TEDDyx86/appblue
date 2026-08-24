#!/usr/bin/env python3
"""
Script de teste para validar conexão com Google Drive
Execute: python test_google_drive.py
"""

import os
import sys

# Adiciona o diretório do backend ao path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Carrega variáveis de ambiente do .env
from dotenv import load_dotenv
load_dotenv()

def test_google_drive():
    """Testa conexão e listagem de arquivos"""
    
    print("=" * 60)
    print("TESTE GOOGLE DRIVE - Tactiq-Pipedrive Automation")
    print("=" * 60)
    
    # 1. Verifica variáveis de ambiente
    service_account_path = os.getenv("GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON")
    print(f"\n1. Verificando credenciais...")
    print(f"   Caminho: {service_account_path}")
    
    if not service_account_path:
        print("   ❌ ERRO: GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON não definido no .env")
        return False
    
    if not os.path.exists(service_account_path):
        print(f"   ❌ ERRO: Arquivo não encontrado: {service_account_path}")
        return False
    
    print("   ✅ Arquivo de credenciais encontrado")
    
    # 2. Testa autenticação
    print("\n2. Testando autenticação...")
    try:
        from google.oauth2.service_account import Credentials
        from googleapiclient.discovery import build
        
        credentials = Credentials.from_service_account_file(
            service_account_path,
            scopes=["https://www.googleapis.com/auth/drive"]
        )
        service = build("drive", "v3", credentials=credentials)
        print("   ✅ Autenticação OK")
    except Exception as e:
        print(f"   ❌ ERRO na autenticação: {e}")
        return False
    
    # 3. Busca a pasta
    folder_name = "Briefing - Tactiq"
    print(f"\n3. Buscando pasta: '{folder_name}'...")
    try:
        query = f"name='{folder_name}' and mimeType='application/vnd.google-apps.folder' and trashed=false"
        results = service.files().list(q=query, spaces="drive", fields="files(id, name)").execute()
        files = results.get("files", [])
        
        if not files:
            print(f"   ❌ ERRO: Pasta '{folder_name}' não encontrada")
            print("   💡 Verifique se a pasta existe e está compartilhada com a service account")
            return False
        
        folder_id = files[0]["id"]
        print(f"   ✅ Pasta encontrada!")
        print(f"   📁 Folder ID: {folder_id}")
    except Exception as e:
        print(f"   ❌ ERRO ao buscar pasta: {e}")
        return False
    
    # 4. Lista arquivos na pasta
    print(f"\n4. Listando arquivos na pasta...")
    try:
        query = f"'{folder_id}' in parents and trashed=false"
        results = service.files().list(
            q=query,
            spaces="drive",
            fields="files(id, name, mimeType, createdTime, size)",
            orderBy="createdTime desc",
            pageSize=10
        ).execute()
        
        files = results.get("files", [])
        
        if not files:
            print("   ℹ️  Pasta vazia (nenhum arquivo encontrado)")
        else:
            print(f"   ✅ {len(files)} arquivo(s) encontrado(s):")
            for f in files:
                size = f.get("size", "N/A")
                if size != "N/A":
                    size = f"{int(size) / 1024:.1f} KB"
                print(f"      - {f['name']} ({f['mimeType']}) - {size} - {f['createdTime'][:19]}")
    except Exception as e:
        print(f"   ❌ ERRO ao listar arquivos: {e}")
        return False
    
    # 5. Testa leitura de um Google Doc (se houver)
    print("\n5. Testando leitura de Google Doc...")
    doc_files = [f for f in files if f['mimeType'] == 'application/vnd.google-apps.document']
    
    if doc_files:
        test_doc = doc_files[0]
        try:
            response = service.files().export(fileId=test_doc['id'], mimeType="text/plain").execute()
            text = response.decode("utf-8")
            preview = text[:200].replace('\n', ' ')
            print(f"   ✅ Leitura OK - Exemplo: {preview}...")
        except Exception as e:
            print(f"   ❌ ERRO ao ler Google Doc: {e}")
    else:
        print("   ℹ️  Nenhum Google Doc encontrado para testar leitura")
    
    # Resumo
    print("\n" + "=" * 60)
    print("✅ TESTE CONCLUÍDO COM SUCESSO!")
    print("=" * 60)
    print(f"\n📋 Resumo:")
    print(f"   • Service Account: OK")
    print(f"   • Pasta '{folder_name}': OK (ID: {folder_id})")
    print(f"   • Arquivos na pasta: {len(files)}")
    print(f"\n🚀 Próximo: Configure o webhook do Google Drive ou rode o backend")
    
    return True


if __name__ == "__main__":
    success = test_google_drive()
    sys.exit(0 if success else 1)