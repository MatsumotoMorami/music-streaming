-- CreateTable
CREATE TABLE "Room" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "playlist" TEXT DEFAULT '[]',
    "playMode" TEXT NOT NULL DEFAULT 'sequence',
    "currentIndex" INTEGER NOT NULL DEFAULT 0
);
