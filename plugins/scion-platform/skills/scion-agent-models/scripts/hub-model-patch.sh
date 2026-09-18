#!/usr/bin/env bash
# hub-model-patch.sh — Live-patch model configurations on running Scion agents
set -euo pipefail

HUB_URL="${SCION_HUB_ENDPOINT:-}"
AGENT_TARGET=""
PROJECT_FILTER=""
TEMPLATE_FILTER=""
NEW_MODEL=""
DRY_RUN=false
OUTPUT_JSON=false

usage() {
  cat <<EOF
Usage: $(basename "$0") --hub <https://hub.example.com/> --model <model-identifier> [targets] [options]

Targeting (specify at least one):
  --agent <id|slug>     Target a specific agent by ID or slug
  --project <id|slug>   Filter targets to a specific project
  --template <name>     Filter targets by agent template (e.g. 'coordinator', 'developer')
  --all                 Target all matching active agents

Required:
  --model <model>       Model string to set (e.g. 'claude-opus-4-8', 'gemini-3.8-flash', 'claude-3-7-sonnet')

Options:
  --hub <url>           Hub endpoint URL (required or via SCION_HUB_ENDPOINT)
  --dry-run             Preview matching agents and proposed changes without applying
  --json                Output results in JSON format
  -h, --help            Show this help message

Examples:
  # Patch a single coordinator by ID:
  $(basename "$0") --hub \$HUB --agent 1e156f1c-7ace... --model claude-opus-4-8

  # Dry-run: preview updating all developer agents in okf-app to gemini-3.8-flash:
  $(basename "$0") --hub \$HUB --project okf-app --template developer --model gemini-3.8-flash --dry-run

  # Live-patch all running coordinators across all projects to claude-opus-4-8:
  $(basename "$0") --hub \$HUB --all --template coordinator --model claude-opus-4-8
EOF
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --hub)
      HUB_URL="$2"
      shift 2
      ;;
    --agent)
      AGENT_TARGET="$2"
      shift 2
      ;;
    --project)
      PROJECT_FILTER="$2"
      shift 2
      ;;
    --template)
      TEMPLATE_FILTER="$2"
      shift 2
      ;;
    --model)
      NEW_MODEL="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --all)
      shift
      ;;
    --json)
      OUTPUT_JSON=true
      shift
      ;;
    -h|--help)
      usage
      ;;
    *)
      echo "Unknown flag: $1" >&2
      usage
      ;;
  esac
done

if [[ -z "$HUB_URL" ]]; then
  echo "Error: --hub <url> or SCION_HUB_ENDPOINT is required." >&2
  usage
fi

if [[ -z "$NEW_MODEL" ]]; then
  echo "Error: --model <model-name> is required." >&2
  usage
fi

if [[ -z "$AGENT_TARGET" && -z "$PROJECT_FILTER" && -z "$TEMPLATE_FILTER" ]]; then
  echo "Error: You must specify a target: --agent, --project, or --template." >&2
  usage
fi

[[ "$HUB_URL" != */ ]] && HUB_URL="${HUB_URL}/"
API_BASE="${HUB_URL%/}"

for cmd in jq curl; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Error: Required command '$cmd' not found in PATH." >&2
    exit 1
  fi
done

CREDS_FILE="${HOME}/.scion/credentials.json"
if [[ ! -f "$CREDS_FILE" ]]; then
  echo "Error: $CREDS_FILE not found. Authenticate first with: scion hub auth login --hub-url $HUB_URL --no-browser" >&2
  exit 1
fi

TOKEN=$(jq -r --arg h "$HUB_URL" '.hubs[$h].accessToken // empty' "$CREDS_FILE")
if [[ -z "$TOKEN" ]]; then
  echo "Error: No access token for $HUB_URL found in $CREDS_FILE." >&2
  exit 1
fi

# Fetch agents
AGENTS_RAW=$(curl -s -H "Authorization: Bearer $TOKEN" "${API_BASE}/api/v1/agents?limit=250")

# Identify matching targets
MATCHES=$(echo "$AGENTS_RAW" | jq \
  --arg a_target "$AGENT_TARGET" \
  --arg p_filter "$PROJECT_FILTER" \
  --arg t_filter "$TEMPLATE_FILTER" '
  (.agents // .) |
  [ .[] |
    select(
      ($a_target != "" and (.id == $a_target or .slug == $a_target or .name == $a_target)) or
      ($a_target == "" and
        ($p_filter == "" or .projectId == $p_filter or .groveId == $p_filter or .project == $p_filter) and
        ($t_filter == "" or .template == $t_filter)
      )
    ) |
    {
      id: .id,
      name: .name,
      slug: .slug,
      project: .project,
      projectId: (.projectId // .groveId),
      template: (.template // "none"),
      phase: .phase,
      currentModel: (.appliedConfig.model // "(unset)"),
      harness: (.appliedConfig.harnessConfig // .harness // "unknown")
    }
  ]
')

COUNT=$(echo "$MATCHES" | jq 'length')
if [[ "$COUNT" -eq 0 ]]; then
  echo "No agents found matching the specified criteria."
  exit 0
fi

if [[ "$DRY_RUN" == "true" ]]; then
  if [[ "$OUTPUT_JSON" == "true" ]]; then
    jq -n --arg new "$NEW_MODEL" --argjson matches "$MATCHES" '{dryRun: true, proposedModel: $new, targetCount: ($matches | length), targets: $matches}'
  else
    echo "=== DRY RUN: Found $COUNT matching agent(s) to patch with model '$NEW_MODEL' ==="
    echo "$MATCHES" | jq -r --arg new "$NEW_MODEL" '
      .[] |
      "  * [\(.name)] (\(.id)) in project \(.project) [phase: \(.phase)]\n" +
      "      Template: \(.template) | Harness: \(.harness)\n" +
      "      Current Model: \(.currentModel)  -->  Proposed Model: \($new)\n"
    '
    echo "Dry run complete. No changes were applied."
  fi
  exit 0
fi

# Execute Live Patch
RESULTS="[]"
for row in $(echo "$MATCHES" | jq -r '.[] | @base64'); do
  _decode() {
    echo "$row" | base64 --decode | jq -r "$1"
  }
  AID=$(_decode '.id')
  ANAME=$(_decode '.name')
  ACURR=$(_decode '.currentModel')

  # Send PATCH request
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "${API_BASE}/api/v1/agents/${AID}" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"config\": {\"model\": \"${NEW_MODEL}\"}}")

  SUCCESS=false
  if [[ "$HTTP_CODE" -ge 200 && "$HTTP_CODE" -lt 300 ]]; then
    SUCCESS=true
    if [[ "$OUTPUT_JSON" != "true" ]]; then
      echo "✓ Successfully patched $ANAME ($AID): $ACURR -> $NEW_MODEL"
    fi
  else
    if [[ "$OUTPUT_JSON" != "true" ]]; then
      echo "✗ Failed to patch $ANAME ($AID) [HTTP $HTTP_CODE]" >&2
    fi
  fi

  RESULTS=$(jq -n \
    --argjson existing "$RESULTS" \
    --arg aid "$AID" \
    --arg name "$ANAME" \
    --arg prev "$ACURR" \
    --arg new "$NEW_MODEL" \
    --argjson ok "$SUCCESS" \
    --arg code "$HTTP_CODE" \
    '$existing + [{id: $aid, name: $name, previousModel: $prev, updatedModel: $new, success: $ok, httpStatus: ($code | tonumber)}]')
done

if [[ "$OUTPUT_JSON" == "true" ]]; then
  echo "$RESULTS"
fi
