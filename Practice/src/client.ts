import "dotenv/config";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText, jsonSchema, ToolSet } from "ai";
import { confirm, input, select } from "@inquirer/prompts";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CreateMessageRequestSchema, Prompt, PromptMessage, Tool } from "@modelcontextprotocol/sdk/types.js";

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

const google = createGoogleGenerativeAI({
    apiKey: process.env.GEMINI_API_KEY
})

async function main() {
    await mcp.connect(transport)
    const [{ tools }, { prompts }, { resources }, { resourceTemplates }] = await Promise.all([
        mcp.listTools(),
        mcp.listPrompts(),
        mcp.listResources(),
        mcp.listResourceTemplates()
    ])

    mcp.setRequestHandler(CreateMessageRequestSchema, async (request) => {
        const texts: string[] = []
        for (const message of request.params.messages) {
            const text = await handleServerMessagePrompt(message)
            if (text != null) texts.push(text)
        }

        return {
            role: "user",
            model: "gemini-2.0-flash",
            stopReason: "endTurn", // saying this is the end of the client side message for the turn
            content: {
                type: "text",
                text: texts.join("\n"),
            },
        }
    })

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
            case "Prompts":
                const promptName = await select({
                    message: "Select a prompt",
                    choices:
                        prompts.map(prompt => ({
                            name: prompt.name,
                            value: prompt.name,
                            description: prompt.description,
                        })),

                })
                const prompt = prompts.find(p => p.name === promptName)
                if (prompt == null) {
                    console.error("Prompt not found")
                } else {
                    await handlePrompt(prompt)
                }
                break;
            case "Query":
                await handleQuery(tools)
        }
    }
}

async function handleQuery(tools: Tool[]) {
    const query = await input({ message: "Enter your query" })

    const { text, toolResults } = await generateText({
        model: google("gemini-2.0-flash"),
        prompt: query,
        tools: tools.reduce(
            (obj: ToolSet, tool) => {
                // Make sure we always have a valid schema structure for Google Gemini
                const schema = {
                    type: "object" as const,
                    properties: {} as Record<string, any>
                };

                // If the tool has a proper schema with properties, use those
                if (tool.inputSchema && tool.inputSchema.properties) {
                    // Convert each property to a proper JSON schema
                    const props: Record<string, any> = {};
                    for (const [key, value] of Object.entries(tool.inputSchema.properties)) {
                        props[key] = { type: (value as any).type || "string" };
                    }
                    schema.properties = props;
                }

                return {
                    ...obj,
                    [tool.name]: {
                        description: tool.description || "",
                        inputSchema: jsonSchema(schema),
                        execute: async (args: Record<string, any>) => {
                            const result = await mcp.callTool({
                                name: tool.name,
                                arguments: args,
                            });
                            return result.content;
                        },
                    },
                };
            },
            {} as ToolSet
        ),
    })

    console.log(
        text || toolResults[0]?.output[0]?.text || "No text generated."
    )
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

async function handlePrompt(prompt: Prompt) {
    const args: Record<string, string> = {} // empty arguments to start with
    for (const arg of prompt.arguments ?? []) {
        args[arg.name] = await input({
            message: `Enter value for ${arg.name}:`,
        })
    }

    const response = await mcp.getPrompt({
        name: prompt.name,
        arguments: args,
    })

    for (const message of response.messages) {
        console.log(await handleServerMessagePrompt(message));
    }
}

async function handleServerMessagePrompt(message: PromptMessage) {
    if (message.content.type !== "text") return;

    console.log(message.content.text);
    const run = await confirm({
        message: "Would you like to run this prompt",
        default: true
    })

    if (!run) {
        return;
    }

    const { text } = await generateText({
        model: google("gemini-2.0-flash"),
        prompt: message.content.text
    })

    return text;
}

main()