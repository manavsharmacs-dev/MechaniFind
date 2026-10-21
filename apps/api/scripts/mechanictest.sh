#!/bin/zsh
# Step 1a tests: becoming a mechanic. Starts its own server, cleans up after.
cd "$(dirname "$0")/.."
npx tsx scripts/authtest-cleanup.mts >/dev/null
LOG=$(mktemp); JAR=$(mktemp); JAR2=$(mktemp)
PORT=3999 LOCATION_PING_SECONDS=1 TRUST_PROXY_HEADER=x-forwarded-for npx tsx src/index.ts > "$LOG" 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null; rm -f "$LOG" "$JAR" "$JAR2"; npx tsx scripts/seed-dashboard.mts --clean >/dev/null; npx tsx scripts/authtest-cleanup.mts >/dev/null' EXIT
for i in {1..40}; do curl -s localhost:3999/ >/dev/null && break; sleep 0.25; done

U=http://localhost:3999; B=$U/api/auth
H=(-H 'content-type: application/json')
pass() { [[ "$2" == "$3" ]] && echo "PASS  $1" || echo "FAIL  $1  (expected $3, got $2)"; }
code_for() { grep "code for $1" "$LOG" | tail -1 | awk '{print $NF}'; }
st() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
prof() { curl -s -o /dev/null -w '%{http_code}' "${H[@]}" -b "$1" -X "$2" $U/mechanic/profile -d "$3"; }
EXP=$(python3 -c "import datetime; print(datetime.date.today() + datetime.timedelta(days=365))")
BIZ=',"serviceArea":"Elgin to Rockford, I-90","llcNumber":"llc 1234567","llcState":"il","ein":"12-3456789","insuranceProvider":"Progressive Commercial","insurancePolicyNumber":"PC 123-4567","insuranceCoverageDollars":1000000,"insuranceExpiresOn":"'"$EXP"'"'
GOOD='{"businessName":"Joe'"'"'s Diesel Repair","serviceType":"mobile","specialties":["engine","electrical"],"calloutFeeCents":15000,"serviceRadiusMiles":40,"location":{"lat":42.0354,"lng":-88.2812}'"$BIZ}"

# Sign in a phone account and an email-only account
P=+18155550201
curl -s -o /dev/null "${H[@]}" -H 'x-forwarded-for: 10.30.0.1' -X POST $B/phone-number/send-otp -d "{\"phoneNumber\":\"$P\"}"
curl -s -o /dev/null "${H[@]}" -H 'x-forwarded-for: 10.30.0.1' -c "$JAR" -X POST $B/phone-number/verify -d "{\"phoneNumber\":\"$P\",\"code\":\"$(code_for $P)\"}"
E=noPhone@example.com
curl -s -o /dev/null "${H[@]}" -H 'x-forwarded-for: 10.30.0.2' -X POST $B/email-otp/send-verification-otp -d '{"email":"nophone@example.com","type":"sign-in"}'
curl -s -o /dev/null "${H[@]}" -H 'x-forwarded-for: 10.30.0.2' -c "$JAR2" -X POST $B/sign-in/email-otp -d "{\"email\":\"nophone@example.com\",\"otp\":\"$(code_for nophone@example.com)\"}"

echo "--- Who can become a mechanic"
pass "signed out: refused"                       "$(st "${H[@]}" -X POST $U/mechanic/profile -d "$GOOD")" 401
pass "no confirmed phone: refused"               "$(prof "$JAR2" POST "$GOOD")" 409

echo "--- Bad or sneaky input is rejected"
pass "extra field isApproved:true rejected"      "$(prof "$JAR" POST "${GOOD%\}},\"isApproved\":true}")" 400
pass "extra field role:admin rejected"           "$(prof "$JAR" POST "${GOOD%\}},\"role\":\"admin\"}")" 400
pass "made-up specialty rejected"                "$(prof "$JAR" POST "${GOOD/\"engine\"/\"wizardry\"}")" 400
pass "radius over 100 miles rejected"            "$(prof "$JAR" POST "${GOOD/:40,/:500,}")" 400
pass "negative call-out fee rejected"            "$(prof "$JAR" POST "${GOOD/15000/-5}")" 400
pass "location outside the US rejected"          "$(prof "$JAR" POST "${GOOD/\{\"lat\":42.0354,\"lng\":-88.2812\}/{\"lat\":51.5,\"lng\":-0.12}}")" 400
pass "shop without an address rejected"          "$(prof "$JAR" POST "${GOOD/\"mobile\"/\"shop\"}")" 400
pass "1-letter business name rejected"           "$(prof "$JAR" POST "${GOOD/Joe\'s Diesel Repair/J}")" 400
pass "mobile without a service area rejected"    "$(prof "$JAR" POST "${GOOD/\"serviceArea\":\"Elgin to Rockford, I-90\",/}")" 400
pass "missing insurance rejected"                "$(prof "$JAR" POST "${GOOD/\"insurancePolicyNumber\":\"PC 123-4567\",/}")" 400
pass "already-expired insurance rejected"        "$(prof "$JAR" POST "${GOOD/$EXP/2020-01-01}")" 400
pass "impossible insurance date rejected"        "$(prof "$JAR" POST "${GOOD/$EXP/2027-02-30}")" 400
pass "far-future typo date rejected"             "$(prof "$JAR" POST "${GOOD/$EXP/2099-01-01}")" 400
pass "missing EIN rejected"                      "$(prof "$JAR" POST "${GOOD/\"ein\":\"12-3456789\",/}")" 400
pass "EIN with wrong digit count rejected"       "$(prof "$JAR" POST "${GOOD/12-3456789/12-345}")" 400
pass "EIN starting 00 rejected"                  "$(prof "$JAR" POST "${GOOD/12-3456789/00-3456789}")" 400
pass "made-up state rejected"                    "$(prof "$JAR" POST "${GOOD/\"il\"/\"ZZ\"}")" 400
pass "letters in USDOT number rejected"          "$(prof "$JAR" POST "${GOOD%\}},\"usdotNumber\":\"12AB\"}")" 400
pass "zero insurance coverage rejected"          "$(prof "$JAR" POST "${GOOD/1000000/0}")" 400

echo "--- Signing up"
SNEAKY='{"businessName":"  Joe​'"'"'s   Diesel‮ Repair ","serviceType":"mobile","specialties":["engine","electrical"],"calloutFeeCents":15000,"serviceRadiusMiles":40,"location":{"lat":42.0354,"lng":-88.2812},"usdotNumber":"USDOT 1234567","mcNumber":"MC-765432"'"$BIZ}"
R=$(curl -s "${H[@]}" -b "$JAR" -X POST $U/mechanic/profile -d "$SNEAKY")
pass "profile created as pending"                "$(echo $R | grep -o '"status":"pending"')" '"status":"pending"'
pass "starts offline (not receiving jobs)"       "$(echo $R | grep -o '"isAvailable":false')" '"isAvailable":false'
pass "hidden/backwards characters and extra spaces stripped" "$(echo $R | grep -o '"businessName":"[^"]*"')" '"businessName":"Joe'"'"'s Diesel Repair"'
pass "full EIN never sent back, only last 4"      "$(echo $R | grep -c '123456789')$(echo $R | grep -o '"einLast4":"6789"')" '0"einLast4":"6789"'
pass "USDOT / MC prefixes stripped"              "$(echo $R | grep -o '"usdotNumber":"1234567","mcNumber":"765432"')" '"usdotNumber":"1234567","mcNumber":"765432"'
pass "LLC number and state normalized"           "$(echo $R | grep -o '"llcNumber":"LLC1234567","llcState":"IL"')" '"llcNumber":"LLC1234567","llcState":"IL"'
pass "account is now a mechanic"                 "$(curl -s -b "$JAR" $U/me | grep -o '"role":"mechanic"')" '"role":"mechanic"'
pass "can't sign up twice"                       "$(prof "$JAR" POST "$GOOD")" 409
pass "can read own profile"                      "$(st -b "$JAR" $U/mechanic/profile)" 200

echo "--- Availability while pending"
avail() { curl -s -o /dev/null -w '%{http_code}' "${H[@]}" -b "$JAR" -X POST $U/mechanic/availability -d "$1"; }
ping() { curl -s -o /dev/null -w '%{http_code}' "${H[@]}" -b "$JAR" -X POST $U/mechanic/location -d '{"location":{"lat":42.04,"lng":-88.29}}'; }
LOC='"location":{"lat":42.0354,"lng":-88.2812}'
pass "pending mechanic can't go online"          "$(avail "{\"available\":true,$LOC}")" 403
pass "going offline is always allowed"           "$(avail '{"available":false}')" 200
pass "location pings refused while offline"      "$(ping)" 409

echo "--- Editing"
pass "rejected edit (bad data) refused"          "$(prof "$JAR" PATCH '{"serviceRadiusMiles":999}')" 400
pass "change price"                              "$(prof "$JAR" PATCH '{"calloutFeeCents":17500}')" 200
pass "change price again right away"             "$(prof "$JAR" PATCH '{"calloutFeeCents":20000}')" 200
pass "change radius and specialties any time"    "$(prof "$JAR" PATCH '{"serviceRadiusMiles":60,"specialties":["engine","brakes"]}')" 200
pass "price actually saved"                      "$(curl -s -b "$JAR" $U/mechanic/profile | grep -o '"calloutFeeCents":20000')" '"calloutFeeCents":20000'
weekpass() { npx tsx -e "import('./src/db/index.js').then(async ({db,pool})=>{const {sql}=await import('drizzle-orm');await db.execute(sql\`update mechanic_profiles set name_changed_at = now() - interval '8 days' where user_id = (select id from users where phone_number = '$P')\`);await pool.end();})"; }

dbset() { npx tsx -e "import('./src/db/index.js').then(async ({db,pool})=>{const {sql}=await import('drizzle-orm');await db.execute(sql.raw(\"update mechanic_profiles set $1 where user_id = (select id from users where phone_number = '$P')\"));await pool.end();})"; }

echo "--- Approval & business name"
dbset "insurance_expires_on = current_date"
pass "admin can't approve with expired insurance" "$(npm run -s mechanic:approve -- $P >/dev/null 2>&1; echo $?)" 1
dbset "insurance_expires_on = '$EXP'"
npm run -s mechanic:approve -- $P >/dev/null
pass "admin approval works"                      "$(curl -s -b "$JAR" $U/mechanic/profile | grep -o '"status":"[a-z]*"')" '"status":"approved"'
pass "can't approve yourself via edit"           "$(prof "$JAR" PATCH '{"isApproved":true}')" 400
pass "changing price keeps approval"             "$(curl -s "${H[@]}" -b "$JAR" -X PATCH $U/mechanic/profile -d '{"calloutFeeCents":22500}' | grep -o '"status":"[a-z]*"')" '"status":"approved"'
pass "renaming the business needs re-approval"   "$(curl -s "${H[@]}" -b "$JAR" -X PATCH $U/mechanic/profile -d '{"businessName":"Joe Diesel LLC"}' | grep -o '"status":"[a-z]*"')" '"status":"pending"'
R=$(curl -s -w ' %{http_code}' "${H[@]}" -b "$JAR" -X PATCH $U/mechanic/profile -d '{"businessName":"Another Name Inc"}')
pass "second rename in the same week refused"    "${R##* }" 429
pass "...and says when the next rename is allowed" "$(echo $R | grep -o '"nextNameChangeAt":"20' )" '"nextNameChangeAt":"20'
pass "prices still editable during the name wait" "$(prof "$JAR" PATCH '{"calloutFeeCents":25000}')" 200
npm run -s mechanic:approve -- $P >/dev/null
pass "re-sending the same EIN keeps approval"    "$(curl -s "${H[@]}" -b "$JAR" -X PATCH $U/mechanic/profile -d '{"ein":"123456789"}' | grep -o '"status":"[a-z]*"')" '"status":"approved"'
pass "new insurance policy needs re-approval"    "$(curl -s "${H[@]}" -b "$JAR" -X PATCH $U/mechanic/profile -d '{"insurancePolicyNumber":"PC-999-0000"}' | grep -o '"status":"[a-z]*"')" '"status":"pending"'
npm run -s mechanic:approve -- $P >/dev/null
pass "new EIN needs re-approval"                 "$(curl -s "${H[@]}" -b "$JAR" -X PATCH $U/mechanic/profile -d '{"ein":"98-7654321"}' | grep -o '"status":"[a-z]*"')" '"status":"pending"'
pass "re-sending the SAME name isn't a rename"   "$(prof "$JAR" PATCH '{"businessName":"Joe Diesel LLC"}')" 200
weekpass
pass "a week later: rename allowed again"        "$(prof "$JAR" PATCH '{"businessName":"Another Name Inc"}')" 200

echo "--- Availability once approved"
npm run -s mechanic:approve -- $P >/dev/null
pass "can't go online without sending location"  "$(avail '{"available":true}')" 400
pass "can't sneak in extra fields"               "$(avail "{\"available\":true,$LOC,\"isApproved\":true}")" 400
pass "approved mechanic goes online"             "$(curl -s "${H[@]}" -b "$JAR" -X POST $U/mechanic/availability -d "{\"available\":true,$LOC}" | grep -o '"isAvailable":true')" '"isAvailable":true'
sleep 1.1
pass "location ping accepted while online"       "$(ping)" 200
pass "second ping too soon is refused"           "$(ping)" 429
sleep 1.1
pass "ping accepted again after the wait"        "$(ping)" 200
dbset "insurance_expires_on = current_date"
pass "expired insurance: can't go online"        "$(avail "{\"available\":true,$LOC}")" 403
pass "...profile says insurance isn't valid"     "$(curl -s -b "$JAR" $U/mechanic/profile | grep -o '"valid":false')" '"valid":false'
dbset "insurance_expires_on = '$EXP'"
pass "location outside the US refused"           "$(curl -s -o /dev/null -w '%{http_code}' "${H[@]}" -b "$JAR" -X POST $U/mechanic/location -d '{"location":{"lat":51.5,"lng":-0.12}}')" 400
npm run -s mechanic:approve -- $P --revoke >/dev/null
pass "revoking approval forces them offline"     "$(curl -s -b "$JAR" $U/mechanic/profile | grep -o '"isAvailable":false')" '"isAvailable":false'
pass "...and they can't go back online"          "$(avail "{\"available\":true,$LOC}")" 403

echo "--- Dashboard"
npm run -s mechanic:approve -- $P >/dev/null
curl -s -o /dev/null "${H[@]}" -b "$JAR" -X PATCH $U/mechanic/profile -d '{"calloutFeeCents":25000}'
npx tsx scripts/seed-dashboard.mts $P >/dev/null
D=$(curl -s -b "$JAR" "$U/mechanic/dashboard?tz=America/Chicago")
j() { echo "$D" | python3 -c "import json,sys; d=json.load(sys.stdin); print($1)"; }
pass "signed out: refused"                        "$(st $U/mechanic/dashboard)" 401
pass "account with no mechanic profile: 404"      "$(st -b "$JAR2" $U/mechanic/dashboard)" 404
pass "shows exactly my 1 waiting offer"           "$(j "len(d['offers'])")" 1
pass "never shows another mechanic's offer"       "$(echo "$D" | grep -c 'PRIVATE')" 0
pass "offer shows approximate distance only"      "$(j "d['offers'][0]['approxMiles']")" 12.5
pass "offer hides driver's exact location"        "$(j "'location' in d['offers'][0] or 'lat' in d['offers'][0]")" False
pass "active job shown, with status"              "$(j "d['activeJob']['status']")" en_route
pass "active job has the exact location"          "$(j "d['activeJob']['location']['lat']")" 42.067
pass "today: 1 job completed"                     "$(j "d['stats']['today']['jobsCompleted']")" 1
pass "today: fees earned = fee at time of accept" "$(j "d['stats']['today']['calloutFeesCents']")" 25000
pass "today: 3 offers received, 2 accepted"       "$(j "(d['stats']['today']['offersReceived'], d['stats']['today']['offersAccepted'])")" "(3, 2)"
pass "acceptance rate 67%"                        "$(j "d['stats']['today']['acceptanceRate']")" 0.67
pass "history lists the completed job"            "$(j "[h['status'] for h in d['history']]")" "['completed']"
curl -s -o /dev/null "${H[@]}" -b "$JAR" -X PATCH $U/mechanic/profile -d '{"calloutFeeCents":40000}'
pass "raising my price doesn't rewrite past earnings" "$(curl -s -b "$JAR" $U/mechanic/dashboard | python3 -c "import json,sys; print(json.load(sys.stdin)['stats']['today']['calloutFeesCents'])")" 25000
pass "bogus time zone falls back safely"          "$(curl -s -b "$JAR" "$U/mechanic/dashboard?tz=';drop%20table%20jobs;--" | python3 -c "import json,sys; print(json.load(sys.stdin)['stats']['timeZone'])")" America/Chicago
