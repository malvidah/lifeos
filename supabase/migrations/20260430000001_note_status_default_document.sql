-- Change default note status from 'new' to 'document'
ALTER TABLE notes ALTER COLUMN status SET DEFAULT 'document';
UPDATE notes SET status = 'document' WHERE status = 'new';
