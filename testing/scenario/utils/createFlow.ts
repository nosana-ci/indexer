import { describe, it, afterEach, beforeEach } from 'vitest';

interface FlowContext {
  failed: boolean;
}

export function createFlow(name: string, fn: (step: typeof it) => void) {
  describe(name, () => {
    const context: FlowContext = { failed: false };

    beforeEach((testContext) => {
      if (context.failed) {
        testContext.skip();
      }
    });

    afterEach((testContext) => {
      if (testContext.task.result?.state === 'fail') {
        context.failed = true;
      }
    });

    fn(it);
  });
}
