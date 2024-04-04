import { DataSeeder, SeedDataAvailableEngine } from './dataseeder';
import { GithubApi, RepoFull } from './githubapi';
import { Database } from './database';
import { Stats } from './stats';
import { Version } from './version';
import { logger } from './logger';
import { Config } from './config';

import express, { Express, Request, Response } from 'express';

import * as crypto from "crypto";

const ghWebhookSecret: string = Config.get("GITHUB_WEBHOOK_SECRET", "");

export class Routes
{
    public initialize(app: Express)
    {
        app.use(express.json());

        app.get("/api", this.routeBase.bind(this));

        app.get("/api/seeddata", this.routeSeedData.bind(this));
        app.get("/api/availableengines", this.routeAvailableEngines.bind(this));

        app.post("/api/reseed", this.routeReseed.bind(this));
    }

    private updateCaches()
    {
        var dataSeeder = DataSeeder.getInstance();
        dataSeeder.cacheAllSeedData();
    }

    private routeBase(this: Routes, req: Request, res: Response)
    {
        res.send({
            apiVersion: Version.ApiVersion,
            serviceVersion: Version.ServiceVersion
        });
    }

    private routeSeedData(this: Routes, req: Request, res: Response)
    {
        logger.profile("api/seeddata");

        this.updateCaches();

        var dataSeeder = DataSeeder.getInstance();
        res.send(dataSeeder.getAvailableEngines());
        
        logger.profile("api/seeddata");
    }

    private routeAvailableEngines(this: Routes, req: Request, res: Response)
    {
        logger.profile("api/availableengines");

        this.logRequest(req);

        (async () =>
        {
            let prismaClient = Database.getPrismaClient();
            let repoAndBranchData = await prismaClient.githubCacheRepo.findMany({
                include: { branches: true }
            });

            class BranchResponse
            {
                name: string = "";
                sha: string = "";
                lastCommitDateTime: Date = new Date(0);
            }

            class RepoResponse
            {
                owner: string = "";
                name: string = "";
                friendlyName: string = "";
                description: string = "";
                notableFeatures: Array<string> = new Array<string>();
                stars: number = 0;
                forkCount: number = 0;
                license: string = "";

                branches: BranchResponse[] = new Array<BranchResponse>();
            };
            let repoResponse = new Array<RepoResponse>();

            for (let i in repoAndBranchData)
            {
                let cachedRepo = repoAndBranchData[i];
                let newRepo = new RepoResponse();
                newRepo.owner = cachedRepo.owner;
                newRepo.name = cachedRepo.name;
                newRepo.stars = cachedRepo.stars;
                newRepo.forkCount = cachedRepo.forks;
                newRepo.license = cachedRepo.license;

                let seedData = DataSeeder.getInstance().getAvailableEngineByName(`${newRepo.owner}/${newRepo.name}`);
                if (seedData)
                {
                    newRepo.friendlyName = seedData.friendlyName;
                    newRepo.description = seedData.description;
                    newRepo.notableFeatures = seedData.notableFeatures;
                }

                for (let j in cachedRepo.branches)
                {
                    let cachedBranch = cachedRepo.branches[j];
                    let newBranch = new BranchResponse();
                    newBranch.name = cachedBranch.name;
                    newBranch.sha = cachedBranch.headSHA;
                    newBranch.lastCommitDateTime = cachedBranch.commitDatetime;

                    newRepo.branches.push(newBranch);
                }

                repoResponse.push(newRepo);
            }

            res.send(repoResponse);

            logger.profile("api/availableengines");
        })();
    }

    private routeReseed(this: Routes, req: Request, res: Response)
    {
        logger.profile("api/reseed");

        // Check secret, respond with 200 even if it's not correct
        let isValidSecret = this.verifySignature(req);
        if (!isValidSecret)
        {
            res.sendStatus(200);
            
            let addr = req.socket.address();
            logger.info(`Failed to reseed (secret invalid)`, { address: addr, userAgent: req.headers['user-agent'] });

            logger.profile("api/seeddata");
            return;
        }

        console.log("Github webhook requesting reseeding");

        let owner: string = req.body["repository"]["owner"]["login"];
        let repoName: string = req.body["repository"]["name"];
        DataSeeder.getInstance().cacheAvailableEngineSeedDataFromRepo(owner, repoName);

        res.sendStatus(200);
        
        logger.profile("api/reseed");
    }

    private verifySignature(req: Request): boolean
    {
        let xHubSig = req.headers["x-hub-signature-256"] as string | undefined;
        if (!xHubSig)
        {
            return false;
        }

        const signature = crypto
            .createHmac("sha256", ghWebhookSecret)
            .update(JSON.stringify(req.body))
            .digest("hex");
        let trusted = Buffer.from(`sha256=${signature}`, 'ascii');
        let untrusted =  Buffer.from(xHubSig, 'ascii');
        return crypto.timingSafeEqual(trusted, untrusted);
    };

    private async logRequest(req: Request)
    {
        let requestCount: number = await Stats.getStat("requests", 0);
        Stats.setStat("requests", requestCount + 1);
    }
}