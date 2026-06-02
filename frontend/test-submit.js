const http = require('http');

const data = JSON.stringify({
  m: 5,
  n: 5,
  achieved_rank: 3,
  solver_name: 'test',
  cut_sequence: [
    { t: 'c', v: [[0, 0], [1, 0]] },
    { t: 'v', v: [[2, 2]], r: 1 },
    { t: 'i', v: [[3, 3]] }
  ]
});

const req = http.request({
  hostname: '127.0.0.1',
  port: 8000,
  path: '/api/submit_solution',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data),
    // Fake token, might get 401 instead of 422 if auth is first, but lets see
    'Authorization': 'Bearer asdf'
  }
}, (res) => {
  let body = '';
  res.on('data', d => body += d);
  res.on('end', () => console.log('Status:', res.statusCode, 'Body:', body));
});

req.write(data);
req.end();
