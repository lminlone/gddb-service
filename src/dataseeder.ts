import { logger } from './logger';
import { Config } from './config';

import { Octokit } from 'octokit';

import { Buffer } from "buffer";
import fs from 'node:fs';
import path from 'node:path';

export class SeedDataAvailableEngine
{
    public friendlyName: string = "";
    public description: string = "";
    public notableFeatures: string[] = [];

    public static fromAny(o: any): SeedDataAvailableEngine
    {
        let result: SeedDataAvailableEngine = new SeedDataAvailableEngine();

        result.friendlyName = o["friendlyName"];
        result.description = o["description"];
        result.notableFeatures = o["notableFeatures"];

        return result;
    }
}

export class DataSeeder
{
    private static instance: DataSeeder;

    private availableEngines: Map<string, SeedDataAvailableEngine> = new Map<string, SeedDataAvailableEngine>();
    private availableEngineModules: Object = {};
    private availableEngineAlterations: Object = {};
    private availableGDExtensions: Object = {};

    public static getInstance(): DataSeeder
    {
        if (!DataSeeder.instance)
            DataSeeder.instance = new DataSeeder();
        return DataSeeder.instance;
    }

    public async getAvailableEngines(): Promise<Map<string, SeedDataAvailableEngine>>
    {
        await this.cacheAllSeedData();

        return this.availableEngines;
    }

    public getAvailableEngineKey(githubOwner: string, githubRepoName: string): string | null
    {
        for (let [key, availableEngine] of this.availableEngines)
        {
            if (key == `${githubOwner}/${githubRepoName}`)
            {
                return key;
            }
        }

        return null;
    }

    public getAvailableEngine(githubOwner: string, githubRepoName: string): SeedDataAvailableEngine | null
    {
        var key = this.getAvailableEngineKey(githubOwner, githubRepoName);
        if (key == null)
            return null;

        return this.getAvailableEngineByName(key);
    }

    public getAvailableEngineByName(name: string | null): SeedDataAvailableEngine | null
    {
        if (!name)
            return null;

        var engine = this.availableEngines.get(name);
        return engine == undefined ? null : engine;
    }

    public async cacheAllSeedData()
    {
        let owner: string = Config.get("SEED_DATA_GITHUB_OWNER", "lminlone");
        let repo: string = Config.get("SEED_DATA_GITHUB_REPO", "gddb");
        return this.cacheAvailableEngineSeedDataFromRepo(owner, repo);
    }

    public async cacheAvailableEngineSeedDataFromRepo(owner: string, repoName: string)
    {
        logger.info(`Caching seed data from Github repo ${owner}/${repoName}`);

        let dataStr: string = "{}";

        let octokit: Octokit = new Octokit({ auth: Config.get("GITHUB_API_TOKEN", "") });
        let response = await octokit.rest.repos.getContent({
            owner: owner,
            repo: repoName,
            path: "engines.json"
        });

        if ("content" in response.data)
        {
            dataStr = this.b64DecodeUnicode(response.data.content);
        }

        // Convert the incoming data to concrete types
        let data = JSON.parse(dataStr);
        this.availableEngines.clear();
        for (let key in data)
        {
            let entry = data[key];
            this.availableEngines.set(key, SeedDataAvailableEngine.fromAny(entry));
        }
    }

    private b64DecodeUnicode(str: string)
    {
        // Going backwards: from bytestream, to percent-encoding, to original string.
        return decodeURIComponent(atob(str).split('').map((c) =>
        {
            return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join(''));
    }
}