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

type CcShadowCandidatePayload = {
    eventId: string;
    signature: string;
    tokenMint: string;
    poolAddress: string;
    creatorAddress?: string | null;
    cc: number;
    startedAt?: string;
    createPoolBlockTime?: number | null;
    skipReason?: string;
};

type CcShadowJob = {
    jobId: string;
    eventId: string;
    signature: string;
    tokenMint: string;
    poolAddress: string;
    creatorAddress: string | null;
    cc: number;
    skipReason: string | null;
    createdAtMs: number;
    startedAtMs: number;
    nextRunAtMs: number;
    expiresAtMs: number;
    sampleIndex: number;
    createPoolBlockTime: number | null;
    state: Record<string, any>;
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
    ccShadowEnabled: boolean;
    ccShadowQueueDir: string;
    ccShadowRootDir: string;
    ccShadowLogPath: string;
    ccShadowQueueMaxJobs: number;
    ccShadowFastIntervalMs: number;
    ccShadowFastPhaseMs: number;
    ccShadowSlowIntervalMs: number;
    ccShadowDexEveryNSnapshots: number;
    ccShadowHoldTtlMs: number;
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
    sampleCcShadowCandidate: (candidate: {
        eventId: string;
        signature: string;
        tokenMint: string;
        poolAddress: string;
        creatorAddress?: string | null;
        cc: number;
        sampleIndex: number;
        elapsedMs: number;
        createPoolBlockTime?: number | null;
        state: Record<string, any>;
    }) => Promise<{ snapshot: Record<string, any>; nextState?: Record<string, any> }>;
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
    const ccShadowJobs = new Map<string, CcShadowJob>();
    let ccShadowInterval: NodeJS.Timeout | null = null;
    let ccShadowTickRunning = false;
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

    function appendCcShadowLog(message: string) {
        try {
            fs.mkdirSync(path.dirname(options.ccShadowLogPath), { recursive: true });
            const line = `[${new Date().toISOString()}] ${message}\n`;
            fs.appendFileSync(options.ccShadowLogPath, line);
        } catch {
            // best-effort only
        }
    }

    function getCcShadowPaths(cc: number) {
        const ccDir = path.join(options.ccShadowRootDir, `cc-${cc}`);
        return {
            ccDir,
            summaryDir: path.join(ccDir, "summary"),
            timelineDir: path.join(ccDir, "timeline"),
            currentSummaryPath: path.join(ccDir, "summary", "current.json"),
            byTokenSummaryPath: path.join(ccDir, "summary", "by-token.json"),
            timelinePath: path.join(ccDir, "timeline", "events.ndjson"),
        };
    }

    function writeCcShadowIndex() {
        if (!options.ccShadowEnabled) return;
        try {
            fs.mkdirSync(options.ccShadowRootDir, { recursive: true });
            const byCc: Record<string, { activeJobs: number; currentSummaryPath: string; byTokenSummaryPath: string; timelinePath: string }> = {};
            const ccSet = new Set<number>();
            for (const job of ccShadowJobs.values()) ccSet.add(job.cc);
            for (const dir of fs.existsSync(options.ccShadowRootDir) ? fs.readdirSync(options.ccShadowRootDir) : []) {
                const m = dir.match(/^cc-(\d+)$/);
                if (m) ccSet.add(Number(m[1]));
            }
            for (const cc of [...ccSet].sort((a, b) => a - b)) {
                const paths = getCcShadowPaths(cc);
                byCc[String(cc)] = {
                    activeJobs: [...ccShadowJobs.values()].filter((job) => job.cc === cc).length,
                    currentSummaryPath: paths.currentSummaryPath,
                    byTokenSummaryPath: paths.byTokenSummaryPath,
                    timelinePath: paths.timelinePath,
                };
            }
            fs.writeFileSync(path.join(options.ccShadowRootDir, "index.json"), JSON.stringify({ generatedAt: new Date().toISOString(), byCc }, null, 2));
        } catch {
            // best-effort only
        }
    }

    function recordCcShadowSnapshot(job: CcShadowJob, snapshot: Record<string, any>) {
        const paths = getCcShadowPaths(job.cc);
        fs.mkdirSync(paths.summaryDir, { recursive: true });
        fs.mkdirSync(paths.timelineDir, { recursive: true });

        const timelineRow = {
            eventId: job.eventId,
            signature: job.signature,
            tokenMint: job.tokenMint,
            poolAddress: job.poolAddress,
            creatorAddress: job.creatorAddress,
            cc: job.cc,
            skipReason: job.skipReason,
            ...snapshot,
        };
        fs.appendFileSync(paths.timelinePath, `${JSON.stringify(timelineRow)}\n`);

        let byToken: Record<string, any> = {};
        if (fs.existsSync(paths.byTokenSummaryPath)) {
            try {
                byToken = JSON.parse(fs.readFileSync(paths.byTokenSummaryPath, "utf8"));
            } catch {
                byToken = {};
            }
        }

        const key = job.eventId;
        const previous = byToken[key] || {
            eventId: job.eventId,
            signature: job.signature,
            tokenMint: job.tokenMint,
            gmgn: `https://gmgn.ai/sol/token/${job.tokenMint}`,
            poolAddress: job.poolAddress,
            creatorAddress: job.creatorAddress,
            cc: job.cc,
            skipReason: job.skipReason,
            startedAtMs: job.startedAtMs,
            createdAtMs: job.createdAtMs,
            snapshots: 0,
            peakPnlPct: null,
            maxAdversePnlPct: null,
            firstTrigger: null,
            lastSnapshot: null,
            removeLiquidityDetected: false,
            removeLiquidityAtMs: null,
            finalReason: null,
            completed: false,
        };

        const peakPnlPct = Number(snapshot.peakPnlPct);
        const currentPnlPct = Number(snapshot.currentPnlPct);
        const trigger = snapshot.wouldExitReason || null;
        previous.snapshots += 1;
        previous.lastSnapshot = snapshot;
        if (Number.isFinite(peakPnlPct)) {
            previous.peakPnlPct = previous.peakPnlPct === null ? peakPnlPct : Math.max(previous.peakPnlPct, peakPnlPct);
        }
        if (Number.isFinite(currentPnlPct)) {
            previous.maxAdversePnlPct = previous.maxAdversePnlPct === null ? currentPnlPct : Math.min(previous.maxAdversePnlPct, currentPnlPct);
        }
        if (!previous.firstTrigger && trigger) previous.firstTrigger = trigger;
        if (snapshot.removeLiquidityDetected) {
            previous.removeLiquidityDetected = true;
            previous.removeLiquidityAtMs = snapshot.sampleAtMs || null;
        }
        if (snapshot.finalReason) {
            previous.finalReason = snapshot.finalReason;
            previous.completed = true;
        }
        byToken[key] = previous;
        fs.writeFileSync(paths.byTokenSummaryPath, JSON.stringify(byToken, null, 2));

        const values = Object.values(byToken) as Array<any>;
        const distribution = (threshold: number, field: "peakPnlPct" | "maxAdversePnlPct", cmp: (v: number, thr: number) => boolean) =>
            values.filter((item) => typeof item[field] === "number" && cmp(item[field], threshold)).length;
        const currentSummary = {
            generatedAt: new Date().toISOString(),
            cc: job.cc,
            trackedTokens: values.length,
            activeJobs: [...ccShadowJobs.values()].filter((item) => item.cc === job.cc).length,
            peaks: {
                gte10: distribution(10, "peakPnlPct", (v, thr) => v >= thr),
                gte25: distribution(25, "peakPnlPct", (v, thr) => v >= thr),
                gte50: distribution(50, "peakPnlPct", (v, thr) => v >= thr),
                gte100: distribution(100, "peakPnlPct", (v, thr) => v >= thr),
            },
            drawdowns: {
                lteNeg10: distribution(-10, "maxAdversePnlPct", (v, thr) => v <= thr),
                lteNeg25: distribution(-25, "maxAdversePnlPct", (v, thr) => v <= thr),
                lteNeg50: distribution(-50, "maxAdversePnlPct", (v, thr) => v <= thr),
                lteNeg90: distribution(-90, "maxAdversePnlPct", (v, thr) => v <= thr),
            },
            removeLiquidityDetected: values.filter((item) => item.removeLiquidityDetected).length,
            firstTriggerCounts: values.reduce((acc, item) => {
                const keyName = item.firstTrigger || "none";
                acc[keyName] = (acc[keyName] || 0) + 1;
                return acc;
            }, {} as Record<string, number>),
            topPeaks: values
                .filter((item) => typeof item.peakPnlPct === "number")
                .sort((a, b) => b.peakPnlPct - a.peakPnlPct)
                .slice(0, 10),
            worstDrawdowns: values
                .filter((item) => typeof item.maxAdversePnlPct === "number")
                .sort((a, b) => a.maxAdversePnlPct - b.maxAdversePnlPct)
                .slice(0, 10),
        };
        fs.writeFileSync(paths.currentSummaryPath, JSON.stringify(currentSummary, null, 2));
        writeCcShadowIndex();
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
        // Atomic check-and-set: prevent double dispatch for same signature
        if (activeSignatures.has(signature)) {
            return true;
        }

        const slot = findIdleWorkerSlot();
        if (!slot) {
            return false;
        }

        // CRITICAL: Add to activeSignatures BEFORE any async operations
        // This prevents concurrent dispatchPoolToWorker calls from both passing the check above
        if (activeSignatures.has(signature)) {
            // Double-check in case another dispatch won the race
            return true;
        }
        activeSignatures.add(signature);

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

    function createCcShadowJob(payload: CcShadowCandidatePayload, nowMs: number): CcShadowJob | null {
        if (!payload.eventId || !payload.signature || !payload.tokenMint || !payload.poolAddress || !Number.isFinite(payload.cc)) {
            return null;
        }
        const startedAtMs = payload.startedAt ? Date.parse(payload.startedAt) : nowMs;
        const safeStartedAtMs = Number.isFinite(startedAtMs) ? startedAtMs : nowMs;
        const ttlMs = Math.max(1000, options.ccShadowHoldTtlMs);
        return {
            jobId: `${safeStartedAtMs}-${payload.eventId}-${Math.floor(Math.random() * 1_000_000)}`,
            eventId: payload.eventId,
            signature: payload.signature,
            tokenMint: payload.tokenMint,
            poolAddress: payload.poolAddress,
            creatorAddress: payload.creatorAddress || null,
            cc: payload.cc,
            skipReason: payload.skipReason || null,
            createdAtMs: nowMs,
            startedAtMs: safeStartedAtMs,
            nextRunAtMs: nowMs,
            expiresAtMs: safeStartedAtMs + ttlMs,
            sampleIndex: 0,
            createPoolBlockTime: payload.createPoolBlockTime ?? null,
            state: {},
        };
    }

    function ingestCcShadowQueueFiles() {
        if (!options.ccShadowEnabled) return;
        if (!fs.existsSync(options.ccShadowQueueDir)) return;

        let files: string[] = [];
        try {
            files = fs.readdirSync(options.ccShadowQueueDir).filter((name) => name.endsWith('.json')).sort((a, b) => a.localeCompare(b));
        } catch {
            return;
        }

        for (const fileName of files) {
            const fullPath = path.join(options.ccShadowQueueDir, fileName);
            try {
                const payload = JSON.parse(fs.readFileSync(fullPath, 'utf8')) as CcShadowCandidatePayload;
                const queueMaxJobs = Math.max(1, options.ccShadowQueueMaxJobs);
                if (ccShadowJobs.size >= queueMaxJobs) {
                    appendCcShadowLog(`DROP queue full (${queueMaxJobs}) event=${payload.eventId || '-'} cc=${payload.cc ?? '-'}`);
                    fs.unlinkSync(fullPath);
                    continue;
                }
                const existing = [...ccShadowJobs.values()].find((job) => job.eventId === payload.eventId);
                if (existing) {
                    fs.unlinkSync(fullPath);
                    continue;
                }
                const job = createCcShadowJob(payload, Date.now());
                if (!job) {
                    appendCcShadowLog(`DROP malformed payload file=${fileName}`);
                    fs.unlinkSync(fullPath);
                    continue;
                }
                ccShadowJobs.set(job.jobId, job);
                appendCcShadowLog(`ENQUEUE event=${job.eventId} cc=${job.cc} token=${job.tokenMint}`);
                fs.unlinkSync(fullPath);
                writeCcShadowIndex();
            } catch (error: any) {
                appendCcShadowLog(`ERROR ingest file=${fileName} message=${error?.message || 'unknown'}`);
                try { fs.unlinkSync(fullPath); } catch {}
            }
        }
    }

    async function runCcShadowQueueTick() {
        if (!options.ccShadowEnabled || ccShadowTickRunning) return;
        ccShadowTickRunning = true;
        try {
            ingestCcShadowQueueFiles();
            const nowMs = Date.now();
            const jobs = [...ccShadowJobs.values()].sort((a, b) => a.nextRunAtMs - b.nextRunAtMs);
            for (const job of jobs) {
                if (nowMs < job.nextRunAtMs) continue;
                const elapsedMs = Math.max(0, nowMs - job.startedAtMs);
                if (nowMs >= job.expiresAtMs) {
                    appendCcShadowLog(`EXPIRE event=${job.eventId} cc=${job.cc} samples=${job.sampleIndex}`);
                    recordCcShadowSnapshot(job, {
                        sampleIndex: job.sampleIndex,
                        sampleAt: new Date(nowMs).toISOString(),
                        sampleAtMs: nowMs,
                        ageMs: elapsedMs,
                        phase: elapsedMs <= options.ccShadowFastPhaseMs ? 'fast' : 'slow',
                        finalReason: 'ttl',
                    });
                    ccShadowJobs.delete(job.jobId);
                    writeCcShadowIndex();
                    continue;
                }

                const { snapshot, nextState } = await options.sampleCcShadowCandidate({
                    eventId: job.eventId,
                    signature: job.signature,
                    tokenMint: job.tokenMint,
                    poolAddress: job.poolAddress,
                    creatorAddress: job.creatorAddress,
                    cc: job.cc,
                    sampleIndex: job.sampleIndex,
                    elapsedMs,
                    createPoolBlockTime: job.createPoolBlockTime,
                    state: job.state,
                });
                if (nextState) {
                    job.state = nextState;
                }
                recordCcShadowSnapshot(job, snapshot);
                job.sampleIndex += 1;

                if (snapshot.removeLiquidityDetected) {
                    appendCcShadowLog(`REMOVE_LIQ event=${job.eventId} cc=${job.cc} ageMs=${elapsedMs}`);
                    ccShadowJobs.delete(job.jobId);
                    writeCcShadowIndex();
                    continue;
                }

                const fast = elapsedMs <= options.ccShadowFastPhaseMs;
                job.nextRunAtMs = nowMs + (fast ? Math.max(1000, options.ccShadowFastIntervalMs) : Math.max(1000, options.ccShadowSlowIntervalMs));
            }
        } finally {
            ccShadowTickRunning = false;
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

    function startCcShadowQueue() {
        if (!options.ccShadowEnabled) return;
        fs.mkdirSync(options.ccShadowQueueDir, { recursive: true });
        fs.mkdirSync(options.ccShadowRootDir, { recursive: true });
        fs.mkdirSync(path.dirname(options.ccShadowLogPath), { recursive: true });
        appendCcShadowLog("START cc shadow queue manager");
        writeCcShadowIndex();
        if (ccShadowInterval) {
            clearInterval(ccShadowInterval);
            ccShadowInterval = null;
        }
        ccShadowInterval = setInterval(() => {
            void runCcShadowQueueTick();
        }, 1000);
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

            if (ccShadowInterval) {
                clearInterval(ccShadowInterval);
                ccShadowInterval = null;
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
        startCcShadowQueue();
        setupGracefulShutdown(connection);
        console.log("🚀 Sniper is running. Press Ctrl+C to stop.\n");
    }

    return {
        runSupervisor,
    };
}
