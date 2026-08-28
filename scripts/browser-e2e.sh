#!/usr/bin/env bash
# Browser E2E for the Fieldward planning-board pivot.
#
# Runs against a fresh dev server started inside this same invocation (the
# readiness probe below also passes if a server is already on :3000).
#
# The agent side is exercised through the REAL WebMCP surface: the browser
# must expose document.modelContext, and the page's McpProvider registers
# all tools into it at load. We call them through
# getTools() + executeTool() — the same path a host agent would.
#
# NOTE on text checks: eyebrow labels render uppercase via CSS
# (text-transform), and `get text` returns the TRANSFORMED text — hence
# `rg -qi` for case-insensitive matches.
set -u
cd /home/z/my-project

bunx next dev -p 3000 > /dev/null 2>&1 &
SERVER_PID=$!
for i in $(seq 1 40); do
  curl -s -o /dev/null http://127.0.0.1:3000/ && break || sleep 1
done
sleep 2

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "PASS  $1"; }
bad()  { FAIL=$((FAIL+1)); echo "FAIL  $1"; }

# Strip the JSON quoting agent-browser eval puts around string results.
val() { sed -e 's/^"//' -e 's/"$//' <<<"$1"; }

# Un-escape the inner quotes of a JSON string eval result (\" → ").
unesc() { sed 's/\\"/"/g' <<<"$1"; }

# field <name> <<< box-output — parse "x:      27" lines from get box,
# flooring decimals (box coordinates can be fractional).
field() { awk -v key="$1" '$1 == key":" { printf "%d", $2 }'; }

agent-browser close --all > /dev/null 2>&1
agent-browser set viewport 1440 900 > /dev/null 2>&1
agent-browser open http://127.0.0.1:3000 > /dev/null
sleep 4

# Reset whatever session this browser had, then reload for a clean board.
agent-browser eval "fetch('/api/brief/reset', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ sessionId: localStorage.getItem('fieldward:session') }) }).then(r=>r.ok)" > /dev/null
agent-browser reload > /dev/null
sleep 4

# ── 1. Home page structure ────────────────────────────────────────────────
BODY=$(agent-browser get text body 2>/dev/null)
echo "$BODY" | rg -qi "the trip" && ok "home shows the trip brief band" || bad "home shows the trip brief band"
echo "$BODY" | rg -qi "the gear tray" && ok "home shows the gear tray" || bad "home shows the gear tray"
echo "$BODY" | rg -q "The board" && ok "home shows the board" || bad "home shows the board"
echo "$BODY" | rg -q "Lock this plan" && ok "Lock this plan button present" || bad "Lock this plan button present"
echo "$BODY" | rg -qi "cart|checkout|place an order|add to cart" && bad "no commerce language on home" || ok "no commerce language on home"
echo "$BODY" | rg -q "Agent tools · 16" && ok "native WebMCP context registered 16 tools (status pill)" || bad "status pill shows 16 tools"
echo "$BODY" | rg -qi "Already Have" && ok "board displays Already Have (Owned) top lane" || bad "Already Have lane missing"

# Helper: call a registered WebMCP tool through the native context.
# $1 = tool name, $2 = input as a single-quoted JSON string (shell single
# quotes keep the double quotes intact through every nesting level).
call() {
  agent-browser eval "(async () => {
    const tools = await document.modelContext.getTools();
    const t = tools.find(x => x.name === '$1');
    if (!t) return JSON.stringify({ success: false, error: 'tool not registered: $1' });
    return await document.modelContext.executeTool(t, '$2');
  })()" 2>/dev/null
}

# ── 2. Human sets the trip brief through the UI (one retry — hydration
#    timing can swallow the first click) ────────────────────────────────────
BRIEF=""
for ATTEMPT in 1 2; do
  agent-browser fill "#trip-description" "3-day winter backpacking trip in the Cascades" > /dev/null
  agent-browser fill "#trip-budget" "500" > /dev/null
  sleep 1
  agent-browser find role button click --name "Save trip" > /dev/null 2>&1
  sleep 2.5
  BRIEF=$(unesc "$(val "$(call get_trip_brief '{}')")")
  echo "$BRIEF" | rg -q "3-day winter backpacking trip in the Cascades" && break
  echo "     [retry] brief save attempt $ATTEMPT didn't land — trying again"
done
echo "$BRIEF" | rg -q "3-day winter backpacking trip in the Cascades" && echo "$BRIEF" | rg -q '"budgetDollars":500' && ok "human saved the brief via the UI; agent's get_trip_brief sees it" || bad "brief round-trip — got: $BRIEF"

# ── 2b. Weather chip: "not yet available" before place/dates are set ──────
CHIPSTATE=$(val "$(agent-browser eval "document.querySelector('[aria-label=\"Weather outlook\"]')?.getAttribute('data-weather-state') ?? 'missing'" 2>/dev/null)")
[ "$CHIPSTATE" = "unset" ] && ok "weather chip: Not yet available before place/dates are set" || bad "weather chip unset state — got $CHIPSTATE"
CHIPLABEL=$(val "$(agent-browser eval "!!document.querySelector('[aria-label=\"Weather outlook\"]')?.textContent.match(/not yet available/i)" 2>/dev/null)")
[ "$CHIPLABEL" = "true" ] && ok "weather chip labels the unset state for the human" || bad "weather chip unset label missing"

# ── 2c. Weather chip: an unfindable place is an honest unavailable ─────────
# Native setter + input event: React-controlled date inputs don't respond to
# fill the way text inputs do.
agent-browser eval "const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; const a=document.querySelector('#trip-start'); s.call(a,'2026-11-15'); a.dispatchEvent(new Event('input',{bubbles:true})); const b=document.querySelector('#trip-end'); s.call(b,'2026-11-18'); b.dispatchEvent(new Event('input',{bubbles:true})); 'dates set'" > /dev/null
agent-browser fill "#trip-location" "Xyzzyq Nowherevale" > /dev/null
sleep 1
agent-browser find role button click --name "Save trip" > /dev/null 2>&1
sleep 3
CHIPBAD=""
for ATTEMPT in 1 2 3 4 5 6; do
  CHIPBAD=$(val "$(agent-browser eval "document.querySelector('[aria-label=\"Weather outlook\"]')?.getAttribute('data-weather-state') ?? 'missing'" 2>/dev/null)")
  [ "$CHIPBAD" = "unavailable" ] && break
  sleep 1
done
[ "$CHIPBAD" = "unavailable" ] && ok "weather chip: unfindable place → Not available (unavailable state)" || bad "weather chip geocode-fail state — got $CHIPBAD"
CHIPBADTEXT=$(val "$(agent-browser eval "!!document.querySelector('[aria-label=\"Weather outlook\"]')?.textContent.match(/couldn.t find/i)" 2>/dev/null)")
[ "$CHIPBADTEXT" = "true" ] && ok "weather chip explains the unfindable place to the human" || bad "weather chip geocode-fail copy missing"

# ── 2d. Weather chip: a real place — chip state must match the outlook the agent's tool sees ──
agent-browser eval "window.scrollTo(0, 0)" > /dev/null 2>&1
agent-browser fill "#trip-location" "North Cascades" > /dev/null
sleep 1
agent-browser find role button click --name "Save trip" > /dev/null 2>&1
CHIPREAL=""
for ATTEMPT in $(seq 1 14); do
  CHIPREAL=$(val "$(agent-browser eval "document.querySelector('[aria-label=\"Weather outlook\"]')?.getAttribute('data-weather-state') ?? 'missing'" 2>/dev/null)")
  [ "$CHIPREAL" = "forecast" ] || [ "$CHIPREAL" = "historical-average" ] || [ "$CHIPREAL" = "unavailable" ] && break
  sleep 1
done
APISTATE=$(val "$(agent-browser eval "(async()=>{const r=await fetch('/api/weather?sessionId='+localStorage.getItem('fieldward:session')); const d=await r.json(); return d.outlook.dataSource;})()" 2>/dev/null)")
[ "$CHIPREAL" = "$APISTATE" ] && ok "weather chip state matches the outlook the agent's tool sees ($CHIPREAL)" || bad "chip/api mismatch — chip=$CHIPREAL api=$APISTATE"
if [ "$CHIPREAL" = "historical-average" ]; then
  CHIPLBL=$(val "$(agent-browser eval "!!document.querySelector('[aria-label=\"Weather outlook\"]')?.textContent.match(/seasonal average/i)" 2>/dev/null)")
  [ "$CHIPLBL" = "true" ] && ok "seasonal-average chip carries its honest label" || bad "seasonal-average label missing"
elif [ "$CHIPREAL" = "forecast" ]; then
  CHIPLBL=$(val "$(agent-browser eval "!!document.querySelector('[aria-label=\"Weather outlook\"]')?.textContent.match(/real forecast/i)" 2>/dev/null)")
  [ "$CHIPLBL" = "true" ] && ok "forecast chip carries its honest label" || bad "forecast label missing"
else
  CHIPLBL=$(val "$(agent-browser eval "!!document.querySelector('[aria-label=\"Weather outlook\"]')?.textContent.match(/unreachable|rate-limited|couldn.t find/i)" 2>/dev/null)")
  [ "$CHIPLBL" = "true" ] && ok "unavailable chip carries its honest reason (upstream rate-limited)" || bad "unavailable reason missing"
fi

# ── 3. Agent places gear on the board, live ───────────────────────────────
GEARID=$(val "$(agent-browser eval "(async()=>{const r=await fetch('/api/gear/search?q=hollowpine&limit=1'); const d=await r.json(); return d.results[0].id;})()" 2>/dev/null)")
PLACE=$(unesc "$(val "$(call place_on_board '{"gearItemId":"'$GEARID'","x":420,"y":120,"note":"Two doors for the pair of you - tapes out drum-tight before a squall."}')")")
echo "$PLACE" | rg -q "Hollowpine 2P Tent" && echo "$PLACE" | rg -q '"x":420' && ok "agent placed the tent card at (420,120) with a note" || bad "agent placed a tent — got: $PLACE"
sleep 2.5
CARD=$(val "$(agent-browser eval "!![...document.querySelectorAll('article')].find(a => a.textContent.includes('Hollowpine') && a.textContent.includes('Placed by agent') && a.textContent.includes('drum-tight'))" 2>/dev/null)")
[ "$CARD" = "true" ] && ok "card renders on the board: attribution + agent note visible" || bad "card renders on the board"

# ── 4. Default placement (no coords) lands in-bounds ───────────────────────
STOVEID=$(val "$(agent-browser eval "(async()=>{const r=await fetch('/api/gear/search?q=stove&limit=1'); const d=await r.json(); return d.results[0].id;})()" 2>/dev/null)")
PLACE2=$(unesc "$(val "$(call place_on_board '{"gearItemId":"'$STOVEID'"}')")")
echo "$PLACE2" | rg -q "Fieldkettle Folding Stove" && echo "$PLACE2" | rg -q '"x":48,"y":48' && ok "agent placed the stove at the first open slot (48,48)" || bad "agent placed the stove — got: $PLACE2"

# ── 5. Agent moves a card — the same card the human sees ──────────────────
STOVE_CARD=$(val "$(agent-browser eval "(async()=>{const r=await fetch('/api/board?sessionId='+localStorage.getItem('fieldward:session')); const b=await r.json(); const s=b.items.find(i=>i.name.includes('Stove')); return s ? s.id : 'NOTFOUND';})()" 2>/dev/null)")
echo "     [debug] stove card id: $STOVE_CARD"
MOVE=$(unesc "$(val "$(call move_board_item '{"boardItemId":"'$STOVE_CARD'","x":700,"y":260}')")")
echo "$MOVE" | rg -q '"x":700' && echo "$MOVE" | rg -q '"y":260' && ok "agent moved the stove card to (700,260)" || bad "agent moved the stove — got: $MOVE"
sleep 2.5
MOVED=$(val "$(agent-browser eval "const el=[...document.querySelectorAll('article')].find(a=>a.textContent.includes('Fieldkettle')); el ? el.parentElement.style.transform : 'missing'" 2>/dev/null)")
echo "$MOVED" | rg -q "700px" && ok "moved card's live transform is translate3d(700px, 260px) — animated co-editing" || bad "moved card transform — got: $MOVED"
agent-browser screenshot scripts/pivot-board-agent-card.png > /dev/null 2>&1

# ── 6. Human drags from the tray onto the board (dnd-kit PointerSensor) ────
# The tray row and the drop point must both be in the viewport; drag with
# low-level mouse events so the destination is a visible board point.
agent-browser scrollintoview "li[aria-label*='Ridgeline 45L Pack']" > /dev/null 2>&1
sleep 1
ROWBOX=$(agent-browser get box "li[aria-label*='Ridgeline 45L Pack']" 2>/dev/null)
RX=$(field x <<<"$ROWBOX"); RY=$(field y <<<"$ROWBOX"); RW=$(field width <<<"$ROWBOX"); RH=$(field height <<<"$ROWBOX")
if [ "$((RY + RH))" -gt 870 ]; then
  agent-browser scroll down $((RY + RH - 820)) > /dev/null 2>&1
  sleep 1
  ROWBOX=$(agent-browser get box "li[aria-label*='Ridgeline 45L Pack']" 2>/dev/null)
  RX=$(field x <<<"$ROWBOX"); RY=$(field y <<<"$ROWBOX")
fi
BOARD=$(agent-browser get box "[role='application']" 2>/dev/null)
BX=$(field x <<<"$BOARD"); BY=$(field y <<<"$BOARD")
DROPX=$((BX + 420)); DROPY=$((BY + 180))
[ "$DROPY" -gt 850 ] && DROPY=850
SRCX=$((RX + RW / 2)); SRCY=$((RY + RH / 2))
echo "     [debug] drag ($SRCX,$SRCY) -> ($DROPX,$DROPY)"
agent-browser mouse move "$SRCX" "$SRCY" > /dev/null 2>&1
agent-browser mouse down > /dev/null 2>&1
agent-browser mouse move "$DROPX" "$DROPY" > /dev/null 2>&1
# A second small move after the activating one: dnd-kit computes the drop
# target from post-activation pointer moves (real drags always have many).
sleep 0.3
agent-browser mouse move "$((DROPX + 8))" "$((DROPY + 8))" > /dev/null 2>&1
sleep 0.4
agent-browser mouse up > /dev/null 2>&1
sleep 2.5
DRAGCOUNT=$(val "$(agent-browser eval "(async()=>{const r=await fetch('/api/board?sessionId='+localStorage.getItem('fieldward:session')); const b=await r.json(); return b.items.filter(i=>i.name.includes('Ridgeline')).length;})()" 2>/dev/null)")
[ "$DRAGCOUNT" = "1" ] && ok "human drag from tray placed the pack on the board" || bad "human drag from tray (found $DRAGCOUNT cards)"

# ── 7. Human adds a day block; readiness panel reacts ─────────────────────
# Scroll the toolbar button into view CENTERED first — a sticky-header-
# covered button swallows the click (same hazard the banner Accept click
# works around above; the weather chip changing height between runs moves
# the toolbar under the header at the inherited scroll position).
for DC in 1 2; do
  agent-browser eval "[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Day block')?.scrollIntoView({block:'center'})" > /dev/null 2>&1
  sleep 0.5
  agent-browser find role button click --name "Day block" > /dev/null 2>&1
  sleep 2.5
done
DAYCARD=$(val "$(agent-browser eval "[...document.querySelectorAll('input[aria-label=\"Day label\"]')].filter(i=>i.value.startsWith('Day')).length" 2>/dev/null)")
[ "$DAYCARD" = "2" ] && ok "two day blocks added and rendered" || bad "day blocks added — got $DAYCARD"
READY=$(val "$(agent-browser eval "!!document.querySelector('[aria-label=\"Trip readiness\"]')" 2>/dev/null)")
[ "$READY" = "true" ] && ok "readiness panel appears with a trip set" || bad "readiness panel appears"
agent-browser screenshot scripts/pivot-board-full.png > /dev/null 2>&1

# ── 8. Agent proposes a brief change → banner → Accept ───────────────────
PROP=$(val "$(call propose_trip_brief_update '{"budget":650}')")
echo "$PROP" | rg -q "pendingProposal" && ok "agent's brief change landed as a pending proposal" || bad "proposal — got: $PROP"
sleep 3
BANNER=$(val "$(agent-browser eval "!![...document.querySelectorAll('section,div,p')].find(n => n.textContent && n.textContent.includes('Agent suggests') && n.textContent.includes('Accept'))" 2>/dev/null)")
[ "$BANNER" = "true" ] && ok "pending-proposal banner appeared (budget \$650)" || bad "pending-proposal banner appeared"
BUDGET=""
for ATTEMPT in 1 2; do
  # Scroll the banner clear of the sticky header before clicking — a header-
  # covered button swallows the click.
  agent-browser eval "window.scrollTo(0, 0)" > /dev/null 2>&1
  sleep 0.5
  agent-browser find role button click --name "Accept" > /dev/null 2>&1
  sleep 2.5
  BUDGET=$(val "$(agent-browser eval "(async()=>{const r=await fetch('/api/brief?sessionId='+localStorage.getItem('fieldward:session')); const b=await r.json(); return b.brief.budget;})()" 2>/dev/null)")
  [ "$BUDGET" = "65000" ] && break
  echo "     [retry] accept attempt $ATTEMPT didn't land — trying again"
done
[ "$BUDGET" = "65000" ] && ok "human accepted — budget now \$650" || bad "budget after accept — got $BUDGET"

# ── 8b. Agent suggests a day order → banner → human accepts, board reorders ─
DAYSJSON=$(unesc "$(val "$(agent-browser eval "(async()=>{const r=await fetch('/api/board?sessionId='+localStorage.getItem('fieldward:session')); const b=await r.json(); const days=b.items.filter(i=>i.itemType==='day').sort((p,q)=>p.y-q.y||p.x-q.x); return JSON.stringify(days.map(d=>({id:d.id,label:d.label})));})()" 2>/dev/null)")")
D1=$(echo "$DAYSJSON" | rg -o '"id":"[^"]+"' | head -1 | cut -d'"' -f4)
D2=$(echo "$DAYSJSON" | rg -o '"id":"[^"]+"' | sed -n 2p | cut -d'"' -f4)
L1=$(echo "$DAYSJSON" | rg -o '"label":"[^"]+"' | head -1 | cut -d'"' -f4)
L2=$(echo "$DAYSJSON" | rg -o '"label":"[^"]+"' | sed -n 2p | cut -d'"' -f4)
echo "     [debug] day order: $L1 ($D1) then $L2 ($D2)"
SUGGEST=$(unesc "$(val "$(call suggest_day_order '{"orderedBoardItemIds":["'$D2'","'$D1'"],"note":"Lake camp first — the calm weather window opens before the pass."}')")")
echo "$SUGGEST" | rg -q '"orderedBoardItemIds"' && ok "agent suggested a day order through native WebMCP" || bad "day-order suggestion — got: $SUGGEST"
sleep 3
DOBANNER=$(val "$(agent-browser eval "!!document.querySelector('[data-day-order-banner=\"pending\"]')" 2>/dev/null)")
[ "$DOBANNER" = "true" ] && ok "day-order proposal banner appeared above the board" || bad "day-order banner appeared"
DONOTE=$(val "$(agent-browser eval "const n=document.querySelector('[data-day-order-banner]'); !!n && n.textContent.includes('calm weather window') && n.textContent.includes('Accept order')" 2>/dev/null)")
[ "$DONOTE" = "true" ] && ok "banner spells out the proposed order + the agent's reasoning" || bad "banner order/note rendering"
UNMOVED=$(val "$(agent-browser eval "(async()=>{const r=await fetch('/api/board?sessionId='+localStorage.getItem('fieldward:session')); const b=await r.json(); const days=b.items.filter(i=>i.itemType==='day').sort((p,q)=>p.y-q.y||p.x-q.x); return days[0].id;})()" 2>/dev/null)")
[ "$UNMOVED" = "$D1" ] && ok "proposal changed nothing — the board order waits for the human" || bad "proposal moved the board before accept — got $UNMOVED"

agent-browser eval "document.querySelector('[data-day-order-banner]')?.scrollIntoView({block:'center'})" > /dev/null 2>&1
sleep 0.5
agent-browser find role button click --name "Accept order" > /dev/null 2>&1
sleep 3
NEWFIRST=""
for ATTEMPT in 1 2 3; do
  NEWFIRST=$(val "$(agent-browser eval "(async()=>{const r=await fetch('/api/board?sessionId='+localStorage.getItem('fieldward:session')); const b=await r.json(); const days=b.items.filter(i=>i.itemType==='day').sort((p,q)=>p.y-q.y||p.x-q.x); return days[0].id;})()" 2>/dev/null)")
  [ "$NEWFIRST" = "$D2" ] && break
  sleep 1
done
[ "$NEWFIRST" = "$D2" ] && ok "human accepted — day order flipped on the board (live)" || bad "day order after accept — first=$NEWFIRST"
BANNERAFTER=$(val "$(agent-browser eval "!document.querySelector('[data-day-order-banner=\"pending\"]')" 2>/dev/null)")
[ "$BANNERAFTER" = "true" ] && ok "banner cleared after the verdict" || bad "banner cleared after accept"

# ── 8c. A second suggestion, dismissed — nothing moves ──────────────────────
SUGGEST2=$(unesc "$(val "$(call suggest_day_order '{"orderedBoardItemIds":["'$D1'","'$D2'"]}')" 2>/dev/null)")
echo "$SUGGEST2" | rg -q '"orderedBoardItemIds"' && ok "agent suggested a second day order" || bad "second suggestion — got: $SUGGEST2"
sleep 3
agent-browser eval "document.querySelector('[data-day-order-banner]')?.scrollIntoView({block:'center'})" > /dev/null 2>&1
sleep 0.5
agent-browser find role button click --name "Dismiss" > /dev/null 2>&1
sleep 3
STILLFIRST=$(val "$(agent-browser eval "(async()=>{const r=await fetch('/api/board?sessionId='+localStorage.getItem('fieldward:session')); const b=await r.json(); const days=b.items.filter(i=>i.itemType==='day').sort((p,q)=>p.y-q.y||p.x-q.x); return days[0].id;})()" 2>/dev/null)")
[ "$STILLFIRST" = "$D2" ] && ok "human dismissed — the accepted order stood, nothing moved" || bad "dismiss changed the order — first=$STILLFIRST"
BANNERGONE=$(val "$(agent-browser eval "!document.querySelector('[data-day-order-banner=\"pending\"]')" 2>/dev/null)")
[ "$BANNERGONE" = "true" ] && ok "banner cleared after dismiss" || bad "banner cleared after dismiss"

# ── 9. Lock the plan (human-only) → export view ──────────────────────────
agent-browser eval "[...document.querySelectorAll('button')].find(b => b.textContent.includes('Lock this plan'))?.scrollIntoView({block:'center'})" > /dev/null 2>&1
sleep 0.5
agent-browser find role button click --name "Lock this plan" > /dev/null 2>&1
sleep 1.5
agent-browser find role button click --name "Yes, lock it" > /dev/null 2>&1
sleep 2.5
EXPORT=$(agent-browser get text body 2>/dev/null)
echo "$EXPORT" | rg -qi "the plan, locked" && ok "export view rendered after locking" || bad "export view rendered"
echo "$EXPORT" | rg -q "The packing list" && ok "packing list section present" || bad "packing list section present"
echo "$EXPORT" | rg -q "The days" && ok "itinerary section present" || bad "itinerary section present"
echo "$EXPORT" | rg -q "Print / save as PDF" && ok "print affordance present" || bad "print affordance present"
agent-browser screenshot scripts/pivot-export-view.png > /dev/null 2>&1

# ── 10. Locked board is read-only for the agent ───────────────────────────
BOOTSID=$(val "$(agent-browser eval "(async()=>{const r=await fetch('/api/gear/search?q=boots&limit=1'); const d=await r.json(); return d.results[0].id;})()" 2>/dev/null)")
LOCKEDPLACE=$(val "$(call place_on_board '{"gearItemId":"'$BOOTSID'"}')")
echo "$LOCKEDPLACE" | rg -qi "locked" && ok "agent placement refused while locked (409 surfaces as tool error)" || bad "agent placement refused while locked — got: $LOCKEDPLACE"

# ── 11. Mobile viewport: no horizontal overflow ───────────────────────────
agent-browser set viewport 390 844 > /dev/null
agent-browser open http://127.0.0.1:3000 > /dev/null
sleep 4
OVERFLOW=$(val "$(agent-browser eval "document.documentElement.scrollWidth - document.documentElement.clientWidth" 2>/dev/null)")
[ "$OVERFLOW" = "0" ] && ok "mobile 390px: no horizontal overflow" || bad "mobile overflow: ${OVERFLOW}px"
agent-browser screenshot scripts/pivot-mobile.png > /dev/null 2>&1

# ── 12. Fresh plan for a clean demo state, then done ──────────────────────
agent-browser set viewport 1440 900 > /dev/null
agent-browser eval "fetch('/api/brief/reset', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ sessionId: localStorage.getItem('fieldward:session') }) }).then(r=>r.ok)" > /dev/null

kill $SERVER_PID 2>/dev/null
echo ""
echo "RESULT: $PASS passed, $FAIL failed"
exit $([ "$FAIL" = "0" ] && echo 0 || echo 1)
