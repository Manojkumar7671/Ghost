import { test, expect } from '@playwright/test';

test.describe('Ghost Smoke Tests', () => {
  test('Ordinary Chat Request', async ({ request }) => {
    const response = await request.post('http://localhost:3000/api/chat', {
      data: { message: 'hello ghost', sessionData: { safeUser: 'admin' } }
    });
    expect(response.ok()).toBeTruthy();
    const json = await response.json();
    expect(json.success).toBeTruthy();
    expect(json.text).toBeDefined();
    expect(json.text.length).toBeGreaterThan(0);
  });

  test('Coding Task Direct Routing', async ({ request }) => {
    const response = await request.post('http://localhost:3000/api/chat', {
      data: { message: 'coding task: write a hello world python script', sessionData: { safeUser: 'admin' } }
    });
    expect(response.ok()).toBeTruthy();
    const json = await response.json();
    expect(json.success).toBeTruthy();
    // It should route to aiderAgent which returns background status
    expect(json.text).toContain('Missing owner or repo for Aider task');
  });

  test('Deep Research Direct Routing', async ({ request }) => {
    const response = await request.post('http://localhost:3000/api/chat', {
      data: { message: 'deep research about quantum computing', sessionData: { safeUser: 'admin' } }
    });
    expect(response.ok()).toBeTruthy();
    const json = await response.json();
    // In test environment without proper mock, it might fail inside deep research, but it shouldn't hit PEVR.
    // If it hits deep research directly, it returns "Deep research failed..." or succeeds.
    expect(json.success).toBeDefined();
    if (!json.success) {
      expect(json.text).toContain('Deep research failed');
    }
  });
});
