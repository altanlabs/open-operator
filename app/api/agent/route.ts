import { NextResponse } from 'next/server';
import { openai } from "@ai-sdk/openai";
import { CoreMessage, generateObject, UserContent } from "ai";
import { z } from "zod";
import { ObserveResult, Stagehand } from "@browserbasehq/stagehand";

const LLMClient = openai("gpt-4o");

// API key validation middleware
function validateApiKey(request: Request) {
  const apiKey = request.headers.get('x-api-key');
  const validApiKey = process.env.API_KEY;
  
  // Add debug logging
  console.log('API Key validation:', {
    apiKeyPresent: !!apiKey,
    validApiKeyPresent: !!validApiKey,
    headerKeys: Array.from(request.headers.keys())
  });
  
  if (!validApiKey) {
    console.error('API_KEY environment variable is not set in the server environment');
    return NextResponse.json(
      { 
        error: 'Server configuration error: API_KEY not set',
        details: 'The API_KEY environment variable is not configured on the server'
      },
      { status: 500 }
    );
  }
  
  if (!apiKey) {
    return NextResponse.json(
      { 
        error: 'Missing API key',
        details: 'The x-api-key header is required'
      },
      { status: 401 }
    );
  }
  
  if (apiKey !== validApiKey) {
    return NextResponse.json(
      { 
        error: 'Invalid API key',
        details: 'The provided API key is not valid'
      },
      { status: 401 }
    );
  }
  
  return null; // null means validation passed
}

type Step = {
  text: string;
  reasoning: string;
  tool: "GOTO" | "ACT" | "EXTRACT" | "OBSERVE" | "CLOSE" | "WAIT" | "NAVBACK";
  instruction: string;
};

async function runStagehand({
  sessionID,
  method,
  instruction,
}: {
  sessionID: string;
  method: "GOTO" | "ACT" | "EXTRACT" | "CLOSE" | "SCREENSHOT" | "OBSERVE" | "WAIT" | "NAVBACK";
  instruction?: string;
}) {
  let stagehand = null;
  try {
    stagehand = new Stagehand({
      browserbaseSessionID: sessionID,
      env: "BROWSERBASE",
      logger: () => {},
    });
    await stagehand.init();

    const page = stagehand.page;

    try {
      switch (method) {
        case "GOTO":
          await page.goto(instruction!, {
            waitUntil: "commit",
            timeout: 60000,
          });
          break;

        case "ACT":
          await page.act(instruction!);
          break;

        case "EXTRACT": {
          const { extraction } = await page.extract(instruction!);
          return extraction;
        }

        case "OBSERVE":
          return await page.observe({
            instruction,
            useAccessibilityTree: true,
          });

        case "CLOSE":
          await stagehand.close();
          break;

        case "SCREENSHOT": {
          const cdpSession = await page.context().newCDPSession(page);
          const { data } = await cdpSession.send("Page.captureScreenshot");
          return data;
        }

        case "WAIT":
          await new Promise((resolve) =>
            setTimeout(resolve, Number(instruction))
          );
          break;

        case "NAVBACK":
          await page.goBack();
          break;
      }
    } catch (error) {
      console.error(`Error executing ${method}:`, error);
      throw error;
    }
  } catch (error) {
    console.error('Failed to execute Stagehand operation:', error);
    throw new Error(`Failed to execute Stagehand operation: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    // Always attempt to close the stagehand session if it was initialized
    if (stagehand) {
      try {
        await stagehand.close();
      } catch (closeError) {
        console.error('Error closing Stagehand session:', closeError);
      }
    }
  }
}

async function sendPrompt({
  goal,
  sessionID,
  previousSteps = [],
  previousExtraction,
}: {
  goal: string;
  sessionID: string;
  previousSteps?: Step[];
  previousExtraction?: string | ObserveResult[];
}) {
  let currentUrl = "";

  try {
    const stagehand = new Stagehand({
      browserbaseSessionID: sessionID,
      env: "BROWSERBASE"
    });
    await stagehand.init();
    currentUrl = await stagehand.page.url();
    await stagehand.close();
  } catch (error) {
    console.error('Error getting page info:', error);
  }

  const content: UserContent = [
    {
      type: "text",
      text: `Consider the following screenshot of a web page${currentUrl ? ` (URL: ${currentUrl})` : ''}, with the goal being "${goal}".
${previousSteps.length > 0
    ? `Previous steps taken:
${previousSteps
  .map(
    (step, index) => `
Step ${index + 1}:
- Action: ${step.text}
- Reasoning: ${step.reasoning}
- Tool Used: ${step.tool}
- Instruction: ${step.instruction}
`
  )
  .join("\n")}`
    : ""
}
Determine the immediate next step to take to achieve the goal. 

Important guidelines:
1. Break down complex actions into individual atomic steps
2. For ACT commands, use only one action at a time, such as:
   - Single click on a specific element
   - Type into a single input field
   - Select a single option
3. Avoid combining multiple actions in one instruction
4. If multiple actions are needed, they should be separate steps

If the goal has been achieved, return "close".`,
    },
  ];

  // Add screenshot if navigated to a page previously
  if (previousSteps.length > 0 && previousSteps.some((step) => step.tool === "GOTO")) {
    content.push({
      type: "image",
      image: (await runStagehand({
        sessionID,
        method: "SCREENSHOT",
      })) as string,
    });
  }

  if (previousExtraction) {
    content.push({
      type: "text",
      text: `The result of the previous ${
        Array.isArray(previousExtraction) ? "observation" : "extraction"
      } is: ${previousExtraction}.`,
    });
  }

  const message: CoreMessage = {
    role: "user",
    content,
  };

  const result = await generateObject({
    model: LLMClient,
    schema: z.object({
      text: z.string(),
      reasoning: z.string(),
      tool: z.enum([
        "GOTO",
        "ACT",
        "EXTRACT",
        "OBSERVE",
        "CLOSE",
        "WAIT",
        "NAVBACK",
      ]),
      instruction: z.string(),
    }),
    messages: [message],
  });

  return {
    result: result.object,
    previousSteps: [...previousSteps, result.object],
  };
}

async function selectStartingUrl(goal: string) {
  const message: CoreMessage = {
    role: "user",
    content: [{
      type: "text",
      text: `Given the goal: "${goal}", determine the best URL to start from.
Choose from:
1. A relevant search engine (Google, Bing, etc.)
2. A direct URL if you're confident about the target website
3. Any other appropriate starting point

Return a URL that would be most effective for achieving this goal.`
    }]
  };

  const result = await generateObject({
    model: LLMClient,
    schema: z.object({
      url: z.string().url(),
      reasoning: z.string()
    }),
    messages: [message]
  });

  return result.object;
}

// Helper function to create a new Browserbase session
async function createBrowserbaseSession() {
  // This should make an API call to Browserbase to create a new session
  // You'll need to replace this with the actual API call using your API key
  try {
    // For testing, we can get around this by using a pre-created session
    // In production, you should make an API call to Browserbase to create a new session
    const response = await fetch('https://api.browserbase.com/v1/sessions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.BROWSERBASE_API_KEY}`
      },
      body: JSON.stringify({
        // Configuration options for the session
        width: 1280,
        height: 800,
        timeout: 60
      })
    });
    
    const data = await response.json();
    return {
      sessionId: data.id,
      debugUrl: data.debugUrl
    };
  } catch (error) {
    console.error('Failed to create Browserbase session:', error);
    throw new Error('Failed to create Browserbase session');
  }
}

// Async generator function for streaming responses
async function* executeAgentWithStream({
  goal,
  sessionId,
}: {
  goal: string;
  sessionId?: string; // Make sessionId optional
}) {
  let sessionCreatedInternally = false;
  let activeSessionId: string | null = sessionId || null;
  
  try {
    // Create a new session if one wasn't provided
    let debugUrl;
    
    if (!activeSessionId) {
      try {
        const session = await createBrowserbaseSession();
        activeSessionId = session.sessionId;
        debugUrl = session.debugUrl;
        sessionCreatedInternally = true;
      } catch (error) {
        throw new Error(`Failed to create a Browserbase session: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    
    // At this point activeSessionId should always be defined
    if (!activeSessionId) {
      throw new Error('Failed to create or use a valid session ID');
    }
    
    // Get starting URL
    const { url, reasoning } = await selectStartingUrl(goal);
    const firstStep: Step = {
      text: `Navigating to ${url}`,
      reasoning,
      tool: "GOTO",
      instruction: url
    };
    
    // Construct a session URL if we don't have one from creation
    const sessionUrl = debugUrl || `https://www.browserbase.com/devtools-fullscreen/inspector.html?wss=connect.euc1.browserbase.com/debug/${activeSessionId}/devtools/page/1?debug=true`;
    
    yield JSON.stringify({
      type: 'session_start',
      sessionId: activeSessionId,
      sessionUrl,
      contextId: activeSessionId,
    });

    // Execute first step
    await runStagehand({
      sessionID: activeSessionId,
      method: "GOTO",
      instruction: url
    });

    yield JSON.stringify({
      type: 'step_complete',
      result: firstStep,
      done: false
    });

    // Keep track of all steps
    let allSteps: Step[] = [firstStep];
    let done = false;

    // Continue until the goal is achieved
    while (!done) {
      // Get the next step
      const { result, previousSteps: newPreviousSteps } = await sendPrompt({
        goal,
        sessionID: activeSessionId,
        previousSteps: allSteps,
      });

      allSteps = newPreviousSteps;
      
      // If the step is CLOSE, we're done
      done = result.tool === "CLOSE";

      yield JSON.stringify({
        type: 'step_planned',
        result,
        done
      });

      // If not done, execute the step
      if (!done) {
        const extraction = await runStagehand({
          sessionID: activeSessionId,
          method: result.tool,
          instruction: result.instruction,
        });

        yield JSON.stringify({
          type: 'step_executed',
          extraction: extraction || null,
          currentStep: result,
          url: result.tool === "GOTO" ? result.instruction : null
        });
      }
    }

    // Final result
    yield JSON.stringify({
      type: 'complete',
      steps: allSteps,
      finalResult: allSteps[allSteps.length - 1]
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    yield JSON.stringify({
      type: 'error',
      error: errorMessage
    });
  } finally {
    // Clean up if we created the session internally
    if (sessionCreatedInternally && activeSessionId) {
      try {
        // Close the session through the API
        await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/session`, {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            sessionId: activeSessionId,
          }),
        });
      } catch (cleanupError) {
        console.error('Error cleaning up session:', cleanupError);
      }
    }
  }
}

export async function POST(request: Request) {
  // Validate API key first
  const validationError = validateApiKey(request);
  if (validationError) {
    return validationError;
  }
  
  let sessionId: string | null = null;
  
  try {
    const body = await request.json();
    const { goal, sessionId: providedSessionId } = body;

    if (!goal) {
      return NextResponse.json(
        { error: 'Missing goal in request body' },
        { status: 400 }
      );
    }

    // Always create a new session unless one is explicitly provided
    sessionId = providedSessionId || null;
    let sessionUrl = '';
    let sessionCreatedInRoute = false;
    
    if (!sessionId) {
      try {
        // Create a real Browserbase session using the existing session API
        const sessionResponse = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/session`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            timezone: 'America/Los_Angeles', // Default timezone
          }),
        });
        
        if (!sessionResponse.ok) {
          throw new Error('Failed to create session');
        }
        
        const sessionData = await sessionResponse.json();
        
        if (!sessionData.success) {
          throw new Error(sessionData.error || 'Failed to create session');
        }
        
        sessionId = sessionData.sessionId;
        sessionUrl = sessionData.sessionUrl;
        sessionCreatedInRoute = true;
        
        // Create a readable stream for our response
        return new Response(
          new ReadableStream({
            async start(controller) {
              const encoder = new TextEncoder();
              
              // Immediately send session info for fast UI feedback
              controller.enqueue(encoder.encode(JSON.stringify({
                type: 'session_start',
                sessionId,
                sessionUrl,
                contextId: sessionData.contextId
              }) + '\n'));
              
              // Now run the full agent loop
              try {
                // Get starting URL and generate first step
                const { url, reasoning } = await selectStartingUrl(goal);
                const firstStep: Step = {
                  text: `Navigating to ${url}`,
                  reasoning,
                  tool: "GOTO",
                  instruction: url
                };
                
                controller.enqueue(encoder.encode(JSON.stringify({
                  type: 'starting_url',
                  url,
                  reasoning
                }) + '\n'));
                
                // Execute first step
                if (!sessionId) {
                  throw new Error('Session ID is unexpectedly null');
                }
                
                await runStagehand({
                  sessionID: sessionId,
                  method: "GOTO",
                  instruction: url
                });
                
                controller.enqueue(encoder.encode(JSON.stringify({
                  type: 'step_complete',
                  result: firstStep,
                  done: false
                }) + '\n'));
                
                // Keep track of all steps
                let allSteps: Step[] = [firstStep];
                let done = false;
                
                // Continue until the goal is achieved
                while (!done) {
                  // Get the next step
                  const { result, previousSteps: newPreviousSteps } = await sendPrompt({
                    goal,
                    sessionID: sessionId,
                    previousSteps: allSteps,
                  });
                  
                  allSteps = newPreviousSteps;
                  
                  // If the step is CLOSE, we're done
                  done = result.tool === "CLOSE";
                  
                  controller.enqueue(encoder.encode(JSON.stringify({
                    type: 'step_planned',
                    result,
                    done
                  }) + '\n'));
                  
                  // If not done, execute the step
                  if (!done) {
                    const extraction = await runStagehand({
                      sessionID: sessionId,
                      method: result.tool,
                      instruction: result.instruction,
                    });
                    
                    controller.enqueue(encoder.encode(JSON.stringify({
                      type: 'step_executed',
                      extraction: extraction || null,
                      currentStep: result,
                      url: result.tool === "GOTO" ? result.instruction : null
                    }) + '\n'));
                  }
                }
                
                // Final result
                controller.enqueue(encoder.encode(JSON.stringify({
                  type: 'complete',
                  steps: allSteps,
                  finalResult: allSteps[allSteps.length - 1]
                }) + '\n'));
                
                controller.close();
              } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                controller.enqueue(encoder.encode(JSON.stringify({
                  type: 'error',
                  error: errorMessage
                }) + '\n'));
                controller.close();
              } finally {
                // Always clean up the session
                if (sessionId) {
                  try {
                    await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/session`, {
                      method: 'DELETE',
                      headers: {
                        'Content-Type': 'application/json',
                      },
                      body: JSON.stringify({
                        sessionId,
                      }),
                    });
                  } catch (cleanupError) {
                    console.error('Error cleaning up session:', cleanupError);
                  }
                }
              }
            }
          }),
          {
            headers: {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              'Connection': 'keep-alive',
            },
          }
        );
      } catch (initError) {
        // Clean up session if it was created but an error happened later
        if (sessionCreatedInRoute && sessionId) {
          try {
            await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/session`, {
              method: 'DELETE',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                sessionId,
              }),
            });
          } catch (cleanupError) {
            console.error('Error cleaning up session after initial error:', cleanupError);
          }
        }
        
        return NextResponse.json(
          { success: false, error: 'Failed to create session', details: String(initError) },
          { status: 500 }
        );
      }
    } else {
      // Use existing session ID with streaming response
      return new Response(
        new ReadableStream({
          async start(controller) {
            const encoder = new TextEncoder();
            
            try {
              // At this point sessionId is not null because we're in the else block where sessionId exists
              for await (const chunk of executeAgentWithStream({ goal, sessionId: sessionId as string })) {
                controller.enqueue(encoder.encode(chunk + '\n'));
              }
              controller.close();
            } catch (error: unknown) {
              const errorMessage = error instanceof Error ? error.message : String(error);
              controller.enqueue(encoder.encode(JSON.stringify({ type: 'error', error: errorMessage }) + '\n'));
              controller.close();
            }
          }
        }),
        {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          },
        }
      );
    }
  } catch (error) {
    // Final fallback cleanup if we have a session ID
    if (sessionId) {
      try {
        await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/session`, {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            sessionId,
          }),
        });
      } catch (cleanupError) {
        console.error('Error in final session cleanup:', cleanupError);
      }
    }
    
    console.error('Error in agent endpoint:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to process request' },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({ message: 'Agent API endpoint ready' });
} 