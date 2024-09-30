-- Create the Tags table
CREATE TABLE IF NOT EXISTS Tags (
    tag_id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    readable_id TEXT NOT NULL UNIQUE
);

-- Create the TagRelationships table
CREATE TABLE IF NOT EXISTS TagRelationships (
    parent_tag_id INTEGER,
    child_tag_id INTEGER,
    PRIMARY KEY (parent_tag_id, child_tag_id),
    FOREIGN KEY (parent_tag_id) REFERENCES Tags(tag_id),
    FOREIGN KEY (child_tag_id) REFERENCES Tags(tag_id)
);

-- Create the Notes table with the new visibility field
CREATE TABLE IF NOT EXISTS Notes (
    note_id INTEGER PRIMARY KEY AUTOINCREMENT,
    author TEXT,
    date INTEGER NOT NULL, -- Unix timestamp
    rating INTEGER DEFAULT 3 CHECK (rating BETWEEN 1 AND 5),
    source TEXT,
    visibility INTEGER DEFAULT 3 CHECK (visibility BETWEEN 1 AND 5),
    text TEXT NOT NULL
);

-- Create the NoteTags table
CREATE TABLE IF NOT EXISTS NoteTags (
    note_id INTEGER,
    tag_id INTEGER,
    PRIMARY KEY (note_id, tag_id),
    FOREIGN KEY (note_id) REFERENCES Notes(note_id),
    FOREIGN KEY (tag_id) REFERENCES Tags(tag_id)
);

-- Index for faster tag searches
CREATE INDEX IF NOT EXISTS idx_note_tags ON NoteTags(tag_id);

-- Index for faster date-based queries
CREATE INDEX IF NOT EXISTS idx_notes_date ON Notes(date);