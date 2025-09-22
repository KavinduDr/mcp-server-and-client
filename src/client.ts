import { input, select } from "@inquirer/prompts";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Tool } from "@modelcontextprotocol/sdk/types.js";

const mcp = new Client(
    {
        name: "test-client",
        version: "1.0.0",
    },
    { capabilities: { sampling: {} } }
)

// transport layer protocols
const transport = new StdioClientTransport({
    command: "node",
    args: ["build/server.js"],
    stderr: "ignore", // remove the errors and warnings from the server process. In production you might want to log these somewhere
})

async function main() {
    await mcp.connect(transport)
    const [{ tools }, { prompts }, { resources }, { resourceTemplates }] = await Promise.all([
        mcp.listTools(),
        mcp.listPrompts(),
        mcp.listResources(),
        mcp.listResourceTemplates()
    ])

    console.log("You are connected to the MCP server!")
    while (true) {
        const option = await select({
            message: "What do you want to do?",
            choices: ["Query", "Tools", "Resources", "Prompts"]
        })

        switch (option) {
            case "Tools":
                const toolName = await select({
                    message: "Select a tool",
                    choices: tools.map(tool => ({
                        name: tool.annotations?.title || tool.name,
                        value: tool.name,
                        description: tool.description,
                    })),
                })
                const tool = tools.find(t => t.name === toolName)
                if (tool == null) {
                    console.error("Tool not found")
                } else {
                    await handleTool(tool)
                }
                break;
        }
    }
}

async function handleTool(tool: Tool) {
    const args: Record<string, string> = {} // empty arguments to start with
    for (const [key, value] of Object.entries(
        tool.inputSchema.properties ?? {}
    )) {
        args[key] = await input({
            message: `Enter value for ${key} (${(value as { type: string }).type}):`, // type casting because value is type of unknown. so it will give an error
        })
    }

    const res = await mcp.callTool({
        name: tool.name,
        arguments: args,
    })

    console.log((res.content as [{ text: string }])[0].text) // also type casting because content is of type unknown
}

main()