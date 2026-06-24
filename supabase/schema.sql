-- ============================================================
-- UPDATED SUPABASE SCHEMA WITH PACKING STATUS
-- Run this in Supabase SQL Editor
-- ============================================================

-- Enable UUID
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Drop existing table if you want to recreate
-- DROP TABLE IF EXISTS order_markings_history;
-- DROP TABLE IF EXISTS order_markings;

-- ============================================================
-- TABLE: order_markings (Updated with packing_status)
-- ============================================================

CREATE TABLE IF NOT EXISTS order_markings (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    fleek_id VARCHAR(100) NOT NULL UNIQUE,
    packing_status VARCHAR(50) DEFAULT 'Pending',
    marking_text TEXT,
    marked_by VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add packing_status column if table already exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'order_markings' AND column_name = 'packing_status'
    ) THEN
        ALTER TABLE order_markings ADD COLUMN packing_status VARCHAR(50) DEFAULT 'Pending';
    END IF;
END $$;

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_order_markings_fleek_id ON order_markings(fleek_id);
CREATE INDEX IF NOT EXISTS idx_order_markings_status ON order_markings(packing_status);

-- ============================================================
-- TABLE: order_markings_history (Audit log)
-- ============================================================

CREATE TABLE IF NOT EXISTS order_markings_history (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    fleek_id VARCHAR(100) NOT NULL,
    old_packing_status VARCHAR(50),
    new_packing_status VARCHAR(50),
    old_marking_text TEXT,
    new_marking_text TEXT,
    changed_by VARCHAR(255),
    changed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_history_fleek_id ON order_markings_history(fleek_id);

-- ============================================================
-- TRIGGER: Auto-update timestamp
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_timestamp ON order_markings;
CREATE TRIGGER trg_update_timestamp
    BEFORE UPDATE ON order_markings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- TRIGGER: Log status changes
-- ============================================================

CREATE OR REPLACE FUNCTION log_status_changes()
RETURNS TRIGGER AS $$
BEGIN
    IF (TG_OP = 'UPDATE' AND (
        OLD.packing_status IS DISTINCT FROM NEW.packing_status OR
        OLD.marking_text IS DISTINCT FROM NEW.marking_text
    )) THEN
        INSERT INTO order_markings_history (
            fleek_id, old_packing_status, new_packing_status,
            old_marking_text, new_marking_text, changed_by
        ) VALUES (
            NEW.fleek_id, OLD.packing_status, NEW.packing_status,
            OLD.marking_text, NEW.marking_text, NEW.marked_by
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_log_changes ON order_markings;
CREATE TRIGGER trg_log_changes
    AFTER UPDATE ON order_markings
    FOR EACH ROW
    EXECUTE FUNCTION log_status_changes();

-- ============================================================
-- VALID STATUS CHECK CONSTRAINT
-- ============================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'valid_packing_status'
    ) THEN
        ALTER TABLE order_markings ADD CONSTRAINT valid_packing_status
        CHECK (packing_status IN (
            'Pending',
            'Hold for bundling',
            'Single dispatch lead time',
            'Single dispatch over weight',
            'Complete'
        ));
    END IF;
EXCEPTION WHEN duplicate_object THEN
    NULL;
END $$;
