-- Create skills table
CREATE TABLE IF NOT EXISTS skills (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    definition JSONB NOT NULL,
    status TEXT DEFAULT 'candidate' CHECK (status IN ('candidate', 'validated', 'approved', 'deprecated', 'quarantined')),
    version INTEGER DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create skill_runs table
CREATE TABLE IF NOT EXISTS skill_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    skill_id UUID REFERENCES skills(id),
    task_id UUID,
    success BOOLEAN DEFAULT false,
    metrics JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
