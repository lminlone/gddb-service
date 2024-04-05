import { WebApi } from "./webapi";
import { DataSeeder, SeedDataAvailableEngine } from './dataseeder';
import { Database, RepoMin, BranchMin } from "./database";
import { OctokitRepo, OctokitBranchList, OctokitBranch } from './githubapi';
import { logger } from './logger';
import { Config } from './config';

import { Octokit } from "octokit";
import { Duration } from "luxon";

const toMilliseconds = (hrs: number, min: number, sec: number) => (hrs*60*60+min*60+sec)*1000;

export class Server
{
    private static instance: Server;

    public static getInstance(): Server
    {
        if (!Server.instance)
            Server.instance = new Server();
        return Server.instance;
    }

    public async initialize() : Promise<void>
    {
        logger.info("Starting gddb service");

        let db = Database.getInstance();
        try
        {
            await db.initialize();
        }
        catch (e)
        {
            logger.error("Could not initialize database");
            logger.error(e);
            return;
        }

        var webapi: WebApi = WebApi.getInstance();
        webapi.initialize();

        await this.updateRepoCache();
    }

    private async updateRepoCache()
    {
        logger.profile("updaterepocache");

        let repoRecacheTime: number = Config.get("REPO_CACHE_TIME", 10);
        let repoRecacheTimeMs: number = toMilliseconds(0, repoRecacheTime, 0);

        // Fetch the seed data so we can query 
        let dataSeeder = DataSeeder.getInstance();
        let availableEngines = await dataSeeder.getAvailableEngines();
        let db = Database.getInstance();

        logger.info(`Attempting to update ${availableEngines.size} repo(s)`);

        let reposCachedCount = 0;
        for (let [key, engine] of availableEngines)
        {
            let githubUri = key;
            let uriSplit = key.split("/") ?? null;
            if (uriSplit == null)
            {
                continue;
            }

            let owner: string = uriSplit[0];
            let repoName: string = uriSplit[1];

            // Fetch latest repo data from Github to recache it if cache has expired
            logger.info(`Cache miss for repo ${owner}/${repoName}`);

            let octokit: Octokit = new Octokit({ auth: Config.get("GITHUB_API_TOKEN", "") });
            let response = await octokit.rest.repos.get({ owner: owner, repo: repoName });
            if (!response || !response.data.owner)
                return;

            let cachedRepo = await db.updateCachedRepo(response.data);

            let branchList = (await octokit.rest.repos.listBranches({ owner: owner, repo: repoName })).data;
            await db.updateCachedBranchList(response.data.owner.login ?? "", response.data.name, branchList);

            let tasks = new Array<Promise<void>>;
            for (let i in branchList)
            {
                tasks.push(this.updateBranchCache(cachedRepo, branchList[i].name));
            }
            await Promise.all(tasks);

            ++reposCachedCount;
        }

        logger.info(`Cached ${reposCachedCount} repo(s)`);

        logger.profile("updaterepocache");

        setTimeout(() => { this.updateRepoCache(); }, repoRecacheTimeMs);
    }

    private async updateBranchCache(repo: RepoMin, branchName: string)
    {
        if (!repo)
            return;

        // Fetch the branch details from Github first
        let octokit: Octokit = new Octokit({ auth: Config.get("GITHUB_API_TOKEN", "") });

        let branchInfo: OctokitBranch;
        try
        {
            let response = await octokit.rest.repos.getBranch({ owner: repo.owner, repo: repo.name, branch: branchName });
            branchInfo = response.data;
        }
        catch
        {
            return;
        }

        let committer = branchInfo.commit.commit.committer;
        if (!committer)
            return;

        let db = Database.getInstance();
        await db.updateCachedBranch(repo.owner, repo.name, branchInfo);
    }
}