/**
 * CapSolver API Integration
 * Handles reCAPTCHA v2, hCaptcha, and other CAPTCHA solving
 *
 * API Docs: https://api.capsolver.com
 */

import fetch from 'node-fetch';

export interface CapSolverResponse {
  errorId: number;
  errorDescription?: string;
  taskId?: string;
  solution?: {
    gRecaptchaResponse?: string;
    [key: string]: any;
  };
}

export interface CapSolverConfig {
  apiKey: string;
  clientKey?: string;
  timeout?: number; // milliseconds (default: 5000)
}

export class CapSolverClient {
  private apiKey: string;
  private clientKey: string;
  private timeout: number;
  private apiBase: string = 'https://api.capsolver.com';

  constructor(config: CapSolverConfig) {
    if (!config.apiKey) {
      throw new Error('CapSolver API key is required');
    }
    this.apiKey = config.apiKey;
    this.clientKey = config.clientKey || config.apiKey;
    this.timeout = config.timeout || 5000;
  }

  /**
   * Solve reCAPTCHA v2 (Image)
   * @param imageBase64 Base64 encoded captcha image
   * @param description Optional description of the captcha (e.g., "numbers", "letters")
   */
  async solveImageCaptcha(
    imageBase64: string,
    description?: string
  ): Promise<{ solution: string; taskId: string }> {
    const createTaskResponse = await this.createTask({
      type: 'ImageToTextTask',
      body: imageBase64,
      module: description || '',
      score: 0.8,
      pageurl: 'https://auto-solve.com', // Generic fallback
    });

    if (createTaskResponse.errorId !== 0) {
      throw new Error(
        `CapSolver create task failed: ${createTaskResponse.errorDescription}`
      );
    }

    const taskId = createTaskResponse.taskId;
    return this.pollTaskResult(taskId);
  }

  /**
   * Solve reCAPTCHA v2 (Checkbox/Enterprise)
   * @param siteKey The site key from the captcha element
   * @param pageUrl The URL of the page containing the captcha
   */
  async solveRecaptchaV2(siteKey: string, pageUrl: string): Promise<{ solution: string; taskId: string }> {
    const createTaskResponse = await this.createTask({
      type: 'NoCaptchaTaskProxyless',
      websiteKey: siteKey,
      websiteURL: pageUrl,
    });

    if (createTaskResponse.errorId !== 0) {
      throw new Error(
        `CapSolver create task failed: ${createTaskResponse.errorDescription}`
      );
    }

    const taskId = createTaskResponse.taskId;
    return this.pollTaskResult(taskId);
  }

  /**
   * Solve hCaptcha
   * @param siteKey The site key from hcaptcha element
   * @param pageUrl The URL of the page containing the captcha
   */
  async solveHCaptcha(siteKey: string, pageUrl: string): Promise<{ solution: string; taskId: string }> {
    const createTaskResponse = await this.createTask({
      type: 'HCaptchaTaskProxyless',
      websiteKey: siteKey,
      websiteURL: pageUrl,
    });

    if (createTaskResponse.errorId !== 0) {
      throw new Error(
        `CapSolver create task failed: ${createTaskResponse.errorDescription}`
      );
    }

    const taskId = createTaskResponse.taskId;
    return this.pollTaskResult(taskId);
  }

  /**
   * Create a task on CapSolver
   */
  private async createTask(payload: any): Promise<CapSolverResponse> {
    const body = {
      clientKey: this.clientKey,
      task: payload,
      softID: 123,
      languagePool: 'en',
    };

    try {
      const response = await fetch(`${this.apiBase}/createTask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return (await response.json()) as CapSolverResponse;
    } catch (error: any) {
      throw new Error(`CapSolver API error: ${error.message}`);
    }
  }

  /**
   * Poll task result with timeout
   */
  private async pollTaskResult(
    taskId: string,
    maxAttempts: number = 10,
    delayMs: number = 500
  ): Promise<{ solution: string; taskId: string }> {
    const startTime = Date.now();

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      // Check timeout
      if (Date.now() - startTime > this.timeout) {
        throw new Error(`CapSolver timeout after ${this.timeout}ms`);
      }

      // Wait before polling
      if (attempt > 1) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }

      try {
        const response = await fetch(`${this.apiBase}/getTaskResult`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientKey: this.clientKey,
            taskId,
          }),
        });

        if (!response.ok) {
          continue; // Retry on network error
        }

        const data = (await response.json()) as CapSolverResponse;

        if (data.errorId !== 0) {
          throw new Error(
            `CapSolver getTaskResult failed: ${data.errorDescription}`
          );
        }

        // Check if task is complete
        if (data.solution) {
          const solution = data.solution.gRecaptchaResponse ||
                          data.solution.gRecaptchaResponseNoPrefix ||
                          data.solution.text ||
                          '';

          if (!solution) {
            throw new Error('CapSolver returned empty solution');
          }

          return { solution, taskId };
        }

        // Task is still processing, continue polling
      } catch (error: any) {
        // Only throw on critical errors, not on transient network errors
        if (error.message.includes('timeout')) {
          throw error;
        }
        // Continue polling on other errors
      }
    }

    throw new Error(`CapSolver polling timeout: no solution after ${maxAttempts} attempts`);
  }

  /**
   * Get account balance
   */
  async getBalance(): Promise<number> {
    const response = await fetch(`${this.apiBase}/getBalance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientKey: this.clientKey,
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to get balance: HTTP ${response.status}`);
    }

    const data = (await response.json()) as any;
    return data.balance || 0;
  }
}

export default CapSolverClient;
