"""
FastAPI Backend: Automação Tactiq → Google Drive → Pipedrive
Autenticação, Webhooks, Integração CRM
"""

import os
import uuid
import json
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any
from functools import wraps

from fastapi import FastAPI, HTTPException, Depends, Header, Request, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr, Field
import jwt
import bcrypt
from google.oauth2.service_account import Credentials
from google.auth.transport.requests import Request as GoogleRequest
from googleapiclient.discovery import build
import httpx
from supabase import create_client, Client
from apscheduler.schedulers.background import BackgroundScheduler
import logging
from dotenv import load_dotenv

# Carrega variáveis de ambiente
load_dotenv()

# ============================================================================
# CONFIGURAÇÃO
# ============================================================================

logger = logging.getLogger(__name__)

# Env vars
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
JWT_SECRET = os.getenv("JWT_SECRET", "your-secret-key-change-in-production")
JWT_ALGORITHM = "HS256"
JWT_EXPIRATION_HOURS = int(os.getenv("JWT_EXPIRATION_HOURS", 24))

PIPEDRIVE_API_TOKEN = os.getenv("PIPEDRIVE_API_TOKEN")
PIPEDRIVE_BASE_URL = "https://api.pipedrive.com/api/v2"  # API v2 - mais eficiente, 50% menos tokens

GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON = os.getenv("GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON")
GOOGLE_DRIVE_FOLDER_NAME = "Briefing - Tactiq"

# FastAPI app
app = FastAPI(title="Automação Tactiq-Pipedrive", version="1.0.0")

# CORS - Permite Vercel, Render, localhost e qualquer origem
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Database
supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

# Scheduler
scheduler = BackgroundScheduler()
scheduler.start()

# ============================================================================
# MODELS
# ============================================================================

class SignupRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=8)
    full_name: str

class LoginRequest(BaseModel):
    email: EmailStr
    password: str

class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int

class UserResponse(BaseModel):
    id: str
    email: str
    full_name: Optional[str]
    role: str
    created_at: str

class AlertResponse(BaseModel):
    id: str
    alert_type: str
    cliente_nome: Optional[str] = None
    pipedrive_deal_id: Optional[str] = None
    description: str
    severity: str
    is_resolved: bool
    details: Optional[Dict] = None
    created_at: str

# ============================================================================
# AUTENTICAÇÃO
# ============================================================================

def hash_password(password: str) -> str:
    """Hash password com bcrypt"""
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(password.encode(), salt).decode()

def verify_password(password: str, hash_val: str) -> bool:
    """Verifica password"""
    return bcrypt.checkpw(password.encode(), hash_val.encode())

def create_jwt(user_id: str, expires_hours: int = JWT_EXPIRATION_HOURS) -> tuple[str, str]:
    """Cria JWT access token + refresh token"""
    now = datetime.utcnow()
    
    # Access token
    payload = {
        "sub": user_id,
        "iat": now,
        "exp": now + timedelta(hours=expires_hours),
        "type": "access"
    }
    access_token = jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)
    
    # Refresh token (7 dias)
    refresh_payload = {
        "sub": user_id,
        "iat": now,
        "exp": now + timedelta(days=7),
        "type": "refresh"
    }
    refresh_token = jwt.encode(refresh_payload, JWT_SECRET, algorithm=JWT_ALGORITHM)
    
    return access_token, refresh_token

def verify_jwt(token: str) -> dict:
    """Verifica JWT e retorna payload"""
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expirado")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Token inválido")

def get_current_user(authorization: Optional[str] = Header(None)) -> dict:
    """Dependency: extrai usuário do JWT"""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Authorization header ausente")
    
    token = authorization.split(" ")[1]
    payload = verify_jwt(token)
    
    if payload.get("type") != "access":
        raise HTTPException(status_code=401, detail="Token inválido")
    
    return payload

def require_admin(user: dict = Depends(get_current_user)):
    """Dependency: verifica se é admin"""
    # Busca role no DB
    response = supabase.table("users").select("role").eq("id", user["sub"]).single().execute()
    if response.data.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Acesso restrito a admin")
    return user

# ============================================================================
# AUTH ENDPOINTS
# ============================================================================

@app.post("/api/auth/signup")
async def signup(req: SignupRequest):
    """Cadastro público desabilitado por segurança"""
    raise HTTPException(
        status_code=403,
        detail="Cadastro público desabilitado. Novas contas devem ser criadas pelo Administrador no painel de Configurações."
    )

class CreateUserByAdminRequest(BaseModel):
    email: EmailStr
    password: str
    full_name: str
    role: str = "member"  # "admin" ou "member"

@app.get("/api/admin/users")
async def list_users(user: dict = Depends(require_admin)):
    """Lista todos os usuários do sistema (Exclusivo Admin)"""
    res = supabase.table("users").select("id, email, full_name, role, created_at").order("created_at", desc=False).execute()
    return {"users": res.data or []}

@app.post("/api/admin/users")
async def create_user_by_admin(req: CreateUserByAdminRequest, user: dict = Depends(require_admin)):
    """Cria um novo usuário pela conta de Administrador"""
    existing = supabase.table("users").select("id").eq("email", req.email.strip().lower()).execute()
    if existing.data:
        raise HTTPException(status_code=400, detail="Este e-mail já está cadastrado no sistema")
        
    user_id = str(uuid.uuid4())
    password_hash = hash_password(req.password)
    role = req.role if req.role in ["admin", "member"] else "member"
    
    supabase.table("users").insert({
        "id": user_id,
        "email": req.email.strip().lower(),
        "password_hash": password_hash,
        "full_name": req.full_name.strip(),
        "role": role
    }).execute()
    
    log_audit_event(
        action="USER_CREATED_BY_ADMIN",
        resource_type="user",
        resource_id=user_id,
        user_id=user["sub"],
        details={
            "created_user_email": req.email,
            "created_user_name": req.full_name,
            "created_user_role": role,
            "summary": f"Novo usuário '{req.full_name}' ({req.email}) criado com perfil {role.upper()} pelo administrador."
        }
    )
    
    return {
        "status": "success",
        "message": f"Usuário {req.full_name} criado com sucesso!",
        "user": {
            "id": user_id,
            "email": req.email,
            "full_name": req.full_name,
            "role": role
        }
    }

@app.delete("/api/admin/users/{user_id_to_delete}")
async def delete_user_by_admin(user_id_to_delete: str, user: dict = Depends(require_admin)):
    """Exclui um usuário do sistema (Exclusivo Admin)"""
    if user_id_to_delete == user["sub"]:
        raise HTTPException(status_code=400, detail="Você não pode excluir sua própria conta de administrador")
        
    supabase.table("users").delete().eq("id", user_id_to_delete).execute()
    
    log_audit_event(
        action="USER_DELETED_BY_ADMIN",
        resource_type="user",
        resource_id=user_id_to_delete,
        user_id=user["sub"],
        details={
            "deleted_user_id": user_id_to_delete,
            "summary": f"Usuário #{user_id_to_delete} removido do sistema pelo administrador."
        }
    )
    
    return {"status": "success", "message": "Usuário removido com sucesso"}

@app.post("/api/auth/login", response_model=TokenResponse)
async def login(req: LoginRequest):
    """Login"""
    
    # Busca usuário
    response = supabase.table("users").select("id, password_hash").eq("email", req.email).execute()
    if not response.data:
        raise HTTPException(status_code=401, detail="Email ou senha incorretos")
    
    user = response.data[0]
    
    # Verifica senha
    if not verify_password(req.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Email ou senha incorretos")
    
    # Cria JWT
    access_token, refresh_token = create_jwt(user["id"])
    
    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        expires_in=JWT_EXPIRATION_HOURS * 3600
    )

@app.post("/api/auth/refresh", response_model=TokenResponse)
async def refresh(authorization: Optional[str] = Header(None)):
    """Refresh JWT"""
    
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Authorization header ausente")
    
    token = authorization.split(" ")[1]
    payload = verify_jwt(token)
    
    if payload.get("type") != "refresh":
        raise HTTPException(status_code=401, detail="Refresh token inválido")
    
    # Cria novo access token
    access_token, new_refresh_token = create_jwt(payload["sub"])
    
    return TokenResponse(
        access_token=access_token,
        refresh_token=new_refresh_token,
        expires_in=JWT_EXPIRATION_HOURS * 3600
    )

@app.get("/api/auth/me", response_model=UserResponse)
async def get_me(user: dict = Depends(get_current_user)):
    """Dados do usuário logado"""
    
    response = supabase.table("users").select("*").eq("id", user["sub"]).single().execute()
    data = response.data
    
    return UserResponse(
        id=data["id"],
        email=data["email"],
        full_name=data["full_name"],
        role=data["role"],
        created_at=data["created_at"]
    )

# ============================================================================
# GOOGLE DRIVE INTEGRATION
# ============================================================================

def get_google_drive_service():
    """Cria serviço do Google Drive"""
    if not GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON:
        raise HTTPException(status_code=500, detail="Google Drive service account não configurado")
    
    credentials = Credentials.from_service_account_file(
        GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON,
        scopes=["https://www.googleapis.com/auth/drive"]
    )
    return build("drive", "v3", credentials=credentials)

def find_google_drive_folder():
    """Encontra a pasta 'Tactiq Transcription' no Drive"""
    service = get_google_drive_service()
    
    query = f"name='{GOOGLE_DRIVE_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false"
    results = service.files().list(q=query, spaces="drive", fields="files(id, name)").execute()
    
    files = results.get("files", [])
    if not files:
        raise HTTPException(status_code=500, detail="Pasta Tactiq Transcription não encontrada")
    
    return files[0]["id"]

def read_google_doc_as_text(doc_id: str) -> str:
    """Lê conteúdo de um Google Doc e retorna como texto"""
    service = get_google_drive_service()
    
    # Exporta como texto
    response = service.files().export(fileId=doc_id, mimeType="text/plain").execute()
    return response.decode("utf-8")

def setup_google_drive_watch(folder_id: str, webhook_url: str):
    """Configura notificações do Google Drive para a pasta"""
    service = get_google_drive_service()
    
    channel_id = str(uuid.uuid4())
    
    try:
        # Watch folder para mudanças
        body = {
            "id": channel_id,
            "type": "web_hook",
            "address": webhook_url,
            "token": "tactiq-automation"
        }
        
        # Nota: Google Drive API watch em folders é via changes, não via files
        # Por simplicidade, você pode fazer polling periódico em vez disso
        logger.info(f"Google Drive watch setup iniciado para pasta {folder_id}")
        return channel_id
    except Exception as e:
        logger.error(f"Erro ao setup Google Drive watch: {e}")
        raise

def log_audit_event(
    action: str,
    resource_type: str,
    resource_id: Optional[str] = None,
    user_id: Optional[str] = None,
    details: Optional[Dict[str, Any]] = None,
    old_values: Optional[Dict[str, Any]] = None,
    new_values: Optional[Dict[str, Any]] = None
):
    """Registra evento com metadados detalhados na tabela audit_log do Supabase"""
    clean_user_id = None
    if user_id:
        try:
            uuid.UUID(str(user_id))
            clean_user_id = str(user_id)
        except (ValueError, AttributeError):
            clean_user_id = None

    try:
        supabase.table("audit_log").insert({
            "action": action,
            "resource_type": resource_type,
            "resource_id": str(resource_id) if resource_id else None,
            "user_id": clean_user_id,
            "details": details or {},
            "old_values": old_values,
            "new_values": new_values,
            "created_at": datetime.utcnow().isoformat()
        }).execute()
    except Exception as e:
        logger.error(f"Erro ao registrar audit_log ({action}): {e}")

# ============================================================================
# PIPEDRIVE INTEGRATION
# ============================================================================

async def search_pipedrive_person(name: str, email: Optional[str] = None) -> Optional[List[Dict]]:
    """
    Busca pessoa no Pipedrive por nome ou email usando API v2.
    
    API v2 changes:
    - Endpoint: /api/v2/persons/search
    - Retorna objetos diretamente em 'data.items'
    """
    
    async with httpx.AsyncClient() as client:
        # Busca por nome
        query = name
        if email:
            query = email  # Prioriza busca por email
        
        response = await client.get(
            f"{PIPEDRIVE_BASE_URL}/persons/search",
            params={
                "term": query,
                "api_token": PIPEDRIVE_API_TOKEN
            }
        )
        
        if response.status_code != 200:
            logger.error(f"Erro ao buscar pessoa no Pipedrive: {response.text}")
            return None
        
        data = response.json()
        # API v2 retorna em data.items
        return data.get("data", {}).get("items", []) if data.get("success") else None

async def get_pipedrive_deal(deal_id: str) -> Optional[Dict]:
    """
    Busca deal no Pipedrive usando API v2.
    
    API v2 changes:
    - Endpoint: /api/v2/deals/{id}
    - Timestamps em RFC 3339
    """
    
    async with httpx.AsyncClient() as client:
        response = await client.get(
            f"{PIPEDRIVE_BASE_URL}/deals/{deal_id}",
            params={"api_token": PIPEDRIVE_API_TOKEN}
        )
        
        if response.status_code != 200:
            logger.error(f"Erro ao buscar deal: {response.text}")
            return None
        
        data = response.json()
        return data.get("data") if data.get("success") else None

async def create_pipedrive_activity(
    person_id: Optional[str] = None,
    deal_id: Optional[str] = None,
    subject: str = "",
    due_date: Optional[str] = None,
    note: str = "",
    activity_type: str = "meeting"
) -> Optional[Dict]:
    """
    Cria Activity no Pipedrive usando API v2.
    
    API v2 changes:
    - Endpoint: /api/v2/activities
    - Método: POST
    - Boolean values: usar true/false (não 1/0)
    """
    
    payload = {
        "type": activity_type,
        "subject": subject,
        "note": note,
    }
    
    if person_id:
        p_id = int(person_id) if str(person_id).isdigit() else person_id
        payload["person_id"] = p_id
        payload["participants"] = [{"person_id": p_id, "primary": True}]
    if deal_id:
        payload["deal_id"] = int(deal_id) if str(deal_id).isdigit() else deal_id
    if due_date:
        payload["due_date"] = due_date
    
    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"{PIPEDRIVE_BASE_URL}/activities",
            params={"api_token": PIPEDRIVE_API_TOKEN},
            json=payload
        )
        
        if response.status_code not in [200, 201]:
            logger.error(f"Erro ao criar Activity: {response.text}")
            return None
        
        data = response.json()
        return data.get("data") if data.get("success") else None

async def update_pipedrive_activity(activity_id: str, updates: Dict) -> Optional[Dict]:
    """
    Atualiza Activity no Pipedrive usando API v2.
    """
    async with httpx.AsyncClient() as client:
        response = await client.patch(
            f"{PIPEDRIVE_BASE_URL}/activities/{activity_id}",
            params={"api_token": PIPEDRIVE_API_TOKEN},
            json=updates
        )
        
        if response.status_code != 200:
            logger.error(f"Erro ao atualizar Activity: {response.text}")
            return None
        
        data = response.json()
        return data.get("data") if data.get("success") else None

# ============================================================================
# WEBHOOK: Google Drive
# ============================================================================

@app.post("/api/webhooks/google-drive")
async def google_drive_webhook(
    request: Request,
    background_tasks: BackgroundTasks,
    user: dict = Depends(require_admin)
):
    """
    Webhook do Google Drive quando novo arquivo é criado em Tactiq Transcription.
    Google Drive envia notificações vazias, então fazemos polling.
    """
    
    # Extrai headers do webhook
    channel_id = request.headers.get("X-Goog-Channel-ID")
    resource_id = request.headers.get("X-Goog-Resource-ID")
    resource_state = request.headers.get("X-Goog-Resource-State")
    
    logger.info(f"Google Drive webhook recebido: state={resource_state}, channel={channel_id}")
    
    if resource_state == "sync":
        # Sync message, apenas confirma
        return {"status": "ok"}
    
    # Processa mudança em background
    background_tasks.add_task(process_new_transcription, user["sub"])
    
    return {"status": "processing"}

# ============================================================================
# TACTIQ DOCUMENT PARSER
# ============================================================================

import re

def parse_tactiq_doc(text: str, file_name: str = "") -> dict:
    """
    Parser para extrair dados estruturados dos Google Docs gerados pelo Tactiq
    """
    now = datetime.utcnow()
    data = {
        "principais_topicos": [],
        "dados_cliente": {
            "nome": "",
            "idade": "",
            "estado_civil": "",
            "demonstrou_interesse": "",
            "email": ""
        },
        "proxima_acao": {
            "descricao": "",
            "prazo_sugerido": (now + timedelta(days=3)).strftime("%Y-%m-%d"),
            "prioridade": "média"
        },
        "participantes": [],
        "tactiq_link": "",
        "pipedrive": {
            "person_id": None,
            "deal_id": None,
            "activity_id": None,
            "person_url": None,
            "deal_url": None
        }
    }
    
    # 1. Participantes
    part_match = re.search(r"PARTICIPANTES_NOME:\s*(.*)", text, re.IGNORECASE)
    if part_match:
        parts = [p.strip() for p in part_match.group(1).split(",") if p.strip()]
        data["participantes"] = parts
        
    # 2. Dados do Cliente
    nome_match = re.search(r"\*\s*Nome:\s*(.*)", text, re.IGNORECASE)
    if nome_match and "nao informado" not in nome_match.group(1).lower() and "não informado" not in nome_match.group(1).lower():
        data["dados_cliente"]["nome"] = nome_match.group(1).strip()
    elif data["participantes"]:
        for p in data["participantes"]:
            if "robson" not in p.lower():
                data["dados_cliente"]["nome"] = p
                break

    idade_match = re.search(r"\*\s*Idade:\s*(.*)", text, re.IGNORECASE)
    if idade_match:
        data["dados_cliente"]["idade"] = idade_match.group(1).strip()

    ec_match = re.search(r"\*\s*Estado civil:\s*(.*)", text, re.IGNORECASE)
    if ec_match:
        data["dados_cliente"]["estado_civil"] = ec_match.group(1).strip()

    interesse_match = re.search(r"\*\s*Demonstrou interesse:\s*(.*)", text, re.IGNORECASE)
    if interesse_match:
        data["dados_cliente"]["demonstrou_interesse"] = interesse_match.group(1).strip()
        
    # 3. Principais Tópicos
    topicos_section = re.search(r"PRINCIPAIS T[ÓO]PICOS\s*\n(.*?)(?=(DADOS DO CLIENTE|Link da reuniao|====|$))", text, re.IGNORECASE | re.DOTALL)
    if topicos_section:
        raw_topicos = topicos_section.group(1).strip().split("\n")
        topicos = []
        for line in raw_topicos:
            line_clean = re.sub(r"^[\*\-\•\d\.]+\s*", "", line).strip()
            if line_clean and len(line_clean) > 3:
                topicos.append(line_clean)
        data["principais_topicos"] = topicos

    # 4. Próxima Ação
    proxima_acao_desc = ""
    for t in reversed(data["principais_topicos"]):
        if any(keyword in t.lower() for keyword in ["agend", "reuni", "propost", "enviar", "apresenta", "retorno", "custo", "avaliar", "estudo"]):
            proxima_acao_desc = t
            break
            
    if not proxima_acao_desc:
        if data["principais_topicos"]:
            proxima_acao_desc = f"Follow-up: {data['principais_topicos'][-1]}"
        else:
            proxima_acao_desc = f"Follow-up reunião com {data['dados_cliente']['nome'] or file_name}"
            
    data["proxima_acao"]["descricao"] = proxima_acao_desc[:250]
    
    # Prioridade
    interesse = data["dados_cliente"]["demonstrou_interesse"].lower()
    if "sim" in interesse or "alto" in interesse or "muito" in interesse:
        data["proxima_acao"]["prioridade"] = "alta"
    elif "não" in interesse or "baixo" in interesse or "recus" in interesse:
        data["proxima_acao"]["prioridade"] = "baixa"
    else:
        data["proxima_acao"]["prioridade"] = "média"
        
    # Link Tactiq
    link_match = re.search(r"Link da reuniao.*:\s*(https?://[^\s]+)", text, re.IGNORECASE)
    if link_match:
        data["tactiq_link"] = link_match.group(1).strip()
        
    return data

async def get_person_deals(person_id: str) -> Optional[List[Dict]]:
    """Busca deals associados a uma pessoa no Pipedrive"""
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{PIPEDRIVE_BASE_URL}/deals",
                params={"person_id": person_id, "api_token": PIPEDRIVE_API_TOKEN}
            )
            if response.status_code == 200:
                data = response.json()
                return data.get("data", []) if data.get("success") else []
    except Exception as e:
        logger.error(f"Erro ao buscar deals da pessoa {person_id}: {e}")
    return []

# ============================================================================
# PROCESSAMENTO DE TRANSCRIÇÃO
# ============================================================================

async def process_new_transcription(user_id: str):
    """Background task: processa novas transcrições do Drive com parser real"""
    
    try:
        folder_id = find_google_drive_folder()
        service = get_google_drive_service()
        
        # Lista arquivos na pasta
        query = f"'{folder_id}' in parents and trashed=false"
        results = service.files().list(
            q=query,
            spaces="drive",
            fields="files(id, name, createdTime, mimeType)",
            orderBy="createdTime desc",
            pageSize=50
        ).execute()
        
        files = results.get("files", [])
        logger.info(f"Encontrados {len(files)} arquivos na pasta do Google Drive")
        
        for file in files:
            if file.get("mimeType") != "application/vnd.google-apps.document":
                continue
                
            google_doc_id = file["id"]
            meeting_title = file["name"]
            created_time = file.get("createdTime")
            
            # Verifica se já foi processado
            existing = supabase.table("transcriptions").select("id").eq(
                "google_doc_id", google_doc_id
            ).execute()
            
            if existing.data:
                continue
                
            logger.info(f"Processando arquivo real do Drive: {meeting_title}")
            
            # Lê conteúdo do arquivo
            try:
                transcription_text = read_google_doc_as_text(google_doc_id)
            except Exception as e:
                logger.error(f"Erro ao ler Google Doc {google_doc_id}: {e}")
                continue
            
            # Cria registro de transcrição (processing)
            transcription_record = supabase.table("transcriptions").insert({
                "google_doc_id": google_doc_id,
                "meeting_title": meeting_title,
                "meeting_date": created_time,
                "transcription_text": transcription_text,
                "processing_status": "processing",
                "created_by": user_id
            }).execute()
            
            transcription_id = transcription_record.data[0]["id"]
            
            # Executa parser real do Tactiq
            briefing_json = parse_tactiq_doc(transcription_text, meeting_title)
            cliente_nome = briefing_json["dados_cliente"]["nome"]
            cliente_email = briefing_json["dados_cliente"].get("email")
            
            person_id = None
            deal_id = None
            activity_id = None
            matching_confidence = 0.0
            
            if cliente_nome and len(cliente_nome) > 2:
                # Busca no Pipedrive
                person_results = await search_pipedrive_person(cliente_nome, cliente_email)
                
                if person_results and len(person_results) > 0:
                    # Encontrou pessoa no Pipedrive
                    first_person = person_results[0]
                    # API v2 retorna o objeto em item
                    item_data = first_person.get("item", first_person)
                    person_id = str(item_data.get("id"))
                    matching_confidence = 1.0 if len(person_results) == 1 else 0.75
                    
                    # Gera link direto do cliente
                    briefing_json["pipedrive"]["person_id"] = person_id
                    briefing_json["pipedrive"]["person_url"] = f"https://investimentosblue.pipedrive.com/person/{person_id}"
                    
                    # Busca Deals abertos do cliente
                    deals = await get_person_deals(person_id)
                    if deals:
                        deal_id = str(deals[0].get("id"))
                        briefing_json["pipedrive"]["deal_id"] = deal_id
                        briefing_json["pipedrive"]["deal_url"] = f"https://investimentosblue.pipedrive.com/deal/{deal_id}"
                    
                    # Se tiver alta confiança, cria apenas a Anotação Rica no Pipedrive
                    if matching_confidence >= 0.70:
                        topicos_html = "".join([f"<li>{topico}</li>" for topico in briefing_json.get("principais_topicos", [])])
                        note_html = (
                            f"<h3>📋 Briefing da Reunião (Origem: Tactiq / Google Drive)</h3>"
                            f"<p><strong>Reunião:</strong> {meeting_title}</p>"
                            f"<p><strong>Cliente:</strong> {cliente_nome}</p>"
                            f"<p><strong>Interesse:</strong> {briefing_json.get('dados_cliente', {}).get('demonstrou_interesse', 'Não informado')}</p>"
                            f"<h4>Principais Tópicos Abordados:</h4>"
                            f"<ul>{topicos_html or '<li>Discussão patrimonial e sucessória.</li>'}</ul>"
                            f"<h4>🎯 Próxima Ação Sugerida:</h4>"
                            f"<p>{briefing_json.get('proxima_acao', {}).get('descricao', 'Dar continuidade aos alinhamentos')}</p>"
                            f"<hr/>"
                            f"<p><small>⚡ Sincronizado pelo Sistema Robson Tavernard (Investimentos Blue)</small></p>"
                        )
                        note_res = await create_pipedrive_note(content=note_html, deal_id=deal_id, person_id=person_id)
                        if note_res:
                            note_id = str(note_res.get("id"))
                            briefing_json["pipedrive"]["note_id"] = note_id
                            logger.info(f"Nota Pipedrive criada com sucesso: {note_id} para {cliente_nome}")
            
            # Atualiza transcrição para completed com o briefing real
            supabase.table("transcriptions").update({
                "processing_status": "completed",
                "briefing_json": briefing_json
            }).eq("id", transcription_id).execute()
            
            # Registra no log de auditoria
            is_linked = bool(deal_id or person_id)
            if is_linked:
                action_type = "DRIVE_DOC_LINKED"
                summary_text = f"Arquivo '{meeting_title}' recebido do Google Drive e vinculado com sucesso ao cliente '{cliente_nome or 'Identificado'}'" + (f" e Deal #{deal_id}" if deal_id else "") + " no Pipedrive com tarefa agendada."
            else:
                action_type = "DRIVE_DOC_UNLINKED"
                if cliente_nome and cliente_nome.lower() != "cliente":
                    summary_text = f"Arquivo '{meeting_title}' processado pela IA (mencionou '{cliente_nome}'). Não foi vinculado ao Pipedrive pois o contato não foi localizado no CRM ou trata-se de reunião interna."
                else:
                    summary_text = f"Arquivo '{meeting_title}' processado pela IA. Reunião interna da equipe ou sem cliente externo identificado no Pipedrive."

            log_audit_event(
                action=action_type,
                resource_type="transcription",
                resource_id=transcription_id,
                user_id=user_id,
                details={
                    "doc_title": meeting_title,
                    "google_doc_id": google_doc_id,
                    "cliente_nome": cliente_nome if cliente_nome and cliente_nome.lower() != "cliente" else None,
                    "cliente_email": cliente_email,
                    "pipedrive_person_id": person_id,
                    "pipedrive_deal_id": deal_id,
                    "pipedrive_activity_id": activity_id,
                    "deal_url": briefing_json.get("pipedrive", {}).get("deal_url"),
                    "person_url": briefing_json.get("pipedrive", {}).get("person_url"),
                    "proxima_acao": briefing_json.get("proxima_acao", {}).get("descricao") if is_linked else None,
                    "tactiq_link": briefing_json.get("tactiq_link"),
                    "is_linked_to_crm": is_linked,
                    "summary": summary_text
                }
            )
            
            logger.info(f"Transcrição concluída e auditada ({action_type}): {meeting_title}")
    
    except Exception as e:
        logger.error(f"Erro no processamento de transcrições: {e}")

# ============================================================================
# PIPEDRIVE ENDPOINTS
# ============================================================================

@app.post("/api/pipedrive/persons")
async def search_pipedrive_persons(
    request: Request,
    user: dict = Depends(require_admin)
):
    """Busca pessoa no Pipedrive por nome ou email"""
    try:
        body = await request.json()
        name = body.get("name")
        email = body.get("email")
        
        if not name:
            raise HTTPException(status_code=400, detail="Nome é obrigatório")
        
        results = await search_pipedrive_person(name, email)
        
        if results is None:
            raise HTTPException(status_code=500, detail="Erro ao buscar no Pipedrive")
        
        return {"results": results}
    except Exception as e:
        logger.error(f"Erro ao processar request: {e}")
        raise HTTPException(status_code=400, detail=f"Erro ao processar request: {str(e)}")

@app.get("/api/pipedrive/search-persons")
async def search_persons_autocomplete(
    term: str,
    user: dict = Depends(require_admin)
):
    """Busca pessoas no Pipedrive para autocomplete e atribuição"""
    if not term or len(term.strip()) < 2:
        return {"items": []}
        
    async with httpx.AsyncClient() as client:
        res = await client.get(
            f"{PIPEDRIVE_BASE_URL}/persons/search",
            params={"term": term.strip(), "api_token": PIPEDRIVE_API_TOKEN, "limit": 10}
        )
        if res.status_code != 200:
            return {"items": []}
            
        raw_items = res.json().get("data", {}).get("items", [])
        formatted = []
        for it in raw_items:
            item = it.get("item", it)
            emails = item.get("emails", [])
            primary_email = emails[0] if emails and isinstance(emails, list) else item.get("email", "")
            phones = item.get("phones", [])
            primary_phone = phones[0] if phones and isinstance(phones, list) else item.get("phone", "")
            formatted.append({
                "id": str(item.get("id")),
                "name": item.get("name"),
                "email": primary_email,
                "phone": primary_phone,
                "url": f"https://investimentosblue.pipedrive.com/person/{item.get('id')}"
            })
        return {"items": formatted}

@app.get("/api/pipedrive/search-deals")
async def search_deals_autocomplete(
    term: str,
    user: dict = Depends(require_admin)
):
    """Busca negócios no Pipedrive para autocomplete e atribuição"""
    if not term or len(term.strip()) < 1:
        return {"items": []}
        
    async with httpx.AsyncClient() as client:
        res = await client.get(
            f"{PIPEDRIVE_BASE_URL}/deals/search",
            params={"term": term.strip(), "api_token": PIPEDRIVE_API_TOKEN, "limit": 10}
        )
        if res.status_code != 200:
            return {"items": []}
            
        raw_items = res.json().get("data", {}).get("items", [])
        formatted = []
        for it in raw_items:
            item = it.get("item", it)
            person = item.get("person") or {}
            formatted.append({
                "id": str(item.get("id")),
                "title": item.get("title"),
                "status": item.get("status"),
                "person_id": str(person.get("id")) if person.get("id") else None,
                "person_name": person.get("name"),
                "url": f"https://investimentosblue.pipedrive.com/deal/{item.get('id')}"
            })
        return {"items": formatted}

@app.get("/api/pipedrive/deal/{deal_id}")
async def get_deal_by_id(
    deal_id: str,
    user: dict = Depends(require_admin)
):
    """Busca detalhes de um deal específico pelo ID no Pipedrive"""
    async with httpx.AsyncClient() as client:
        res = await client.get(
            f"{PIPEDRIVE_BASE_URL}/deals/{deal_id}",
            params={"api_token": PIPEDRIVE_API_TOKEN}
        )
        if res.status_code != 200:
            raise HTTPException(status_code=404, detail="Negócio não encontrado no Pipedrive")
            
        data = res.json().get("data", {})
        person = data.get("person") or {}
        return {
            "id": str(data.get("id")),
            "title": data.get("title"),
            "status": data.get("status"),
            "person_id": str(person.get("id")) if person.get("id") else None,
            "person_name": person.get("name"),
            "url": f"https://investimentosblue.pipedrive.com/deal/{deal_id}"
        }

async def create_pipedrive_note(
    content: str,
    deal_id: Optional[str] = None,
    person_id: Optional[str] = None
) -> Optional[Dict]:
    """Cria uma nota rica no Pipedrive vinculada a um deal e/ou person"""
    payload = {
        "content": content,
        "pinned_to_deal_flag": 1 if deal_id else 0,
    }
    if deal_id:
        try:
            payload["deal_id"] = int(deal_id)
        except ValueError:
            payload["deal_id"] = deal_id
    if person_id:
        try:
            payload["person_id"] = int(person_id)
        except ValueError:
            payload["person_id"] = person_id
            
    async with httpx.AsyncClient() as client:
        res = await client.post(
            "https://api.pipedrive.com/v1/notes",
            params={"api_token": PIPEDRIVE_API_TOKEN},
            json=payload
        )
        if res.status_code in [200, 201]:
            return res.json().get("data")
        else:
            logger.error(f"Erro ao criar nota no Pipedrive: {res.text}")
            return None

# ============================================================================
# PIPEDRIVE: ATIVIDADES, ASSESSORES (ORGANIZAÇÕES) & AGENDA
# ============================================================================

DIAS_SEMANA_PT = {
    0: "segunda-feira",
    1: "terça-feira",
    2: "quarta-feira",
    3: "quinta-feira",
    4: "sexta-feira",
    5: "sábado",
    6: "domingo"
}

@app.get("/api/pipedrive/assessores")
async def list_pipedrive_assessores(user: dict = Depends(require_admin)):
    """Lista todas as Organizações (Assessores) cadastradas no Pipedrive"""
    async with httpx.AsyncClient() as client:
        res = await client.get(
            "https://api.pipedrive.com/v1/organizations",
            params={"api_token": PIPEDRIVE_API_TOKEN, "limit": 100}
        )
        if res.status_code != 200:
            return {"assessores": []}
        data = res.json().get("data") or []
        assessores = [{"id": o.get("id"), "name": o.get("name")} for o in data if o.get("name")]
        return {"assessores": sorted(assessores, key=lambda x: x["name"])}

@app.get("/api/pipedrive/activities")
async def list_pipedrive_activities(
    assessor_name: Optional[str] = None,
    assessor_id: Optional[int] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    period: Optional[str] = None,
    done: Optional[bool] = None,
    user: dict = Depends(require_admin)
):
    """
    Lista atividades do Pipedrive com suporte a paginação completa,
    filtros por período (esta semana, este mês, etc.), assessor e geração de template WhatsApp.
    """
    now = datetime.now()
    
    # Define range de datas
    computed_start = start_date
    computed_end = end_date
    
    if period == "this_week":
        # Segunda-feira da semana atual até Domingo
        monday = now - timedelta(days=now.weekday())
        sunday = monday + timedelta(days=6)
        computed_start = monday.strftime("%Y-%m-%d")
        computed_end = sunday.strftime("%Y-%m-%d")
    elif period == "next_week":
        next_monday = now - timedelta(days=now.weekday()) + timedelta(days=7)
        next_sunday = next_monday + timedelta(days=6)
        computed_start = next_monday.strftime("%Y-%m-%d")
        computed_end = next_sunday.strftime("%Y-%m-%d")
    elif period == "this_month":
        first_day = now.replace(day=1)
        # Próximo mês dia 1 - 1 dia
        if now.month == 12:
            last_day = now.replace(year=now.year + 1, month=1, day=1) - timedelta(days=1)
        else:
            last_day = now.replace(month=now.month + 1, day=1) - timedelta(days=1)
        computed_start = first_day.strftime("%Y-%m-%d")
        computed_end = last_day.strftime("%Y-%m-%d")
    elif period == "next_30_days":
        computed_start = now.strftime("%Y-%m-%d")
        computed_end = (now + timedelta(days=30)).strftime("%Y-%m-%d")
    elif not computed_start and not computed_end and period != "all":
        # Janela padrão: 30 dias atrás até 90 dias no futuro
        computed_start = (now - timedelta(days=30)).strftime("%Y-%m-%d")
        computed_end = (now + timedelta(days=90)).strftime("%Y-%m-%d")

    # Busca organizações (Assessores) cadastradas
    async with httpx.AsyncClient() as client:
        orgs_res = await client.get(
            "https://api.pipedrive.com/v1/organizations",
            params={"api_token": PIPEDRIVE_API_TOKEN, "limit": 100}
        )
        all_orgs = (orgs_res.json().get("data") or []) if orgs_res.status_code == 200 else []
        assessores_map = {o["id"]: o["name"] for o in all_orgs if o.get("name")}
        
        # Paginação sobre as atividades no Pipedrive (até 500 registros)
        all_raw_activities = []
        start_offset = 0
        
        for _ in range(5):
            query_params = {
                "api_token": PIPEDRIVE_API_TOKEN,
                "limit": 100,
                "start": start_offset,
                "user_id": 0
            }
            if computed_start:
                query_params["start_date"] = computed_start
            if computed_end:
                query_params["end_date"] = computed_end
            if done is not None:
                query_params["done"] = 1 if done else 0
            else:
                query_params["done"] = 0  # REGRA: Apenas atividades em aberto por padrão
                
            res = await client.get("https://api.pipedrive.com/v1/activities", params=query_params)
            if res.status_code != 200:
                break
                
            data = res.json().get("data") or []
            if not data:
                break
                
            all_raw_activities.extend(data)
            
            pagination = res.json().get("additional_data", {}).get("pagination", {})
            if not pagination.get("more_items_in_collection"):
                break
            start_offset = pagination.get("next_start", start_offset + 100)
            
        formatted_activities = []
        assessores_count: Dict[str, Dict[str, Any]] = {}
        seen_activity_ids = set()
        
        for a in all_raw_activities:
            act_id = str(a.get("id"))
            if act_id in seen_activity_ids:
                continue
            seen_activity_ids.add(act_id)
            
            # REGRA: Ignora / oculta qualquer atividade marcada como feito (done == True)
            if bool(a.get("done")):
                continue
            
            org_id = a.get("org_id")
            org_name = a.get("org_name") or assessores_map.get(org_id)
            person_name = a.get("person_name")
            
            # REGRA ESTRITA: Só exibe atividades que têm Pessoa (Cliente) E Organização (Assessor) definidos
            if not person_name or not str(person_name).strip():
                continue
            if not org_name or not str(org_name).strip() or org_name == "Sem Assessor":
                continue
            
            # Contabiliza nas opções de assessores ativos
            if org_name not in assessores_count:
                assessores_count[org_name] = {"id": org_id, "name": org_name, "count": 0}
            assessores_count[org_name]["count"] += 1
            
            # Filtro por assessor selecionado
            if assessor_name and assessor_name != "all" and org_name != assessor_name:
                continue
            if assessor_id and org_id != assessor_id:
                continue
                
            due_date_str = a.get("due_date") or ""
            due_time_str = a.get("due_time") or ""
            duration_str = a.get("duration") or "01:00"
            
            time_slot = "Horário a definir"
            day_name = ""
            date_display = ""
            
            if due_date_str:
                try:
                    dt = datetime.strptime(due_date_str, "%Y-%m-%d")
                    day_name = DIAS_SEMANA_PT.get(dt.weekday(), "")
                    date_display = dt.strftime("%d/%m")
                except Exception:
                    pass
                    
            if due_time_str:
                try:
                    start_parts = [int(p) for p in due_time_str.split(":")[:2]]
                    dur_parts = [int(p) for p in duration_str.split(":")[:2]]
                    start_min = start_parts[0] * 60 + start_parts[1]
                    dur_min = dur_parts[0] * 60 + dur_parts[1]
                    end_min = start_min + dur_min
                    end_h, end_m = divmod(end_min, 60)
                    start_fmt = f"{start_parts[0]:02d}:{start_parts[1]:02d}"
                    end_fmt = f"{end_h:02d}:{end_m:02d}"
                    time_slot = f"{start_fmt} - {end_fmt}"
                except Exception:
                    time_slot = due_time_str
                    
            person_id = a.get("person_id")
            deal_title = a.get("deal_title")
            deal_id = a.get("deal_id")
            subj = a.get("subject") or "Reunião"
            act_type = a.get("type") or "meeting"
            
            # Template WhatsApp linha única: 'segunda-feira (20/08) R1 com ana (16:00-17:00)'
            wa_template = f"{day_name} ({date_display}) {subj} com {person_name} ({time_slot})".strip()
            
            formatted_activities.append({
                "id": str(a.get("id")),
                "type": act_type,
                "subject": subj,
                "due_date": due_date_str,
                "due_time": due_time_str,
                "duration": duration_str,
                "time_slot": time_slot,
                "day_of_week": day_name,
                "date_display": date_display,
                "person_name": person_name,
                "person_id": str(person_id) if person_id else None,
                "person_url": f"https://investimentosblue.pipedrive.com/person/{person_id}" if person_id else None,
                "org_name": org_name,
                "org_id": org_id,
                "deal_id": str(deal_id) if deal_id else None,
                "deal_title": deal_title,
                "deal_url": f"https://investimentosblue.pipedrive.com/deal/{deal_id}" if deal_id else None,
                "done": bool(a.get("done")),
                "whatsapp_template": wa_template
            })
            
        # Ordena cronologicamente
        formatted_activities.sort(key=lambda x: (x["due_date"], x["due_time"] or "99:99"))
        
        # Gera template consolidado para WhatsApp se filtrado por assessor
        whatsapp_consolidated = ""
        target_assessor_label = assessor_name if (assessor_name and assessor_name != "all") else "Geral"
        if formatted_activities:
            lines = [f"📅 *Agenda de Atendimentos - Robson Vieira & {target_assessor_label}*\n"]
            by_date: Dict[str, List[Dict]] = {}
            for act in formatted_activities:
                d_key = f"{act['day_of_week'].capitalize()} ({act['date_display']})"
                by_date.setdefault(d_key, []).append(act)
                
            for d_header, acts in by_date.items():
                lines.append(f"🔹 *{d_header}*")
                for act in acts:
                    lines.append(f"• {act['time_slot']} | {act['subject']} com {act['person_name']}")
                lines.append("")
                
            lines.append("Qualquer dúvida ou ajuste de horário, estou à disposição! 🚀")
            whatsapp_consolidated = "\n".join(lines).strip()
            
        # Retorna assessores ordenados por contagem (maiores primeiro)
        assessores_list = sorted(
            [a for a in assessores_count.values() if a["count"] > 0],
            key=lambda x: -x["count"]
        )
        
        return {
            "activities": formatted_activities,
            "assessores": assessores_list,
            "whatsapp_consolidated": whatsapp_consolidated,
            "period": {
                "start_date": computed_start,
                "end_date": computed_end,
                "period_filter": period or "default_window"
            },
            "total": len(formatted_activities)
        }

# ============================================================================
# PIPELINE COMERCIAL (MONITORAMENTO ATIVO)
# ============================================================================

PIPELINE_COMERCIAL_ID = 1

async def fetch_comercial_pipeline_data() -> Dict[str, Any]:
    """Busca dados consolidados do Funil Comercial do Pipedrive"""
    async with httpx.AsyncClient() as client:
        # 1. Busca stages do funil 1
        stages_res = await client.get(
            "https://api.pipedrive.com/v1/stages",
            params={"api_token": PIPEDRIVE_API_TOKEN}
        )
        all_stages = stages_res.json().get("data") or []
        comercial_stages = {s["id"]: s["name"] for s in all_stages if s.get("pipeline_id") == PIPELINE_COMERCIAL_ID}
        
        # 2. Busca deals abertos do funil 1
        deals_res = await client.get(
            "https://api.pipedrive.com/v1/deals",
            params={"api_token": PIPEDRIVE_API_TOKEN, "pipeline_id": PIPELINE_COMERCIAL_ID, "status": "open", "limit": 100}
        )
        raw_deals = deals_res.json().get("data") or []
        
        now = datetime.now()
        total_value = 0.0
        stages_breakdown = {}
        stagnant_deals = []
        overdue_deals = []
        formatted_deals = []
        
        for d in raw_deals:
            deal_id = str(d.get("id"))
            title = d.get("title") or "Negócio sem título"
            person = d.get("person_name") or (d.get("person_id", {}).get("name") if isinstance(d.get("person_id"), dict) else "Cliente")
            val = float(d.get("value") or 0)
            total_value += val
            stage_id = d.get("stage_id")
            stage_name = comercial_stages.get(stage_id, f"Etapa #{stage_id}")
            
            stages_breakdown[stage_name] = stages_breakdown.get(stage_name, 0) + 1
            
            # Stagnation check
            days_inactive = 0
            update_time_str = d.get("update_time")
            if update_time_str:
                try:
                    up_dt = datetime.strptime(update_time_str, "%Y-%m-%d %H:%M:%S")
                    days_inactive = (now - up_dt).days
                except Exception:
                    pass
            
            # Next activity check
            next_act = d.get("next_activity_date")
            is_overdue = False
            if next_act:
                try:
                    act_dt = datetime.strptime(next_act, "%Y-%m-%d")
                    is_overdue = act_dt.date() < now.date()
                except Exception:
                    pass
            
            deal_obj = {
                "id": deal_id,
                "title": title,
                "person_name": person,
                "stage_id": stage_id,
                "stage_name": stage_name,
                "value": val,
                "update_time": update_time_str,
                "days_inactive": days_inactive,
                "next_activity_date": next_act,
                "is_stagnant": days_inactive > 15,
                "is_overdue": is_overdue,
                "deal_url": f"https://investimentosblue.pipedrive.com/deal/{deal_id}"
            }
            
            formatted_deals.append(deal_obj)
            if deal_obj["is_stagnant"]:
                stagnant_deals.append(deal_obj)
            if is_overdue:
                overdue_deals.append(deal_obj)
                
        return {
            "pipeline_id": PIPELINE_COMERCIAL_ID,
            "pipeline_name": "Comercial",
            "total_deals": len(formatted_deals),
            "total_value": total_value,
            "stages_breakdown": stages_breakdown,
            "stagnant_count": len(stagnant_deals),
            "overdue_count": len(overdue_deals),
            "deals": formatted_deals,
            "stagnant_deals": stagnant_deals,
            "overdue_deals": overdue_deals
        }

async def sync_comercial_alerts_internal(user_id: Optional[str] = None) -> Dict[str, Any]:
    """Varre o Funil Comercial e grava/atualiza os alertas de negócios parados e follow-ups atrasados no Supabase"""
    data = await fetch_comercial_pipeline_data()
    stagnant = data.get("stagnant_deals", [])
    overdue = data.get("overdue_deals", [])
    
    # 1. Pega alertas abertos existentes no Supabase para não duplicar
    existing_alerts_res = supabase.table("alerts").select("id, pipedrive_deal_id, alert_type").eq("is_resolved", False).execute()
    existing_map = {(a.get("pipedrive_deal_id"), a.get("alert_type")): a.get("id") for a in (existing_alerts_res.data or [])}
    
    alerts_created = 0
    alerts_updated = 0
    
    # Processa Negócios Parados
    for d in stagnant:
        key = (d["id"], "negocio_parado")
        desc = f"Negócio '{d['title']}' parado há {d['days_inactive']} dias na etapa '{d['stage_name']}'."
        sev = "high" if d["value"] >= 50000 or d["days_inactive"] > 30 else "medium"
        alert_payload = {
            "alert_type": "negocio_parado",
            "pipedrive_deal_id": d["id"],
            "cliente_nome": d["person_name"],
            "description": desc,
            "severity": sev,
            "is_resolved": False,
            "details": {
                "deal_id": d["id"],
                "deal_url": d["deal_url"],
                "value": d["value"],
                "stage": d["stage_name"],
                "days_inactive": d["days_inactive"]
            }
        }
        
        if key in existing_map:
            supabase.table("alerts").update(alert_payload).eq("id", existing_map[key]).execute()
            alerts_updated += 1
        else:
            supabase.table("alerts").insert(alert_payload).execute()
            alerts_created += 1
            
    # Processa Follow-ups Atrasados
    for d in overdue:
        key = (d["id"], "follow_up_atrasado")
        desc = f"Follow-up atrasado para '{d['person_name']}' no negócio '{d['title']}'. Venceu em {d['next_activity_date']}."
        sev = "high" if d["value"] >= 50000 else "medium"
        alert_payload = {
            "alert_type": "follow_up_atrasado",
            "pipedrive_deal_id": d["id"],
            "cliente_nome": d["person_name"],
            "description": desc,
            "severity": sev,
            "is_resolved": False,
            "details": {
                "deal_id": d["id"],
                "deal_url": d["deal_url"],
                "value": d["value"],
                "due_date": d["next_activity_date"]
            }
        }
        
        if key in existing_map:
            supabase.table("alerts").update(alert_payload).eq("id", existing_map[key]).execute()
            alerts_updated += 1
        else:
            supabase.table("alerts").insert(alert_payload).execute()
            alerts_created += 1
            
    log_audit_event(
        action="PIPELINE_COMERCIAL_SYNCED",
        resource_type="pipeline",
        resource_id="1",
        user_id=user_id or "system",
        details={
            "pipeline": "Comercial",
            "total_deals": data["total_deals"],
            "total_value": data["total_value"],
            "stagnant_count": len(stagnant),
            "overdue_count": len(overdue),
            "alerts_created": alerts_created,
            "alerts_updated": alerts_updated,
            "summary": f"Varredura no Funil Comercial concluída: {len(stagnant)} negócios parados e {len(overdue)} follow-ups identificados ({alerts_created} novos alertas)."
        }
    )
    
    return {
        "status": "success",
        "total_deals": data["total_deals"],
        "total_value": data["total_value"],
        "stagnant_count": len(stagnant),
        "overdue_count": len(overdue),
        "alerts_created": alerts_created,
        "alerts_updated": alerts_updated,
        "stages_breakdown": data["stages_breakdown"]
    }

@app.get("/api/pipedrive/pipeline/comercial/summary")
async def get_comercial_summary(user: dict = Depends(require_admin)):
    """Retorna resumo consolidado do Funil Comercial do Pipedrive"""
    return await fetch_comercial_pipeline_data()

@app.get("/api/pipedrive/pipeline/comercial/deals")
async def get_comercial_deals(user: dict = Depends(require_admin)):
    """Retorna lista de negócios abertos no Funil Comercial do Pipedrive"""
    data = await fetch_comercial_pipeline_data()
    return {"deals": data.get("deals", [])}

@app.post("/api/pipedrive/pipeline/comercial/sync-alerts")
async def sync_comercial_alerts_endpoint(user: dict = Depends(require_admin)):
    """Dispara a sincronização ativa de alertas do Funil Comercial com o banco"""
    return await sync_comercial_alerts_internal(user_id=user.get("id", user.get("sub")))

# ============================================================================
# TRANSCRIPTIONS ENDPOINTS
# ============================================================================

from pydantic import BaseModel

class TranscriptionResponse(BaseModel):
    id: str
    google_doc_id: str
    meeting_title: Optional[str]
    meeting_date: Optional[str]
    processing_status: str
    briefing_json: Optional[Dict]
    created_at: str

class AssignTranscriptionRequest(BaseModel):
    person_id: Optional[str] = None
    deal_id: Optional[str] = None
    custom_client_name: Optional[str] = None
    cliente_nome: Optional[str] = None
    create_note: bool = True
    create_activity: bool = True

@app.get("/api/transcriptions", response_model=List[TranscriptionResponse])
async def get_transcriptions(
    limit: int = 50,
    status: Optional[str] = None,
    user: dict = Depends(require_admin)
):
    """Lista histórico de transcrições processadas"""
    
    query = supabase.table("transcriptions").select("*").order("created_at", desc=True).limit(limit)
    
    if status:
        query = query.eq("processing_status", status)
    
    response = query.execute()
    
    return [
        TranscriptionResponse(
            id=t["id"],
            google_doc_id=t["google_doc_id"],
            meeting_title=t.get("meeting_title"),
            meeting_date=t.get("meeting_date"),
            processing_status=t["processing_status"],
            briefing_json=t.get("briefing_json"),
            created_at=t["created_at"]
        )
        for t in response.data
    ]

@app.post("/api/transcriptions/{transcription_id}/assign")
@app.post("/api/transcriptions/{transcription_id}/assign-pipedrive")
async def assign_transcription_to_crm(
    transcription_id: str,
    req: AssignTranscriptionRequest,
    user: dict = Depends(require_admin)
):
    """Atribui manualmente uma transcrição a um Cliente/Negócio no Pipedrive com criação de nota e tarefa"""
    
    # 1. Busca transcrição existente
    t_res = supabase.table("transcriptions").select("*").eq("id", transcription_id).execute()
    if not t_res.data:
        raise HTTPException(status_code=404, detail="Transcrição não encontrada")
        
    t = t_res.data[0]
    briefing_json = t.get("briefing_json") or {}
    meeting_title = t.get("meeting_title") or "Reunião"
    
    person_id = req.person_id
    deal_id = req.deal_id
    client_name = req.custom_client_name or req.cliente_nome
    
    # 2. Se informou deal_id mas não person_id, busca person_id no Deal
    if deal_id and not person_id:
        try:
            async with httpx.AsyncClient() as client:
                d_res = await client.get(
                    f"{PIPEDRIVE_BASE_URL}/deals/{deal_id}",
                    params={"api_token": PIPEDRIVE_API_TOKEN}
                )
                if d_res.status_code == 200:
                    d_data = d_res.json().get("data", {})
                    d_person = d_data.get("person")
                    if d_person and isinstance(d_person, dict):
                        person_id = str(d_person.get("id"))
                        if not client_name:
                            client_name = d_person.get("name")
        except Exception as e:
            logger.warning(f"Não foi possível buscar person_id do deal {deal_id}: {e}")
            
    # 3. Se informou person_id mas não client_name, busca nome da pessoa
    if person_id and not client_name:
        try:
            async with httpx.AsyncClient() as client:
                p_res = await client.get(
                    f"{PIPEDRIVE_BASE_URL}/persons/{person_id}",
                    params={"api_token": PIPEDRIVE_API_TOKEN}
                )
                if p_res.status_code == 200:
                    p_data = p_res.json().get("data", {})
                    client_name = p_data.get("name")
        except Exception as e:
            logger.warning(f"Não foi possível buscar nome da person {person_id}: {e}")
            
    if not client_name:
        client_name = briefing_json.get("dados_cliente", {}).get("nome") or "Cliente"
        
    # 4. Atualiza briefing_json com Pipedrive URLs
    if "pipedrive" not in briefing_json:
        briefing_json["pipedrive"] = {}
    if "dados_cliente" not in briefing_json:
        briefing_json["dados_cliente"] = {}
        
    briefing_json["dados_cliente"]["nome"] = client_name
    briefing_json["pipedrive"]["person_id"] = str(person_id) if person_id else None
    briefing_json["pipedrive"]["deal_id"] = str(deal_id) if deal_id else None
    briefing_json["pipedrive"]["person_url"] = f"https://investimentosblue.pipedrive.com/person/{person_id}" if person_id else None
    briefing_json["pipedrive"]["deal_url"] = f"https://investimentosblue.pipedrive.com/deal/{deal_id}" if deal_id else None
    
    # 5. Cria Nota no Pipedrive
    note_id = None
    if req.create_note:
        topicos_html = "".join([f"<li>{topico}</li>" for topico in briefing_json.get("principais_topicos", [])])
        note_html = (
            f"<h3>📋 Briefing da Reunião (Origem: Tactiq / Google Drive)</h3>"
            f"<p><strong>Reunião:</strong> {meeting_title}</p>"
            f"<p><strong>Cliente:</strong> {client_name}</p>"
            f"<p><strong>Interesse:</strong> {briefing_json.get('dados_cliente', {}).get('demonstrou_interesse', 'Não informado')}</p>"
            f"<h4>Principais Tópicos Abordados:</h4>"
            f"<ul>{topicos_html or '<li>Discussão patrimonial e sucessória.</li>'}</ul>"
            f"<h4>🎯 Próxima Ação Sugerida:</h4>"
            f"<p>{briefing_json.get('proxima_acao', {}).get('descricao', 'Dar continuidade aos alinhamentos')}</p>"
            f"<hr/>"
            f"<p><small>⚡ Sincronizado pelo Sistema Robson Tavernard (Investimentos Blue)</small></p>"
        )
        note_res = await create_pipedrive_note(content=note_html, deal_id=deal_id, person_id=person_id)
        if note_res:
            note_id = str(note_res.get("id"))
            briefing_json["pipedrive"]["note_id"] = note_id
            
    # 6. Atualiza registro da Transcrição
    supabase.table("transcriptions").update({
        "processing_status": "completed",
        "briefing_json": briefing_json
    }).eq("id", transcription_id).execute()
    
    # 7. Registra no Log de Auditoria
    log_audit_event(
        action="DRIVE_DOC_LINKED",
        resource_type="transcription",
        resource_id=transcription_id,
        user_id=user.get("id", user.get("sub")),
        details={
            "doc_title": meeting_title,
            "cliente_nome": client_name,
            "pipedrive_person_id": person_id,
            "pipedrive_deal_id": deal_id,
            "pipedrive_note_id": note_id,
            "deal_url": briefing_json["pipedrive"].get("deal_url"),
            "person_url": briefing_json["pipedrive"].get("person_url"),
            "proxima_acao": briefing_json.get("proxima_acao", {}).get("descricao"),
            "is_linked_to_crm": True,
            "assigned_manually": True,
            "summary": f"Transcrição '{meeting_title}' vinculada com sucesso ao cliente '{client_name}'" + (f" (Deal #{deal_id})" if deal_id else "") + " no Pipedrive por Robson com anotação sincronizada."
        }
    )
    
    return {
        "status": "success",
        "message": f"Transcrição vinculada com sucesso ao Pipedrive!",
        "person_id": person_id,
        "deal_id": deal_id,
        "person_url": briefing_json["pipedrive"].get("person_url"),
        "deal_url": briefing_json["pipedrive"].get("deal_url"),
        "briefing_json": briefing_json
    }

@app.post("/api/transcriptions/{transcription_id}/toggle-ignore")
async def toggle_ignore_transcription(
    transcription_id: str,
    user: dict = Depends(require_admin)
):
    """Alterna o status de ignorada/reunião interna de uma transcrição para não gerar alertas ou pendências"""
    t_res = supabase.table("transcriptions").select("*").eq("id", transcription_id).execute()
    if not t_res.data:
        raise HTTPException(status_code=404, detail="Transcrição não encontrada")
        
    t = t_res.data[0]
    briefing_json = t.get("briefing_json") or {}
    meeting_title = t.get("meeting_title") or "Reunião"
    
    current_ignored = briefing_json.get("is_ignored", False)
    new_ignored = not current_ignored
    briefing_json["is_ignored"] = new_ignored
    
    supabase.table("transcriptions").update({
        "briefing_json": briefing_json
    }).eq("id", transcription_id).execute()
    
    action_text = "marcada como Reunião Interna (Ignorada)" if new_ignored else "reaberta para acompanhamento"
    
    log_audit_event(
        action="TRANSCRIPTION_IGNORED" if new_ignored else "TRANSCRIPTION_UNIGNORED",
        resource_type="transcription",
        resource_id=transcription_id,
        user_id=user.get("id", user.get("sub")),
        details={
            "doc_title": meeting_title,
            "is_ignored": new_ignored,
            "summary": f"Transcrição '{meeting_title}' {action_text} por Robson."
        }
    )
    
    return {
        "status": "success",
        "is_ignored": new_ignored,
        "message": f"Transcrição {action_text} com sucesso.",
        "briefing_json": briefing_json
    }

@app.get("/api/pipeline-activities")
async def get_pipeline_activities(
    limit: int = 50,
    user: dict = Depends(require_admin)
):
    """Lista activities criadas no pipeline"""
    
    query = supabase.table("pipeline_activities").select("*").order("created_at", desc=True).limit(limit)
    response = query.execute()
    
    return response.data

# ============================================================================
# ALERTS ENDPOINTS
# ============================================================================

@app.get("/api/alerts", response_model=List[AlertResponse])
async def get_alerts(
    resolved: Optional[bool] = None,
    alert_type: Optional[str] = None,
    user: dict = Depends(require_admin)
):
    """Lista alertas consolidados"""
    
    query = supabase.table("alerts").select("*")
    
    if resolved is not None:
        query = query.eq("is_resolved", resolved)
    
    if alert_type:
        query = query.eq("alert_type", alert_type)
    
    query = query.order("created_at", desc=True).limit(100)
    
    response = query.execute()
    
    return [
        AlertResponse(
            id=alert["id"],
            alert_type=alert["alert_type"],
            cliente_nome=alert.get("cliente_nome"),
            pipedrive_deal_id=alert.get("pipedrive_deal_id"),
            description=alert["description"],
            severity=alert["severity"],
            is_resolved=alert["is_resolved"],
            details=alert.get("details"),
            created_at=alert["created_at"]
        )
        for alert in response.data
    ]

@app.patch("/api/alerts/{alert_id}")
@app.patch("/api/alerts/{alert_id}/resolve")
async def resolve_alert(alert_id: str, user: dict = Depends(require_admin)):
    """Marca alerta como resolvido e registra no log de auditoria"""
    
    # Busca dados do alerta antes de resolver
    current_alert = supabase.table("alerts").select("*").eq("id", alert_id).execute()
    alert_info = current_alert.data[0] if current_alert.data else {}
    
    response = supabase.table("alerts").update({
        "is_resolved": True,
        "resolved_by": user.get("id", user.get("sub")),
        "resolved_at": datetime.utcnow().isoformat()
    }).eq("id", alert_id).execute()
    
    log_audit_event(
        action="ALERT_RESOLVED",
        resource_type="alert",
        resource_id=alert_id,
        user_id=user.get("id", user.get("sub")),
        details={
            "alert_type": alert_info.get("alert_type"),
            "cliente_nome": alert_info.get("cliente_nome"),
            "description": alert_info.get("description"),
            "resolved_by": user.get("email"),
            "summary": f"Alerta de '{alert_info.get('alert_type', 'Geral')}' para o cliente '{alert_info.get('cliente_nome', 'Geral')}' foi marcado como resolvido."
        }
    )
    
    return {"status": "ok", "alert_id": alert_id}

# ============================================================================
# AUDIT & ACTIVITY LOGS ENDPOINTS
# ============================================================================

@app.get("/api/audit-logs")
async def get_audit_logs(
    action: Optional[str] = None,
    search: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
    user: dict = Depends(require_admin)
):
    """Retorna histórico cronológico de logs de auditoria e atribuições"""
    query = supabase.table("audit_log").select("*").order("created_at", desc=True).limit(limit)
    
    if action and action != "all":
        query = query.eq("action", action)
        
    res = query.execute()
    logs = res.data or []
    
    if search and search.strip():
        q = search.lower().strip()
        filtered = []
        for item in logs:
            details = item.get("details") or {}
            details_str = json.dumps(details).lower()
            action_str = (item.get("action") or "").lower()
            if q in details_str or q in action_str:
                filtered.append(item)
        logs = filtered
        
    return logs

@app.get("/api/audit-logs/stats")
async def get_audit_logs_stats(user: dict = Depends(require_admin)):
    """Retorna métricas consolidadas dos logs de auditoria"""
    res = supabase.table("audit_log").select("action").execute()
    rows = res.data or []
    
    drive_count = sum(1 for r in rows if "DRIVE" in r.get("action", ""))
    pipedrive_count = sum(1 for r in rows if r.get("action") == "DRIVE_DOC_LINKED" or "PIPEDRIVE" in r.get("action", ""))
    booking_count = sum(1 for r in rows if "CALENDAR" in r.get("action", "") or "BOOKING" in r.get("action", ""))
    alert_count = sum(1 for r in rows if "ALERT" in r.get("action", ""))
    
    return {
        "total_logs": len(rows),
        "drive_updates": drive_count,
        "pipedrive_assignments": pipedrive_count,
        "calendar_bookings": booking_count,
        "alerts_actions": alert_count
    }

# ============================================================================
# JOB SCHEDULER: Alertas diários
# ============================================================================

def generate_daily_alerts():
    """Job diário que consolida alertas do Funil Comercial do Pipedrive"""
    import asyncio
    try:
        logger.info("Iniciando job diário de monitoramento do Funil Comercial...")
        asyncio.run(sync_comercial_alerts_internal(user_id="system_cron"))
        logger.info("Job diário de monitoramento concluído com sucesso")
    except Exception as e:
        logger.error(f"Erro no job diário do Funil Comercial: {e}")

# Agenda job para rodar diariamente às 7h
scheduler.add_job(generate_daily_alerts, "cron", hour=7, minute=0, timezone="America/Sao_Paulo")

# ============================================================================
# HEALTH CHECK
# ============================================================================

@app.get("/health")
async def health_check():
    """Health check"""
    return {"status": "ok"}

# ============================================================================
# SYSTEM STATUS & CONFIGURATION
# ============================================================================

@app.get("/api/system/status")
async def get_system_status(user: dict = Depends(require_admin)):
    """Verifica status das conexões (Supabase, Drive, Pipedrive)"""
    status_report = {
        "supabase": {"connected": False, "detail": ""},
        "google_drive": {"connected": False, "detail": ""},
        "pipedrive": {"connected": False, "detail": ""},
        "scheduler": {"active": scheduler.running, "timezone": "America/Sao_Paulo"}
    }
    
    # 1. Supabase
    try:
        res = supabase.table("users").select("id").limit(1).execute()
        status_report["supabase"]["connected"] = True
        status_report["supabase"]["detail"] = "Conexão e RLS ativas"
    except Exception as e:
        status_report["supabase"]["detail"] = str(e)
        
    # 2. Google Drive
    try:
        folder_id = find_google_drive_folder()
        status_report["google_drive"]["connected"] = True
        status_report["google_drive"]["detail"] = f"Pasta '{GOOGLE_DRIVE_FOLDER_NAME}' conectada"
    except Exception as e:
        status_report["google_drive"]["detail"] = str(e)
        
    # 3. Pipedrive
    try:
        async with httpx.AsyncClient() as client:
            res = await client.get("https://api.pipedrive.com/v1/users/me", params={"api_token": PIPEDRIVE_API_TOKEN})
            if res.status_code == 200:
                user_info = res.json().get("data", {})
                status_report["pipedrive"]["connected"] = True
                status_report["pipedrive"]["detail"] = f"{user_info.get('name')} ({user_info.get('company_name')})"
            else:
                status_report["pipedrive"]["detail"] = f"Status {res.status_code}"
    except Exception as e:
        status_report["pipedrive"]["detail"] = str(e)
        
    return status_report

@app.get("/api/system/config")
async def get_system_config(user: dict = Depends(require_admin)):
    """Obtém configurações ativas do sistema"""
    try:
        res = supabase.table("configuration").select("*").execute()
        return res.data
    except Exception as e:
        logger.error(f"Erro ao buscar configurações: {e}")
        return []

# ============================================================================
# CALENDAR & BOOKING SYSTEM (CALENDLY / MS BOOKINGS STYLE)
# ============================================================================

DEFAULT_WEEKLY_SCHEDULE = {
    "0": {"day": 0, "name": "Domingo", "enabled": False, "intervals": []},
    "1": {"day": 1, "name": "Segunda-feira", "enabled": True, "intervals": [{"start": "09:00", "end": "18:00"}]},
    "2": {"day": 2, "name": "Terça-feira", "enabled": True, "intervals": [{"start": "09:00", "end": "18:00"}]},
    "3": {"day": 3, "name": "Quarta-feira", "enabled": True, "intervals": [{"start": "09:00", "end": "18:00"}]},
    "4": {"day": 4, "name": "Quinta-feira", "enabled": True, "intervals": [{"start": "09:00", "end": "18:00"}]},
    "5": {"day": 5, "name": "Sexta-feira", "enabled": True, "intervals": [{"start": "09:00", "end": "18:00"}]},
    "6": {"day": 6, "name": "Sábado", "enabled": False, "intervals": []},
}

class CalendarSettings(BaseModel):
    weekly_schedule: Dict[str, Any] = Field(default_factory=lambda: DEFAULT_WEEKLY_SCHEDULE)
    work_days: List[int] = [1, 2, 3, 4, 5]  # 1=Seg, 2=Ter, 3=Qua, 4=Qui, 5=Sex, 6=Sab, 7=Dom
    start_hour: str = "09:00"
    end_hour: str = "18:00"
    lunch_start: str = "12:00"
    lunch_end: str = "13:00"
    slot_duration_minutes: int = 60
    buffer_before_minutes: int = 0
    buffer_after_minutes: int = 0
    buffer_minutes: int = 0
    slot_interval_minutes: int = 30  # Limitar a hora de início a (15, 30, 60 min)
    min_notice_hours: int = 12        # Prazo de entrega mínimo (12 horas)
    max_future_days: int = 21         # Prazo de entrega máximo (21 dias)
    timezone: str = "America/Sao_Paulo"
    meeting_types: List[Dict[str, Any]] = [
        {
            "id": "r1",
            "name": "R1 Planejamento Sucessório",
            "duration": 60,
            "color": "sky",
            "description": "Primeira reunião de levantamento patrimonial e objetivos familiares.",
            "active": True
        },
        {
            "id": "r2",
            "name": "R2 Gestão Patrimonial",
            "duration": 45,
            "color": "teal",
            "description": "Apresentação da estratégia personalizada e estruturação.",
            "active": True
        },
        {
            "id": "revisao",
            "name": "Revisão de Carteira & Apólices",
            "duration": 30,
            "color": "amber",
            "description": "Acompanhamento periódico de coberturas e ativos.",
            "active": True
        },
        {
            "id": "follow_up",
            "name": "Follow-up & Alinhamento Rápido",
            "duration": 30,
            "color": "indigo",
            "description": "Tira-dúvidas e próximos passos contratuais.",
            "active": True
        }
    ]

class BookingRequest(BaseModel):
    date: str  # "YYYY-MM-DD"
    time: str  # "HH:MM"
    meeting_type_id: str
    meeting_type_name: str
    duration_minutes: int
    client_name: str
    client_email: Optional[str] = None
    client_phone: Optional[str] = None
    person_id: Optional[str] = None
    deal_id: Optional[str] = None
    platform: str = "teams"  # "teams" | "meet" | "presencial"
    notes: Optional[str] = None

@app.get("/api/calendar/settings")
async def get_calendar_settings(user: dict = Depends(require_admin)):
    """Obtém configurações de disponibilidade da agenda"""
    try:
        res = supabase.table("configuration").select("value").eq("key", "calendar_settings").execute()
        if res.data and len(res.data) > 0:
            val = res.data[0]["value"]
            data = json.loads(val) if isinstance(val, str) else val
            # Garante campos padrão caso ausentes
            if "weekly_schedule" not in data:
                data["weekly_schedule"] = DEFAULT_WEEKLY_SCHEDULE
            if "buffer_before_minutes" not in data:
                data["buffer_before_minutes"] = 0
            if "buffer_after_minutes" not in data:
                data["buffer_after_minutes"] = 0
            if "slot_interval_minutes" not in data:
                data["slot_interval_minutes"] = 30
            return data
    except Exception as e:
        logger.error(f"Erro ao buscar calendar_settings: {e}")
        
    # Default settings
    default_settings = CalendarSettings().dict()
    try:
        supabase.table("configuration").insert({
            "key": "calendar_settings",
            "value": json.dumps(default_settings),
            "value_type": "json",
            "description": "Configurações de horários e regras da agenda"
        }).execute()
    except Exception:
        pass
    return default_settings

@app.post("/api/calendar/settings")
@app.put("/api/calendar/settings")
async def save_calendar_settings(settings: CalendarSettings, user: dict = Depends(require_admin)):
    """Salva configurações de disponibilidade da agenda"""
    try:
        settings_dict = settings.dict()
        res = supabase.table("configuration").select("id").eq("key", "calendar_settings").execute()
        if res.data:
            supabase.table("configuration").update({
                "value": json.dumps(settings_dict),
                "updated_by": user.get("id", user.get("sub")),
                "updated_at": datetime.utcnow().isoformat()
            }).eq("key", "calendar_settings").execute()
        else:
            supabase.table("configuration").insert({
                "key": "calendar_settings",
                "value": json.dumps(settings_dict),
                "value_type": "json",
                "description": "Configurações de horários e regras da agenda",
                "updated_by": user.get("id", user.get("sub"))
            }).execute()
        return {"status": "ok", "settings": settings_dict}
    except Exception as e:
        logger.error(f"Erro ao salvar calendar_settings: {e}")
        raise HTTPException(status_code=500, detail=str(e))

async def fetch_pipedrive_busy_activities(start_date: str, end_date: str) -> List[Dict]:
    """Busca atividades marcadas no Pipedrive para verificar horários ocupados"""
    try:
        async with httpx.AsyncClient() as client:
            res = await client.get(
                f"https://api.pipedrive.com/v1/activities",
                params={
                    "api_token": PIPEDRIVE_API_TOKEN,
                    "start_date": start_date,
                    "end_date": end_date,
                    "done": 0,
                    "limit": 100
                }
            )
            if res.status_code == 200:
                data = res.json()
                return data.get("data", []) or []
    except Exception as e:
        logger.error(f"Erro ao buscar activities do Pipedrive: {e}")
    return []

@app.get("/api/calendar/available-slots")
async def get_available_slots(
    duration: int = 60,
    start_date: Optional[str] = None,
    days_count: int = 30,
    user: dict = Depends(require_admin)
):
    """Calcula slots livres estilo Calendly baseando-se nas regras e conflitos"""
    # 1. Carrega configurações
    settings_res = await get_calendar_settings(user)
    weekly_schedule = settings_res.get("weekly_schedule")
    work_days = settings_res.get("work_days", [1, 2, 3, 4, 5])
    start_hour_str = settings_res.get("start_hour", "09:00")
    end_hour_str = settings_res.get("end_hour", "18:00")
    lunch_start_str = settings_res.get("lunch_start", "12:00")
    lunch_end_str = settings_res.get("lunch_end", "13:00")
    
    buffer_before = settings_res.get("buffer_before_minutes", 0)
    buffer_after = settings_res.get("buffer_after_minutes", settings_res.get("buffer_minutes", 0))
    slot_step = settings_res.get("slot_interval_minutes", 30)
    min_notice_hrs = settings_res.get("min_notice_hours", 12)
    max_future_days = settings_res.get("max_future_days", 21)
    
    actual_days_count = min(days_count, max_future_days)
    
    # 2. Período de cálculo
    now_utc = datetime.utcnow()
    # Aproximação de fuso SP (-3h)
    now_local = now_utc - timedelta(hours=3)
    
    if start_date:
        try:
            curr_date = datetime.strptime(start_date, "%Y-%m-%d")
        except ValueError:
            curr_date = now_local.replace(hour=0, minute=0, second=0, microsecond=0)
    else:
        curr_date = now_local.replace(hour=0, minute=0, second=0, microsecond=0)
        
    end_calc_date = curr_date + timedelta(days=actual_days_count)
    
    # 3. Busca conflitos do Pipedrive
    busy_activities = await fetch_pipedrive_busy_activities(
        curr_date.strftime("%Y-%m-%d"),
        end_calc_date.strftime("%Y-%m-%d")
    )
    
    # Mapeia ocupações por data: { "YYYY-MM-DD": [ (start_min, end_min) ] }
    busy_by_date: Dict[str, List[tuple]] = {}
    for act in busy_activities:
        act_date = act.get("due_date")
        act_time = act.get("due_time")  # "HH:MM"
        act_dur = act.get("duration")   # "HH:MM"
        if act_date and act_time:
            try:
                th, tm = map(int, act_time.split(":")[:2])
                start_m = th * 60 + tm
                dur_m = 45
                if act_dur:
                    dh, dm = map(int, act_dur.split(":")[:2])
                    dur_m = dh * 60 + dm
                end_m = start_m + dur_m
                if act_date not in busy_by_date:
                    busy_by_date[act_date] = []
                busy_by_date[act_date].append((start_m, end_m))
            except Exception:
                pass
                
    # Converte strings de horário para minutos do dia
    def to_minutes(h_str: str) -> int:
        h, m = map(int, h_str.split(":")[:2])
        return h * 60 + m
        
    def to_time_str(mins: int) -> str:
        h = mins // 60
        m = mins % 60
        return f"{h:02d}:{m:02d}"
        
    weekday_names = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"]
    
    result_days = []
    
    for day_offset in range(actual_days_count):
        day_date = curr_date + timedelta(days=day_offset)
        date_str = day_date.strftime("%Y-%m-%d")
        
        # Mapeamento do dia da semana para weekly_schedule:
        # Python weekday(): 0=Seg, 1=Ter, 2=Qua, 3=Qui, 4=Sex, 5=Sab, 6=Dom
        # Chave weekly_schedule: "0"=Dom, "1"=Seg, "2"=Ter, "3"=Qua, "4"=Qui, "5"=Sex, "6"=Sab
        day_key = str((day_date.weekday() + 1) % 7)
        
        intervals = []
        if weekly_schedule and day_key in weekly_schedule:
            day_cfg = weekly_schedule[day_key]
            if not day_cfg.get("enabled"):
                continue
            intervals = day_cfg.get("intervals", [])
            if not intervals:
                continue
        else:
            # Fallback para work_days legado
            iso_weekday = day_date.weekday() + 1
            if iso_weekday not in work_days:
                continue
            intervals = [{"start": start_hour_str, "end": end_hour_str}]
            
        day_busy = busy_by_date.get(date_str, [])
        slots = []
        seen_slot_times = set()
        
        for iv in intervals:
            iv_start_m = to_minutes(iv.get("start", "09:00"))
            iv_end_m = to_minutes(iv.get("end", "18:00"))
            
            current_m = iv_start_m
            
            while current_m + duration <= iv_end_m:
                slot_start = current_m
                slot_end = current_m + duration
                
                # Verifica colisão com atividades ocupadas (incluindo buffer antes e depois)
                overlaps_busy = False
                for (b_start, b_end) in day_busy:
                    # O slot precisará de buffer_before livre antes de começar e buffer_after livre após terminar
                    required_start = slot_start - buffer_before
                    required_end = slot_end + buffer_after
                    if not (required_end <= b_start or required_start >= b_end):
                        overlaps_busy = True
                        break
                        
                # Verifica antecedência mínima se for o dia de hoje
                is_past = False
                if date_str == now_local.strftime("%Y-%m-%d"):
                    now_m = now_local.hour * 60 + now_local.minute
                    if slot_start < now_m + (min_notice_hrs * 60):
                        is_past = True
                elif day_date < now_local.replace(hour=0, minute=0, second=0):
                    is_past = True
                    
                time_key = to_time_str(slot_start)
                if not overlaps_busy and not is_past and time_key not in seen_slot_times:
                    seen_slot_times.add(time_key)
                    slots.append({
                        "time": time_key,
                        "end_time": to_time_str(slot_end),
                        "duration_minutes": duration
                    })
                    
                # Avança pelo intervalo configurado (slot_step)
                current_m += slot_step
                
        # Ordena slots
        slots.sort(key=lambda s: s["time"])
        
        result_days.append({
            "date": date_str,
            "weekday_name": weekday_names[day_date.weekday()],
            "day_of_month": day_date.day,
            "month_name": day_date.strftime("%B"),
            "has_slots": len(slots) > 0,
            "slots_count": len(slots),
            "slots": slots
        })
        
    return {
        "duration_minutes": duration,
        "days": result_days
    }

@app.post("/api/calendar/book")
async def book_meeting(booking: BookingRequest, user: dict = Depends(require_admin)):
    """Cria agendamento de reunião integrado ao Pipedrive"""
    try:
        # 1. Busca ou cria Pessoa no Pipedrive
        person_id = booking.person_id
        if not person_id:
            results = await search_pipedrive_person(booking.client_name, booking.client_email)
            if results:
                item_data = results[0].get("item", results[0])
                person_id = str(item_data.get("id"))
            else:
                # Cria nova pessoa
                async with httpx.AsyncClient() as client:
                    create_res = await client.post(
                        "https://api.pipedrive.com/v1/persons",
                        params={"api_token": PIPEDRIVE_API_TOKEN},
                        json={
                            "name": booking.client_name,
                            "email": [{"value": booking.client_email, "primary": True}] if booking.client_email else [],
                            "phone": [{"value": booking.client_phone, "primary": True}] if booking.client_phone else []
                        }
                    )
                    if create_res.status_code in [200, 201]:
                        person_id = str(create_res.json().get("data", {}).get("id"))
                        
        # 2. Busca Deal se não informado
        deal_id = booking.deal_id
        if person_id and not deal_id:
            deals = await get_person_deals(person_id)
            if deals:
                deal_id = str(deals[0].get("id"))
                
        # 3. Formata duração
        dur_h = booking.duration_minutes // 60
        dur_m = booking.duration_minutes % 60
        dur_str = f"{dur_h:02d}:{dur_m:02d}"
        
        subject = f"[{booking.meeting_type_name}] {booking.client_name}"
        note_content = (
            f"🎯 Tipo: {booking.meeting_type_name}\n"
            f"👤 Cliente: {booking.client_name}\n"
            f"📱 Telefone: {booking.client_phone or 'Não informado'}\n"
            f"📧 E-mail: {booking.client_email or 'Não informado'}\n"
            f"💻 Plataforma: {booking.platform.upper()}\n"
            f"📝 Observações: {booking.notes or 'Nenhuma'}\n"
            f"⚡ Agendado via Sistema Robson Blue3"
        )
        
        # 4. Cria Activity no Pipedrive
        activity = await create_pipedrive_activity(
            person_id=person_id,
            deal_id=deal_id,
            subject=subject,
            due_date=booking.date,
            note=note_content,
            activity_type="meeting"
        )
        
        if not activity:
            raise HTTPException(status_code=500, detail="Erro ao criar atividade no Pipedrive")
            
        activity_id = str(activity.get("id"))
        
        # Atualiza horário e duração na Activity
        await update_pipedrive_activity(activity_id, {
            "due_time": booking.time,
            "duration": dur_str
        })
        
        person_url = f"https://investimentosblue.pipedrive.com/person/{person_id}" if person_id else None
        deal_url = f"https://investimentosblue.pipedrive.com/deal/{deal_id}" if deal_id else None
        
        # Registra no log de auditoria
        log_audit_event(
            action="CALENDAR_BOOKING_CREATED",
            resource_type="calendar_booking",
            resource_id=activity_id,
            user_id=user.get("id", user.get("sub")),
            details={
                "client_name": booking.client_name,
                "client_email": booking.client_email,
                "client_phone": booking.client_phone,
                "meeting_type": booking.meeting_type_name,
                "date": booking.date,
                "time": booking.time,
                "duration": dur_str,
                "platform": booking.platform,
                "pipedrive_person_id": person_id,
                "pipedrive_deal_id": deal_id,
                "pipedrive_activity_id": activity_id,
                "person_url": person_url,
                "deal_url": deal_url,
                "summary": f"Novo agendamento de '{booking.meeting_type_name}' confirmado com {booking.client_name} para {booking.date} às {booking.time} ({booking.platform.upper()}). Atividade #{activity_id} vinculada ao Pipedrive."
            }
        )
        
        return {
            "status": "success",
            "message": "Reunião agendada com sucesso!",
            "activity_id": activity_id,
            "subject": subject,
            "date": booking.date,
            "time": booking.time,
            "duration": dur_str,
            "client_name": booking.client_name,
            "pipedrive_person_url": person_url,
            "pipedrive_deal_url": deal_url
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Erro ao agendar reunião: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/calendar/meetings")
async def get_scheduled_meetings(
    filter_type: str = "upcoming",  # "upcoming" | "all" | "past"
    user: dict = Depends(require_admin)
):
    """Lista reuniões agendadas no Pipedrive"""
    try:
        now_str = (datetime.utcnow() - timedelta(hours=3)).strftime("%Y-%m-%d")
        
        async with httpx.AsyncClient() as client:
            res = await client.get(
                "https://api.pipedrive.com/v1/activities",
                params={
                    "api_token": PIPEDRIVE_API_TOKEN,
                    "type": "meeting",
                    "limit": 50
                }
            )
            if res.status_code != 200:
                return []
                
            activities = res.json().get("data", []) or []
            formatted = []
            for a in activities:
                due_date = a.get("due_date") or ""
                done = a.get("done")
                
                if filter_type == "upcoming" and (due_date < now_str or done):
                    continue
                elif filter_type == "past" and due_date >= now_str and not done:
                    continue
                    
                person = a.get("person_name") or a.get("person_id")
                person_id = a.get("person_id")
                deal_id = a.get("deal_id")
                
                formatted.append({
                    "id": a.get("id"),
                    "subject": a.get("subject"),
                    "date": due_date,
                    "time": a.get("due_time") or "09:00",
                    "duration": a.get("duration") or "00:45",
                    "client_name": person if isinstance(person, str) else a.get("subject"),
                    "person_id": person_id,
                    "deal_id": deal_id,
                    "is_done": done,
                    "pipedrive_person_url": f"https://investimentosblue.pipedrive.com/person/{person_id}" if person_id else None,
                    "pipedrive_deal_url": f"https://investimentosblue.pipedrive.com/deal/{deal_id}" if deal_id else None
                })
                
            formatted.sort(key=lambda x: (x["date"], x["time"]))
            return formatted
            
    except Exception as e:
        logger.error(f"Erro ao listar reuniões agendadas: {e}")
        return []

@app.delete("/api/calendar/meetings/{activity_id}")
async def cancel_meeting(activity_id: str, user: dict = Depends(require_admin)):
    """Cancela reunião agendada no Pipedrive"""
    try:
        async with httpx.AsyncClient() as client:
            res = await client.delete(
                f"https://api.pipedrive.com/v1/activities/{activity_id}",
                params={"api_token": PIPEDRIVE_API_TOKEN}
            )
            if res.status_code == 200:
                return {"status": "ok", "message": "Reunião cancelada com sucesso"}
            else:
                raise HTTPException(status_code=res.status_code, detail="Erro ao cancelar reunião no Pipedrive")
    except Exception as e:
        logger.error(f"Erro ao cancelar reunião {activity_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# ============================================================================
# CALENDAR AUTHENTICATED ENDPOINTS
# ============================================================================

@app.get("/api/calendar/types")
async def get_calendar_meeting_types(user: dict = Depends(require_admin)):
    """Retorna tipos de reuniões para o agendador autenticado"""
    try:
        res = supabase.table("configuration").select("value").eq("key", "calendar_settings").execute()
        if res.data and len(res.data) > 0:
            val = res.data[0]["value"]
            settings_dict = json.loads(val) if isinstance(val, str) else val
            return {
                "planner_name": "Robson Vieira Tavernard",
                "planner_role": "Planejamento Financeiro e Sucessório",
                "company": "Blue3 Investimentos",
                "meeting_types": settings_dict.get("meeting_types", CalendarSettings().meeting_types),
                "timezone": settings_dict.get("timezone", "America/Sao_Paulo")
            }
    except Exception as e:
        logger.error(f"Erro ao carregar tipos de reunião: {e}")
        
    return {
        "planner_name": "Robson Vieira Tavernard",
        "planner_role": "Planejamento Financeiro e Sucessório",
        "company": "Blue3 Investimentos",
        "meeting_types": CalendarSettings().meeting_types,
        "timezone": "America/Sao_Paulo"
    }

# ============================================================================
# MAIN
# ============================================================================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
