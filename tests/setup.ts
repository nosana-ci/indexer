/**
 * Global test setup file
 * This file runs before all tests and sets up the testing environment
 */

import { vi, beforeEach, afterEach } from 'vitest';

// Global test hooks
beforeEach(() => {
  // Reset all mocks before each test
  vi.clearAllMocks();
});

afterEach(() => {
  // Clean up after each test
  vi.restoreAllMocks();
});
