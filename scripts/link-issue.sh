#!/bin/bash
# Link a deciduous node to a GitHub issue
#
# Usage:
#   ./scripts/link-issue.sh <node_id> <issue_number>
#   ./scripts/link-issue.sh 34 1
#
# This stores the issue number in the node's metadata_json.issue field.
# The sync-graph-to-issues.ts script reads this to know where to post observations.

set -e

NODE_ID=$1
ISSUE_NUMBER=$2

if [ -z "$NODE_ID" ] || [ -z "$ISSUE_NUMBER" ]; then
  echo "Usage: $0 <node_id> <issue_number>"
  echo "Example: $0 34 1"
  exit 1
fi

DB=".deciduous/deciduous.db"

if [ ! -f "$DB" ]; then
  echo "Error: Database not found at $DB"
  exit 1
fi

# Check node exists
NODE_EXISTS=$(sqlite3 "$DB" "SELECT COUNT(*) FROM decision_nodes WHERE id = $NODE_ID;")
if [ "$NODE_EXISTS" -eq 0 ]; then
  echo "Error: Node $NODE_ID not found"
  exit 1
fi

# Get current node info
NODE_INFO=$(sqlite3 "$DB" "SELECT node_type, title FROM decision_nodes WHERE id = $NODE_ID;")
echo "Linking node #$NODE_ID to issue #$ISSUE_NUMBER"
echo "  $NODE_INFO"

# Update metadata
sqlite3 "$DB" "
UPDATE decision_nodes
SET metadata_json = json_set(COALESCE(metadata_json, '{}'), '\$.issue', $ISSUE_NUMBER)
WHERE id = $NODE_ID;
"

# Verify
LINKED_ISSUE=$(sqlite3 "$DB" "SELECT json_extract(metadata_json, '\$.issue') FROM decision_nodes WHERE id = $NODE_ID;")
echo "Done. Node #$NODE_ID now linked to issue #$LINKED_ISSUE"
