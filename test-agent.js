#!/usr/bin/env node

const https = require('http');
const readline = require('readline');

// Read goal from command line args or prompt user
async function getGoal() {
  if (process.argv.length > 2) {
    return process.argv.slice(2).join(' ');
  }
  
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  return new Promise((resolve) => {
    rl.question('Enter your goal for the agent: ', (goal) => {
      rl.close();
      resolve(goal);
    });
  });
}

async function testAgentAPI() {
  try {
    const goal = await getGoal();
    console.log(`\nTesting agent API with goal: "${goal}"\n`);
    
    const data = JSON.stringify({ goal });
    
    // Get API key from environment variable
    const apiKey = process.env.API_KEY;
    if (!apiKey) {
      console.error('Error: API_KEY environment variable is not set');
      console.log('Please set your API key using:');
      console.log('export API_KEY=your_api_key_here');
      return;
    }
    
    const options = {
      hostname: 'localhost',
      port: 3000,
      path: '/api/agent',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length,
        'x-api-key': apiKey
      }
    };
    
    const req = https.request(options, (res) => {
      console.log(`Status: ${res.statusCode}`);
      
      if (res.statusCode !== 200) {
        console.error('API request failed with status:', res.statusCode);
        res.on('data', (chunk) => {
          console.error('Error response:', chunk.toString());
        });
        return;
      }
      
      // Handle streaming response
      let buffer = '';
      
      res.on('data', (chunk) => {
        // Add to buffer
        buffer += chunk.toString();
        
        // Process complete lines in the buffer
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // The last element might be incomplete
        
        for (const line of lines) {
          if (line.trim()) {
            try {
              const data = JSON.parse(line);
              printResponse(data);
            } catch (e) {
              console.log('Raw output:', line);
            }
          }
        }
      });
      
      res.on('end', () => {
        // Process any remaining data in the buffer
        if (buffer.trim()) {
          try {
            const data = JSON.parse(buffer);
            printResponse(data);
          } catch (e) {
            console.log('Raw output:', buffer);
          }
        }
        console.log('Response ended');
      });
    });
    
    req.on('error', (error) => {
      console.error('Error making request:', error.message);
    });
    
    // Write data to request body
    req.write(data);
    req.end();
  } catch (error) {
    console.error('Error testing API:', error);
  }
}

function printResponse(data) {
  switch (data.type) {
    case 'session_start':
      console.log(`Started session: ${data.sessionId}`);
      console.log(`Session URL: ${data.sessionUrl}\n`);
      break;
      
    case 'starting_url':
      console.log(`Starting URL: ${data.url}`);
      console.log(`Reasoning: ${data.reasoning}\n`);
      break;
      
    case 'step_complete':
      console.log(`Step completed: ${data.result.text}\n`);
      break;
      
    case 'step_planned':
      console.log(`Planning next step:`);
      console.log(`- Action: ${data.result.text}`);
      console.log(`- Reasoning: ${data.result.reasoning}`);
      console.log(`- Tool: ${data.result.tool}`);
      console.log(`- Instruction: ${data.result.instruction}`);
      if (data.done) {
        console.log('- Task complete!');
      }
      console.log();
      break;
      
    case 'step_executed':
      console.log(`Executed step.`);
      if (data.extraction) {
        console.log(`Extraction result:`, data.extraction);
      }
      if (data.url) {
        console.log(`Navigated to: ${data.url}`);
      }
      console.log();
      break;
      
    case 'complete':
      console.log(`Task completed successfully!`);
      console.log(`Total steps executed: ${data.steps.length}`);
      console.log();
      break;
      
    case 'error':
      console.error(`Error occurred: ${data.error}\n`);
      break;
      
    default:
      console.log('Unknown response type:', data);
  }
}

testAgentAPI(); 