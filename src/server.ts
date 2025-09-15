import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new McpServer({
    name: "test",
    version: "1.0.0",
    capabilities: {
        resources: {},
        tooles: {},
        prompts: {},
    }
})

// Start the server

async function main() {
    const transport = new StdioServerTransport() //create a transport using standard input/output
    await server.connect(transport)
}

main()