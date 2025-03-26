import tsBlankSpace from "ts-blank-space";
import Handlebars from "handlebars";
import express from "express";
import swc from "@swc/core";
import chalk from "chalk";
import path from "path";
import net from "net";
import fs from "fs";
import WebSocket, { WebSocketServer } from "ws";
import { exec } from "child_process";

const fileToServe = process.argv[2];
const initialPath = fileToServe ? `/${fileToServe}` : "";

const websocketPort = await findAvailablePort();

const websocketServer = new WebSocketServer({
    port: websocketPort,
    host: "127.0.0.1",
});

const connections = new Set<WebSocket>();

websocketServer.on("connection", (ws) => {
    connections.add(ws);

    ws.on("error", console.error);

    ws.on("close", () => {
        connections.delete(ws);
    });
});

const app = express();

function startClientWebsocket(websocketPort) {
    new WebSocket(`ws://localhost:${websocketPort}`).addEventListener(
        "message",
        (event) => {
            if (event.data === "reload") {
                console.log("Reloading");
                window.location.reload();
            }
        },
    );
}

app.use(async (req, res, next) => {
    let filename = "";
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

        filename = path.resolve(process.cwd(), ...parts);

        if (!filename.startsWith(process.cwd())) {
            console.error(
                `Rejecting file outside of current working directory: '${filename}'`,
            );
            res.status(403).send("Forbidden");
            return;
        }

        if (!fs.existsSync(filename)) {
            const indexFile = path.resolve(process.cwd(), "index.html");
            if (
                req.headers["accept"]?.split(",")?.includes("text/html") &&
                fs.existsSync(indexFile)
            ) {
                res.set("Content-Type", "text/html");
                fs.createReadStream(indexFile).pipe(res);
            } else {
                console.error(`Not found: ${filename}`);
                res.status(404).end("Not found");
            }
            return;
        }

        res.header("Cache-Control", "nocache");

        if (filename.endsWith(".hbs.html")) {
            res.set("Content-Type", "text/html");
            const source = await fs.promises.readFile(filename, "utf8");
            const template = Handlebars.compile(source);
            const html = await template(req.query);
            res.write(html);
            res.end(
                `<script>(${startClientWebsocket.toString()})(${websocketPort})</script>`,
            );
        } else if (filename.endsWith(".html")) {
            res.set("Content-Type", "text/html");
            fs.createReadStream(filename)
                .pipe(res)
                .write(
                    `<script>(${startClientWebsocket.toString()})(${websocketPort})</script>`,
                );
        } else if (filename.endsWith(".css")) {
            res.set("Content-Type", "text/css");
            fs.createReadStream(filename).pipe(res);
        } else if (filename.endsWith(".ts") || filename.endsWith(".tsx")) {
            res.set("Content-Type", "text/javascript");
            const source = await fs.promises.readFile(filename, "utf8");
            const output = tsBlankSpace(source);
            res.end(output);
        } else if (filename.endsWith(".js")) {
            res.set("Content-type", "text/javascript");
            fs.createReadStream(filename).pipe(res);
        } else if (filename.endsWith(".json")) {
            res.set("Content-Type", "application/json");
            fs.createReadStream(filename).pipe(res);
        } else {
            res.sendFile(filename);
        }
    } catch (e) {
        console.error(
            `${req.method} ${req.url}: ${e.message} (reading ${filename})`,
        );
        res.status(500).end("Something went wrong");
    }
});

let reloadTimeout: ReturnType<typeof setTimeout> | undefined = undefined;
fs.watch(process.cwd(), () => {
    clearTimeout(reloadTimeout);
    reloadTimeout = setTimeout(() => {
        console.log(chalk.gray("Reloading!"));
        connections.forEach((ws) => ws.send("reload"));
    }, 10);
});

let port = 4200;
const host = "127.0.0.1";

try {
    app.listen(port, host, () => {
        exec(`open http://localhost:${port}${initialPath}`);
    });
} catch (e) {
    port = await findAvailablePort();
    app.listen(port, host, () => {
        exec(`open http://localhost:${port}${initialPath}`);
    });
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
