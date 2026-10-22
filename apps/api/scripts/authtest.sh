#!/bin/zsh
# End-to-end sign-in test. Starts its own API server, cleans up after itself.
# Simulates a proxy (TRUST_PROXY_HEADER) so the test can act as many different IPs.
cd "$(dirname "$0")/.."
LOG=$(mktemp); JAR=$(mktemp); JAR2=$(mktemp); JAR3=$(mktemp)
PORT=3999 TRUST_PROXY_HEADER=x-forwarded-for npx tsx src/index.ts > "$LOG" 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null; rm -f "$LOG" "$JAR" "$JAR2" "$JAR3"' EXIT
for i in {1..30}; do curl -s localhost:3999/ >/dev/null && break; sleep 0.5; done

B=http://localhost:3999/api/auth
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
ME=$(curl -s -b "$JAR" localhost:3999/me)
pass "/me works when signed in"           "$(echo $ME | grep -o '"role":"driver"')" '"role":"driver"'
pass "/me blocked when signed out"        "$(curl -s -o /dev/null -w '%{http_code}' localhost:3999/me)" 401
pass "code can't be reused"               "$(verify $P1 $C 10.0.0.1)" 400

# 2. Can't make yourself an admin while signing up
send $P2 10.0.0.2 >/dev/null; C2=$(code_for $P2)
R=$(verify $P2 $C2 10.0.0.2 ',"role":"admin"')
ROLE=$(curl -s -b "$JAR" localhost:3999/me | grep -o '"role":"[a-z_]*"')
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

# 5. Email sign-in
esend() { curl -s -o /dev/null -w '%{http_code}' "${H[@]}" -H "x-forwarded-for: $2" -X POST $B/email-otp/send-verification-otp -d "{\"email\":\"$1\",\"type\":\"${3:-sign-in}\"}"; }
esignin() { curl -s -o /dev/null -w '%{http_code}' "${H[@]}" -H "x-forwarded-for: $3" -c "$4" -X POST $B/sign-in/email-otp -d "{\"email\":\"$1\",\"otp\":\"$2\"}"; }
myid() { curl -s -b "$1" localhost:3999/me | grep -o '"id":"[^"]*"'; }
E1=driver1@example.com; E2=mech2@example.com; E3=taken3@example.com
pass "email: send sign-in code"            "$(esend $E1 10.7.0.1)" 200
pass "email: wrong code rejected"          "$(esignin $E1 000000 10.7.0.1 $JAR2)" 400
pass "email: right code signs in"          "$(esignin $E1 $(code_for $E1) 10.7.0.1 $JAR2)" 200
pass "email: /me shows the email"          "$(curl -s -b "$JAR2" localhost:3999/me | grep -o '"email":"driver1@example.com"')" '"email":"driver1@example.com"'
pass "email: new account starts as driver" "$(curl -s -b "$JAR2" localhost:3999/me | grep -o '"role":"driver"')" '"role":"driver"'
pass "email: throwaway inbox refused"      "$(esend someone@mailinator.com 10.7.0.2)" 400
pass "email: password-reset code refused"  "$(esend $E1 10.7.0.3 forget-password)" 400
pass "email: password-reset route is gone" "$(curl -s -o /dev/null -w '%{http_code}' "${H[@]}" -X POST $B/email-otp/reset-password -d '{}')" 404
pass "email: code-checking route is gone (no guessing oracle)" "$(curl -s -o /dev/null -w '%{http_code}' "${H[@]}" -X POST $B/email-otp/check-verification-otp -d '{}')" 404
esend hash4@example.com 10.7.0.4 >/dev/null
HC=$(code_for hash4@example.com)
STORED=$(npx tsx -e "import('./src/db/index.js').then(async ({db,pool})=>{const {sql}=await import('drizzle-orm');const r=await db.execute(sql\`select value from verifications where identifier like '%hash4@example.com%'\`);console.log(String((r.rows[0] as any)?.value??''));await pool.end();})" 2>/dev/null)
[[ -n "$STORED" && "$STORED" != *"$HC"* ]] && echo "PASS  email: codes stored scrambled (hashed), not readable" || echo "FAIL  email: code readable in database"

# 6. Linking: email account adds a phone
P5=+18155550105
send $P5 10.8.0.1 >/dev/null
pass "link: email account adds a phone"    "$(curl -s -o /dev/null -w '%{http_code}' "${H[@]}" -b "$JAR2" -H 'origin: http://localhost:3000' -H 'x-forwarded-for: 10.8.0.1' -X POST $B/phone-number/verify -d "{\"phoneNumber\":\"$P5\",\"code\":\"$(code_for $P5)\",\"updatePhoneNumber\":true}")" 200
pass "link: /me now shows the phone too"   "$(curl -s -b "$JAR2" localhost:3999/me | grep -o "\"phoneNumber\":\"$P5\"")" "\"phoneNumber\":\"$P5\""

# 7. Linking: phone account adds an email, then signs in with it
P6=+18155550106
send $P6 10.9.0.1 >/dev/null
curl -s -o /dev/null "${H[@]}" -c "$JAR3" -H 'x-forwarded-for: 10.9.0.1' -X POST $B/phone-number/verify -d "{\"phoneNumber\":\"$P6\",\"code\":\"$(code_for $P6)\"}"
PHONE_ID=$(myid "$JAR3")
pass "link: phone account hides internal placeholder email" "$(curl -s -b "$JAR3" localhost:3999/me | grep -o '"email":null')" '"email":null'
pass "link: request code at new email"     "$(curl -s -o /dev/null -w '%{http_code}' "${H[@]}" -b "$JAR3" -H 'origin: http://localhost:3000' -H 'x-forwarded-for: 10.9.0.2' -X POST $B/email-otp/request-email-change -d "{\"newEmail\":\"$E2\"}")" 200
pass "link: confirm new email with code"   "$(curl -s -o /dev/null -w '%{http_code}' "${H[@]}" -b "$JAR3" -H 'origin: http://localhost:3000' -H 'x-forwarded-for: 10.9.0.2' -X POST $B/email-otp/change-email -d "{\"newEmail\":\"$E2\",\"otp\":\"$(code_for $E2)\"}")" 200
esend $E2 10.9.0.3 >/dev/null; rm -f "$JAR"; esignin $E2 $(code_for $E2) 10.9.0.3 $JAR >/dev/null
pass "link: signing in by the added email opens the SAME account" "$(myid "$JAR")" "$PHONE_ID"

# 8. Replacing an existing email needs the OLD email's approval (fix B)
U=http://localhost:3999
approve() { # jar, channel, newValue, ip, oldAddress  → prints confirm's http status
  curl -s -o /dev/null "${H[@]}" -b "$1" -H "x-forwarded-for: $4" -X POST $U/account/contact-change/start -d "{\"channel\":\"$2\",\"newValue\":\"$3\"}"
  curl -s -o /dev/null -w '%{http_code}' "${H[@]}" -b "$1" -H "x-forwarded-for: $4" -X POST $U/account/contact-change/confirm -d "{\"channel\":\"$2\",\"code\":\"$(code_for $5)\"}"
}
R=$(curl -s -w ' %{http_code}' "${H[@]}" -b "$JAR3" -H 'origin: http://localhost:3000' -H 'x-forwarded-for: 10.9.0.5' -X POST $B/email-otp/request-email-change -d "{\"newEmail\":\"$E1\"}")
pass "replace: without the old email's approval, refused" "${R##* }" 403
pass "...and says why"                        "$(echo $R | grep -o OLD_CONTACT_APPROVAL_REQUIRED)" OLD_CONTACT_APPROVAL_REQUIRED
pass "replace: old email approves (code sent to $E2)" "$(approve "$JAR3" email "$E1" 10.9.0.6 "$E2")" 200

# 8a. Even with approval, can't take over someone else's email
pass "steal: requesting another user's email looks normal" "$(curl -s -o /dev/null -w '%{http_code}' "${H[@]}" -b "$JAR3" -H 'origin: http://localhost:3000' -H 'x-forwarded-for: 10.9.0.4' -X POST $B/email-otp/request-email-change -d "{\"newEmail\":\"$E1\"}")" 200
grep -q "Email code for $E1" <(grep -c "" "$LOG" >/dev/null; awk -v e="$E1" 'index($0,"Email code for " e)' "$LOG" | tail -n +2) && echo "FAIL  steal: a code was sent to the owner's inbox" || echo "PASS  steal: no code is sent, so the email can't be claimed"
pass "steal: guessing the change code fails" "$(curl -s -o /dev/null -w '%{http_code}' "${H[@]}" -b "$JAR3" -H 'origin: http://localhost:3000' -H 'x-forwarded-for: 10.9.0.4' -X POST $B/email-otp/change-email -d "{\"newEmail\":\"$E1\",\"otp\":\"123456\"}")" 400

# 8b. Adding/changing a contact needs a RECENT sign-in (fix A)
UID6=$(echo "$PHONE_ID" | sed -E 's/.*"id":"([^"]+)".*/\1/')   # bare id (myid returns "id":"...")
[[ -n "$UID6" && "$UID6" != *'"'* ]] || echo "FAIL  fresh: couldn't read the test user's id"
age() { npx tsx -e "import('./src/db/index.js').then(async ({db,pool})=>{const {sql}=await import('drizzle-orm');await db.execute(sql.raw(\"update sessions set created_at = now() - interval '$1 minutes' where user_id = '$UID6'\"));await pool.end();})"; }
OH=(-H 'origin: http://localhost:3000')
E3=link3@example.com; P7=+18155550107
age 11
R=$(curl -s -w ' %{http_code}' "${H[@]}" -b "$JAR3" "${OH[@]}" -H 'x-forwarded-for: 10.10.0.1' -X POST $B/email-otp/request-email-change -d "{\"newEmail\":\"$E3\"}")
pass "fresh: 11-min-old session can't request an email change" "${R##* }" 403
pass "...and says to sign in again"         "$(echo $R | grep -o 'REAUTH_REQUIRED')" REAUTH_REQUIRED
grep -q "Email code for $E3" "$LOG" && echo "FAIL  ...but a code was sent anyway" || echo "PASS  ...and no code is sent"
pass "fresh: 11-min-old session can't confirm an email change" "$(curl -s -o /dev/null -w '%{http_code}' "${H[@]}" -b "$JAR3" "${OH[@]}" -H 'x-forwarded-for: 10.10.0.1' -X POST $B/email-otp/change-email -d "{\"newEmail\":\"$E3\",\"otp\":\"123456\"}")" 403
send $P7 10.10.0.2 >/dev/null
pass "fresh: 11-min-old session can't add/replace a phone" "$(curl -s -o /dev/null -w '%{http_code}' "${H[@]}" -b "$JAR3" "${OH[@]}" -H 'x-forwarded-for: 10.10.0.2' -X POST $B/phone-number/verify -d "{\"phoneNumber\":\"$P7\",\"code\":\"$(code_for $P7)\",\"updatePhoneNumber\":true}")" 403
pass "fresh: phone number unchanged"        "$(curl -s -b "$JAR3" localhost:3999/me | grep -o "\"phoneNumber\":\"$P6\"")" "\"phoneNumber\":\"$P6\""
pass "fresh: the old session still works for everything else" "$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR3" localhost:3999/me)" 200
age 9
pass "fresh: 9-min-old session can get the old email's approval" "$(approve "$JAR3" email "$E3" 10.10.0.6 "$E2")" 200
pass "fresh: 9-min-old session can still change contacts" "$(curl -s -o /dev/null -w '%{http_code}' "${H[@]}" -b "$JAR3" "${OH[@]}" -H 'x-forwarded-for: 10.10.0.3' -X POST $B/email-otp/request-email-change -d "{\"newEmail\":\"$E3\"}")" 200
age 60
pass "fresh: an approval doesn't help an old session" "$(curl -s -o /dev/null -w '%{http_code}' "${H[@]}" -b "$JAR3" "${OH[@]}" -H 'x-forwarded-for: 10.10.0.7' -X POST $B/email-otp/request-email-change -d "{\"newEmail\":\"$E3\"}")" 403
JAR4=$(mktemp); send $P6 10.10.0.4 >/dev/null
curl -s -o /dev/null "${H[@]}" -c "$JAR4" -H 'x-forwarded-for: 10.10.0.4' -X POST $B/phone-number/verify -d "{\"phoneNumber\":\"$P6\",\"code\":\"$(code_for $P6)\"}"
pass "fresh: signing in again unlocks contact changes" "$(curl -s -o /dev/null -w '%{http_code}' "${H[@]}" -b "$JAR4" "${OH[@]}" -H 'x-forwarded-for: 10.10.0.5' -X POST $B/email-otp/request-email-change -d "{\"newEmail\":\"$E3\"}")" 200
rm -f "$JAR4"

# 9. Sign out
curl -s -o /dev/null "${H[@]}" -b "$JAR" -c "$JAR" -H 'origin: http://localhost:3000' -X POST $B/sign-out -d '{}'
pass "signed out"                         "$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" localhost:3999/me)" 401

grep -iE "error" "$LOG" | grep -v "\[DEV\]" | head -5
