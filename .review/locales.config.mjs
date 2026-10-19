import { defineConfig } from '@playwright/test'
export default defineConfig({testDir:'.',testMatch:'locale.spec.mjs',workers:1,retries:0,
  timeout:100000,globalTimeout:240000,reporter:'list',
  outputDir:process.env.RECOVERY_EVIDENCE_ROOT+'/locales'})
