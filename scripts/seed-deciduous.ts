#!/usr/bin/env node --experimental-strip-types

import { execSync } from "child_process";

interface Commit {
  hash: string;
  subject: string;
  date: string;
  body: string;
  files: string[];
}

type NodeType = "goal" | "decision" | "option" | "action" | "outcome" | "observation";

interface DeciduousNode {
  type: NodeType;
  title: string;
  commit: string;
  files: string[];
  confidence: number;
}

// Parse commit prefix to deciduous node type
function commitToNodeType(subject: string): { type: NodeType; confidence: number } {
  const lower = subject.toLowerCase();

  if (lower.startsWith("feat:") || lower.startsWith("feat(")) {
    return { type: "action", confidence: 90 };
  }
  if (lower.startsWith("fix:") || lower.startsWith("fix(")) {
    return { type: "action", confidence: 85 };
  }
  if (lower.startsWith("refactor:") || lower.startsWith("refactor(")) {
    return { type: "action", confidence: 80 };
  }
  if (lower.startsWith("docs:") || lower.startsWith("docs(")) {
    return { type: "action", confidence: 70 };
  }
  if (lower.startsWith("test:") || lower.startsWith("test(")) {
    return { type: "action", confidence: 75 };
  }
  if (lower.startsWith("chore:") || lower.startsWith("chore(")) {
    return { type: "action", confidence: 60 };
  }
  if (lower.startsWith("style:") || lower.startsWith("style(")) {
    return { type: "action", confidence: 65 };
  }
  // Default
  return { type: "action", confidence: 70 };
}

// Get commits from git log
function getCommits(limit: number): Commit[] {
  const format = "%h|||%s|||%ai|||%b|||END_COMMIT";
  const log = execSync(`git log --format="${format}" -n ${limit}`, { encoding: "utf-8" });

  const commits: Commit[] = [];
  const entries = log.split("|||END_COMMIT").filter(e => e.trim());

  for (const entry of entries) {
    const parts = entry.trim().split("|||");
    if (parts.length < 4) continue;

    const [hash, subject, date, body] = parts;

    // Get files changed
    let files: string[] = [];
    try {
      const stat = execSync(`git show ${hash} --stat --name-only --format=""`, { encoding: "utf-8" });
      files = stat.split("\n").filter(f => f.trim() && !f.includes("|"));
    } catch {
      // ignore
    }

    commits.push({
      hash: hash.trim(),
      subject: subject.trim(),
      date: date.trim(),
      body: body.trim(),
      files,
    });
  }

  return commits;
}

// Create a deciduous node
function createNode(node: DeciduousNode): number | null {
  const filesArg = node.files.length > 0 ? `-f "${node.files.slice(0, 10).join(",")}"` : "";
  const title = node.title.replace(/"/g, '\\"');

  const cmd = `deciduous add ${node.type} "${title}" -c ${node.confidence} --commit ${node.commit} ${filesArg}`;

  try {
    const output = execSync(cmd, { encoding: "utf-8" });
    // Extract node ID from output like "Created action node 42: ..."
    const match = output.match(/node (\d+)/);
    return match ? parseInt(match[1], 10) : null;
  } catch (error) {
    console.error(`Failed to create node: ${node.title}`);
    console.error(error);
    return null;
  }
}

// Link two nodes
function linkNodes(from: number, to: number, reason: string): void {
  const reasonArg = reason.replace(/"/g, '\\"');
  try {
    execSync(`deciduous link ${from} ${to} -r "${reasonArg}"`, { encoding: "utf-8" });
  } catch (error) {
    console.error(`Failed to link ${from} -> ${to}`);
  }
}

// Main
function main() {
  const limit = parseInt(process.argv[2] || "50", 10);
  console.log(`Seeding deciduous from last ${limit} commits...\n`);

  const commits = getCommits(limit);
  console.log(`Found ${commits.length} commits\n`);

  // Process in reverse chronological order (oldest first) so we can link
  const reversed = [...commits].reverse();

  let prevNodeId: number | null = null;
  let created = 0;
  let linked = 0;

  for (const commit of reversed) {
    const { type, confidence } = commitToNodeType(commit.subject);

    const node: DeciduousNode = {
      type,
      title: commit.subject,
      commit: commit.hash,
      files: commit.files,
      confidence,
    };

    console.log(`[${commit.hash}] ${type}: ${commit.subject}`);

    const nodeId = createNode(node);
    if (nodeId !== null) {
      created++;

      // Link to previous node (chronological chain)
      if (prevNodeId !== null) {
        linkNodes(prevNodeId, nodeId, "leads_to");
        linked++;
      }

      prevNodeId = nodeId;
    }
  }

  console.log(`\nDone! Created ${created} nodes, ${linked} edges`);
  console.log(`\nRun 'deciduous nodes' to see the graph`);
  console.log(`Run 'deciduous serve' to view in browser`);
}

main();
