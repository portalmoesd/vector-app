ALTER TABLE section_comments ADD COLUMN IF NOT EXISTS parent_id INT REFERENCES section_comments(id) ON DELETE CASCADE;
