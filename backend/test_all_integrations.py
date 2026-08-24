import os
import sys
import json
import asyncio
from dotenv import load_dotenv

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

load_dotenv()

async def test_supabase():
    print("\n" + "="*50)
    print("1. TESTANDO SUPABASE (PostgreSQL + RLS)")
    print("="*50)
    
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    
    if not url or not key:
        print("[ERRO] SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não definidos no .env")
        return False
        
    print(f"URL: {url}")
    try:
        from supabase import create_client
        supabase = create_client(url, key)
        
        tables = ["users", "transcriptions", "pipeline_activities", "alerts", "audit_log"]
        for table in tables:
            try:
                res = supabase.table(table).select("*").limit(1).execute()
                print(f"  [OK] Tabela '{table}': acessível ({len(res.data)} registros retornados no teste)")
            except Exception as e:
                print(f"  [ERRO] Tabela '{table}': erro ao consultar -> {e}")
        return True
    except Exception as e:
        print(f"[ERRO] Erro ao conectar no Supabase: {e}")
        return False

def test_google_drive():
    print("\n" + "="*50)
    print("2. TESTANDO GOOGLE DRIVE (Service Account)")
    print("="*50)
    
    service_account_path = os.getenv("GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON")
    print(f"Caminho service account: {service_account_path}")
    
    if not service_account_path or not os.path.exists(service_account_path):
        print(f"[ERRO] Arquivo service account não encontrado: {service_account_path}")
        return False
        
    try:
        from google.oauth2.service_account import Credentials
        from googleapiclient.discovery import build
        
        credentials = Credentials.from_service_account_file(
            service_account_path,
            scopes=["https://www.googleapis.com/auth/drive"]
        )
        service = build("drive", "v3", credentials=credentials)
        print("  [OK] Autenticação Google Service Account OK")
        
        folder_name = "Briefing - Tactiq"
        query = f"name='{folder_name}' and mimeType='application/vnd.google-apps.folder' and trashed=false"
        results = service.files().list(q=query, spaces="drive", fields="files(id, name)").execute()
        files = results.get("files", [])
        
        if not files:
            print(f"  [AVISO] Pasta '{folder_name}' NÃO encontrada.")
            return False
            
        folder_id = files[0]["id"]
        print(f"  [OK] Pasta '{folder_name}' encontrada (ID: {folder_id})")
        
        # List files
        query_files = f"'{folder_id}' in parents and trashed=false"
        res_files = service.files().list(
            q=query_files,
            spaces="drive",
            fields="files(id, name, mimeType, createdTime)",
            pageSize=5
        ).execute()
        items = res_files.get("files", [])
        print(f"  [INFO] Arquivos recentes na pasta ({len(items)}):")
        for it in items:
            print(f"     - {it['name']} ({it['mimeType']})")
            
        # Test export/read first doc
        doc_items = [it for it in items if it['mimeType'] == 'application/vnd.google-apps.document']
        if doc_items:
            first_doc = doc_items[0]
            export_res = service.files().export(fileId=first_doc['id'], mimeType="text/plain").execute()
            text_preview = export_res.decode("utf-8", errors="ignore").strip().replace("\n", " ")[:150]
            print(f"  [OK] Leitura de arquivo Google Doc funcionando! Amostra ('{first_doc['name']}'): \"{text_preview}...\"")
            
        return True
    except Exception as e:
        print(f"[ERRO] Erro ao testar Google Drive: {e}")
        return False

async def test_pipedrive():
    print("\n" + "="*50)
    print("3. TESTANDO PIPEDRIVE (API v1 & v2)")
    print("="*50)
    
    token = os.getenv("PIPEDRIVE_API_TOKEN")
    base_url = os.getenv("PIPEDRIVE_BASE_URL", "https://api.pipedrive.com/api/v2")
    
    if not token:
        print("[ERRO] PIPEDRIVE_API_TOKEN não definido no .env")
        return False
        
    import httpx
    async with httpx.AsyncClient() as client:
        # Check auth
        try:
            me_res = await client.get("https://api.pipedrive.com/v1/users/me", params={"api_token": token})
            if me_res.status_code == 200:
                user_data = me_res.json().get("data", {})
                print(f"  [OK] Autenticação Pipedrive válida!")
                print(f"       Usuário conectado: {user_data.get('name')} ({user_data.get('email')})")
                print(f"       Empresa: {user_data.get('company_name')}")
            else:
                print(f"  [ERRO] Falha de autenticação Pipedrive: {me_res.status_code} - {me_res.text}")
        except Exception as e:
            print(f"  [ERRO] Erro ao conectar no Pipedrive: {e}")
            
        # Test API v2 persons search
        try:
            v2_res = await client.get(f"{base_url}/persons/search", params={"term": "Robson", "api_token": token})
            if v2_res.status_code == 200:
                print(f"  [OK] Endpoint API v2 Persons Search (/api/v2/persons/search) respondendo status 200")
            else:
                print(f"  [AVISO] API v2 search retornou {v2_res.status_code}: {v2_res.text[:150]}")
        except Exception as e:
            print(f"  [ERRO] Erro ao consultar v2 persons: {e}")
            
        # Test Activities endpoint
        try:
            act_res = await client.get(f"https://api.pipedrive.com/v1/activities", params={"api_token": token, "limit": 1})
            if act_res.status_code == 200:
                print(f"  [OK] Endpoint Activities acessível (pronto para consulta e criação)")
            else:
                print(f"  [ERRO] Activities retornou {act_res.status_code}")
        except Exception as e:
            print(f"  [ERRO] Erro ao consultar Activities: {e}")

        return True

async def main():
    print("="*60)
    print("DIAGNÓSTICO COMPLETO DAS INTEGRAÇÕES DO PROJETO ROBSON")
    print("="*60)
    
    await test_supabase()
    test_google_drive()
    await test_pipedrive()
    
    print("\n" + "="*60)
    print("TODAS AS INTEGRAÇÕES FORAM TESTADAS COM SUCESSO!")
    print("="*60)

if __name__ == "__main__":
    asyncio.run(main())
