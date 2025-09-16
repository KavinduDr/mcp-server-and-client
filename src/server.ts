import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { title } from "process";
import z from "zod";
import fs from "node:fs/promises";

const server = new McpServer({
    name: "test",
    version: "1.0.0",
    capabilities: {
        resources: {},
        tooles: {},
        prompts: {},
    }
})

//create a tool
server.tool("create-user", "Create a new user in the databse", {
    name: z.string(),
    email: z.string(),
    address: z.string(),
    phone: z.string()
}, {
    title: "Create User",
    readOnlyHint: false, //indicates that this tool modifies state
    destructiveHint: false, //indicates that this tool does not delete data, if deleting then we set this to true then it will give additional confirmation prompts
    idempotentHint: false, //indicates that this tool is not idempotent, if it is idempotent then we set this to true then it will give additional confirmation prompts
    openWorldHint: true //indicates that this tool can be used in an open world setting, if false then it will give additional confirmation prompts. because our database will be external
}, async (params) => {
    try {
        const id = await createUser(params)
        return {
            content: [
                { type: "text", text: `User ${id} created successfully` }
            ]
        }
    } catch {
        return {
            content: [
                { type: "text", text: "Failed to create user" }
            ]
        }
    }
})

async function createUser(user: {
    name: string,
    email: string,
    address: string,
    phone: string
}) {
    const users = await import("./data/users.json", { // this file import is relative to the current file
        with: { type: "json" }
    }).then(m => m.default)

    const id = users.length + 1
    users.push({ id, ...user })

    await fs.writeFile("./src/data/users.json", JSON.stringify(users, null, 2)) // this file path is needed from the root folder because we are using ts-node to run the file

    return id
}

// Start the server

async function main() {
    const transport = new StdioServerTransport() //create a transport using standard input/output
    await server.connect(transport)
}

main()