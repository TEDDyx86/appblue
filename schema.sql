-- ============================================================================
-- Schema Supabase: Automação Tactiq → Pipedrive
-- ============================================================================
-- Este arquivo contém todas as tabelas, RLS policies e índices necessários.
-- Execute na console SQL do Supabase na ordem especificada.

-- ============================================================================
-- 1. TABELA: users (Autenticação)
-- ============================================================================
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(255),
  role VARCHAR(50) DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Índices
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);

-- RLS
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Policy: Cada usuário vê apenas seus próprios dados
CREATE POLICY "Users can view own data" ON users
  FOR SELECT USING (
    auth.uid()::text = id::text OR
    (SELECT role FROM users WHERE id = auth.uid()) = 'admin'
  );

-- Policy: Apenas durante signup (sem autenticação)
CREATE POLICY "Public signup" ON users
  FOR INSERT WITH CHECK (true);

-- Policy: Usuários podem atualizar seus próprios dados
CREATE POLICY "Users update own data" ON users
  FOR UPDATE USING (auth.uid()::text = id::text);

-- ============================================================================
-- 2. TABELA: transcriptions (Histórico de transcrições do Tactiq)
-- ============================================================================
CREATE TABLE IF NOT EXISTS transcriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  google_doc_id VARCHAR(255) UNIQUE NOT NULL,
  meeting_title VARCHAR(500),
  meeting_date TIMESTAMP WITH TIME ZONE,
  meeting_duration_minutes INTEGER,
  participants TEXT[], -- Array de nomes/emails
  transcription_text TEXT,
  
  -- JSON gerado pelo Tactiq (prompt customizado)
  briefing_json JSONB, -- { principais_topicos: [...], dados_cliente: {...}, proxima_acao: {...} }
  
  processing_status VARCHAR(50) DEFAULT 'pending' CHECK (processing_status IN ('pending', 'processing', 'completed', 'failed')),
  processing_error TEXT,
  
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Índices
CREATE INDEX idx_transcriptions_google_doc_id ON transcriptions(google_doc_id);
CREATE INDEX idx_transcriptions_created_by ON transcriptions(created_by);
CREATE INDEX idx_transcriptions_status ON transcriptions(processing_status);
CREATE INDEX idx_transcriptions_created_at ON transcriptions(created_at DESC);

-- RLS
ALTER TABLE transcriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin can view all transcriptions" ON transcriptions
  FOR SELECT USING (
    (SELECT role FROM users WHERE id = auth.uid()) = 'admin'
  );

CREATE POLICY "Users can view own transcriptions" ON transcriptions
  FOR SELECT USING (created_by = auth.uid());

CREATE POLICY "Admin insert transcriptions" ON transcriptions
  FOR INSERT WITH CHECK (
    (SELECT role FROM users WHERE id = auth.uid()) = 'admin'
  );

CREATE POLICY "Admin update transcriptions" ON transcriptions
  FOR UPDATE USING (
    (SELECT role FROM users WHERE id = auth.uid()) = 'admin'
  );

-- ============================================================================
-- 3. TABELA: pipeline_activities (Vínculo Tactiq ↔ Pipedrive)
-- ============================================================================
CREATE TABLE IF NOT EXISTS pipeline_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transcription_id UUID NOT NULL REFERENCES transcriptions(id) ON DELETE CASCADE,
  
  -- Dados do cliente extraídos
  cliente_nome VARCHAR(255),
  cliente_email VARCHAR(255),
  
  -- Pipedrive IDs
  pipedrive_person_id VARCHAR(255),
  pipedrive_deal_id VARCHAR(255),
  pipedrive_activity_id VARCHAR(255) UNIQUE,
  
  -- Próxima ação
  proxima_acao_descricao TEXT,
  proxima_acao_prazo DATE,
  proxima_acao_prioridade VARCHAR(50) DEFAULT 'média' CHECK (proxima_acao_prioridade IN ('alta', 'média', 'baixa')),
  
  -- Status da reunião de Teams
  status_teams VARCHAR(50) DEFAULT 'pendente' CHECK (status_teams IN ('pendente', 'confirmado')),
  conference_meeting_url VARCHAR(500),
  
  -- Matching
  matching_confidence NUMERIC(3,2) CHECK (matching_confidence >= 0 AND matching_confidence <= 1),
  matching_manual_confirmed BOOLEAN DEFAULT FALSE,
  matching_confirmed_by UUID REFERENCES users(id),
  matching_confirmed_at TIMESTAMP WITH TIME ZONE,
  
  -- Auditoria
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Índices
CREATE INDEX idx_pipeline_activities_transcription ON pipeline_activities(transcription_id);
CREATE INDEX idx_pipeline_activities_pipedrive_deal ON pipeline_activities(pipedrive_deal_id);
CREATE INDEX idx_pipeline_activities_activity ON pipeline_activities(pipedrive_activity_id);
CREATE INDEX idx_pipeline_activities_status_teams ON pipeline_activities(status_teams);
CREATE INDEX idx_pipeline_activities_created_at ON pipeline_activities(created_at DESC);

-- RLS
ALTER TABLE pipeline_activities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin full access" ON pipeline_activities
  FOR ALL USING (
    (SELECT role FROM users WHERE id = auth.uid()) = 'admin'
  );

CREATE POLICY "Users can view" ON pipeline_activities
  FOR SELECT USING (
    (SELECT role FROM users WHERE id = auth.uid()) IN ('admin', 'user')
  );

-- ============================================================================
-- 4. TABELA: alerts (Dashboard de alertas consolidados)
-- ============================================================================
CREATE TABLE IF NOT EXISTS alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Tipo de alerta
  alert_type VARCHAR(50) NOT NULL CHECK (alert_type IN ('negocio_parado', 'follow_up_atrasado', 'teams_pendente')),
  
  -- Relações
  pipeline_activity_id UUID REFERENCES pipeline_activities(id) ON DELETE CASCADE,
  pipedrive_deal_id VARCHAR(255),
  
  -- Dados do cliente
  cliente_nome VARCHAR(255),
  cliente_email VARCHAR(255),
  
  -- Descrição
  description TEXT,
  details JSONB, -- Dados adicionais específicos do tipo de alerta
  
  -- Severidade e status
  severity VARCHAR(50) DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high')),
  is_resolved BOOLEAN DEFAULT FALSE,
  resolved_by UUID REFERENCES users(id),
  resolved_at TIMESTAMP WITH TIME ZONE,
  
  -- Auditoria
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Índices
CREATE INDEX idx_alerts_type ON alerts(alert_type);
CREATE INDEX idx_alerts_resolved ON alerts(is_resolved);
CREATE INDEX idx_alerts_severity ON alerts(severity);
CREATE INDEX idx_alerts_pipeline_activity ON alerts(pipeline_activity_id);
CREATE INDEX idx_alerts_created_at ON alerts(created_at DESC);

-- RLS
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin can view all alerts" ON alerts
  FOR SELECT USING (
    (SELECT role FROM users WHERE id = auth.uid()) = 'admin'
  );

CREATE POLICY "Users can view alerts" ON alerts
  FOR SELECT USING (
    (SELECT role FROM users WHERE id = auth.uid()) IN ('admin', 'user')
  );

CREATE POLICY "Admin update alerts" ON alerts
  FOR UPDATE USING (
    (SELECT role FROM users WHERE id = auth.uid()) = 'admin'
  );

-- ============================================================================
-- 5. TABELA: audit_log (Conformidade LGPD)
-- ============================================================================
CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(100), -- Ex: "transcription_processed", "activity_created", "alert_resolved", "matching_confirmed"
  resource_type VARCHAR(50), -- Ex: "transcription", "pipeline_activity", "alert"
  resource_id VARCHAR(255),
  
  -- O que foi feito
  old_values JSONB,
  new_values JSONB,
  details JSONB,
  
  ip_address VARCHAR(45), -- IPv4 ou IPv6
  user_agent TEXT,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Índices
CREATE INDEX idx_audit_log_user ON audit_log(user_id);
CREATE INDEX idx_audit_log_resource ON audit_log(resource_type, resource_id);
CREATE INDEX idx_audit_log_action ON audit_log(action);
CREATE INDEX idx_audit_log_created_at ON audit_log(created_at DESC);

-- RLS
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin only" ON audit_log
  FOR SELECT USING (
    (SELECT role FROM users WHERE id = auth.uid()) = 'admin'
  );

CREATE POLICY "Admin insert audit log" ON audit_log
  FOR INSERT WITH CHECK (
    (SELECT role FROM users WHERE id = auth.uid()) = 'admin'
  );

-- ============================================================================
-- 6. TABELA: configuration (Configurações do sistema)
-- ============================================================================
CREATE TABLE IF NOT EXISTS configuration (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  key VARCHAR(100) UNIQUE NOT NULL,
  value TEXT,
  value_type VARCHAR(50), -- 'string', 'integer', 'boolean', 'json'
  description TEXT,
  
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Índice
CREATE UNIQUE INDEX idx_config_key ON configuration(key);

-- RLS
ALTER TABLE configuration ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin only" ON configuration
  FOR ALL USING (
    (SELECT role FROM users WHERE id = auth.uid()) = 'admin'
  );

-- Dados padrão de configuração
INSERT INTO configuration (key, value, value_type, description) VALUES
  ('dias_negocio_parado', '15', 'integer', 'Dias sem atualização antes de considerar negócio parado'),
  ('dias_vencimento_alerta_teams', '2', 'integer', 'Dias antes do vencimento para alertar sobre Teams'),
  ('timezone', 'America/Sao_Paulo', 'string', 'Timezone para jobs agendados'),
  ('matching_confidence_min', '0.85', 'string', 'Confiança mínima para criar Activity automaticamente (0-1)'),
  ('dias_uteis_follow_up_padrao', '3', 'integer', 'Dias úteis padrão para follow-up após reunião')
ON CONFLICT (key) DO NOTHING;

-- ============================================================================
-- 7. TRIGGERS (Auditoria automática)
-- ============================================================================

-- Função para atualizar updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Aplicar em todas as tabelas
CREATE TRIGGER users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER transcriptions_updated_at BEFORE UPDATE ON transcriptions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER pipeline_activities_updated_at BEFORE UPDATE ON pipeline_activities FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER alerts_updated_at BEFORE UPDATE ON alerts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER configuration_updated_at BEFORE UPDATE ON configuration FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- 8. FUNÇÃO HELPER: Buscar alertas consolidados
-- ============================================================================
CREATE OR REPLACE FUNCTION get_consolidated_alerts(p_limit INT DEFAULT 100)
RETURNS TABLE (
  alert_id UUID,
  alert_type VARCHAR,
  cliente_nome VARCHAR,
  cliente_email VARCHAR,
  description TEXT,
  severity VARCHAR,
  is_resolved BOOLEAN,
  created_at TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    a.id,
    a.alert_type,
    a.cliente_nome,
    a.cliente_email,
    a.description,
    a.severity,
    a.is_resolved,
    a.created_at
  FROM alerts a
  WHERE a.is_resolved = FALSE
  ORDER BY 
    CASE a.severity
      WHEN 'high' THEN 1
      WHEN 'medium' THEN 2
      WHEN 'low' THEN 3
    END,
    a.created_at DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- FIM
-- ============================================================================
-- Próximas configurações no Supabase UI:
-- 1. Authentication > Providers > Email: Desabilitar "Email Confirmations" (opcional)
-- 2. Authentication > JWT: JWT Expiration = 3600 seg, Refresh = 604800 seg
-- 3. Database > Extensions > pg_cron: Habilitar (para job scheduler)
-- 4. Security > CORS: Adicionar localhost:3000 e seu domínio
-- 5. Storage > Create Bucket "transcriptions" (se usar para backup)
