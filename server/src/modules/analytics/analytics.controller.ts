import type { Request, Response } from 'express';
import { courseLearnerQuerySchema } from '@cadence/shared';
import { ok } from '../../lib/response.js';
import { analyticsService } from './analytics.service.js';

/**
 * Analytics HTTP.
 *
 * Each handler passes `req.user` straight through; the service decides
 * which course the actor may see, so an admin reaching these endpoints
 * gets the same analytics for any course without a separate code path.
 */
export const analyticsController = {
  async course(req: Request, res: Response): Promise<void> {
    const data = await analyticsService.courseAnalytics(req.params.id!, req.user!);
    ok(res, 'Course analytics retrieved', data);
  },

  async learners(req: Request, res: Response): Promise<void> {
    const query = courseLearnerQuerySchema.parse(req.query);
    const { items, meta } = await analyticsService.courseLearners(
      req.params.id!,
      query,
      req.user!,
    );
    ok(res, 'Enrolled learners retrieved', items, meta);
  },

  async learnerProgress(req: Request, res: Response): Promise<void> {
    const data = await analyticsService.learnerProgress(
      req.params.id!,
      req.params.userId!,
      req.user!,
    );
    ok(res, 'Learner progress retrieved', data);
  },
};
