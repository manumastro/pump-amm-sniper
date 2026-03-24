import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { Connection, PublicKey } from "@solana/web3.js";
import { WorkerSlotState } from "../domain/types";

type DeferredNoWsolCandidatePayload = {
    signature: string;
    tokenMint: string;
    poolAddress: string;
    createdAt?: string;
    noWsolRetryCount?: number;
    source?: string;
};

type DeferredNoWsolJob = {
    jobId: string;
    signature: string;
    tokenMint: string;
    poolAddress: string;
    createdAtMs: number;
    nextRunAtMs: number;
    expiresAtMs: number;
    attempts: number;
    noWsolRetryCount: number;
    source: string;
};

export function createSupervisorRuntime(options: {
    rootDir: string;
    workerLogDir: string;
    maxConcurrentOperations: number;
    queueMaxPendingSignatures: number;
    deferredNoWsolQueueEnabled: boolean;
    deferredNoWsolQueueDir: string;
    deferredNoWsolLogPath: string;
    deferredNoWsolQueueMaxJobs: number;
    deferredNoWsolInitialDelayMs: number;
    deferredNoWsolMaxAttempts: number;
    deferredNoWsolBaseIntervalMs: number;
    deferredNoWsolBackoffMultiplier: number;
    deferredNoWsolMaxIntervalMs: number;
    deferredNoWsolMaxAgeMs: number;
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
    checkDeferredNoWsolCandidate: (candidate: {
        signature: string;
        tokenMint: string;
        poolAddress: string;
        attempt: number;
        jobId: string;
    }) => Promise<{ hasWsol: boolean; details: string }>;
    onStartupLog: (workerCount: number) => void;
}) {
    let logSubscriptionId: number | null = null;
    let lastLogAtMs = Date.now();
    let healthcheckInterval: NodeJS.Timeout | null = null;
    const seenSignatures = new Map<string, number>();
    const activeSignatures = new Set<string>();
    const pendingSignatures: string[] = [];
    const pendingSignatureSet = new Set<string>();
    const deferredNoWsolJobs = new Map<string, DeferredNoWsolJob>();
    const deferredNoWsolBySignature = new Set<string>();
    let deferredQueueInterval: NodeJS.Timeout | null = null;
    let deferredTickRunning = false;
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

    function appendDeferredNoWsolLog(message: string) {
        try {
            fs.mkdirSync(path.dirname(options.deferredNoWsolLogPath), { recursive: true });
            const line = `[${new Date().toISOString()}] ${message}\n`;
            fs.appendFileSync(options.deferredNoWsolLogPath, line);
        } catch {
            // best-effort only
        }
    }

    function findIdleWorkerSlot(): WorkerSlotState | null {
        return workerSlots.find((slot) => !slot.busy) || null;
    }

    function enqueuePendingSignature(signature: string) {
        if (pendingSignatureSet.has(signature) || activeSignatures.has(signature)) return;

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

    function dispatchPoolToWorker(signature: string, extraEnv?: Record<string, string>): boolean {
        if (activeSignatures.has(signature)) {
            return true;
        }

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
        activeSignatures.add(signature);
        console.log(`DISPATCH     | worker-${slot.slot} ${options.shortSig(signature)}`);

        const workerEntry = options.getWorkerEntryCommand();
        const child = spawn(workerEntry.cmd, workerEntry.args, {
            cwd: options.rootDir,
            env: {
                ...process.env,
                WORKER_TASK_SIGNATURE: signature,
                WORKER_SLOT: String(slot.slot),
                SILENCE_RPC_429_LOGS: process.env.SILENCE_RPC_429_LOGS || "true",
                ...extraEnv,
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
            activeSignatures.delete(signature);
            drainPendingQueue();
        });

        child.on("error", (error) => {
            console.error(`WORKER       | worker-${slot.slot} failed ${options.shortSig(signature)}: ${error.message}`);
            slot.busy = false;
            slot.signature = null;
            slot.child = null;
            activeSignatures.delete(signature);
            drainPendingQueue();
        });

        return true;
    }

    function drainPendingQueue() {
        while (pendingSignatures.length > 0) {
            const signature = pendingSignatures[0];
            if (activeSignatures.has(signature)) {
                pendingSignatures.shift();
                pendingSignatureSet.delete(signature);
                continue;
            }
            if (!dispatchPoolToWorker(signature)) {
                return;
            }
            pendingSignatures.shift();
            pendingSignatureSet.delete(signature);
        }
    }

    function createDeferredNoWsolJob(payload: DeferredNoWsolCandidatePayload, nowMs: number): DeferredNoWsolJob | null {
        if (!payload.signature || !payload.tokenMint || !payload.poolAddress) {
            return null;
        }
        const createdAtMs = payload.createdAt ? Date.parse(payload.createdAt) : nowMs;
        const safeCreatedAtMs = Number.isFinite(createdAtMs) ? createdAtMs : nowMs;
        const initialDelayMs = Math.max(250, options.deferredNoWsolInitialDelayMs);
        const maxAgeMs = Math.max(initialDelayMs, options.deferredNoWsolMaxAgeMs);
        const jobId = `${safeCreatedAtMs}-${payload.signature.slice(0, 16)}-${Math.floor(Math.random() * 1_000_000)}`;
        return {
            jobId,
            signature: payload.signature,
            tokenMint: payload.tokenMint,
            poolAddress: payload.poolAddress,
            createdAtMs: safeCreatedAtMs,
            nextRunAtMs: nowMs + initialDelayMs,
            expiresAtMs: nowMs + maxAgeMs,
            attempts: 0,
            noWsolRetryCount: Number.isFinite(payload.noWsolRetryCount) ? Math.max(0, payload.noWsolRetryCount || 0) : 0,
            source: payload.source || "worker",
        };
    }

    function ingestDeferredNoWsolQueueFiles() {
        if (!options.deferredNoWsolQueueEnabled) return;
        if (!fs.existsSync(options.deferredNoWsolQueueDir)) return;

        let files: string[] = [];
        try {
            files = fs
                .readdirSync(options.deferredNoWsolQueueDir)
                .filter((name) => name.endsWith(".json"))
                .sort((a, b) => a.localeCompare(b));
        } catch {
            return;
        }

        for (const fileName of files) {
            const fullPath = path.join(options.deferredNoWsolQueueDir, fileName);
            try {
                const raw = fs.readFileSync(fullPath, "utf8");
                const payload = JSON.parse(raw) as DeferredNoWsolCandidatePayload;
                const nowMs = Date.now();

                if (deferredNoWsolBySignature.has(payload.signature)) {
                    fs.unlinkSync(fullPath);
                    continue;
                }

                const queueMaxJobs = Math.max(1, options.deferredNoWsolQueueMaxJobs);
                if (deferredNoWsolJobs.size >= queueMaxJobs) {
                    appendDeferredNoWsolLog(
                        `DROP queue full (${queueMaxJobs}) sig=${options.shortSig(payload.signature || "-")}`,
                    );
                    fs.unlinkSync(fullPath);
                    continue;
                }

                const job = createDeferredNoWsolJob(payload, nowMs);
                if (!job) {
                    appendDeferredNoWsolLog(`DROP malformed payload file=${fileName}`);
                    fs.unlinkSync(fullPath);
                    continue;
                }

                deferredNoWsolJobs.set(job.jobId, job);
                deferredNoWsolBySignature.add(job.signature);
                appendDeferredNoWsolLog(
                    `ENQUEUE job=${job.jobId} sig=${options.shortSig(job.signature)} token=${job.tokenMint} attempts_inline=${job.noWsolRetryCount}`,
                );
                fs.unlinkSync(fullPath);
            } catch (error: any) {
                appendDeferredNoWsolLog(
                    `ERROR ingest file=${fileName} message=${error?.message || "unknown"}`,
                );
                try {
                    fs.unlinkSync(fullPath);
                } catch {
                    // no-op
                }
            }
        }
    }

    async function runDeferredNoWsolQueueTick() {
        if (!options.deferredNoWsolQueueEnabled) return;
        if (deferredTickRunning) return;

        deferredTickRunning = true;
        try {
            ingestDeferredNoWsolQueueFiles();
            const nowMs = Date.now();
            const jobs = Array.from(deferredNoWsolJobs.values()).sort((a, b) => a.nextRunAtMs - b.nextRunAtMs);
            const maxJobsPerTick = 2;
            let processed = 0;

            for (const job of jobs) {
                if (processed >= maxJobsPerTick) break;
                if (nowMs < job.nextRunAtMs) continue;

                if (nowMs >= job.expiresAtMs) {
                    const ageSec = Math.max(0, Math.round((nowMs - job.createdAtMs) / 1000));
                    appendDeferredNoWsolLog(
                        `EXPIRE job=${job.jobId} sig=${options.shortSig(job.signature)} attempts=${job.attempts} age=${ageSec}s`,
                    );
                    deferredNoWsolJobs.delete(job.jobId);
                    deferredNoWsolBySignature.delete(job.signature);
                    processed += 1;
                    continue;
                }

                if (activeSignatures.has(job.signature)) {
                    job.nextRunAtMs = nowMs + 500;
                    processed += 1;
                    continue;
                }

                const checkResult = await options.checkDeferredNoWsolCandidate({
                    signature: job.signature,
                    tokenMint: job.tokenMint,
                    poolAddress: job.poolAddress,
                    attempt: job.attempts + 1,
                    jobId: job.jobId,
                });

                if (checkResult.hasWsol) {
                    const dispatched = dispatchPoolToWorker(job.signature, {
                        DEFERRED_NO_WSOL_REPLAY: "1",
                        DEFERRED_NO_WSOL_JOB_ID: job.jobId,
                    });
                    if (dispatched) {
                        appendDeferredNoWsolLog(
                            `DISPATCH job=${job.jobId} sig=${options.shortSig(job.signature)} attempt=${job.attempts + 1} details=${checkResult.details}`,
                        );
                        deferredNoWsolJobs.delete(job.jobId);
                        deferredNoWsolBySignature.delete(job.signature);
                    } else {
                        job.nextRunAtMs = nowMs + 500;
                    }
                    processed += 1;
                    continue;
                }

                job.attempts += 1;
                const maxAttempts = Math.max(1, options.deferredNoWsolMaxAttempts);
                if (job.attempts >= maxAttempts) {
                    const ageSec = Math.max(0, Math.round((nowMs - job.createdAtMs) / 1000));
                    appendDeferredNoWsolLog(
                        `GIVEUP job=${job.jobId} sig=${options.shortSig(job.signature)} attempts=${job.attempts} age=${ageSec}s details=${checkResult.details}`,
                    );
                    deferredNoWsolJobs.delete(job.jobId);
                    deferredNoWsolBySignature.delete(job.signature);
                    processed += 1;
                    continue;
                }

                const backoffMultiplier = Math.max(1, options.deferredNoWsolBackoffMultiplier);
                const baseIntervalMs = Math.max(250, options.deferredNoWsolBaseIntervalMs);
                const maxIntervalMs = Math.max(baseIntervalMs, options.deferredNoWsolMaxIntervalMs);
                const nextDelayMs = Math.min(
                    maxIntervalMs,
                    Math.round(baseIntervalMs * Math.pow(backoffMultiplier, Math.max(0, job.attempts - 1))),
                );
                job.nextRunAtMs = nowMs + nextDelayMs;
                appendDeferredNoWsolLog(
                    `RETRY job=${job.jobId} sig=${options.shortSig(job.signature)} attempt=${job.attempts}/${maxAttempts} next=${nextDelayMs}ms details=${checkResult.details}`,
                );
                processed += 1;
            }
        } finally {
            deferredTickRunning = false;
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

    function startDeferredNoWsolQueue() {
        if (!options.deferredNoWsolQueueEnabled) return;
        fs.mkdirSync(options.deferredNoWsolQueueDir, { recursive: true });
        fs.mkdirSync(path.dirname(options.deferredNoWsolLogPath), { recursive: true });
        appendDeferredNoWsolLog("START deferred no-WSOL queue manager");
        if (deferredQueueInterval) {
            clearInterval(deferredQueueInterval);
            deferredQueueInterval = null;
        }
        deferredQueueInterval = setInterval(() => {
            void runDeferredNoWsolQueueTick();
        }, 500);
    }

    function setupGracefulShutdown(connection: Connection) {
        const shutdown = async () => {
            console.log("\n🛑 Shutting down...");

            if (healthcheckInterval) {
                clearInterval(healthcheckInterval);
                healthcheckInterval = null;
            }

            if (deferredQueueInterval) {
                clearInterval(deferredQueueInterval);
                deferredQueueInterval = null;
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
        startDeferredNoWsolQueue();
        setupGracefulShutdown(connection);
        console.log("🚀 Sniper is running. Press Ctrl+C to stop.\n");
    }

    return {
        runSupervisor,
    };
}
