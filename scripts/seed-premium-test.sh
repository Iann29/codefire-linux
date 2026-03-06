#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# Premium Teams Test Data Seeder
# Seeds test data into Supabase for testing the premium teams flow.
# =============================================================================

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

print_header() {
  echo ""
  echo -e "${CYAN}${BOLD}==========================================${NC}"
  echo -e "${CYAN}${BOLD}  Premium Teams — Test Data Seeder${NC}"
  echo -e "${CYAN}${BOLD}==========================================${NC}"
  echo ""
}

print_step() {
  echo -e "${YELLOW}>> $1${NC}"
}

print_ok() {
  echo -e "${GREEN}[OK] $1${NC}"
}

print_err() {
  echo -e "${RED}[ERROR] $1${NC}"
}

# Check HTTP response for errors. Expects the curl output as $1 and a label as $2.
check_response() {
  local body="$1"
  local label="$2"

  # Supabase REST API returns JSON arrays/objects on success.
  # Errors look like: {"message":"...","code":"..."}
  if echo "$body" | grep -q '"message"'; then
    print_err "$label failed:"
    echo "$body" | python3 -m json.tool 2>/dev/null || echo "$body"
    return 1
  fi

  print_ok "$label"
  return 0
}

# ---------------------------------------------------------------------------
# Credentials
# ---------------------------------------------------------------------------

print_header

SUPABASE_URL="${SUPABASE_URL:-https://hofreldxofygaerodowt.supabase.co}"

echo -e "${BOLD}This script seeds test data into Supabase for the premium teams flow.${NC}"
echo -e "Supabase URL: ${CYAN}$SUPABASE_URL${NC}"
echo ""

if [ -z "${SUPABASE_ANON_KEY:-}" ]; then
  read -rp "Supabase anon key: " SUPABASE_ANON_KEY
fi

if [ -z "${ACCESS_TOKEN:-}" ]; then
  read -rp "Your access token (from app sign-in): " ACCESS_TOKEN
fi

read -rp "Your user ID: " USER_ID
read -rp "Your team ID: " TEAM_ID
read -rp "A project ID from your local DB: " PROJECT_ID

echo ""
echo -e "${BOLD}Seeding data...${NC}"
echo ""

# ---------------------------------------------------------------------------
# 1. Activity Events
# ---------------------------------------------------------------------------

print_step "Seeding activity events..."

RESPONSE=$(curl -s -w "\n%{http_code}" "$SUPABASE_URL/rest/v1/activity_events" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '[
    {"project_id":"'"$PROJECT_ID"'","user_id":"'"$USER_ID"'","event_type":"task_created","entity_type":"task","entity_id":"test-1","metadata":{"title":"Fix login bug"}},
    {"project_id":"'"$PROJECT_ID"'","user_id":"'"$USER_ID"'","event_type":"note_created","entity_type":"note","entity_id":"test-2","metadata":{"title":"Architecture decisions"}},
    {"project_id":"'"$PROJECT_ID"'","user_id":"'"$USER_ID"'","event_type":"session_shared","entity_type":"session","entity_id":"test-3","metadata":{"model":"claude-sonnet-4","branch":"feature/auth"}},
    {"project_id":"'"$PROJECT_ID"'","user_id":"'"$USER_ID"'","event_type":"doc_created","entity_type":"doc","entity_id":"test-4","metadata":{"title":"API Documentation"}},
    {"project_id":"'"$PROJECT_ID"'","user_id":"'"$USER_ID"'","event_type":"review_requested","entity_type":"review","entity_id":"test-5","metadata":{"task":"Implement OAuth"}}
  ]')

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" -ge 200 ] && [ "$HTTP_CODE" -lt 300 ]; then
  print_ok "Seeded 5 activity events"
else
  print_err "Activity events (HTTP $HTTP_CODE)"
  echo "$BODY"
fi

# ---------------------------------------------------------------------------
# 2. Project Docs
# ---------------------------------------------------------------------------

print_step "Seeding project docs..."

RESPONSE=$(curl -s -w "\n%{http_code}" "$SUPABASE_URL/rest/v1/project_docs" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '[
    {"project_id":"'"$PROJECT_ID"'","title":"Getting Started","content":"# Getting Started\n\nWelcome to the project! Here is how to set up your development environment...\n\n## Prerequisites\n- Node.js 18+\n- npm or yarn\n\n## Installation\n```bash\nnpm install\nnpm run dev\n```","sort_order":0,"created_by":"'"$USER_ID"'"},
    {"project_id":"'"$PROJECT_ID"'","title":"API Reference","content":"# API Reference\n\n## Authentication\nAll API requests require a Bearer token.\n\n## Endpoints\n\n### GET /api/projects\nReturns a list of projects.\n\n### POST /api/tasks\nCreates a new task.","sort_order":1,"created_by":"'"$USER_ID"'"},
    {"project_id":"'"$PROJECT_ID"'","title":"Architecture Notes","content":"# Architecture\n\n## Overview\nThe app uses a local-first architecture with cloud sync.\n\n## Data Flow\n1. User makes changes locally (SQLite)\n2. Sync engine marks records as dirty\n3. Periodic push to Supabase\n4. Realtime subscription pulls changes","sort_order":2,"created_by":"'"$USER_ID"'"}
  ]')

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" -ge 200 ] && [ "$HTTP_CODE" -lt 300 ]; then
  print_ok "Seeded 3 project docs"
else
  print_err "Project docs (HTTP $HTTP_CODE)"
  echo "$BODY"
fi

# ---------------------------------------------------------------------------
# 3. Session Summaries
# ---------------------------------------------------------------------------

print_step "Seeding session summaries..."

RESPONSE=$(curl -s -w "\n%{http_code}" "$SUPABASE_URL/rest/v1/session_summaries" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '[
    {"project_id":"'"$PROJECT_ID"'","user_id":"'"$USER_ID"'","session_slug":"abc123","model":"claude-sonnet-4","git_branch":"feature/premium-teams","summary":"Implemented premium team management with Supabase auth, team CRUD, and invitation system. Added settings UI with three-state flow.","files_changed":["src/services/PremiumService.ts","src/views/TeamSettings.tsx","src/models/premium.ts"],"duration_mins":45},
    {"project_id":"'"$PROJECT_ID"'","user_id":"'"$USER_ID"'","session_slug":"def456","model":"claude-opus-4","git_branch":"main","summary":"Fixed sync engine race condition where dirty records could be pushed twice. Added deduplication logic and improved error handling.","files_changed":["src/services/SyncEngine.ts","src/tests/sync.test.ts"],"duration_mins":20}
  ]')

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" -ge 200 ] && [ "$HTTP_CODE" -lt 300 ]; then
  print_ok "Seeded 2 session summaries"
else
  print_err "Session summaries (HTTP $HTTP_CODE)"
  echo "$BODY"
fi

# ---------------------------------------------------------------------------
# 4. Synced Project (upsert) + Review Requests
# ---------------------------------------------------------------------------

print_step "Ensuring synced project exists..."

RESPONSE=$(curl -s -w "\n%{http_code}" "$SUPABASE_URL/rest/v1/synced_projects" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Prefer: resolution=merge-duplicates" \
  -d '{"id":"'"$PROJECT_ID"'","team_id":"'"$TEAM_ID"'","name":"Test Project"}')

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" -ge 200 ] && [ "$HTTP_CODE" -lt 300 ]; then
  print_ok "Synced project ensured"
else
  print_err "Synced project (HTTP $HTTP_CODE)"
  echo "$BODY"
fi

print_step "Seeding review requests..."

RESPONSE=$(curl -s -w "\n%{http_code}" "$SUPABASE_URL/rest/v1/review_requests" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '[
    {"project_id":"'"$PROJECT_ID"'","task_id":"task-1","requested_by":"'"$USER_ID"'","assigned_to":"'"$USER_ID"'","status":"pending","comment":"Please review the auth implementation"},
    {"project_id":"'"$PROJECT_ID"'","task_id":"task-2","requested_by":"'"$USER_ID"'","assigned_to":"'"$USER_ID"'","status":"approved","comment":"LGTM!","resolved_at":"now()"},
    {"project_id":"'"$PROJECT_ID"'","task_id":"task-3","requested_by":"'"$USER_ID"'","assigned_to":"'"$USER_ID"'","status":"changes_requested","comment":"Need to add error handling for the edge case","resolved_at":"now()"}
  ]')

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" -ge 200 ] && [ "$HTTP_CODE" -lt 300 ]; then
  print_ok "Seeded 3 review requests"
else
  print_err "Review requests (HTTP $HTTP_CODE)"
  echo "$BODY"
fi

# ---------------------------------------------------------------------------
# 5. Notifications
# ---------------------------------------------------------------------------

print_step "Seeding notifications..."

RESPONSE=$(curl -s -w "\n%{http_code}" "$SUPABASE_URL/rest/v1/notifications" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '[
    {"user_id":"'"$USER_ID"'","project_id":"'"$PROJECT_ID"'","type":"mention","title":"Nick mentioned you","body":"In task \"Fix auth\": Hey, can you check this?","entity_type":"task_note","entity_id":"note-1","is_read":false},
    {"user_id":"'"$USER_ID"'","project_id":"'"$PROJECT_ID"'","type":"review_request","title":"Review requested","body":"Nick requested your review on \"Implement OAuth\"","entity_type":"review","entity_id":"review-1","is_read":false},
    {"user_id":"'"$USER_ID"'","project_id":"'"$PROJECT_ID"'","type":"review_resolved","title":"Review approved","body":"Your changes were approved","entity_type":"review","entity_id":"review-2","is_read":true}
  ]')

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" -ge 200 ] && [ "$HTTP_CODE" -lt 300 ]; then
  print_ok "Seeded 3 notifications"
else
  print_err "Notifications (HTTP $HTTP_CODE)"
  echo "$BODY"
fi

# ---------------------------------------------------------------------------
# Testing Checklist
# ---------------------------------------------------------------------------

echo ""
echo -e "${CYAN}${BOLD}==========================================${NC}"
echo -e "${CYAN}${BOLD}  Test data seeded! Here's what to check:${NC}"
echo -e "${CYAN}${BOLD}==========================================${NC}"
echo ""
echo -e "  ${BOLD}1.${NC} Activity tab — should show 5 events with icons"
echo -e "  ${BOLD}2.${NC} Activity tab > Summaries — should show 2 session cards"
echo -e "  ${BOLD}3.${NC} Docs tab — should show 3 docs in sidebar, click to edit"
echo -e "  ${BOLD}4.${NC} Reviews tab — should show 3 reviews (1 pending, 1 approved, 1 changes requested)"
echo -e "  ${BOLD}5.${NC} Notification bell — should show 2 unread (red badge)"
echo -e "  ${BOLD}6.${NC} Settings > Team — should show your team and member list"
echo ""
echo -e "${BOLD}Stripe test cards:${NC}"
echo -e "  Success:   ${GREEN}4242 4242 4242 4242${NC}"
echo -e "  Decline:   ${RED}4000 0000 0000 0002${NC}"
echo -e "  3D Secure: ${YELLOW}4000 0025 0000 3155${NC}"
echo ""
