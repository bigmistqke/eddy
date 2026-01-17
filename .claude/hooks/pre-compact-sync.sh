#!/bin/bash
# Pre-compaction safety net: sync deciduous graph before context is lost

echo "Pre-compaction: syncing deciduous graph..." >&2
deciduous sync 2>/dev/null

# Output will be shown to user
echo "Context compacting - deciduous synced. Run /recover after to restore context."
