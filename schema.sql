-- schema.sql
DROP TABLE IF EXISTS Images;
CREATE TABLE Images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    imagekit_file_id TEXT NOT NULL UNIQUE, -- ID của file trên ImageKit
    category TEXT NOT NULL CHECK(category IN ('cat', 'dog')), -- cat hoặc dog
    source_url TEXT, -- URL gốc nếu cần
    photographer_name TEXT,
    is_active BOOLEAN DEFAULT TRUE
);

-- Có thể tạo thêm bảng cho Facts
DROP TABLE IF EXISTS Facts;
CREATE TABLE Facts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    -- 'cat', 'dog', 'general' cho các sự thật về động vật nói chung
    category TEXT NOT NULL CHECK(category IN ('cat', 'dog', 'general')),
    content TEXT NOT NULL UNIQUE,
    is_active BOOLEAN DEFAULT TRUE
);

-- Bảng Inspirations (Mới)
DROP TABLE IF EXISTS Inspirations;
CREATE TABLE Inspirations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT NOT NULL UNIQUE,
    author TEXT,
    is_active BOOLEAN DEFAULT TRUE
);

-- Bảng Soundscapes (Mới)
DROP TABLE IF EXISTS Soundscapes;
CREATE TABLE Soundscapes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL UNIQUE,
    imagekit_file_id TEXT NOT NULL UNIQUE, -- ID của file trên ImageKit
    name TEXT NOT NULL,
    is_active BOOLEAN DEFAULT TRUE
);
