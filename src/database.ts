import { OctokitRepo, OctokitBranchList, OctokitBranch } from './githubapi';
import { logger } from './logger';
import { Config } from './config'

import { PrismaClient } from '@prisma/client';
import { type githubCacheRepo, githubCacheBranch } from '@prisma/client';
import { DateTime, Duration } from 'luxon';

import process from 'node:process';
import fs from 'node:fs';
import path from 'node:path';

export type RepoMin = githubCacheRepo | null;
export type BranchMin = githubCacheBranch | null;
export type RepoFull = ({ branches: githubCacheBranch[] } & githubCacheRepo) | null;

const DATE_MIN = new Date(-8640000000000000);

export class Database
{
    private static instance: Database;

    private prismaClient: PrismaClient;

    constructor()
    {
        logger.info(`Initializing database using connection URL "${process.env.DATABASE_URL}"`);

        this.prismaClient = new PrismaClient();
    }

    public static getInstance(): Database
    {
        if (!Database.instance)
            Database.instance = new Database();
        return Database.instance;
    }

    public static getPrismaClient(): PrismaClient
    {
        return this.getInstance().prismaClient;
    }

    public async initialize(): Promise<boolean>
    {
        try
        {
            return await this.isDatabaseSchemaUpToDate();
        }
        catch (e)
        {
            throw e;
        }

        return true;
    }

    public async isDatabaseSchemaUpToDate(): Promise<boolean>
    {
        let expectedMigrationName = undefined;
        if (process.env.NODE_ENV === "production")
        {
            expectedMigrationName = fs.readFileSync(path.join(process.cwd(), ".built-for-prisma-migration"), "utf8").trim();
        }

        if (expectedMigrationName === undefined || expectedMigrationName === "")
        {
            const result = await this.prismaClient.$queryRaw<Array<any>>`SELECT name FROM sqlite_master WHERE type='table' AND name='_prisma_migrations'`;
            if (result.length > 0)
                return true;
            return false;
        }
      
        // Expected migration should exist in an applied state. This doesn't necessarily
        // mean that it's the latest one (another deployment might be taking place, which
        // could end up differently; old version of the task should still pass the health
        // check, if the new version fails).
        const countResult = await this.prismaClient.$queryRaw`
          SELECT count(*) FROM _prisma_migrations WHERE migration_name = ${expectedMigrationName} AND finished_at IS NOT NULL` as Array<{ count: number }>;
      
        return countResult?.[0]?.count === 1;
      }

    public async getAllCachedRepos(): Promise<RepoMin[]>
    {
        return await this.prismaClient.githubCacheRepo.findMany();
    }

    public async getRepoBranchList(owner: string, repoName: string): Promise<BranchMin[]>
    {
        let cachedRepoData: RepoMin = await this.prismaClient.githubCacheRepo.findFirst({
            where: { owner: owner, name: repoName }
        });

        if (!cachedRepoData)
            return [];

        return await this.prismaClient.githubCacheBranch.findMany({
            where: { repoId: cachedRepoData.id }
        });
    }

    // Fetches any cached repo info, if the cache does not exist or 
    public async getCachedRepo(owner: string, repoName: string, cacheExpirationTime: Duration | null = null): Promise<RepoMin>
    {
        let cachedRepoData: RepoMin = await this.prismaClient.githubCacheRepo.findFirst({
            where: { owner: owner, name: repoName }
        });

        if (!cachedRepoData)
            return null;

        if (cacheExpirationTime)
        {
            if (this.hasCacheExpired(cachedRepoData.lastCacheTime, cacheExpirationTime))
                return null;
        }

        return cachedRepoData;
    }

    public async updateCachedRepo(repoData: OctokitRepo): Promise<RepoMin>
    {
        let prismaClient = Database.getPrismaClient();

        let owner: string = repoData.owner.login;
        let repoName: string = repoData.name;

        // Find this entry first if it exists so we can update it instead of randomly inserting a new of the same repo
        let cachedData = await prismaClient.githubCacheRepo.findFirst({
            where: { owner: owner, name: repoName }
        });

        let dbData = {
            name: repoData.name,
            owner: repoData.owner.login,
            stars: repoData.stargazers_count,
            license: repoData.license?.name ?? "",
            forks: repoData.forks_count,
            lastCacheTime: new Date()
        }
        
        // Insert into database if it doesn't exist, otherwise just update it
        return await prismaClient.githubCacheRepo.upsert({
            where: { id: cachedData?.id ?? -1 },
            update: dbData,
            create: dbData,
        });
    }

    public async updateCachedBranchList(owner: string, repoName: string, branchList: OctokitBranchList)
    {
        let prismaClient = Database.getPrismaClient();

        let cachedRepoData: RepoMin = await prismaClient.githubCacheRepo.findFirst({
            where: { owner: owner, name: repoName }
        });

        if (!cachedRepoData)
            return null;

        for (let key in branchList)
        {
            let branch = branchList[key];
            let cachedBranch = await prismaClient.githubCacheBranch.findFirst({
                where: { repoId: cachedRepoData.id, name: branch.name }
            });

            if (!cachedBranch)
            {
                await prismaClient.githubCacheBranch.create({
                    data: {
                        name: branch.name,
                        headSHA: branch.commit.sha,
                        commitDatetime: new Date(0),
                        repoId: cachedRepoData.id,
                        updateDateTime: new Date(0),
                    }
                });
            }
        }
    }

    public async getCachedBranch(owner: string, repoName: string, branchName: string, cacheExpirationTime: Duration | null = null): Promise<BranchMin>
    {
        let prismaClient = Database.getPrismaClient();

        // Have to fetch the repo first to get the repoId
        let cachedRepoData: RepoMin = await prismaClient.githubCacheRepo.findFirst({
            where: { owner: owner, name: repoName }
        });

        if (!cachedRepoData)
            return null;

        let cachedData = await prismaClient.githubCacheBranch.findFirst({
            where: { repoId: cachedRepoData.id, name: branchName }
        });

        if (!cachedData)
            return null;

        if (cacheExpirationTime)
        {
            if (this.hasCacheExpired(cachedData.updateDateTime, cacheExpirationTime))
                return null;
        }

        return cachedData;
    }

    public async updateCachedBranch(owner: string, repoName: string, branch: OctokitBranch): Promise<BranchMin>
    {
        let prismaClient = Database.getPrismaClient();

        let cachedRepoData: RepoMin = await prismaClient.githubCacheRepo.findFirst({
            where: { owner: owner, name: repoName }
        });

        if (!cachedRepoData)
            return null;

        let cachedData = await prismaClient.githubCacheBranch.findFirst({
            where: { repoId: cachedRepoData.id, name: branch.name }
        });

        let dbData = {
            name: branch.name,
            headSHA: branch.commit.sha,
            commitDatetime: DateTime.fromISO(branch.commit.commit.committer?.date ?? DATE_MIN.toISOString()).toJSDate(),
            updateDateTime: new Date(),

            repoId: cachedRepoData.id,
        };
        
        // Insert into database if it doesn't exist, otherwise just update it
        return await prismaClient.githubCacheBranch.upsert({
            where: { id: cachedData?.id ?? -1 },
            update: dbData,
            create: dbData,
        });
    }

    private hasCacheExpired(t: Date, d: Duration): boolean
    {
        let lastCacheTime: DateTime = DateTime.fromJSDate(t);
        let tDelta = DateTime.now().diff(lastCacheTime);
        if (tDelta > d)
        {
            return true;
        }
        return false;
    }
}