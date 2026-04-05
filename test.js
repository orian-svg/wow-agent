require('dotenv').config();
const fetch = require('node-fetch');

async function test() {
  const res = await fetch('https://open-api.guesty.com/oauth2/token', {
    method: 'POST',
    headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      scope: 'open-api',
      client_id: process.env.GUESTY_CLIENT_ID,
      client_secret: process.env.GUESTY_CLIENT_SECRET
    })
  });
  const token = await res.json();
  const r2 = await fetch('https://open-api.guesty.com/v1/reservations?limit=5', {
    headers: {Authorization: 'Bearer ' + token.access_token}
  });
  const data = await r2.json();
  console.log(JSON.stringify(data.results?.map(r => ({
    id: r._id,
    guest: r.guest?.fullName,
    listing: r.listing?.title
  })), null, 2));
}
test();
```

שמור אותו בשם `test.js` בתיקייה `C:\Users\PC\wow-agent`.

אחר כך בטרמינל:
```
node test.js