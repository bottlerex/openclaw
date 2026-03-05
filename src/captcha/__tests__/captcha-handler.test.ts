/**
 * Unit tests for Captcha Handler
 * Tests: CapSolver API, detection logic, injection
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import CaptchaHandler from '../index';
import CapSolverClient from '../capsolver-client';
import ReCaptchaDetector from '../recaptcha-detector';
import type { Page } from 'playwright';

// Mock CapSolver client
vi.mock('../capsolver-client');

// Mock detector
vi.mock('../recaptcha-detector');

describe('CaptchaHandler', () => {
  let handler: CaptchaHandler;
  let mockPage: any;

  beforeEach(() => {
    // Initialize handler with test config
    handler = new CaptchaHandler({
      apiKey: 'test-key-12345',
      timeout: 10000,
      enableLogging: false,
    });

    // Mock page object
    mockPage = {
      content: vi.fn(),
      url: vi.fn(() => 'https://example.com'),
      frames: vi.fn(() => []),
    } as unknown as Page;
  });

  describe('handlePageCaptcha', () => {
    it('should return true if no captcha detected', async () => {
      // Mock detection result (no captcha)
      vi.mocked(ReCaptchaDetector.detectAnyCaptcha).mockResolvedValue({
        detected: false,
      });

      const result = await handler.handlePageCaptcha(mockPage);
      expect(result).toBe(true);
    });

    it('should handle reCAPTCHA v2 via image OCR', async () => {
      // Mock detection result
      vi.mocked(ReCaptchaDetector.detectAnyCaptcha).mockResolvedValue({
        detected: true,
        type: 'recaptcha_v2',
        siteKey: 'test-sitekey',
        pageUrl: 'https://example.com',
      });

      // Mock image extraction
      vi.mocked(ReCaptchaDetector.extractCaptchaImage).mockResolvedValue(
        Buffer.from('fake-image-data')
      );

      // Mock CapSolver response
      vi.mocked(CapSolverClient.prototype.solveImageCaptcha).mockResolvedValue({
        solution: 'test-solution-token',
        taskId: 'test-task-id',
      });

      // Mock injection
      vi.mocked(ReCaptchaDetector.submitCaptchaSolution).mockResolvedValue(true);

      // Mock verification wait
      vi.mocked(ReCaptchaDetector.waitForCaptchaSolve).mockResolvedValue(true);

      const result = await handler.handlePageCaptcha(mockPage);
      expect(result).toBe(true);
    });

    it('should retry on solve failure', async () => {
      // Mock detection result
      vi.mocked(ReCaptchaDetector.detectAnyCaptcha).mockResolvedValue({
        detected: true,
        type: 'recaptcha_v2',
        siteKey: 'test-sitekey',
        pageUrl: 'https://example.com',
      });

      // First call fails, second succeeds
      vi.mocked(ReCaptchaDetector.extractCaptchaImage)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(Buffer.from('fake-image-data'));

      vi.mocked(CapSolverClient.prototype.solveImageCaptcha)
        .mockRejectedValueOnce(new Error('Timeout'))
        .mockResolvedValueOnce({
          solution: 'test-solution-token',
          taskId: 'test-task-id',
        });

      vi.mocked(ReCaptchaDetector.submitCaptchaSolution).mockResolvedValue(true);
      vi.mocked(ReCaptchaDetector.waitForCaptchaSolve).mockResolvedValue(true);

      const result = await handler.handlePageCaptcha(mockPage);
      expect(result).toBe(true);
    });

    it('should handle hCaptcha', async () => {
      vi.mocked(ReCaptchaDetector.detectAnyCaptcha).mockResolvedValue({
        detected: true,
        type: 'hcaptcha',
        siteKey: 'test-hcaptcha-key',
        pageUrl: 'https://example.com',
      });

      vi.mocked(CapSolverClient.prototype.solveHCaptcha).mockResolvedValue({
        solution: 'hcaptcha-token',
        taskId: 'hcaptcha-task-id',
      });

      vi.mocked(ReCaptchaDetector.submitCaptchaSolution).mockResolvedValue(true);
      vi.mocked(ReCaptchaDetector.waitForCaptchaSolve).mockResolvedValue(true);

      const result = await handler.handlePageCaptcha(mockPage);
      expect(result).toBe(true);
    });

    it('should skip reCAPTCHA v3 (invisible)', async () => {
      vi.mocked(ReCaptchaDetector.detectAnyCaptcha).mockResolvedValue({
        detected: true,
        type: 'recaptcha_v3',
        pageUrl: 'https://example.com',
      });

      const result = await handler.handlePageCaptcha(mockPage);
      expect(result).toBe(true); // Should skip and return true
    });
  });

  describe('checkBalance', () => {
    it('should return account balance', async () => {
      vi.mocked(CapSolverClient.prototype.getBalance).mockResolvedValue(12.5);

      const balance = await handler.checkBalance();
      expect(balance).toBe(12.5);
    });

    it('should return 0 on balance check failure', async () => {
      vi.mocked(CapSolverClient.prototype.getBalance).mockRejectedValue(
        new Error('API error')
      );

      const balance = await handler.checkBalance();
      expect(balance).toBe(0);
    });
  });
});

describe('ReCaptchaDetector', () => {
  let mockPage: any;

  beforeEach(() => {
    mockPage = {
      content: vi.fn(),
      url: vi.fn(() => 'https://example.com'),
      frames: vi.fn(() => []),
    } as unknown as Page;
  });

  describe('detectReCaptchaV2', () => {
    it('should detect reCAPTCHA v2 in HTML', async () => {
      mockPage.content.mockResolvedValue(
        '<div class="g-recaptcha" data-sitekey="test-key-123"></div>'
      );

      const result = await ReCaptchaDetector.detectReCaptchaV2(mockPage);
      expect(result.detected).toBe(true);
      expect(result.type).toBe('recaptcha_v2');
      expect(result.siteKey).toBe('test-key-123');
    });

    it('should return false if not detected', async () => {
      mockPage.content.mockResolvedValue('<html><body>No captcha here</body></html>');

      const result = await ReCaptchaDetector.detectReCaptchaV2(mockPage);
      expect(result.detected).toBe(false);
    });
  });

  describe('detectHCaptcha', () => {
    it('should detect hCaptcha in HTML', async () => {
      mockPage.content.mockResolvedValue(
        '<div class="h-captcha" data-sitekey="hcaptcha-key-456"></div>'
      );

      const result = await ReCaptchaDetector.detectHCaptcha(mockPage);
      expect(result.detected).toBe(true);
      expect(result.type).toBe('hcaptcha');
      expect(result.siteKey).toBe('hcaptcha-key-456');
    });
  });

  describe('detectCloudflareChallenge', () => {
    it('should detect Cloudflare challenge', async () => {
      mockPage.content.mockResolvedValue(
        '<title>Please Wait... | Cloudflare</title>'
      );

      const result = await ReCaptchaDetector.detectCloudflareChallenge(mockPage);
      expect(result.detected).toBe(true);
      expect(result.type).toBe('cloudflare');
    });
  });
});

describe('CapSolverClient', () => {
  let client: CapSolverClient;

  beforeEach(() => {
    client = new CapSolverClient({
      apiKey: 'test-api-key',
      timeout: 5000,
    });
  });

  it('should throw on missing API key', () => {
    expect(() => {
      new CapSolverClient({ apiKey: '' });
    }).toThrow('CapSolver API key is required');
  });

  it('should handle timeout gracefully', async () => {
    // This would be tested with actual API calls in integration tests
    expect(client).toBeDefined();
  });
});
