import fs from "fs";
import path from "path";
import util from "util";
import { EARLY_ROOT_DIR, IS_WORKER_PROCESS, SILENCE_RPC_429_LOGS, WORKER_SLOT } from "../../app/config";

function timestampNow(): string {
    const d = new Date();
    const pad = (n: number, w = 2) => n.toString().padStart(w, "0");
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

export function patchConsoleWithTimestamp() {
    const targetLogPath = IS_WORKER_PROCESS
        ? path.join(EARLY_ROOT_DIR, "logs", `paper-worker-${WORKER_SLOT || 1}.log`)
        : path.join(EARLY_ROOT_DIR, "paper.log");

    fs.mkdirSync(path.dirname(targetLogPath), { recursive: true });

    const originalLog = console.log.bind(console);
    const originalWarn = console.warn.bind(console);
    const originalError = console.error.bind(console);

    const shouldMirrorStdout = !process.env.INVOCATION_ID && !IS_WORKER_PROCESS;
    const wrap = (fn: (...args: any[]) => void) => (...args: any[]) => {
        const payload = util.format(...args);
        if (SILENCE_RPC_429_LOGS && payload.includes("Server responded with 429 Too Many Requests.")) {
            return;
        }
        const rendered = `[${timestampNow()}] ${payload}`;
        fs.appendFileSync(targetLogPath, `${rendered}\n`);
        if (shouldMirrorStdout) {
            fn(rendered);
        }
    };

    console.log = wrap(originalLog);
    console.warn = wrap(originalWarn);
    console.error = wrap(originalError);
}

export function stageLog(_ctx: string, stage: string, message: string) {
    console.log(`${stage.padEnd(12)} | ${message}`);
}
