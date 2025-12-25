-- Add visibility and password hash to rooms
ALTER TABLE "Room" ADD COLUMN "visibility" TEXT NOT NULL DEFAULT 'public';
ALTER TABLE "Room" ADD COLUMN "passwordHash" TEXT;
