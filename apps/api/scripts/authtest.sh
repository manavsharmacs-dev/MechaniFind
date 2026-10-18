#!/bin/zsh
# End-to-end sign-in test. Starts its own API server, cleans up after itself.
# Simulates a proxy (TRUST_PROXY_HEADER) so the test can act as many different IPs.
cd "$(dirname "$0")/.."
LOG=$(mktemp); JAR=$(mktemp)
TRUST_PROXY_HEADER=x-forwarded-for npx tsx src/index.ts > "$LOG" 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null; rm -f "$LOG" "$JAR"' EXIT
for i in {1..30}; do curl -s localhost:3000/ >/dev/null && break; sleep 0.5; done

B=http://localhost:3000/api/auth
H=(-H 'content-type: application/json')
pass() { [[ "$2" == "$3" ]] && echo "PASS  $1" || echo "FAIL  $1  (expected $3, got $2)"; }
code_for() { grep "code for $1" "$LOG" | tail -1 | awk '{print $NF}'; }
send() { curl -s -o /dev/null -w '%{http_code}' "${H[@]}" -H "x-forwarded-for: $2" -X POST $B/phone-number/send-otp -d "{\"phoneNumber\":\"$1\"}"; }
verify() { curl -s -o /dev/null -w '%{http_code}' "${H[@]}" -H "x-forwarded-for: $3" -c "$JAR" -X POST $B/phone-number/verify -d "{\"phoneNumber\":\"$1\",\"code\":\"$2\"$4}"; }

P1=+18155550101; P2=+18155550102; P3=+18155550103; P4=+18155550104

# 1. Normal sign-in
pass "send code"                          "$(send $P1 10.0.0.1)" 200
C=$(code_for $P1)
pass "wrong code rejected"                "$(verify $P1 000000 10.0.0.1)" 400
pass "right code signs in"                "$(verify $P1 $C 10.0.0.1)" 200
ME=$(curl -s -b "$JAR" localhost:3000/me)
pass "/me works when signed in"           "$(echo $ME | grep -o '"role":"driver"')" '"role":"driver"'
pass "/me blocked when signed out"        "$(curl -s -o /dev/null -w '%{http_code}' localhost:3000/me)" 401
pass "code can't be reused"               "$(verify $P1 $C 10.0.0.1)" 400

# 2. Can't make yourself an admin while signing up
send $P2 10.0.0.2 >/dev/null; C2=$(code_for $P2)
R=$(verify $P2 $C2 10.0.0.2 ',"role":"admin"')
ROLE=$(curl -s -b "$JAR" localhost:3000/me | grep -o '"role":"[a-z_]*"')
[[ "$R" != "200" || "$ROLE" == '"role":"driver"' ]] && echo "PASS  can't sign up as admin (status $R, ${ROLE:-no session})" || echo "FAIL  became $ROLE"
pass "can't change own role later (route doesn't exist)"        "$(curl -s -o /dev/null -w '%{http_code}' "${H[@]}" -b "$JAR" -H 'origin: http://localhost:3000' -X POST $B/update-user -d '{"role":"admin"}')" 404

# 3. Three wrong guesses kill the code
send $P3 10.0.0.3 >/dev/null; C3=$(code_for $P3)
for i in 1 2 3; do verify $P3 000000 10.0.0.3 >/dev/null; done
pass "code dead after 3 wrong guesses"    "$(verify $P3 $C3 10.0.0.3)" 403

# 4. Abuse limits
pass "bad phone format rejected"          "$(send 815-555-0105 10.0.0.4)" 400
for i in 1 2 3; do send +1815555020$i 10.0.0.5 >/dev/null; done
pass "4th code/minute from one IP blocked" "$(send +18155550299 10.0.0.5)" 429
for i in 1 2 3 4 5; do send $P4 10.0.1.$i >/dev/null; done
pass "6th code/hour to one phone blocked (even from new IPs)" "$(send $P4 10.0.2.1)" 429

# 5. Sign out
curl -s -o /dev/null -b "$JAR" -c "$JAR" -H 'origin: http://localhost:3000' -X POST $B/sign-out
pass "signed out"                         "$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" localhost:3000/me)" 401

grep -iE "error" "$LOG" | grep -v "\[DEV\]" | head -5
