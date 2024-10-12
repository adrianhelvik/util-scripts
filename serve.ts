import tsBlankSpace from "ts-blank-space"
import express from "express";
import chalk from "chalk";
import path from "path";
import net from "net";
import fs from "fs";
import WebSocket, { WebSocketServer } from "ws";

const websocketPort = await findAvailablePort();

const websocketServer = new WebSocketServer({
    port: websocketPort,
    host: "127.0.0.1",
})

const connections = new Set<WebSocket>();

websocketServer.on('connection', (ws) => {
    connections.add(ws);

    ws.on('error', console.error);

    ws.on("close", () => {
        connections.delete(ws);
    })
});

const app = express();

function startClientWebsocket(websocketPort) {
    new WebSocket(`ws://localhost:${websocketPort}`)
        .addEventListener("message", (event) => {
            if (event.data === "reload") window.location.reload();
        });
}

app.use(async (req, res, next) => {
    try {
        if (!req.path.endsWith("/") && req.path && !path.extname(req.path)) {
            return res.status(307).redirect(req.path + "/");
        }

        const parts = req.path
            .split("/")
            .filter((part) => part !== "" && part !== "." && part !== "..");

        if (!parts.length || !path.extname(parts.at(-1)!)) {
            parts.push("index.html");
        }

        const result = path.resolve(process.cwd(), ...parts);

        if (!result.startsWith(process.cwd())) {
            console.error(`Rejecting file outside of current working directory: '${result}'`);
            res.status(403).send("Forbidden");
            return;
        }

        if (!fs.existsSync(result)) {
            if (req.headers["accept"]?.split(",")?.includes("text/html")) {
                res.set("Content-Type", "text/html");
                fs.createReadStream(path.resolve(process.cwd(), "index.html")).pipe(res);
            } else {
                console.error(`Not found: ${result}`);
                res.status(404).end("Not found");
            }
            return;
        }

        res.header("Cache-Control", "nocache");

        if (result.endsWith(".html")) {
            res.set("Content-Type", "text/html");
            fs.createReadStream(result).pipe(res).write(`<script>(${startClientWebsocket.toString()})(${websocketPort})</script>`);
        } else if (result.endsWith(".css")) {
            res.set("Content-Type", "text/css");
            fs.createReadStream(result).pipe(res);
        } else if (result.endsWith(".ts")) {
            res.set("Content-Type", "text/javascript");
            const source = fs.readFileSync(result, "utf8");
            const output = tsBlankSpace(source);
            res.end(output)
        } else if (result.endsWith(".js")) {
            res.set("Content-type", "text/javascript");
            fs.createReadStream(result).pipe(res);
        } else if (result.endsWith(".json")) {
            res.set("Content-Type", "application/json");
            fs.createReadStream(result).pipe(res);
        } else {
            res.sendFile(result);
        }
    } catch (e) {
        console.error(e.stack);
        res.status(500).end("Something went wrong")
    }
});

let reloadTimeout: ReturnType<typeof setTimeout> | undefined = undefined;
fs.watch(process.cwd(), () => {
    clearTimeout(reloadTimeout)
    reloadTimeout = setTimeout(() => {
        console.log(chalk.gray("Reloading!"))
        connections.forEach(ws => ws.send("reload"));
    }, 50)
});

let port = 4200;
const host = "127.0.0.1";

try {
    app.listen(port, host);
} catch (e) {
    port = await findAvailablePort();
    app.listen(port, host);
}

console.log("Server started on ", chalk.cyan(`http://localhost:${port}`));

function findAvailablePort(): Promise<number> {
    const server = net.createServer();
    return new Promise((resolve, reject) => {
        server.on("error", reject);
        server.listen(0, () => {
            const port = (server.address() as any)!.port;
            server.close(() => {
                resolve(port);
            });
        });
    });
}

