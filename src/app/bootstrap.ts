export async function startApp(options: {
    isWorkerProcess: boolean;
    runWorkerTask: () => Promise<void>;
    runSupervisor: () => Promise<void>;
}) {
    if (options.isWorkerProcess) {
        await options.runWorkerTask();
        return;
    }

    await options.runSupervisor();
}
