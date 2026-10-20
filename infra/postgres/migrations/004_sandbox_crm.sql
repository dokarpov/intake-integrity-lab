-- Synthetic CRM provider store for explicit staging tests only.
-- Never apply in production environments or with real customer data.
CREATE TABLE IF NOT EXISTS sandbox_crm_deliveries (
 tenant_id text NOT NULL,
 operation_key char(64) NOT NULL CHECK (operation_key ~ '^[0-9a-f]{64}$'),
 outbox_id uuid NOT NULL,
 request_digest char(64) NOT NULL CHECK (request_digest ~ '^[0-9a-f]{64}$'),
 crm_record_ref text NOT NULL,
 receipt_ref text NOT NULL,
 delivered_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY (tenant_id,operation_key),
 UNIQUE (tenant_id,outbox_id),
 FOREIGN KEY (tenant_id,outbox_id) REFERENCES sales_crm_outbox_v2(tenant_id,outbox_id)
 ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS sandbox_crm_deliveries_outbox
 ON sandbox_crm_deliveries(tenant_id,outbox_id);
