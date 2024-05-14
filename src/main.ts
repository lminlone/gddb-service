console.log("Starting...");

import { logger } from './logger';
logger.info("Application spinning up");

console.log("Main logger should be initialized");

import { Server } from './server';
var server: Server = Server.getInstance();
server.initialize();