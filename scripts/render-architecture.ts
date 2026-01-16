/**
 * Renders ARCHITECTURE.md by processing diagon code blocks.
 *
 * Usage:
 *   node scripts/render-architecture.ts < input.md > ARCHITECTURE.md
 *   node scripts/render-architecture.ts input.md > ARCHITECTURE.md
 *   node scripts/render-architecture.ts input.md ARCHITECTURE.md
 *
 * Input format:
 *   Use fenced code blocks with diagon language identifiers:
 *
 *   ```diagon:graphDAG
 *   Player -> VideoWorker
 *   Player -> AudioWorker
 *   ```
 *
 *   ```diagon:tree
 *   packages
 *     app
 *     audio
 *   ```
 *
 * Supported diagon types: graphDAG, tree, sequence, table, math, frame, grammar
 */

import Diagon from 'diagonjs'
import { readFileSync, writeFileSync } from 'fs'

const DIAGON_BLOCK_REGEX = /```diagon:(\w+)\n([\s\S]*?)```/g

async function main() {
  const args = process.argv.slice(2)

  // Read input
  let input: string
  if (args[0] && args[0] !== '-') {
    input = readFileSync(args[0], 'utf-8')
  } else {
    // Read from stdin
    input = readFileSync(0, 'utf-8')
  }

  // Initialize diagon
  const diagon = await Diagon.init()

  // Process all diagon blocks
  const output = input.replace(DIAGON_BLOCK_REGEX, (match, type, content) => {
    const translator = diagon.translate[type as keyof typeof diagon.translate]
    if (!translator) {
      console.error(`Warning: Unknown diagon type "${type}", leaving block unchanged`)
      return match
    }

    try {
      const result = translator(content.trim())
      return '```\n' + result + '\n```'
    } catch (error) {
      console.error(`Error processing diagon:${type} block:`, error)
      return match
    }
  })

  // Write output
  if (args[1]) {
    writeFileSync(args[1], output)
    console.error(`Written to ${args[1]}`)
  } else {
    process.stdout.write(output)
  }
}

main().catch(console.error)
