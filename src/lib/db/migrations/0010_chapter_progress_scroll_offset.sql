-- Add intra-page scroll offset to chapter_progress so the reader can
-- resume at the exact vertical position within a tall webtoon page,
-- not just at the top of the saved page index.
ALTER TABLE `chapter_progress` ADD COLUMN `scroll_offset` REAL DEFAULT 0;
