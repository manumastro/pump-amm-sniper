import { Connection } from "@solana/web3.js";

export async function runWorkerTask(options: {
    signature: string;
    workerSlot: number;
    createConnection: () => Connection;
    initSdks: (connection: Connection) => void;
    handleNewPool: (connection: Connection, signature: string) => Promise<void>;
    shortSig: (value: string) => string;
    stageLog: (ctx: string, stage: string, message: string) => void;
}) {
    const connection = options.createConnection();
    options.initSdks(connection);

    console.log(`WORKER       | slot ${options.workerSlot || 1} start ${options.shortSig(options.signature)}`);
    options.stageLog("", "SIGNATURE", options.signature);
    await options.handleNewPool(connection, options.signature);
    console.log(`WORKER       | slot ${options.workerSlot || 1} done ${options.shortSig(options.signature)}`);
}
