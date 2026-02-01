// server/src/index.ts
import { startConfigServer } from './config.js';
import { startWsServer } from './ws-server.js';

const WS_PORT = 8080;
const HTTP_PORT = 8081;

startConfigServer(HTTP_PORT);
startWsServer(WS_PORT, HTTP_PORT);
