import { NextResponse } from "next/server";
import Browserbase from "@browserbasehq/sdk";

type BrowserbaseRegion =
  | "us-west-2"
  | "us-east-1"
  | "eu-central-1"
  | "ap-southeast-1";

// Exact timezone matches for east coast cities
const exactTimezoneMap: Record<string, BrowserbaseRegion> = {
  "America/New_York": "us-east-1",
  "America/Detroit": "us-east-1",
  "America/Toronto": "us-east-1",
  "America/Montreal": "us-east-1",
  "America/Boston": "us-east-1",
  "America/Chicago": "us-east-1",
};

// Prefix-based region mapping
const prefixToRegion: Record<string, BrowserbaseRegion> = {
  America: "us-west-2",
  US: "us-west-2",
  Canada: "us-west-2",
  Europe: "eu-central-1",
  Africa: "eu-central-1",
  Asia: "ap-southeast-1",
  Australia: "ap-southeast-1",
  Pacific: "ap-southeast-1",
};

// Offset ranges to regions (inclusive bounds)
const offsetRanges: {
  min: number;
  max: number;
  region: BrowserbaseRegion;
}[] = [
  { min: -24, max: -4, region: "us-west-2" }, // UTC-24 to UTC-4
  { min: -3, max: 4, region: "eu-central-1" }, // UTC-3 to UTC+4
  { min: 5, max: 24, region: "ap-southeast-1" }, // UTC+5 to UTC+24
];

function getClosestRegion(timezone?: string): BrowserbaseRegion {
  try {
    if (!timezone) {
      return "us-west-2"; // Default if no timezone provided
    }

    // Check exact matches first
    if (timezone in exactTimezoneMap) {
      return exactTimezoneMap[timezone];
    }

    // Check prefix matches
    const prefix = timezone.split("/")[0];
    if (prefix in prefixToRegion) {
      return prefixToRegion[prefix];
    }

    // Use offset-based fallback
    const date = new Date();
    // Create a date formatter for the given timezone
    const formatter = new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    // Get the timezone offset in minutes
    const timeString = formatter.format(date);
    const testDate = new Date(timeString);
    const hourOffset = (testDate.getTime() - date.getTime()) / (1000 * 60 * 60);

    const matchingRange = offsetRanges.find(
      (range) => hourOffset >= range.min && hourOffset <= range.max
    );

    return matchingRange?.region ?? "us-west-2";
  } catch {
    return "us-west-2";
  }
}

async function createSession(timezone?: string, contextId?: string) {
  try {
    // Validate environment variables
    if (!process.env.BROWSERBASE_API_KEY) {
      throw new Error('BROWSERBASE_API_KEY environment variable is not set');
    }
    if (!process.env.BROWSERBASE_PROJECT_ID) {
      throw new Error('BROWSERBASE_PROJECT_ID environment variable is not set');
    }

    console.log('Creating Browserbase session with:', {
      timezone,
      contextId,
      apiKeyPresent: !!process.env.BROWSERBASE_API_KEY,
      projectIdPresent: !!process.env.BROWSERBASE_PROJECT_ID
    });

    const bb = new Browserbase({
      apiKey: process.env.BROWSERBASE_API_KEY
    });

    const browserSettings: { context?: { id: string; persist: boolean } } = {};
    
    try {
      if (contextId) {
        browserSettings.context = {
          id: contextId,
          persist: true,
        };
      } else {
        console.log('Creating new context...');
        const context = await bb.contexts.create({
          projectId: process.env.BROWSERBASE_PROJECT_ID,
        });
        browserSettings.context = {
          id: context.id,
          persist: true,
        };
        console.log('Context created:', context.id);
      }

      console.log('Creating session with settings:', {
        projectId: process.env.BROWSERBASE_PROJECT_ID,
        region: getClosestRegion(timezone),
        contextId: browserSettings.context?.id
      });

      const session = await bb.sessions.create({
        projectId: process.env.BROWSERBASE_PROJECT_ID,
        browserSettings,
        keepAlive: true,
        region: getClosestRegion(timezone),
      });

      console.log('Session created successfully:', session.id);

      return {
        session,
        contextId: browserSettings.context?.id,
      };
    } catch (error) {
      console.error('Error in session/context creation:', error);
      throw error;
    }
  } catch (error) {
    console.error('Error in createSession:', error);
    throw error;
  }
}

async function endSession(sessionId: string) {
  const bb = new Browserbase({
    apiKey: process.env.BROWSERBASE_API_KEY!,
  });
  await bb.sessions.update(sessionId, {
    projectId: process.env.BROWSERBASE_PROJECT_ID!,
    status: "REQUEST_RELEASE",
  });
}

async function getDebugUrl(sessionId: string) {
  const bb = new Browserbase({
    apiKey: process.env.BROWSERBASE_API_KEY!,
  });
  const session = await bb.sessions.debug(sessionId);
  return session.debuggerFullscreenUrl;
}

export async function POST(request: Request) {
  try {
    console.log('Starting session creation...');
    const body = await request.json();
    const timezone = body.timezone as string;
    const providedContextId = body.contextId as string;

    try {
      const { session, contextId } = await createSession(
        timezone,
        providedContextId
      );
      const liveUrl = await getDebugUrl(session.id);
      
      console.log('Session creation completed successfully');
      return NextResponse.json({
        success: true,
        sessionId: session.id,
        sessionUrl: liveUrl,
        contextId,
      });
    } catch (error) {
      console.error('Detailed session creation error:', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        timezone,
        providedContextId
      });
      
      return NextResponse.json(
        { 
          success: false, 
          error: "Failed to create session",
          details: error instanceof Error ? error.message : String(error)
        },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('Error processing request:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: "Failed to process request",
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  const body = await request.json();
  const sessionId = body.sessionId as string;
  await endSession(sessionId);
  return NextResponse.json({ success: true });
}
