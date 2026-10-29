/**
 * Example service layer for business logic
 * Services handle core business logic and communicate with data sources
 */

import { logger } from '../utils/logger';

/**
 * Example service for demonstration
 */
export class ExampleService {
  /**
   * Example method - replace with your actual business logic
   */
  async getExampleData(): Promise<{ message: string; timestamp: string }> {
    try {
      logger.debug('Getting example data');

      const data = {
        message: 'This is example data from the service layer',
        timestamp: new Date().toISOString(),
      };

      logger.info('Successfully retrieved example data');
      return data;
    } catch (error) {
      logger.error('Error in getExampleData', error);
      throw error;
    }
  }
}

export const exampleService = new ExampleService();
