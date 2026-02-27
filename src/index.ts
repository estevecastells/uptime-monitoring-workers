import { app } from './router';
import { runChecks, recheckDown } from './cron/checker';
import { syncZones } from './cron/discovery';
import { cleanOldChecks } from './db/queries';
import type { Env } from './types';

export default {
  fetch: app.fetch,

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    switch (controller.cron) {
      case '* * * * *': {
        // Every minute: recheck monitors that are currently down
        // Every 5th minute: full check on all monitors
        const minute = new Date(controller.scheduledTime).getMinutes();
        if (minute % 5 === 0) {
          ctx.waitUntil(runChecks(env));
        } else {
          ctx.waitUntil(recheckDown(env));
        }
        break;
      }
      case '0 */6 * * *':
        ctx.waitUntil(syncZones(env));
        break;
      case '0 3 * * *':
        ctx.waitUntil(cleanOldChecks(env));
        break;
    }
  },
};
