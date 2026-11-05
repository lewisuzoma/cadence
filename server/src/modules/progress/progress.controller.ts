import type { Request, Response } from 'express';
import { completeLessonSchema, progressQuerySchema, saveProgressSchema } from '@cadence/shared';
import { ok } from '../../lib/response.js';
import { progressService } from './progress.service.js';

export const progressController = {
  async getForLesson(req: Request, res: Response): Promise<void> {
    const progress = await progressService.getForLesson(req.user!.id, req.params.lessonId!);
    ok(res, 'Progress retrieved', progress);
  },

  /** The throttled heartbeat / pause / seek / page-hide flush. */
  async save(req: Request, res: Response): Promise<void> {
    const input = saveProgressSchema.parse(req.body);
    const result = await progressService.save(
      req.user!.id,
      req.params.lessonId!,
      input.positionSeconds,
    );
    ok(res, 'Progress saved', result);
  },

  async complete(req: Request, res: Response): Promise<void> {
    const input = completeLessonSchema.parse(req.body);
    const result = await progressService.complete(
      req.user!.id,
      req.params.lessonId!,
      input.positionSeconds,
    );
    ok(res, 'Lesson completed', result);
  },

  async listMine(req: Request, res: Response): Promise<void> {
    const query = progressQuerySchema.parse(req.query);
    const { items, meta } = await progressService.listMine(req.user!.id, query);
    ok(res, 'Progress retrieved', items, meta);
  },
};
