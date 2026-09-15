-- Create sources table
CREATE TABLE IF NOT EXISTS sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID,
    url TEXT NOT NULL,
    title TEXT,
    content_hash TEXT,
    extraction_method TEXT,
    retrieved_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create knowledge_items table
CREATE TABLE IF NOT EXISTS knowledge_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    topic TEXT NOT NULL,
    claim TEXT NOT NULL,
    claim_type TEXT,
    confidence NUMERIC(4,2) DEFAULT 0.0,
    provenance JSONB,
    review_state TEXT DEFAULT 'candidate' CHECK (review_state IN ('candidate', 'approved', 'quarantined')),
    is_mastered BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add full text search indexes to knowledge_items
CREATE INDEX IF NOT EXISTS idx_knowledge_fts ON knowledge_items USING GIN (to_tsvector('english', topic || ' ' || claim));
CREATE INDEX IF NOT EXISTS idx_knowledge_review_state ON knowledge_items(review_state);
