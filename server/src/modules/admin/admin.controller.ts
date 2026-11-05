import type { Request, Response } from 'express';
import {
  activityQuerySchema,
  adminUserQuerySchema,
  adminUserUpdateSchema,
  paginationQuerySchema,
} from '@cadence/shared';
import { ok } from '../../lib/response.js';
import { dashboardService } from '../dashboard/dashboard.service.js';
import { adminService } from './admin.service.js';

export const adminController = {
  async listUsers(req: Request, res: Response): Promise<void> {
    const query = adminUserQuerySchema.parse(req.query);
    const { items, meta } = await adminService.listUsers(query);
    ok(res, 'Users retrieved', items, meta);
  },

  async getLearner(req: Request, res: Response): Promise<void> {
    const learner = await adminService.getLearner(req.params.id!);
    ok(res, 'Learner retrieved', learner);
  },

  /** The same detail payload, exposed under /progress for the UI's tab. */
  async learnerProgress(req: Request, res: Response): Promise<void> {
    const learner = await adminService.getLearner(req.params.id!);
    ok(res, 'Learner progress retrieved', {
      courses: learner.courses,
      lessons: learner.lessons,
      overallProgressPercentage: learner.overallProgressPercentage,
    });
  },

  async setActive(req: Request, res: Response): Promise<void> {
    const { isActive } = adminUserUpdateSchema.parse(req.body);
    const user = await adminService.setActive(req.user!.id, req.params.id!, isActive);
    ok(res, isActive ? 'Learner activated' : 'Learner deactivated', user);
  },

  async courseLearners(req: Request, res: Response): Promise<void> {
    const query = paginationQuerySchema.parse(req.query);
    const { items, meta } = await adminService.courseLearners(
      req.params.id!,
      query.page,
      query.pageSize,
    );
    ok(res, 'Learners retrieved', items, meta);
  },

  async activity(req: Request, res: Response): Promise<void> {
    const query = activityQuerySchema.parse(req.query);
    const { items, meta } = await dashboardService.activity(query);
    ok(res, 'Activity retrieved', items, meta);
  },
};
