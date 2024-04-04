import { Routes } from './routes';
import { logger } from './logger';
import { Config } from './config';

import http from 'http';
import express, { Express } from 'express';

export class WebApi
{
    private static instance: WebApi;
    private app: Express = express();
    private server: http.Server | null = null;
    private routes: Routes = new Routes();

    public static getInstance(): WebApi
    {
        if (!WebApi.instance)
            WebApi.instance = new WebApi();
        return WebApi.instance;
    }

    public initialize()
    {
        let listenPort: number = Config.get("PORT", 8080);

        this.server = http.createServer(this.app);
        this.server.on('listening', this.onListening.bind(this));
        this.server.listen(listenPort);

        this.routes.initialize(this.app);
    }

    protected onListening(s: WebApi)
    {
        let webApi = WebApi.getInstance();
        let addr = webApi.server?.address();

        let bind = typeof addr === 'string'
            ? 'pipe ' + addr
            : 'port ' + addr?.port;

        logger.info(`Web API started on ${bind}`);
    }
}