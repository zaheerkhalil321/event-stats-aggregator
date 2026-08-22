-- Update upcoming races with future dates (2026-2027 season)
UPDATE hyrox_races SET date = '2026-09-19', status = 'upcoming' WHERE id = 'bru-2025-09' OR id = 'bru-2026-09';
UPDATE hyrox_races SET date = '2026-10-03', status = 'upcoming' WHERE id = 'dub-2025-10' OR id = 'dub-2026-10';
UPDATE hyrox_races SET date = '2026-10-17', status = 'upcoming' WHERE id = 'lon-2025-10' OR id = 'lon-2026-10';
UPDATE hyrox_races SET date = '2026-11-07', status = 'upcoming' WHERE id = 'las-2025-11' OR id = 'las-2026-11';
UPDATE hyrox_races SET date = '2026-11-21', status = 'upcoming' WHERE id = 'ham-2025-11' OR id = 'ham-2026-11';
UPDATE hyrox_races SET date = '2026-12-05', status = 'upcoming' WHERE id = 'mad-2026-02' OR city = 'Madrid';
UPDATE hyrox_races SET date = '2027-01-16', status = 'upcoming' WHERE id = 'lon-2026-01';
UPDATE hyrox_races SET date = '2027-01-30', status = 'upcoming' WHERE id = 'par-2026-01';
UPDATE hyrox_races SET date = '2027-02-20', status = 'upcoming' WHERE id = 'syd-2026-02';
UPDATE hyrox_races SET date = '2027-03-06', status = 'upcoming' WHERE id = 'ber-2026-03';
UPDATE hyrox_races SET date = '2027-03-20', status = 'upcoming' WHERE id = 'ams-2026-03';
UPDATE hyrox_races SET date = '2027-05-15', status = 'upcoming' WHERE id = 'sin-2026-05';
UPDATE hyrox_races SET date = '2027-05-29', status = 'upcoming' WHERE id = 'nyc-2026-05';
UPDATE hyrox_races SET date = '2027-06-12', status = 'upcoming' WHERE id = 'chi-2025-06' OR city = 'Chicago';

-- Set default images for all races if missing
UPDATE hyrox_races SET image_url = 'https://images.unsplash.com/photo-1513635269975-59663e0ac1ad?w=800&auto=format&fit=crop&q=80' WHERE city = 'London';
UPDATE hyrox_races SET image_url = 'https://images.unsplash.com/photo-1502602898657-3e91760cbb34?w=800&auto=format&fit=crop&q=80' WHERE city = 'Paris';
UPDATE hyrox_races SET image_url = 'https://images.unsplash.com/photo-1539037116277-4db20889f2d4?w=800&auto=format&fit=crop&q=80' WHERE city = 'Madrid';
UPDATE hyrox_races SET image_url = 'https://images.unsplash.com/photo-1506973035872-a4ec16b8e8d9?w=800&auto=format&fit=crop&q=80' WHERE city = 'Sydney';
UPDATE hyrox_races SET image_url = 'https://images.unsplash.com/photo-1560969184-10fe8719e047?w=800&auto=format&fit=crop&q=80' WHERE city = 'Berlin';
UPDATE hyrox_races SET image_url = 'https://images.unsplash.com/photo-1533106497176-45ae19e68ba2?w=800&auto=format&fit=crop&q=80' WHERE city = 'Miami';
UPDATE hyrox_races SET image_url = 'https://images.unsplash.com/photo-1512470876302-972faa2aa9a4?w=800&auto=format&fit=crop&q=80' WHERE city = 'Amsterdam';
UPDATE hyrox_races SET image_url = 'https://images.unsplash.com/photo-1514395462725-fb4566210144?w=800&auto=format&fit=crop&q=80' WHERE city = 'Melbourne';
UPDATE hyrox_races SET image_url = 'https://images.unsplash.com/photo-1515586838455-8f8f940d6853?w=800&auto=format&fit=crop&q=80' WHERE city = 'Manchester';
UPDATE hyrox_races SET image_url = 'https://images.unsplash.com/photo-1496442226666-8d4d0e62e6e9?w=800&auto=format&fit=crop&q=80' WHERE city = 'New York';
UPDATE hyrox_races SET image_url = 'https://images.unsplash.com/photo-1583422409516-2895a77efded?w=800&auto=format&fit=crop&q=80' WHERE city = 'Barcelona';
UPDATE hyrox_races SET image_url = 'https://images.unsplash.com/photo-1507992781348-310259076fa0?w=800&auto=format&fit=crop&q=80' WHERE city = 'Toronto';
UPDATE hyrox_races SET image_url = 'https://images.unsplash.com/photo-1525625293386-3f8f99389edd?w=800&auto=format&fit=crop&q=80' WHERE city = 'Singapore';
UPDATE hyrox_races SET image_url = 'https://images.unsplash.com/photo-1467269204594-9661b134dd2b?w=800&auto=format&fit=crop&q=80' WHERE city = 'Munich';
UPDATE hyrox_races SET image_url = 'https://images.unsplash.com/photo-1577083552431-6e5fd01aa342?w=800&auto=format&fit=crop&q=80' WHERE city = 'Frankfurt';
UPDATE hyrox_races SET image_url = 'https://images.unsplash.com/photo-1494522855154-9297ac14b55f?w=800&auto=format&fit=crop&q=80' WHERE city = 'Chicago';
UPDATE hyrox_races SET image_url = 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=800&auto=format&fit=crop&q=80' WHERE city = 'Brussels';
UPDATE hyrox_races SET image_url = 'https://images.unsplash.com/photo-1512453979798-5ea266f8880c?w=800&auto=format&fit=crop&q=80' WHERE city = 'Dubai';
UPDATE hyrox_races SET image_url = 'https://images.unsplash.com/photo-1581351721010-8cf859cb14a4?w=800&auto=format&fit=crop&q=80' WHERE city = 'Las Vegas';
UPDATE hyrox_races SET image_url = 'https://images.unsplash.com/photo-1473496169904-658ba7c44d8a?w=800&auto=format&fit=crop&q=80' WHERE city = 'Hamburg';
