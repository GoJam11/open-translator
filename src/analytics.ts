
type AnalyticsProperties = Record<
  string,
  string | number | boolean | Array<string | number | boolean>
>;

const logger = {
  init() {
    return Promise.resolve()
  },
  pageview(path: string | undefined) {
    console.log(path)
  },
  event(name: string, properties: AnalyticsProperties | undefined) {
    console.log(properties)
  },
}

let initPromise: Promise<void> | null = null;
let initFailed = false;

async function ensureInit() {
  if (initFailed) return;
  if (!initPromise) {
    initPromise = logger
      .init()
      .catch((error) => {
        initFailed = true;
        console.warn('[analytics] Failed to init logger', error);
        throw error;
      });
  }
  try {
    await initPromise;
  } catch {
    // already logged
  }
}

export async function initAnalytics() {
  await ensureInit();
}

export async function trackPageview(path?: string) {
  await ensureInit();
  if (initFailed) return;
  try {
    logger.pageview(path);
  } catch (error) {
    console.warn('[analytics] Failed to track pageview', error);
  }
}

export async function trackEvent(
  name: string,
  properties?: AnalyticsProperties,
) {
  await ensureInit();
  if (initFailed) return;
  try {
    logger.event(name, properties);
  } catch (error) {
    console.warn('[analytics] Failed to track event', error);
  }
}
