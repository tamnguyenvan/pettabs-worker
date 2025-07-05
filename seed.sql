-- seed.sql

-- Seed data for Images
INSERT INTO Images (imagekit_file_id, category, source_url, photographer_name, is_active) VALUES
('/cats/cute_cat_1.jpg', 'cat', '', '', 1),
('/dogs/happy_dog_1.jpg', 'dog', '', '', 1);

-- Seed data for Facts
INSERT INTO Facts (category, content, is_active) VALUES
('cat', 'Cats have five toes on their front paws, but only four on the back ones.', 1),
('dog', 'Dogs can learn more than 1000 words.', 1),
('general', 'Most pet owners sleep with their pets.', 1);

-- Seed data for Inspirations
INSERT INTO Inspirations (content, author, is_active) VALUES
('The best therapist has fur and four legs.', 'Unknown', 1),
('Happiness is a warm puppy.', 'Charles M. Schulz', 1),
('Time spent with cats is never wasted.', 'Sigmund Freud', 1),
('Dogs are not our whole life, but they make our lives whole.', 'Roger Caras', 0);  -- inactive

-- Seed data for Soundscapes
INSERT INTO Soundscapes (key, imagekit_file_id, name, is_active) VALUES
('calming-rain', '/soundscapes/calming-rain.mp3', 'Rainforest Ambience', 1),
('frog-croaking', '/soundscapes/frog-croaking.mp3', 'Happy Frogs', 1);

