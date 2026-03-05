/**
 * Unified Captcha Handler
 * Detects, solves, and injects CAPTCHA solutions
 */

import type { Page } from 'playwright';
import CapSolverClient, { CapSolverConfig } from './capsolver-client';
import ReCaptchaDetector, { CaptchaDetectionResult } from './recaptcha-detector';

export interface CaptchaHandlerConfig extends CapSolverConfig {
  maxRetries?: number;
  solveTimeout?: number; // milliseconds
  enableLogging?: boolean;
}

export class CaptchaHandler {
  private capSolver: CapSolverClient;
  private maxRetries: number;
  private solveTimeout: number;
  private logger: (msg: string, level?: 'info' | 'warning' | 'error') => void;

  constructor(config: CaptchaHandlerConfig) {
    this.capSolver = new CapSolverClient(config);
    this.maxRetries = config.maxRetries || 3;
    this.solveTimeout = config.solveTimeout || 120000; // 2 minutes
    this.logger = config.enableLogging
      ? (msg: string, level = 'info') => console.log(`[Captcha ${level.toUpperCase()}] ${msg}`)
      : () => {};
  }

  /**
   * Main handler: detect, solve, and inject captcha
   * Returns true if successful, false if failed or no captcha detected
   */
  async handlePageCaptcha(page: Page): Promise<boolean> {
    try {
      this.logger('Checking for captcha...');

      // Step 1: Detect captcha
      const detection = await ReCaptchaDetector.detectAnyCaptcha(page);

      if (!detection.detected) {
        this.logger('No captcha detected');
        return true; // No captcha, continue
      }

      this.logger(`Detected ${detection.type} captcha`, 'info');

      // Step 2: Solve captcha based on type
      let solution: string | null = null;

      switch (detection.type) {
        case 'recaptcha_v2':
          solution = await this.solveRecaptchaV2(page, detection);
          break;

        case 'hcaptcha':
          solution = await this.solveHCaptcha(page, detection);
          break;

        case 'cloudflare':
          solution = await this.solveCloudflareChallenge(page, detection);
          break;

        case 'recaptcha_v3':
          // v3 is invisible, usually handled automatically
          this.logger('reCAPTCHA v3 detected (invisible), skipping', 'info');
          return true;

        default:
          this.logger(`Unknown captcha type: ${detection.type}`, 'warning');
          return false;
      }

      if (!solution) {
        this.logger('Failed to solve captcha', 'error');
        return false;
      }

      this.logger('Captcha solved successfully, injecting solution...');

      // Step 3: Inject solution back into page
      const injected = await ReCaptchaDetector.submitCaptchaSolution(page, solution);

      if (!injected) {
        this.logger('Failed to inject captcha solution', 'error');
        return false;
      }

      // Step 4: Wait for captcha to be verified and cleared
      const verified = await ReCaptchaDetector.waitForCaptchaSolve(page, 30000);

      if (!verified) {
        this.logger('Captcha verification timeout', 'warning');
        return false;
      }

      this.logger('Captcha solved and verified!', 'info');
      return true;
    } catch (error: any) {
      this.logger(`Error handling captcha: ${error.message}`, 'error');
      return false;
    }
  }

  /**
   * Solve reCAPTCHA v2 via image OCR or site key
   */
  private async solveRecaptchaV2(
    page: Page,
    detection: CaptchaDetectionResult
  ): Promise<string | null> {
    let attempt = 0;

    while (attempt < this.maxRetries) {
      attempt++;

      try {
        // Try method 1: Extract image and solve via OCR
        const imageBuffer = await ReCaptchaDetector.extractCaptchaImage(page);

        if (imageBuffer) {
          const imageBase64 = imageBuffer.toString('base64');
          const result = await this.capSolver.solveImageCaptcha(imageBase64);
          return result.solution;
        }

        // Try method 2: Use site key if available
        if (detection.siteKey && detection.pageUrl) {
          const result = await this.capSolver.solveRecaptchaV2(
            detection.siteKey,
            detection.pageUrl
          );
          return result.solution;
        }

        this.logger('No image extracted and no site key available', 'warning');
        return null;
      } catch (error: any) {
        this.logger(
          `reCAPTCHA v2 solve attempt ${attempt}/${this.maxRetries} failed: ${error.message}`,
          'warning'
        );

        if (attempt < this.maxRetries) {
          // Wait before retrying
          await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
        }
      }
    }

    return null;
  }

  /**
   * Solve hCaptcha
   */
  private async solveHCaptcha(
    page: Page,
    detection: CaptchaDetectionResult
  ): Promise<string | null> {
    if (!detection.siteKey || !detection.pageUrl) {
      this.logger('hCaptcha site key or URL missing', 'error');
      return null;
    }

    let attempt = 0;

    while (attempt < this.maxRetries) {
      attempt++;

      try {
        const result = await this.capSolver.solveHCaptcha(
          detection.siteKey,
          detection.pageUrl
        );
        return result.solution;
      } catch (error: any) {
        this.logger(
          `hCaptcha solve attempt ${attempt}/${this.maxRetries} failed: ${error.message}`,
          'warning'
        );

        if (attempt < this.maxRetries) {
          await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
        }
      }
    }

    return null;
  }

  /**
   * Handle Cloudflare Challenge
   * Note: May require IP rotation or API-based solution
   */
  private async solveCloudflareChallenge(
    page: Page,
    detection: CaptchaDetectionResult
  ): Promise<string | null> {
    try {
      this.logger('Attempting to solve Cloudflare challenge...', 'info');

      // Cloudflare challenge is typically a JavaScript-based verification
      // Let Playwright handle it with its browser context
      // Most cases: just wait for the page to auto-solve

      // Try waiting for the challenge to be solved automatically
      const startTime = Date.now();
      while (Date.now() - startTime < 15000) {
        // Check if we've moved past the challenge page
        const htmlContent = await page.content();

        if (!htmlContent.includes('Cloudflare') && !htmlContent.includes('challenge')) {
          this.logger('Cloudflare challenge cleared', 'info');
          return 'auto'; // Indicates auto-solve
        }

        await page.waitForTimeout(1000);
      }

      this.logger('Cloudflare challenge auto-solve timeout', 'warning');
      return null;
    } catch (error: any) {
      this.logger(`Cloudflare challenge error: ${error.message}`, 'error');
      return null;
    }
  }

  /**
   * Check account balance
   */
  async checkBalance(): Promise<number> {
    try {
      return await this.capSolver.getBalance();
    } catch (error: any) {
      this.logger(`Failed to check balance: ${error.message}`, 'error');
      return 0;
    }
  }
}

export default CaptchaHandler;
