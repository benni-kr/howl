const fetch = require('node-fetch');

async function test() {
  const res = await fetch('http://127.0.0.1:8000/api/check_shapes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      subgraphs: [{ index: 0, vertices: [{x:0,y:0}, {x:1,y:0}] }]
    })
  });
  console.log(await res.json());
}
test();
