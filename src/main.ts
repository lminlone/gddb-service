import { logger } from './logger';
import { Server } from './server';

logger.info("Application spinning up");

var server: Server = Server.getInstance();
server.initialize();