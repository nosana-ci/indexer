/**
 * External API mocking utilities for indexer tests.
 * Provides createMockNosanaClient and related helpers.
 */

import { vi } from 'vitest';

/**
 * Creates a mock NosanaClient for indexer testing
 */
export const createMockNosanaClient = () => {
  return {
    jobs: {
      get: vi.fn().mockResolvedValue(null),
      all: vi.fn().mockResolvedValue([]),
      markets: vi.fn().mockResolvedValue([]),
      monitor: vi.fn(),
      monitorDetailed: vi.fn(),
    },
    ipfs: {
      retrieve: vi.fn().mockResolvedValue({}),
    },
    solana: {
      rpc: {
        getSignaturesForAddress: vi.fn().mockResolvedValue([]),
      },
    },
  };
};

/**
 * Setup helper to simulate job not found error from NosanaClient
 */
export const setupJobNotFoundError = (jobGetFn: ReturnType<typeof vi.fn>) => {
  jobGetFn.mockRejectedValue({
    message: 'Account does not exist or has no data',
  });
};

/**
 * Setup helper to simulate IPFS retrieval error
 */
export const setupIpfsRetrievalError = (
  ipfsRetrieveFn: ReturnType<typeof vi.fn>
) => {
  ipfsRetrieveFn.mockRejectedValue({
    message: 'IPFS retrieval failed',
    code: 'IPFS_ERROR',
  });
};
