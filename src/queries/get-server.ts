import { generalizedFindById } from './generalized-find-by-id';

// Must be ran after server creation
export const getServer = async (serverId: string, prisma: any) => {
	return await generalizedFindById({ modelName: 'server', kvpArray: [{ k:'id', v:serverId }], prisma });
};
