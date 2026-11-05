import type { Request, Response } from 'express';
import { enrollmentQuerySchema } from '@cadence/shared';
import { created, ok } from '../../lib/response.js';
import { enrollmentService } from './enrollment.service.js';

export const enrollmentController = {
  /**
   * Idempotent by design: a brand-new enrollment answers 201, an existing one
   * answers 200 with the same payload.  No path returns a conflict, so the
   * client's Enroll button cannot land the user on an error.
   */
  async enroll(req: Request, res: Response): Promise<void> {
    const result = await enrollmentService.enroll(req.user!.id, req.params.courseId!);
    if (result.created) {
      created(res, 'Enrolled', result.enrollment);
      return;
    }
    ok(res, 'Already enrolled', result.enrollment);
  },

  async forCourse(req: Request, res: Response): Promise<void> {
    const enrollment = await enrollmentService.getForCourse(req.user!.id, req.params.courseId!);
    ok(res, 'Enrollment retrieved', enrollment);
  },

  async cancel(req: Request, res: Response): Promise<void> {
    const enrollment = await enrollmentService.cancel(req.user!.id, req.params.courseId!);
    ok(res, 'Left course', enrollment);
  },

  async listMine(req: Request, res: Response): Promise<void> {
    const query = enrollmentQuerySchema.parse(req.query);
    const { items, meta } = await enrollmentService.listMine(req.user!.id, query);
    ok(res, 'Enrollments retrieved', items, meta);
  },
};
