/**
 * Test data factory utilities for indexer tests.
 * Indexer-related factories and constants only.
 */
import { jobStateMappingReverse } from '../../src/modules/jobs/model';

const jobStateMapping: Record<number, string> = {
  0: 'QUEUED',
  1: 'RUNNING',
  2: 'COMPLETED',
  3: 'STOPPED',
};

export const jobQueuedState = jobStateMappingReverse.QUEUED;
export const jobRunningState = jobStateMappingReverse.RUNNING;
export const jobCompletedState = jobStateMappingReverse.COMPLETED;
export const jobRunningStateString = jobStateMapping[1];
export const marketQueueJobType = 0;
export const marketQueueNodeType = 1;
const jobQueueNodeTypeString = 'NODE_QUEUE';
const marketTypePremium = 'PREMIUM';

export const secondsInAnHour = 3600;
export const secondsInTwoHours = secondsInAnHour * 2;

const testUserCreatedAt = new Date('2024-01-01');

export const testJobAddress = 'JobAddress123456789';
export const testMarketAddress = 'MarketAddress123';
export const testNodeAddress = 'NodeAddress123';
export const testPayerAddress = 'PayerAddress123';
export const testProjectAddress = 'ProjectAddress123';
export const testRunAddress = 'RunAddress123456789';
export const testAuthorityAddress = 'AuthorityAddress123';

export const testPrice = 100;
export const testTimeStart = 1000;
export const testTimeEnd = 2000;

export const testIpfsJobHash = 'QmJobDefinitionHash';
export const testIpfsResultHash = 'QmResultHash123';
export const testIpfsMetaTriggerGithub = {
  meta: { trigger: 'github' },
};
export const ipfsSuccessStatus = 'SUCCESS';

/**
 * Creates a mock job account
 */
export const createTestJobAccount = (overrides = {}) => {
  return {
    address: testJobAddress,
    project: testProjectAddress,
    market: testMarketAddress,
    node: testNodeAddress,
    price: testPrice,
    timeout: secondsInAnHour,
    state: jobRunningStateString,
    createdAt: testUserCreatedAt,
    updatedAt: testUserCreatedAt,
    ...overrides,
  };
};

/**
 * Creates a mock address object (for @nosana/kit types)
 */
export const createMockAddress = (addressString: string) => ({
  toString: () => addressString,
});

/**
 * Creates a mock Job object from @nosana/kit
 */
export const createTestNosanaJob = (overrides = {}) => {
  return {
    address: testJobAddress,
    state: jobQueuedState,
    market: testMarketAddress,
    payer: testPayerAddress,
    project: testProjectAddress,
    node: testNodeAddress,
    price: testPrice,
    timeout: secondsInAnHour,
    timeStart: testTimeStart,
    timeEnd: testTimeEnd,
    ipfsJob: testIpfsJobHash,
    ipfsResult: null,
    ...overrides,
  };
};

/**
 * Creates a mock Market object from @nosana/kit
 */
export const createTestNosanaMarket = (overrides = {}) => {
  return {
    address: createMockAddress(testMarketAddress),
    queueType: marketQueueNodeType,
    queue: [],
    ...overrides,
  };
};

/**
 * Creates a mock Run object from @nosana/kit
 */
export const createTestNosanaRun = (overrides = {}) => {
  return {
    address: createMockAddress(testRunAddress),
    job: createMockAddress(testJobAddress),
    node: createMockAddress(testNodeAddress),
    time: BigInt(Math.floor(Date.now() / testTimeStart)),
    ...overrides,
  };
};

/**
 * Creates test timestamps for time-based testing
 */
export const createTestTimestamps = () => {
  const now = new Date('2024-01-15T12:00:00Z');
  return {
    now,
    oneMinuteAgo: new Date(now.getTime() - 60 * 1000),
    fiveMinutesAgo: new Date(now.getTime() - 5 * 60 * 1000),
    oneHourAgo: new Date(now.getTime() - 60 * 60 * 1000),
    oneDayAgo: new Date(now.getTime() - 24 * 60 * 60 * 1000),
    oneWeekAgo: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
    oneMonthAgo: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
    oneMinuteLater: new Date(now.getTime() + 60 * 1000),
    oneHourLater: new Date(now.getTime() + 60 * 60 * 1000),
    oneDayLater: new Date(now.getTime() + 24 * 60 * 60 * 1000),
  };
};

/**
 * Creates indexer-specific boundary test values
 */
export const indexerBoundaryValues = {
  stateQueued: jobQueuedState,
  stateRunning: jobRunningState,
  stateCompleted: jobCompletedState,

  epochTime: BigInt(0),
  tg3CutoffDate: BigInt(1727690400),
  futureTime: BigInt(Math.floor(new Date('2100-01-01').getTime() / 1000)),

  zeroPriceInLamports: BigInt(0),
  smallPriceInLamports: BigInt(1000000),
  largePriceInLamports: BigInt(1000000000000),

  zeroTimeout: BigInt(0),
  timeoutTwoHours: BigInt(secondsInTwoHours),
  timeoutOneDay: BigInt(86400),

  validIpfsHash: testIpfsJobHash,
  emptyIpfsHash: '',
  nullIpfsHash: null,
};
