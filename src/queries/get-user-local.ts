import { generalizedFindById } from './generalized-find-by-id';

// Must be ran after server creation
export const getUserLocal = async (userId: string, serverId: string, prisma: any) => {
	return await generalizedFindById({ modelName: 'localUser', kvpArray: [{ k:'id', v:serverId }, { k: 'worldUserId', v:userId }], prisma });
};
