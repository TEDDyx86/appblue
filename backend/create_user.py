#!/usr/bin/env python3
"""
Script para criar usuário admin diretamente no Supabase
"""

import os
import sys
import uuid
import bcrypt
from dotenv import load_dotenv

# Carrega .env
load_dotenv()

# Pega variáveis
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
    print("❌ ERRO: SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não definidos no .env")
    sys.exit(1)

# Conecta ao Supabase
from supabase import create_client, Client

supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

# Dados do usuário
email = "righettiroberto90@gmail.com"
password = "casa102030"
full_name = "Roberto Righetti"

# Gera hash da senha
salt = bcrypt.gensalt()
password_hash = bcrypt.hashpw(password.encode(), salt).decode()

# Cria usuário
user_id = str(uuid.uuid4())

try:
    result = supabase.table("users").insert({
        "id": user_id,
        "email": email,
        "password_hash": password_hash,
        "full_name": full_name,
        "role": "admin"
    }).execute()
    
    print("=" * 60)
    print("✅ USUÁRIO CRIADO COM SUCESSO!")
    print("=" * 60)
    print(f"   ID: {user_id}")
    print(f"   Email: {email}")
    print(f"   Nome: {full_name}")
    print(f"   Role: admin")
    print("=" * 60)
    
except Exception as e:
    if "duplicate key" in str(e).lower() or "already exists" in str(e).lower():
        print("⚠️  Usuário já existe!")
        print(f"   Email: {email}")
    else:
        print(f"❌ Erro ao criar usuário: {e}")
        sys.exit(1)
