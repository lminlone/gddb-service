import { Database } from "./database";

export class Stats
{
    public static async setStat(statName: string, value: number): Promise<void>
    {
        let prismaClient = Database.getPrismaClient();
        await prismaClient.stats.upsert({
            where: { statName: statName },
            update: { value: value },
            create: { statName: statName, value: value }
        });
    }

    public static async getStat(statName: string, defaultValue: any): Promise<number>
    {
        let prismaClient = Database.getPrismaClient();
        let response = await prismaClient.stats.findFirst({ where: { statName: statName } });

        if (response === null)
        {
            await this.setStat(statName, defaultValue);
            return defaultValue;
        }

        return response.value;
    }
}