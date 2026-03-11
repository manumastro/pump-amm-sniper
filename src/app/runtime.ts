import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { Connection, PublicKey } from "@solana/web3.js";
import { WorkerSlotState } from "../domain/types";

export function createSupervisorRuntime(options: {
    rootDir: string;
    workerLogDir: string;
    maxConcurrentOperations: number;
    queueMaxPendingSignatures: number;
    signatureCacheTtlMs: number;
    signatureCacheMaxSize: number;
    logStaleResubscribeMs: number;
    healthcheckIntervalMs: number;
    programId: string;
    createConnection: () => Connection;
    initSdks: (connection: Connection) => void;
    handleNewPool: (connection: Connection, signature: string) => Promise<void>;
    shortSig: (value: string) => string;
    getWorkerEntryCommand: () => { cmd: string; args: string[] };
    stageLog: (ctx: string, stage: string, message: string) => void;
    onStartupLog: (workerCount: number) => void;
}) {
    let logSubscriptionId: number | null = null;
    let lastLogAtMs = Date.now();
    let healthcheckInterval: NodeJS.Timeout | null = null;
    const seenSignatures = new Map<string, number>();
    const pendingSignatures: string[] = [];
    const pendingSignatureSet = new Set<string>();
    const workerSlots: WorkerSlotState[] = Array.from(
        { length: Math.max(1, options.maxConcurrentOperations) },
        (_, index) => ({
            slot: index + 1,
            busy: false,
            signature: null,
            child: null,
        }),
    );

    function getWorkerLogPath(slot: number): string {
        return path.join(options.workerLogDir, `paper-worker-${slot}.log`);
    }

    function findIdleWorkerSlot(): WorkerSlotState | null {
        return workerSlots.find((slot) => !slot.busy) || null;
    }

    function enqueuePendingSignature(signature: string) {
        if (pendingSignatureSet.has(signature)) return;

        const maxPending = Math.max(1, options.queueMaxPendingSignatures);
        if (pendingSignatures.length >= maxPending) {
            const dropped = pendingSignatures.shift();
            if (dropped) {
                pendingSignatureSet.delete(dropped);
                console.warn(`QUEUE        | drop oldest ${options.shortSig(dropped)} (max ${maxPending})`);
            }
        }

        pendingSignatures.push(signature);
        pendingSignatureSet.add(signature);
        console.log(`QUEUE        | enqueued ${options.shortSig(signature)} (pending=${pendingSignatures.length})`);
    }

    function dispatchPoolToWorker(signature: string): boolean {
        const slot = findIdleWorkerSlot();
        if (!slot) {
            return false;
        }

        fs.mkdirSync(options.workerLogDir, { recursive: true });
        const workerLogPath = getWorkerLogPath(slot.slot);
        if (!fs.existsSync(workerLogPath)) {
            fs.writeFileSync(workerLogPath, "");
        }

        slot.busy = true;
        slot.signature = signature;
        console.log(`DISPATCH     | worker-${slot.slot} ${options.shortSig(signature)}`);

        const workerEntry = options.getWorkerEntryCommand();
        const child = spawn(workerEntry.cmd, workerEntry.args, {
            cwd: options.rootDir,
            env: {
                ...process.env,
                WORKER_TASK_SIGNATURE: signature,
                WORKER_SLOT: String(slot.slot),
            },
            stdio: "ignore",
        });

        slot.child = child;

        child.on("exit", (code, signal) => {
            console.log(
                `WORKER       | worker-${slot.slot} done ${options.shortSig(signature)} ` +
                `(code=${code ?? "null"} signal=${signal ?? "-"})`,
            );
            slot.busy = false;
            slot.signature = null;
            slot.child = null;
            drainPendingQueue();
        });

        child.on("error", (error) => {
            console.error(`WORKER       | worker-${slot.slot} failed ${options.shortSig(signature)}: ${error.message}`);
            slot.busy = false;
            slot.signature = null;
            slot.child = null;
            drainPendingQueue();
        });

        return true;
    }

    function drainPendingQueue() {
        while (pendingSignatures.length > 0) {
            const signature = pendingSignatures[0];
            if (!dispatchPoolToWorker(signature)) {
                return;
            }
            pendingSignatures.shift();
            pendingSignatureSet.delete(signature);
        }
    }

    function alreadySeenSignature(signature: string, nowMs: number): boolean {
        const existing = seenSignatures.get(signature);
        if (existing && nowMs - existing < options.signatureCacheTtlMs) {
            return true;
        }
        seenSignatures.set(signature, nowMs);
        return false;
    }

    function pruneSignatureCache(nowMs: number) {
        for (const [sig, timestamp] of seenSignatures) {
            if (nowMs - timestamp > options.signatureCacheTtlMs) {
                seenSignatures.delete(sig);
            }
        }

        if (seenSignatures.size > options.signatureCacheMaxSize) {
            const entries = Array.from(seenSignatures.entries()).sort((a, b) => a[1] - b[1]);
            const toRemove = seenSignatures.size - options.signatureCacheMaxSize;
            for (let i = 0; i < toRemove; i++) {
                seenSignatures.delete(entries[i][0]);
            }
        }
    }

    async function subscribeToPoolLogs(connection: Connection) {
        console.log("👀 Listening for 'create_pool' logs...");
        logSubscriptionId = connection.onLogs(
            new PublicKey(options.programId),
            async (logs) => {
                try {
                    lastLogAtMs = Date.now();
                    pruneSignatureCache(lastLogAtMs);

                    if (alreadySeenSignature(logs.signature, lastLogAtMs)) {
                        return;
                    }

                    const hasCreatePool = logs.logs.some((log) =>
                        log.toLowerCase().includes("create_pool") || log.toLowerCase().includes("createpool")
                    );
                    if (!hasCreatePool) return;

                    if (!dispatchPoolToWorker(logs.signature)) {
                        enqueuePendingSignature(logs.signature);
                    }
                } catch (e: any) {
                    console.error(`❌ Log handler error: ${e.message}`);
                }
            },
            "confirmed",
        );
    }

    function startLogHealthcheck(connection: Connection) {
        if (healthcheckInterval) clearInterval(healthcheckInterval);

        healthcheckInterval = setInterval(async () => {
            const now = Date.now();
            const staleForMs = now - lastLogAtMs;

            drainPendingQueue();
            if (staleForMs < options.logStaleResubscribeMs) return;

            console.warn(`⚠️ Log stream stale for ${Math.floor(staleForMs / 1000)}s. Resubscribing...`);
            try {
                if (logSubscriptionId !== null) {
                    await connection.removeOnLogsListener(logSubscriptionId);
                }
            } catch (e: any) {
                console.warn(`⚠️ Failed removing old log subscription: ${e.message}`);
            }

            logSubscriptionId = null;
            lastLogAtMs = now;
            await subscribeToPoolLogs(connection);
        }, options.healthcheckIntervalMs);
    }

    function setupGracefulShutdown(connection: Connection) {
        const shutdown = async () => {
            console.log("\n🛑 Shutting down...");

            if (healthcheckInterval) {
                clearInterval(healthcheckInterval);
                healthcheckInterval = null;
            }

            if (logSubscriptionId !== null) {
                try {
                    await connection.removeOnLogsListener(logSubscriptionId);
                } catch {
                    // no-op on shutdown
                }
                logSubscriptionId = null;
            }

            for (const slot of workerSlots) {
                if (slot.child && !slot.child.killed) {
                    try {
                        slot.child.kill("SIGTERM");
                    } catch {
                        // no-op on shutdown
                    }
                }
            }

            process.exit(0);
        };

        process.once("SIGINT", shutdown);
        process.once("SIGTERM", shutdown);
    }

    async function runSupervisor() {
        const connection = options.createConnection();
        options.initSdks(connection);
        options.onStartupLog(workerSlots.length);
        await subscribeToPoolLogs(connection);
        startLogHealthcheck(connection);
        setupGracefulShutdown(connection);
        console.log("🚀 Sniper is running. Press Ctrl+C to stop.\n");
    }

    return {
        runSupervisor,
    };
}
