import { type githubCacheRepo, githubCacheBranch } from '@prisma/client';
import { Endpoints } from "@octokit/types";

export type RepoMin = githubCacheRepo | null;
export type BranchMin = githubCacheBranch | null;
export type RepoFull = ({ branches: githubCacheBranch[] } & githubCacheRepo) | null;

export type OctokitRepo = Endpoints["GET /repos/{owner}/{repo}"]["response"]["data"];
export type OctokitBranchList = Endpoints["GET /repos/{owner}/{repo}/branches"]["response"]["data"];
export type OctokitBranch = Endpoints["GET /repos/{owner}/{repo}/branches/{branch}"]["response"]["data"];

import { Octokit } from "octokit";
import config from 'config';
import { DateTime } from 'luxon';

import { Database } from './database';

const DATE_MIN = new Date(-8640000000000000);

export class GithubApi
{
    private static instance: GithubApi;

    public static getInstance(): GithubApi
    {
        if (!GithubApi.instance)
            GithubApi.instance = new GithubApi();
        return GithubApi.instance;
    }
}