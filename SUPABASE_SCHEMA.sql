-- ============================================
-- LIFTAI v7.45 CLOUD SYNC - SUPABASE SCHEMA
-- ============================================
-- Run this in Supabase SQL Editor:
-- https://supabase.com/dashboard/project/xbqlejwtfbeebucrdvqn/sql/new
-- ============================================

-- Create training_blocks table
CREATE TABLE IF NOT EXISTS training_blocks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT NOT NULL,
  block_name TEXT NOT NULL,
  block_data JSONB NOT NULL,
  profile_data JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  block_length INTEGER,
  program_type TEXT,
  is_active BOOLEAN DEFAULT true
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_training_blocks_user_id ON training_blocks(user_id);
CREATE INDEX IF NOT EXISTS idx_training_blocks_created_at ON training_blocks(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_training_blocks_active ON training_blocks(user_id, is_active);

-- Auto-update timestamp function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Auto-update timestamp trigger
DROP TRIGGER IF EXISTS update_training_blocks_updated_at ON training_blocks;
CREATE TRIGGER update_training_blocks_updated_at
  BEFORE UPDATE ON training_blocks
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Enable Row Level Security
ALTER TABLE training_blocks ENABLE ROW LEVEL SECURITY;

-- Policy: Allow all operations (anonymous users)
CREATE POLICY "Enable all for users based on user_id"
  ON training_blocks
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Grant permissions
GRANT ALL ON training_blocks TO anon;
GRANT ALL ON training_blocks TO authenticated;

-- Success! Table is ready for cloud sync.
