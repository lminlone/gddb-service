import { env } from 'node:process'

export class Config
{
    public static get(n: string, defaultVal: any): any
    {
        let envValue = env[n]
        return envValue ? envValue : defaultVal;
    }

    public static has(n: string): boolean
    {
        return env[n] ? true : false;
    }
}