import { defineConfig } from '@playwright/test'
export default defineConfig({testDir:'.',testMatch:'native-ui.spec.mjs',workers:1,retries:0,
  timeout:210000,globalTimeout:240000,
  reporter:[['list'],['html',{outputFolder:process.env.RECOVERY_EVIDENCE_ROOT+'/report',open:'never'}]],
  outputDir:process.env.RECOVERY_EVIDENCE_ROOT+'/results'})
