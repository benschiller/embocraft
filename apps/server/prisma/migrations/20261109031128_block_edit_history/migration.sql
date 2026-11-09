-- CreateTable
CREATE TABLE "BlockEditHistory" (
    "id" BIGSERIAL NOT NULL,
    "worldId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "x" INTEGER NOT NULL,
    "y" INTEGER NOT NULL,
    "z" INTEGER NOT NULL,
    "materialBefore" TEXT,
    "materialAfter" TEXT,
    "editorId" TEXT NOT NULL,
    "editorName" TEXT,
    "editorKind" TEXT NOT NULL,
    "characterId" TEXT,
    "runId" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BlockEditHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BlockEditHistory_worldId_id_idx" ON "BlockEditHistory"("worldId", "id");

-- CreateIndex
CREATE INDEX "BlockEditHistory_characterId_idx" ON "BlockEditHistory"("characterId");

-- AddForeignKey
ALTER TABLE "BlockEditHistory" ADD CONSTRAINT "BlockEditHistory_worldId_fkey" FOREIGN KEY ("worldId") REFERENCES "World"("id") ON DELETE CASCADE ON UPDATE CASCADE;
