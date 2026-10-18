import { rootServer, RootAppStartState } from "@rootsdk/server-app";
import { openDatabase } from "./db";
import { guardService } from "./safeErrors";
import { docService } from "./docService";
import { historyService } from "./historyService";
import { initNotify, notifyService } from "./notifyService";
import { initWiki, wikiService } from "./wikiService";

async function onStarting(state: RootAppStartState) {
  await openDatabase();
  await initWiki();
  await initNotify();
  rootServer.lifecycle.addService(guardService(docService));
  rootServer.lifecycle.addService(guardService(historyService));
  rootServer.lifecycle.addService(guardService(notifyService));
  rootServer.lifecycle.addService(guardService(wikiService));
}

(async () => {
  await rootServer.lifecycle.start(onStarting);
})();
