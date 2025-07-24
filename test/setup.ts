// Silence console.error and console.log in all tests
global.console = {
  ...console,
  error: jest.fn(),
  log: jest.fn(),
};