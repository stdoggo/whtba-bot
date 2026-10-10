-- CreateTable
CREATE TABLE "Message" (
    "id" BIGSERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "worldUserId" BIGINT NOT NULL,
    "serverId" BIGINT NOT NULL,
    "channelId" BIGINT NOT NULL,
    "content" JSONB NOT NULL DEFAULT '{}',
    "likeCount" INTEGER NOT NULL DEFAULT 1,
    "dislikeCount" INTEGER NOT NULL DEFAULT 1,
    "interactions" INTEGER NOT NULL DEFAULT 2,
    "channelName" TEXT,
    "serverName" TEXT,
    "userName" TEXT,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorldUser" (
    "id" BIGINT NOT NULL,
    "worldId" BIGINT NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "globalBalance" INTEGER NOT NULL DEFAULT 0,
    "lastKnownName" TEXT NOT NULL DEFAULT '?',

    CONSTRAINT "WorldUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LocalUser" (
    "id" BIGINT NOT NULL,
    "discordServerId" BIGINT,
    "worldUserId" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "LocalUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Server" (
    "id" BIGINT NOT NULL,
    "worldId" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Server_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServerSettings" (
    "id" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "settings" JSONB DEFAULT '{}',
    "lastKnownName" TEXT DEFAULT '?',

    CONSTRAINT "ServerSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelSettings" (
    "id" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastKnownName" TEXT DEFAULT '?',
    "serverId" BIGINT NOT NULL,
    "settings" JSONB DEFAULT '{}',

    CONSTRAINT "ChannelSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "World" (
    "id" BIGSERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "World_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Message_id_key" ON "Message"("id");

-- CreateIndex
CREATE UNIQUE INDEX "WorldUser_id_key" ON "WorldUser"("id");

-- CreateIndex
CREATE UNIQUE INDEX "Server_id_key" ON "Server"("id");

-- CreateIndex
CREATE UNIQUE INDEX "ServerSettings_id_key" ON "ServerSettings"("id");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelSettings_id_key" ON "ChannelSettings"("id");

-- CreateIndex
CREATE UNIQUE INDEX "World_id_key" ON "World"("id");

-- AddForeignKey
ALTER TABLE "WorldUser" ADD CONSTRAINT "WorldUser_worldId_fkey" FOREIGN KEY ("worldId") REFERENCES "World"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocalUser" ADD CONSTRAINT "LocalUser_discordServerId_fkey" FOREIGN KEY ("discordServerId") REFERENCES "Server"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocalUser" ADD CONSTRAINT "LocalUser_worldUserId_fkey" FOREIGN KEY ("worldUserId") REFERENCES "WorldUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Server" ADD CONSTRAINT "Server_worldId_fkey" FOREIGN KEY ("worldId") REFERENCES "World"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServerSettings" ADD CONSTRAINT "ServerSettings_id_fkey" FOREIGN KEY ("id") REFERENCES "Server"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelSettings" ADD CONSTRAINT "ChannelSettings_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
