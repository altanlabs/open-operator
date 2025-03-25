export default function Home() {
  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-3xl mx-auto">
        <header className="mb-12">
          <h1 className="text-4xl font-bold mb-4">AI Browser API</h1>
          <p className="text-gray-600">A simple API for AI-powered web browsing automation</p>
        </header>

        <section className="bg-white p-8 rounded-lg shadow-sm border border-gray-200 mb-8">
          <h2 className="text-2xl font-semibold mb-6">Agent Endpoint</h2>
          
          <div className="mb-6">
            <h3 className="text-lg font-semibold mb-2">POST /api/agent</h3>
            <p className="text-gray-600 mb-4">Create and control an AI browser agent to perform web tasks.</p>
          </div>

          <div className="mb-6">
            <h4 className="font-medium mb-2">Headers</h4>
            <div className="bg-gray-50 p-4 rounded-md font-mono text-sm">
              {`{
  "Content-Type": "application/json",
  "x-api-key": "YOUR_API_KEY"
}`}
            </div>
          </div>

          <div className="mb-6">
            <h4 className="font-medium mb-2">Request Body</h4>
            <div className="bg-gray-50 p-4 rounded-md font-mono text-sm">
              {`{
  "goal": "string",     // The task you want the agent to perform
  "sessionId": "string" // Browser session ID (from /api/session)
}`}
            </div>
          </div>

          <div className="mb-6">
            <h4 className="font-medium mb-2">Example Request</h4>
            <div className="bg-gray-50 p-4 rounded-md font-mono text-sm">
              {`curl -X POST http://your-domain/api/agent \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: YOUR_API_KEY" \\
  -d '{
    "goal": "What is the current price of NVIDIA stock?",
    "sessionId": "session_id_here"
  }'`}
            </div>
          </div>

          <div>
            <h4 className="font-medium mb-2">Response</h4>
            <div className="bg-gray-50 p-4 rounded-md font-mono text-sm">
              {`{
  "success": true,
  "result": {
    "text": "string",      // Description of the action taken
    "reasoning": "string", // Agent's reasoning for the action
    "tool": "string",      // Tool used (GOTO, ACT, EXTRACT, etc.)
    "instruction": "string" // Specific instruction executed
  }
}`}
            </div>
          </div>
        </section>

        <section className="bg-white p-8 rounded-lg shadow-sm border border-gray-200">
          <h2 className="text-2xl font-semibold mb-6">Session Endpoint</h2>
          
          <div className="mb-6">
            <h3 className="text-lg font-semibold mb-2">POST /api/session</h3>
            <p className="text-gray-600 mb-4">Create a new browser session.</p>
          </div>

          <div className="mb-6">
            <h4 className="font-medium mb-2">Headers</h4>
            <div className="bg-gray-50 p-4 rounded-md font-mono text-sm">
              {`{
  "Content-Type": "application/json",
  "x-api-key": "YOUR_API_KEY"
}`}
            </div>
          </div>

          <div className="mb-6">
            <h4 className="font-medium mb-2">Example Request</h4>
            <div className="bg-gray-50 p-4 rounded-md font-mono text-sm">
              {`curl -X POST http://your-domain/api/session \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: YOUR_API_KEY"`}
            </div>
          </div>

          <div>
            <h4 className="font-medium mb-2">Response</h4>
            <div className="bg-gray-50 p-4 rounded-md font-mono text-sm">
              {`{
  "success": true,
  "sessionId": "string",
  "sessionUrl": "string",
  "contextId": "string"
}`}
            </div>
          </div>
        </section>

        <footer className="mt-12 text-center text-gray-500">
          <p>Powered by Browserbase and Stagehand</p>
        </footer>
      </div>
    </div>
  );
}
