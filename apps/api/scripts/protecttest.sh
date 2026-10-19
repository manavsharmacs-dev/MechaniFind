#!/bin/zsh
# Attack-style tests for the protection layer. Starts its own servers with
# small limits, then cleans up. Usage: npm run test:protect
cd "$(dirname "$0")/.."
LOG=$(mktemp); JAR=$(mktemp); SERVER=
U=http://localhost:3999
J=(-H 'content-type: application/json')
start() { env PORT=3999 "$@" npx tsx src/index.ts > "$LOG" 2>&1 & SERVER=$!; for i in {1..40}; do curl -s $U/ >/dev/null && return; sleep 0.25; done; }
stop() { [[ -n $SERVER ]] && kill $SERVER 2>/dev/null; wait $SERVER 2>/dev/null; SERVER=; }
trap 'stop; rm -f "$LOG" "$JAR"' EXIT
pass() { [[ "$2" == "$3" ]] && echo "PASS  $1" || echo "FAIL  $1  (expected $3, got $2)"; }
st() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
code_for() { grep "code for $1" "$LOG" | tail -1 | awk '{print $NF}'; }
otp() { st "${J[@]}" -X POST $U/api/auth/phone-number/send-otp -d "{\"phoneNumber\":\"$1\"}" "${@:2}"; }

echo "--- Flooding"
start RATE_IP_PER_MIN=40
ok=0; limited=0
for i in {1..45}; do s=$(st $U/); [[ $s == 200 ]] && ((ok++)); [[ $s == 429 ]] && ((limited++)); done
pass "flood: 40 allowed (1 used by startup check), rest refused" "$ok/$limited" "39/6"
pass "refusal says when to retry" "$(curl -s -D - -o /dev/null $U/ | grep -ci '^retry-after')" 1
pass "faking X-Forwarded-For doesn't reset the limit" "$(st -H 'x-forwarded-for: 1.2.3.4' $U/)" 429
stop

echo "--- Scanning for pages"
start SCANNER_BAD_LIMIT=10
for p in admin .env wp-login.php api/users api/admin config.json .git/config backup.sql api/v1 debug graphql; do st $U/$p >/dev/null; done
pass "scanner gets blocked from everything" "$(st $U/)" 429
pass "blocked scanner can't escape with fake IP header" "$(st -H 'x-forwarded-for: 9.9.9.9' $U/)" 429
grep -q "blocked" "$LOG" && echo "PASS  block is logged for you to see"
stop

echo "--- Oversized / junk requests"
start
big=$(head -c 20000 /dev/zero | tr '\0' 'a')
pass "20 KB body refused" "$(st "${J[@]}" -X POST $U/api/auth/phone-number/send-otp -d "{\"phoneNumber\":\"$big\"}")" 413
pass "junk phone refused before using any quota" "$(otp 'not-a-phone')" 400
stop

echo "--- CAPTCHA (Cloudflare's official test keys)"
start TURNSTILE_SECRET_KEY=2x0000000000000000000000000000000AA TRUST_PROXY_HEADER=x-forwarded-for
pass "no CAPTCHA token: refused" "$(otp +18155550401 -H 'x-forwarded-for: 10.4.0.1')" 400
pass "bad CAPTCHA token: refused" "$(otp +18155550401 -H 'x-forwarded-for: 10.4.0.2' -H 'x-captcha-response: XXXX.DUMMY.TOKEN.XXXX')" 403
stop
start TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA TRUST_PROXY_HEADER=x-forwarded-for
pass "valid CAPTCHA token: code sent" "$(otp +18155550402 -H 'x-forwarded-for: 10.4.0.3' -H 'x-captcha-response: XXXX.DUMMY.TOKEN.XXXX')" 200
stop

echo "--- Daily cost cap (SMS)"
start SMS_DAILY_CAP=2 TRUST_PROXY_HEADER=x-forwarded-for
otp +18155550411 -H 'x-forwarded-for: 10.1.0.1' >/dev/null
otp +18155550412 -H 'x-forwarded-for: 10.1.0.2' >/dev/null
pass "3rd text of the day refused once cap hit (even new phone + IP)" "$(otp +18155550413 -H 'x-forwarded-for: 10.1.0.3')" 503
grep -q "COST CAP" "$LOG" && echo "PASS  cost-cap alert logged"
stop

echo "--- One account flooding from many IPs"
start RATE_USER_PER_MIN=5 TRUST_PROXY_HEADER=x-forwarded-for
otp +18155550421 -H 'x-forwarded-for: 10.2.0.1' >/dev/null
st "${J[@]}" -c "$JAR" -H 'x-forwarded-for: 10.2.0.1' -X POST $U/api/auth/phone-number/verify -d "{\"phoneNumber\":\"+18155550421\",\"code\":\"$(code_for +18155550421)\"}" >/dev/null
last=""; for i in {1..6}; do last=$(st -b "$JAR" -H "x-forwarded-for: 10.3.0.$i" $U/me); done
pass "6th /me in a minute refused, despite a new IP each time" "$last" 429
stop

echo "--- Audit fixes"
start SCANNER_BAD_LIMIT=1000 TRUST_PROXY_HEADER=x-forwarded-for
pass "password-reset takeover route is gone" "$(st "${J[@]}" -X POST $U/api/auth/phone-number/request-password-reset -d '{"phoneNumber":"+18155550431"}')" 404
pass "password sign-in route is gone" "$(st "${J[@]}" -X POST $U/api/auth/sign-in/phone-number -d '{}')" 404
pass "update-user route is gone" "$(st "${J[@]}" -X POST $U/api/auth/update-user -d '{"phoneNumber":null}')" 404
pass "open-redirect route is gone" "$(st "$U/api/auth/expo-authorization-proxy?authorizationURL=https://evil.example")" 404
pass "trailing-slash trick doesn't slip through" "$(st "${J[@]}" -X POST $U/api/auth/phone-number/send-otp/ -d '{}')" 404
pass "international number refused (SMS pumping)" "$(otp +442071234567 -H 'x-forwarded-for: 10.5.0.1')" 400
last=""; for i in {1..11}; do last=$(st "${J[@]}" -H "x-forwarded-for: 10.6.0.$i" -X POST $U/api/auth/phone-number/verify -d '{"phoneNumber":"+18155550432","code":"000000"}'); done
pass "11th code guess for one phone in an hour refused (even from new IPs)" "$last" 429
for i in {1..40}; do st $U/me >/dev/null; done
pass "expired-session 401s don't get a driver blocked" "$(st $U/)" 200
last=""; for i in {1..7}; do last=$(st $U/health/db); done
pass "/health/db limited (it wakes the database)" "$last" 429
stop
start DEV_PRINT_OTP=0
otp +18155550433 >/dev/null
grep -q "code for" "$LOG" && echo "FAIL  code printed without DEV_PRINT_OTP" || echo "PASS  codes never printed unless DEV_PRINT_OTP=1"
stop
NODE_ENV=production DEV_PRINT_OTP=0 npx tsx src/index.ts > "$LOG" 2>&1
grep -q "TURNSTILE_SECRET_KEY is required" "$LOG" && echo "PASS  production refuses to start without CAPTCHA" || echo "FAIL  production started without CAPTCHA"
NODE_ENV=production TURNSTILE_SECRET_KEY=x DEV_PRINT_OTP=1 npx tsx src/index.ts > "$LOG" 2>&1
grep -q "DEV_PRINT_OTP must not" "$LOG" && echo "PASS  production refuses to print codes" || echo "FAIL  production allowed DEV_PRINT_OTP"

echo "--- Quota race (100 at once, limit 5)"
npx tsx scripts/quotatest.mts
npx tsx scripts/authtest-cleanup.mts | tail -1
