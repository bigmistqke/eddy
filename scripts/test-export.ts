#!/usr/bin/env npx tsx
/**
 * Export test script using Puppeteer
 * Tests export with clips of different durations
 *
 * Usage:
 *   1. Start the dev server: pnpm dev
 *   2. Run this script: node --experimental-strip-types scripts/test-export.ts
 */

import * as fs from 'fs'
import puppeteer, { type Browser, type Page } from 'puppeteer'

const APP_URL = 'http://127.0.0.1:5173'
const HEADLESS = process.argv.includes('--headless')

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function main() {
  console.log('🚀 Starting export test...')
  console.log(`   URL: ${APP_URL}`)
  console.log(`   Headless: ${HEADLESS}`)
  console.log('')

  let browser: Browser | null = null

  try {
    browser = await puppeteer.launch({
      headless: HEADLESS,
      args: [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        '--autoplay-policy=no-user-gesture-required',
        '--disable-web-security',
        '--allow-file-access-from-files',
      ],
      defaultViewport: { width: 1280, height: 720 },
    })

    const page = await browser.newPage()

    // Grant permissions
    const context = browser.defaultBrowserContext()
    await context.overridePermissions(APP_URL, ['camera', 'microphone'])

    // Log console messages (filter for export transitions)
    page.on('console', msg => {
      const text = msg.text()
      // Show export-related and error logs
      if (
        text.includes('[TRANSITION]') ||
        text.includes('[NO FRAME]') ||
        text.includes('[STALE FRAME]') ||
        text.includes('time past duration') ||
        text.includes('error') ||
        text.includes('Error') ||
        text.includes('[test]')
      ) {
        console.log(`[page:${msg.type()}] ${text}`)
      }
    })

    // Navigate to editor
    console.log('📍 Navigating to editor...')
    await page.goto(`${APP_URL}/editor`, { waitUntil: 'networkidle0' })

    // Wait for initialization
    console.log('⏳ Waiting for editor to initialize...')
    await page.waitForFunction(
      () => !!(window as any).__EDDY_DEBUG__?.player && !!(window as any).__EDDY_DEBUG__?.editor,
      { timeout: 30000 },
    )

    // Record clip on track-0 for 3 seconds
    console.log('🎬 Recording clip on track-0 (3 seconds)...')
    await page.evaluate(async () => {
      const editor = (window as any).__EDDY_DEBUG__?.editor
      editor.selectTrack('track-0')
    })
    await sleep(500)

    await page.evaluate(async () => {
      const editor = (window as any).__EDDY_DEBUG__?.editor
      await editor.toggleRecording()
    })
    await sleep(3000) // Record for 3 seconds

    await page.evaluate(async () => {
      const editor = (window as any).__EDDY_DEBUG__?.editor
      await editor.toggleRecording()
    })
    await sleep(1000) // Wait for finalization

    console.log('✅ Clip 1 recorded (3s)')

    // Record clip on track-1 for 5 seconds
    console.log('🎬 Recording clip on track-1 (5 seconds)...')
    await page.evaluate(async () => {
      const editor = (window as any).__EDDY_DEBUG__?.editor
      editor.selectTrack('track-1')
    })
    await sleep(500)

    await page.evaluate(async () => {
      const editor = (window as any).__EDDY_DEBUG__?.editor
      await editor.toggleRecording()
    })
    await sleep(5000) // Record for 5 seconds

    await page.evaluate(async () => {
      const editor = (window as any).__EDDY_DEBUG__?.editor
      await editor.toggleRecording()
    })
    await sleep(1000) // Wait for finalization

    console.log('✅ Clip 2 recorded (5s)')

    // Deselect track
    await page.evaluate(() => {
      const editor = (window as any).__EDDY_DEBUG__?.editor
      editor.selectTrack(null)
    })
    await sleep(500)

    // Check clip durations
    const clipInfo = await page.evaluate(() => {
      const editor = (window as any).__EDDY_DEBUG__?.editor
      const project = editor?.project()
      return {
        tracks: project?.tracks?.map((t: any) => ({
          id: t.id,
          clips: t.clips?.map((c: any) => ({
            id: c.id,
            duration: c.duration,
          })),
        })),
      }
    })
    console.log('📊 Clip info:', JSON.stringify(clipInfo, null, 2))

    // Start export
    console.log('📤 Starting export...')

    const exportPromise = page.evaluate(async () => {
      const editor = (window as any).__EDDY_DEBUG__?.editor
      console.log('[test] Calling editor.export()')
      await editor.export()
      console.log('[test] Export completed')
      return true
    })

    // Monitor export progress
    let lastProgress = -1
    let lastPhase = ''
    let stuckCount = 0
    const maxStuckCount = 10 // 10 seconds stuck = failure

    const progressInterval = setInterval(async () => {
      try {
        const status = await page.evaluate(() => {
          const editor = (window as any).__EDDY_DEBUG__?.editor
          return {
            phase: editor?.exportPhase?.() ?? 'unknown',
            progress: editor?.exportProgress?.() ?? 0,
            isExporting: editor?.isExporting?.() ?? false,
            error: editor?.exportError?.()?.message ?? null,
          }
        })

        if (status.phase !== lastPhase || Math.abs(status.progress - lastProgress) > 0.01) {
          console.log(`📊 Export: ${status.phase} - ${(status.progress * 100).toFixed(1)}%`)
          lastProgress = status.progress
          lastPhase = status.phase
          stuckCount = 0
        } else if (status.isExporting) {
          stuckCount++
          if (stuckCount >= maxStuckCount) {
            console.log('❌ Export appears stuck!')
            console.log(`   Phase: ${status.phase}`)
            console.log(`   Progress: ${(status.progress * 100).toFixed(1)}%`)
          }
        }

        if (status.error) {
          console.log(`❌ Export error: ${status.error}`)
        }

        if (!status.isExporting && lastPhase !== '') {
          console.log('✅ Export finished')
          clearInterval(progressInterval)
        }
      } catch (e) {
        // Page might be navigating
      }
    }, 1000)

    // Wait for export to complete (with timeout)
    const timeout = 60000 // 60 seconds
    const result = await Promise.race([
      exportPromise,
      sleep(timeout).then(() => 'timeout'),
    ])

    clearInterval(progressInterval)

    if (result === 'timeout') {
      console.log('❌ Export timed out after 60 seconds')

      // Get final state
      const finalState = await page.evaluate(() => {
        const editor = (window as any).__EDDY_DEBUG__?.editor
        return {
          phase: editor?.exportPhase?.() ?? 'unknown',
          progress: editor?.exportProgress?.() ?? 0,
          isExporting: editor?.isExporting?.() ?? false,
        }
      })
      console.log('Final state:', finalState)
    } else {
      console.log('✅ Export completed successfully!')
    }

  } catch (error) {
    console.error('❌ Error:', error)
    process.exit(1)
  } finally {
    if (browser) {
      await sleep(2000) // Let user see final state if not headless
      await browser.close()
    }
  }

  console.log('')
  console.log('✅ Export test complete!')
}

main()
