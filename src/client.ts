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
            case "Resources":
                const resourceUri = await select({
                    message: "Select a resource",
                    choices: [
                        ...resources.map(resource => ({
                            name: resource.name,
                            value: resource.uri,
                            description: resource.description,
                        })),
                        ...resourceTemplates.map(template => ({
                            name: template.name,
                            value: template.uriTemplate,
                            description: template.description,
                        })),
                    ],
                })
                const uri = resources.find(r => r.uri === resourceUri)?.uri ?? resourceTemplates.find(r => r.uriTemplate === resourceUri)?.uriTemplate
                if (uri == null) {
                    console.error("Resource not found")
                } else {
                    await handleResource(uri)
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

async function handleResource(uri: string) {

    let finalUri = uri
    // check if the uri has template or dynamic variables
    const paramMatches = uri.match(/{([^}]+)}/g)

    if (paramMatches != null) {
        for (const paramMatch of paramMatches) {
            const paramName = paramMatch.replace("{", "").replace("}", "")
            const paramValue = await input({
                message: `Enter value for ${paramName}:`
            })
            finalUri = finalUri.replace(paramMatch, paramValue)
        }
    }

    const res = await mcp.readResource({
        uri: finalUri,
    })

    console.log(JSON.stringify(JSON.parse(res.contents[0].text as string), null, 2)
    ) // type casting because contents is of type unknown and we are stringifying the parsed in data to make it readable
}

main()