/**
 * Manual Test Script for Odd One In Backend
 * Run this with: node test_backend.js
 * Make sure server.js is running on port 3001 first!
 */
const http = require('http');

const PORT = 3001;
const BASE_URL = `http://localhost:${PORT}/api/rooms`;

async function request(path, method = 'GET', body = null) {
    return new Promise((resolve, reject) => {
        const url = `${BASE_URL}${path}`;
        const options = {
            method,
            headers: {
                'Content-Type': 'application/json',
            }
        };

        const req = http.request(url, options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    resolve({ status: res.statusCode, data: json });
                } catch (e) {
                    resolve({ status: res.statusCode, data });
                }
            });
        });

        req.on('error', reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

async function runTests() {
    console.log('--- Starting Backend Tests ---');

    // 1. Create Room
    console.log('\n1. Testing Room Creation...');
    const createRes = await request('', 'POST', { gmName: 'Meenit' });
    if (createRes.status === 200 && createRes.data.code) {
        console.log('✅ Room Created:', createRes.data.code);
    } else {
        console.error('❌ Room Creation Failed:', createRes);
        return;
    }

    const code = createRes.data.code;

    // 2. Join Room
    console.log('\n2. Testing Player Joining...');
    const joinRes = await request(`/${code}/join`, 'POST', { playerName: 'Doshi' });
    if (joinRes.status === 200 && joinRes.data.playerId) {
        console.log('✅ Player Joined. ID:', joinRes.data.playerId);
    } else {
        console.error('❌ Player Joining Failed:', joinRes);
    }

    // 3. Get State
    console.log('\n3. Testing Get State...');
    const stateRes = await request(`/${code}`);
    if (stateRes.status === 200 && stateRes.data.state.players.length === 2) {
        console.log('✅ State retrieved correctly. Players:', stateRes.data.state.players.length);
    } else {
        console.error('❌ Get State Failed:', stateRes);
    }

    // 4. Submit Answer
    console.log('\n4. Testing Answer Submission...');
    const ansRes = await request(`/${code}/answer`, 'POST', { 
        playerId: joinRes.data.playerId, 
        answer: 'Test Answer' 
    });
    if (ansRes.status === 200 && ansRes.data.state.answers[joinRes.data.playerId] === 'Test Answer') {
        console.log('✅ Answer submitted successfully.');
    } else {
        console.error('❌ Answer Submission Failed:', ansRes);
    }

    console.log('\n--- Tests Completed ---');
}

runTests().catch(console.error);
