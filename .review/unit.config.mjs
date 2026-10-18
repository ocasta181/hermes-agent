export default {test:{root:process.env.RECOVERY_SOURCE_ROOT,environment:'node',maxWorkers:1,
  include:['apps/desktop/electron/payload-backend.test.ts','apps/desktop/electron/local-gateway-python-runtime.test.ts'],
  testTimeout:30000}}
