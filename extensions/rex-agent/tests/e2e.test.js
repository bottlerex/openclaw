/**
 * E2E Tests for rex-agent tools
 * Tests all three tools against real APIs and services
 */

import { createRexTools, stripThinking, truncate } from '../src/tools.js';
import fs from 'fs';
import path from 'path';

const tools = createRexTools();
let testResults = { passed: 0, failed: 0, tests: [] };

async function test(name, fn) {
  try {
    console.log(`🧪 Testing: ${name}`);
    await fn();
    testResults.passed++;
    testResults.tests.push({ name, status: 'PASS' });
    console.log('✓ PASS');
  } catch (error) {
    testResults.failed++;
    testResults.tests.push({ name, status: 'FAIL', error: error.message });
    console.error(`✗ FAIL: ${error.message}`);
  }
}

async function runAllTests() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  Rex-Agent E2E Test Suite');
  console.log('═══════════════════════════════════════════════════════\n');

  // Test 1: run_command - Echo
  await test('run_command: echo test', async () => {
    const tool = tools.find(t => t.function.name === 'run_command');
    const result = await tool.execute({ command: 'echo "E2E Test"' });
    if (!result.includes('E2E Test')) throw new Error('Output missing');
  });

  // Test 2: run_command - Docker
  await test('run_command: docker ps', async () => {
    const tool = tools.find(t => t.function.name === 'run_command');
    const result = await tool.execute({ command: 'docker ps -q' });
    if (!result.includes('✅')) throw new Error('Docker command failed');
  });

  // Test 3: run_command - Blacklist
  await test('run_command: Blacklist blocks rm -rf', async () => {
    const tool = tools.find(t => t.function.name === 'run_command');
    const result = await tool.execute({ command: 'rm -rf /tmp/test' });
    if (!result.includes('blocked')) throw new Error('Blacklist failed');
  });

  // Test 4: analyze_code
  await test('analyze_code: API test', async () => {
    const tool = tools.find(t => t.function.name === 'analyze_code');
    const result = await tool.execute({ question: 'What does x=1 do?' });
    if (!result || result.length === 0) throw new Error('No response');
  });

  // Test 5: dev_task
  await test('dev_task: Session Bridge', async () => {
    const tool = tools.find(t => t.function.name === 'dev_task');
    const result = await tool.execute({ task: 'Test', project: 'openclaw' });
    if (!result.includes('🚀')) throw new Error('No response');
  });

  // Print summary
  console.log('\n═══════════════════════════════════════════════════════');
  console.log(`Test Results: ${testResults.passed} passed, ${testResults.failed} failed`);
  console.log('═══════════════════════════════════════════════════════\n');
  process.exit(testResults.failed === 0 ? 0 : 1);
}

runAllTests();
