export default async () => {
    // Container instance is available on the same process that ran globalSetup
    const container = globalThis.__kafka_container__?.container;
    if (container) {
        await container.stop();
    }
};
