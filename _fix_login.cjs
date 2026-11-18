const fs = require('fs');
const p = 'CAPSTONE-SHELF-main/src/pages/visitor/VisitorLogin.jsx';
let s = fs.readFileSync(p, 'utf8');
const old = "        // Only route to the code entry screen when a\r\n        // registration was actually found. The response\r\n        // is intentionally the same either way so the form\r\n        // does not reveal which emails are registered.\r\n        if (result?.visitorId) {\r\n          setPendingVisitorId(\r\n            result.visitorId\r\n          );\r\n\r\n          setPendingEmail(email);\r\n          setOtpInput('');\r\n          setError('');\r\n          setView('otp');\r\n\r\n          return;\r\n        }\r\n\r\n        setError(\r\n          'If an unverified registration exists for that address, a new verification code is on its way.'\r\n        );";
const rep = "        // Generic recovery must not disclose account existence or route by\r\n        // leaked visitor identifiers. Keep the user on the current flow.\r\n        setError(\r\n          'If an unverified registration exists for that address, a new verification code is on its way.'\r\n        );";
if (!s.includes(old)) { console.error('LOGIN_NOT_FOUND'); process.exit(1); }
s = s.replace(old, rep);
fs.writeFileSync(p, s);
console.log('login-ok');
