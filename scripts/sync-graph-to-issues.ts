#!/usr/bin/env npx tsx
/**
 * Sync decision graph observations to GitHub issues
 *
 * Maps decisions/goals to issues, posts linked observations as comments.
 *
 * Usage:
 *   npx tsx scripts/sync-graph-to-issues.ts [--dry-run] [--node <id>]
 *
 * Options:
 *   --dry-run     Show what would be posted without posting
 *   --node <id>   Only sync a specific node
 */

import { execSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'

// Issue mapping is stored in the graph itself via metadata_json.issue
// To link a decision to an issue, use the helper script:
//   ./scripts/link-issue.sh <node_id> <issue_number>
//   ./scripts/link-issue.sh 34 1

// Track synced nodes to avoid duplicates
const SYNCED_FILE = '.deciduous/synced-to-issues.json'

interface SyncedNodes {
  [nodeId: string]: {
    issueNumber: number
    commentId: string
    syncedAt: string
  }
}

interface GraphNode {
  id: number
  node_type: string
  title: string
  description: string | null
  status: string
  created_at: string
  metadata_json: string
}

interface GraphEdge {
  id: number
  from_node_id: number
  to_node_id: number
  edge_type: string
  rationale: string | null
}

interface Graph {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

function loadSyncedNodes(): SyncedNodes {
  try {
    return JSON.parse(fs.readFileSync(SYNCED_FILE, 'utf-8'))
  } catch {
    return {}
  }
}

function saveSyncedNodes(synced: SyncedNodes): void {
  const dir = path.dirname(SYNCED_FILE)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  fs.writeFileSync(SYNCED_FILE, JSON.stringify(synced, null, 2))
}

function getGraph(): Graph {
  const output = execSync('deciduous graph', { encoding: 'utf-8' })
  return JSON.parse(output)
}

function getNodePrompt(nodeId: number): string {
  const output = execSync(`deciduous show ${nodeId}`, { encoding: 'utf-8' })
  // Extract prompt section
  const promptMatch = output.match(/Prompt\n([\s\S]*?)(?:\n\nConnections|$)/)
  if (promptMatch) {
    return promptMatch[1].split('\n').map(line => line.replace(/^  /, '')).join('\n').trim()
  }
  return ''
}

function getNodeIssue(node: GraphNode): number | null {
  try {
    const metadata = JSON.parse(node.metadata_json || '{}')
    return metadata.issue ?? null
  } catch {
    return null
  }
}

function findLinkedIssues(graph: Graph, nodeId: number): number[] {
  const issues: number[] = []
  const nodeMap = new Map(graph.nodes.map(n => [n.id, n]))

  // Check if node itself has an issue
  const node = nodeMap.get(nodeId)
  if (node) {
    const issue = getNodeIssue(node)
    if (issue) issues.push(issue)
  }

  // Find parent nodes via incoming edges
  for (const edge of graph.edges) {
    if (edge.to_node_id === nodeId) {
      const parent = nodeMap.get(edge.from_node_id)
      if (parent) {
        const issue = getNodeIssue(parent)
        if (issue) issues.push(issue)
      }
      // Also check grandparents
      for (const edge2 of graph.edges) {
        if (edge2.to_node_id === edge.from_node_id) {
          const grandparent = nodeMap.get(edge2.from_node_id)
          if (grandparent) {
            const issue = getNodeIssue(grandparent)
            if (issue) issues.push(issue)
          }
        }
      }
    }
  }

  return [...new Set(issues)]
}

function formatNodeAsComment(node: GraphNode, prompt: string): string {
  const metadata = JSON.parse(node.metadata_json || '{}')
  const confidence = metadata.confidence ? `${metadata.confidence}%` : 'N/A'

  let body = `## ${node.node_type.charAt(0).toUpperCase() + node.node_type.slice(1)}: ${node.title}\n\n`

  if (prompt) {
    // Format prompt content
    body += prompt
      .split('\n')
      .map(line => {
        // Convert code blocks
        if (line.startsWith('```')) return line
        return line
      })
      .join('\n')
    body += '\n\n'
  }

  body += `---\n`
  body += `_From decision graph node #${node.id} | Confidence: ${confidence} | ${new Date(node.created_at).toLocaleDateString()}_`

  return body
}

function postComment(issueNumber: number, body: string, dryRun: boolean): string | null {
  if (dryRun) {
    console.log(`\n[DRY RUN] Would post to issue #${issueNumber}:`)
    console.log(body.substring(0, 500) + (body.length > 500 ? '...' : ''))
    return 'dry-run-comment-id'
  }

  // Write body to temp file to avoid shell escaping issues
  const tmpFile = `/tmp/gh-comment-${Date.now()}.md`
  try {
    fs.writeFileSync(tmpFile, body)
    const result = execSync(
      `gh issue comment ${issueNumber} --body-file "${tmpFile}"`,
      { encoding: 'utf-8' }
    )
    fs.unlinkSync(tmpFile)
    // Extract comment URL
    const match = result.match(/https:\/\/github\.com\/.*#issuecomment-(\d+)/)
    return match ? match[1] : 'unknown'
  } catch (error) {
    try { fs.unlinkSync(tmpFile) } catch {}
    console.error(`Failed to post comment to issue #${issueNumber}:`, error)
    return null
  }
}

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const nodeIdArg = args.indexOf('--node')
  const specificNodeId = nodeIdArg !== -1 ? parseInt(args[nodeIdArg + 1], 10) : null

  console.log('🔄 Syncing decision graph to GitHub issues...')
  if (dryRun) console.log('   (dry run mode)')

  const graph = getGraph()
  const synced = loadSyncedNodes()

  // Find observations to sync (options are too noisy, observations are findings/benchmarks)
  const nodesToSync = graph.nodes.filter(node => {
    // Only sync observations by default (benchmarks, discoveries, learnings)
    if (node.node_type !== 'observation') return false

    // Filter by specific node if requested
    if (specificNodeId !== null && node.id !== specificNodeId) return false

    // Skip already synced
    if (synced[node.id]) {
      console.log(`   Skipping node #${node.id} (already synced)`)
      return false
    }

    return true
  })

  console.log(`\n📋 Found ${nodesToSync.length} nodes to sync`)

  let syncedCount = 0
  for (const node of nodesToSync) {
    const issues = findLinkedIssues(graph, node.id)

    if (issues.length === 0) {
      console.log(`   Node #${node.id}: no linked issues found`)
      continue
    }

    const prompt = getNodePrompt(node.id)
    const comment = formatNodeAsComment(node, prompt)

    for (const issueNumber of issues) {
      console.log(`\n📝 Posting node #${node.id} to issue #${issueNumber}...`)

      const commentId = postComment(issueNumber, comment, dryRun)

      if (commentId) {
        synced[node.id] = {
          issueNumber,
          commentId,
          syncedAt: new Date().toISOString(),
        }
        syncedCount++
      }
    }
  }

  if (!dryRun) {
    saveSyncedNodes(synced)
  }

  console.log(`\n✅ Synced ${syncedCount} nodes to issues`)
}

main().catch(console.error)
