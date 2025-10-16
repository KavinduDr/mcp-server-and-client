#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { features } from "process";
import z from "zod";

const NWS_API_BASE = "https://api.weather.gov";
const USER_AGENT = "weather-app/1.0";


//create server instance
const server = new McpServer({
    name: "weather",
    version: "1.0.0",
    capabilities: {
        resources: {},
        tools: {}
    }
});

//helper function for making NWS API requests
async function makeNWSRequest<T>(url: string): Promise<T | null> {
    const headers = {
        "User-Agent": USER_AGENT,
        Accept: "application/geo+json"
    };

    try {
        const response = await fetch(url, { headers });
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return (await response.json() as T);
    } catch (error) {
        console.error("Error making NWS request:", error);
        return null;
    }
}

interface AlertFeature {
    properties: {
        event?: string;
        areaDesc?: string;
        severity?: string;
        status?: string;
        headline?: string;
    };
}

// format alert data
function formatAlert(feature: AlertFeature): string {
    const props = feature.properties;
    return [
        `Event: ${props.event || "Unknown"}`,
        `Area: ${props.areaDesc || "Unknown"}`,
        `Severity: ${props.severity || "Unknown"}`,
        `Status: ${props.status || "Unknown"}`,
        `Headline: ${props.headline || "No headline available"}`,
        "---",
    ].join("\n");
}

interface ForecastPeriod {
    name?: string;
    temperature?: number;
    temperatureUnit?: string;
    shortForecast?: string;
    windSpeed?: string;
    windDirection?: string;
}

interface AlertResponse {
    features: AlertFeature[];
}

interface PointsResponse {
    properties: {
        forecast?: string;
    };
}

interface ForecastResponse {
    properties: {
        periods: ForecastPeriod[];
    };
}

//register weather tools
server.tool(
    "get_alerts",
    "Get weather alerts for a state",
    {
        state: z.string().length(2).describe("Two-letter state code (eg. CA, NY)"),
    },
    async ({ state }) => {
        const stateCode = state.toUpperCase();
        const alertUrl = `${NWS_API_BASE}/alerts?area=${stateCode}`;
        const alertData = await makeNWSRequest<AlertResponse>(alertUrl);

        if (!alertData) {
            return {
                content: [
                    {
                        type: "text",
                        text: "Failed to retrieve alerts data",
                    },
                ],
            };
        }

        const formattedAlerts = alertData.features.map(formatAlert);
        const alertsText = `Active alerts for ${stateCode}:\n\n${formattedAlerts.join("\n") || "No active alerts."}`;

        return {
            content: [
                {
                    type: "text",
                    text: alertsText,
                },
            ],
        };
    },
);

server.tool(
    "get_forecast",
    "Get weather forecast for a location",
    {
        latitude: z.number().min(-90).max(90).describe("Latitude of the location"),
        longitude: z.number().min(-180).max(180).describe("Longitude of the location"),
    },
    async ({ latitude, longitude }) => {
        //getting the grid point data
        const pointUrl = `${NWS_API_BASE}/points/${latitude.toFixed(4)},${longitude.toFixed(4)}`;
        const pointsData = await makeNWSRequest<PointsResponse>(pointUrl);

        if (!pointsData) {
            return {
                content: [
                    {
                        type: "text",
                        text: `Failed to retrieve grid point data for (${latitude}, ${longitude})`,
                    },
                ],
            };
        }

        const forecastUrl = pointsData.properties.forecast;
        if (!forecastUrl) {
            return {
                content: [
                    {
                        type: "text",
                        text: "Failed to get forecast URL from the grid point data",
                    },
                ],
            };
        }

        const forecastData = await makeNWSRequest<ForecastResponse>(forecastUrl);
        if (!forecastData) {
            return {
                content: [
                    {
                        type: "text",
                        text: "Failed to retrieve forecast data",
                    },
                ],
            };
        }

        const periods = forecastData.properties?.periods || [];
        if (periods.length === 0) {
            return {
                content: [
                    {
                        type: "text",
                        text: "No forecast periods available",
                    },
                ],
            };
        }

        //formatting forecast periods
        const formattedForecast = periods.map((period: ForecastPeriod) => [
            `${period.name || "Unknown"}:`,
            `Temperature: ${period.temperature || "Unknown"}${period.temperatureUnit || "F"}`,
            `Wind: ${period.windSpeed || "Unknown"} ${period.windDirection || ""}`,
            `${period.shortForecast || "No forecast available"}`,
            "---",
        ].join("\n"),
        );

        const forecastText = `Forecast for ${latitude}, ${longitude}:\n\n${formattedForecast.join("\n")}`;

        return {
            content: [
                {
                    type: "text",
                    text: forecastText,
                },
            ],
        };
    },
);

async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Weather MCP server running on the stdio");
}

main().catch((error) => {
    console.error("Fatal error in main():", error);
    process.exit(1);
})