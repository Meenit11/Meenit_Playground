const https = require('https');

const data = JSON.stringify({ rooms: {} });

const options = {
    hostname: 'api.jsonblob.com',
    port: 443,
    path: '/api/jsonBlob',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Content-Length': data.length
    }
};

const req = https.request(options, (res) => {
    console.log('Status:', res.statusCode);
    const location = res.headers['location'] || res.headers['Location'];
    console.log('Location:', location);
});

req.on('error', (e) => {
    console.error(e);
});

req.write(data);
req.end();
