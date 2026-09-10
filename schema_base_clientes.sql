-- ============================================================================
-- BASE DE CLIENTES — import reconciliado do export MAG
-- Execute na console SQL do Supabase.
-- ============================================================================

-- Uma linha por arquivo enviado. Guarda o diff calculado até a confirmação.
CREATE TABLE IF NOT EXISTS base_importacoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  arquivo_nome VARCHAR(255) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'aguardando_confirmacao'
    CHECK (status IN ('aguardando_confirmacao', 'aplicada', 'descartada')),
  linhas_arquivo INTEGER,
  linhas_descartadas INTEGER,
  diff_json JSONB,
  enviado_por UUID REFERENCES users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  aplicada_em TIMESTAMP WITH TIME ZONE
);

-- Grão: CPF. Os quatro primeiros números são agregados das coberturas.
CREATE TABLE IF NOT EXISTS base_clientes (
  cpf VARCHAR(11) PRIMARY KEY,
  nome VARCHAR(255),
  telefone VARCHAR(60),
  email VARCHAR(255),
  endereco TEXT,
  sexo VARCHAR(20),
  data_nascimento DATE,
  profissao VARCHAR(255),
  renda NUMERIC(14,2),
  qtd_filhos INTEGER,
  total_capital_segurado NUMERIC(16,2),
  total_premio_mensal NUMERIC(14,2),
  qtd_propostas INTEGER,
  qtd_coberturas INTEGER,
  ultima_importacao_id UUID REFERENCES base_importacoes(id),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Grão: item de cobertura.
-- item_contratado é TEXT e nunca numérico: tem 18 dígitos e não cabe em
-- float64. No tratamento manual antigo virava notação científica e o ID ficava
-- corrompido, inviabilizando a reconciliação.
CREATE TABLE IF NOT EXISTS base_coberturas (
  item_contratado TEXT PRIMARY KEY,
  cpf VARCHAR(11) NOT NULL,
  nome_segurado VARCHAR(255),
  proposta TEXT,
  produto VARCHAR(255),
  status_cobertura VARCHAR(80),
  capital_segurado NUMERIC(16,2),
  premio_atual NUMERIC(14,2),
  premio_mensalizado NUMERIC(14,2),
  premio_anualizado NUMERIC(14,2),
  premio_implantado_liquido NUMERIC(14,2),
  iof_implantado NUMERIC(14,2),
  periodicidade VARCHAR(30),
  forma_pagamento VARCHAR(60),
  dia_vencimento INTEGER,
  data_entrada TIMESTAMP WITH TIME ZONE,
  inicio_vigencia DATE,
  fim_vigencia DATE,
  tempo_contribuicao INTEGER,
  prazo_decrescimo INTEGER,
  prazo_diferimento INTEGER,
  am VARCHAR(60),
  produtor_principal VARCHAR(255),
  corretor_pj VARCHAR(255),
  corretor_estruturado VARCHAR(255),
  unidade_producao VARCHAR(120),
  oferta_comercial VARCHAR(255),
  ultima_importacao_id UUID REFERENCES base_importacoes(id),
  visto_em TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_base_coberturas_cpf ON base_coberturas(cpf);
CREATE INDEX IF NOT EXISTS idx_base_coberturas_status ON base_coberturas(status_cobertura);
CREATE INDEX IF NOT EXISTS idx_base_clientes_nome ON base_clientes(nome);
CREATE INDEX IF NOT EXISTS idx_base_importacoes_status ON base_importacoes(status);

ALTER TABLE base_importacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE base_clientes   ENABLE ROW LEVEL SECURITY;
ALTER TABLE base_coberturas ENABLE ROW LEVEL SECURITY;

-- CREATE POLICY não aceita IF NOT EXISTS. Sem o DROP antes, rodar este arquivo
-- uma segunda vez quebraria em "policy already exists" — e o resto do script é
-- idempotente, então ele precisa ser re-executável inteiro.
DROP POLICY IF EXISTS svc_base_importacoes ON base_importacoes;
DROP POLICY IF EXISTS svc_base_clientes    ON base_clientes;
DROP POLICY IF EXISTS svc_base_coberturas  ON base_coberturas;

CREATE POLICY svc_base_importacoes ON base_importacoes FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY svc_base_clientes    ON base_clientes    FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY svc_base_coberturas  ON base_coberturas  FOR ALL USING (true) WITH CHECK (true);
