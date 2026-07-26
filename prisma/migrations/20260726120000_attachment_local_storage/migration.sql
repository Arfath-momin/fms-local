-- Bill/receipt images moved from a hosted image CDN to the local filesystem.
-- The column no longer holds an absolute delivery URL but a path relative to
-- the uploads root (e.g. "2026/07/<uuid>.jpg").
ALTER TABLE "attachments" RENAME COLUMN "image_url" TO "storage_key";
