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

-- Create the Notes table with new MMR fields
CREATE TABLE IF NOT EXISTS Notes (
    note_id INTEGER PRIMARY KEY AUTOINCREMENT,
    author TEXT,
    date INTEGER NOT NULL, -- Unix timestamp
    rating INTEGER DEFAULT 3 CHECK (rating BETWEEN 1 AND 5),
    source TEXT,
    visibility INTEGER DEFAULT 3 CHECK (visibility BETWEEN 1 AND 5),
    text TEXT NOT NULL,
    mmr INTEGER DEFAULT 1500, -- New field for MMR
    mmr_matches INTEGER DEFAULT 0 -- New field for number of MMR matches
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

-- New index for MMR-based queries
CREATE INDEX IF NOT EXISTS idx_notes_mmr ON Notes(mmr);

CREATE TABLE IF NOT EXISTS TagPasswords (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tag_id INTEGER NOT NULL,
    password_hash TEXT NOT NULL,
    max_visibility INTEGER NOT NULL,
    FOREIGN KEY (tag_id) REFERENCES Tags(tag_id)
);