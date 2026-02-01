// server/src/index.ts
import { startConfigServer } from "./config.js";

const WS_PORT = 8080;
const HTTP_PORT = 8081;
const USE_UWS = process.env.SERVER_MODE === "uws";

if (USE_UWS) {
  // uWebSockets.js mode - combined WS + HTTP on single port
  const { startUwsServer } = await import("./uws-server.js");
  startUwsServer(WS_PORT);
} else {
  // Standard ws mode - separate WS and HTTP ports
  const { startWsServer } = await import("./ws-server.js");
  startConfigServer(HTTP_PORT);
  startWsServer(WS_PORT, HTTP_PORT);
}
