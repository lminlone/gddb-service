console.log("Starting...");

import { logger } from './logger';
logger.info("Application spinning up");

import { Server } from './server';
var server: Server = Server.getInstance();
server.initialize();