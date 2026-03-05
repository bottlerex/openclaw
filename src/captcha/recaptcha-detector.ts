/**
 * reCAPTCHA Detection Module
 * Detects and extracts reCAPTCHA elements from web pages
 */

import type { Page } from 'playwright';

export interface CaptchaDetectionResult {
  detected: boolean;
  type?: 'recaptcha_v2' | 'recaptcha_v3' | 'hcaptcha' | 'cloudflare';
  siteKey?: string;
  pageUrl?: string;
  iframe?: {
    src: string;
    name: string;
  };
}

export class ReCaptchaDetector {
  /**
   * Detect if reCAPTCHA v2 is present on the page
   */
  static async detectReCaptchaV2(page: Page): Promise<CaptchaDetectionResult> {
    try {
      // Check for common reCAPTCHA v2 patterns
      const patterns = [
        'g-recaptcha',
        'recaptcha',
        'rc-anchor',
        'rc-container',
      ];

      const htmlContent = await page.content();

      for (const pattern of patterns) {
        if (htmlContent.includes(pattern)) {
          // Try to extract site key
          const siteKeyMatch = htmlContent.match(/data-sitekey="([^"]+)"/);
          const siteKey = siteKeyMatch ? siteKeyMatch[1] : undefined;

          return {
            detected: true,
            type: 'recaptcha_v2',
            siteKey,
            pageUrl: page.url(),
          };
        }
      }

      return { detected: false };
    } catch (error) {
      console.error('Error detecting reCAPTCHA:', error);
      return { detected: false };
    }
  }

  /**
   * Detect reCAPTCHA v3 (invisible)
   */
  static async detectReCaptchaV3(page: Page): Promise<CaptchaDetectionResult> {
    try {
      const htmlContent = await page.content();

      // v3 is usually invisible, check for grecaptcha v3 setup
      const hasV3 = htmlContent.includes('grecaptcha.execute') ||
                   (htmlContent.includes('grecaptcha') && htmlContent.includes('action'));

      if (hasV3) {
        const siteKeyMatch = htmlContent.match(/grecaptcha\.execute\('([^']+)'/);
        const siteKey = siteKeyMatch ? siteKeyMatch[1] : undefined;

        return {
          detected: true,
          type: 'recaptcha_v3',
          siteKey,
          pageUrl: page.url(),
        };
      }

      return { detected: false };
    } catch (error) {
      console.error('Error detecting reCAPTCHA v3:', error);
      return { detected: false };
    }
  }

  /**
   * Extract reCAPTCHA iframe and get the challenge image
   */
  static async extractCaptchaImage(page: Page): Promise<Buffer | null> {
    try {
      // Find reCAPTCHA iframe
      const frames = page.frames();
      let captchaFrame = null;

      for (const frame of frames) {
        const frameUrl = frame.url();
        if (frameUrl.includes('recaptcha') || frameUrl.includes('anchor')) {
          captchaFrame = frame;
          break;
        }
      }

      if (!captchaFrame) {
        console.warn('reCAPTCHA frame not found');
        return null;
      }

      // Wait for checkbox to appear
      try {
        await captchaFrame.waitForSelector('div.rc-anchor', { timeout: 3000 });
      } catch {
        console.warn('reCAPTCHA anchor not found');
        return null;
      }

      // Get the challenge iframe (if it exists)
      const challengeFrames = captchaFrame.frames();
      let challengeFrame = null;

      for (const frame of challengeFrames) {
        const frameUrl = frame.url();
        if (frameUrl.includes('bframe') || frameUrl.includes('challenge')) {
          challengeFrame = frame;
          break;
        }
      }

      if (!challengeFrame) {
        console.warn('Challenge frame not found, might be checkbox-only');
        return null;
      }

      // Try to find and screenshot the captcha image
      try {
        await challengeFrame.waitForSelector('img[src*="imagepicker"]', {
          timeout: 3000,
        });
        const imageElement = await challengeFrame.$('img[src*="imagepicker"]');

        if (imageElement) {
          return await imageElement.screenshot({ type: 'png' });
        }
      } catch {
        console.warn('Could not find captcha image in challenge frame');
      }

      return null;
    } catch (error) {
      console.error('Error extracting captcha image:', error);
      return null;
    }
  }

  /**
   * Detect hCaptcha
   */
  static async detectHCaptcha(page: Page): Promise<CaptchaDetectionResult> {
    try {
      const htmlContent = await page.content();

      if (htmlContent.includes('h-captcha') || htmlContent.includes('hcaptcha')) {
        const siteKeyMatch = htmlContent.match(/data-sitekey="([^"]+)"/);
        const siteKey = siteKeyMatch ? siteKeyMatch[1] : undefined;

        return {
          detected: true,
          type: 'hcaptcha',
          siteKey,
          pageUrl: page.url(),
        };
      }

      return { detected: false };
    } catch (error) {
      console.error('Error detecting hCaptcha:', error);
      return { detected: false };
    }
  }

  /**
   * Detect Cloudflare Challenge
   */
  static async detectCloudflareChallenge(page: Page): Promise<CaptchaDetectionResult> {
    try {
      const htmlContent = await page.content();
      const url = page.url();

      // Cloudflare challenge detection
      const isCloudflare = htmlContent.includes('Cloudflare') ||
                          htmlContent.includes('__cf_chl_jschl_tk__') ||
                          htmlContent.includes('challenge-form') ||
                          htmlContent.includes('cf_clearance');

      if (isCloudflare) {
        return {
          detected: true,
          type: 'cloudflare',
          pageUrl: url,
        };
      }

      return { detected: false };
    } catch (error) {
      console.error('Error detecting Cloudflare:', error);
      return { detected: false };
    }
  }

  /**
   * Universal captcha detection - checks all known types
   */
  static async detectAnyCaptcha(page: Page): Promise<CaptchaDetectionResult> {
    // Check in order of priority (most common first)
    let result = await this.detectReCaptchaV2(page);
    if (result.detected) return result;

    result = await this.detectCloudflareChallenge(page);
    if (result.detected) return result;

    result = await this.detectHCaptcha(page);
    if (result.detected) return result;

    result = await this.detectReCaptchaV3(page);
    if (result.detected) return result;

    return { detected: false };
  }

  /**
   * Solve captcha using CapSolver
   * Returns the solution token to be injected back into the page
   */
  static async submitCaptchaSolution(
    page: Page,
    solutionToken: string
  ): Promise<boolean> {
    try {
      // Find reCAPTCHA response textarea
      const frames = page.frames();

      for (const frame of frames) {
        const responseField = await frame.$('textarea[name="g-recaptcha-response"]');

        if (responseField) {
          // Fill the response field
          await responseField.fill(solutionToken);

          // Try to submit the form
          const form = await frame.$('form');
          if (form) {
            // Find and click the submit button
            const submitButton = await form.$('button[type="submit"], input[type="submit"]');
            if (submitButton) {
              await submitButton.click();
              return true;
            }
          }

          // Alternative: find and click the verification button
          const verifyButton = await frame.$('.rc-button-submit, button[aria-label*="verify"]');
          if (verifyButton) {
            await verifyButton.click();
            return true;
          }

          return true; // Assume success if field was filled
        }
      }

      console.warn('Could not find reCAPTCHA response field');
      return false;
    } catch (error) {
      console.error('Error submitting captcha solution:', error);
      return false;
    }
  }

  /**
   * Wait for captcha to be solved (by checking if the challenge disappears)
   */
  static async waitForCaptchaSolve(
    page: Page,
    timeout: number = 30000
  ): Promise<boolean> {
    try {
      const frames = page.frames();

      for (const frame of frames) {
        try {
          await frame.waitForFunction(
            () => {
              const captchaElement = document.querySelector('.rc-anchor, .h-captcha, .cf-challenge');
              return !captchaElement || captchaElement.style.display === 'none';
            },
            { timeout }
          );
          return true;
        } catch {
          // Continue checking other frames
        }
      }

      return false;
    } catch (error) {
      console.error('Error waiting for captcha solve:', error);
      return false;
    }
  }
}

export default ReCaptchaDetector;
