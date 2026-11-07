import type { Request, Response } from 'express';
import {
  lessonInputSchema,
  lessonUpdateSchema,
  moduleInputSchema,
  moduleUpdateSchema,
  reorderLessonsSchema,
} from '@cadence/shared';
import { created, noContent, ok } from '../../lib/response.js';
import { lessonsService } from './lessons.service.js';

export const lessonsController = {
  async detail(req: Request, res: Response): Promise<void> {
    const lesson = await lessonsService.getDetail(req.params.id!, req.user);
    ok(res, 'Lesson retrieved', lesson);
  },

  async listForCourse(req: Request, res: Response): Promise<void> {
    const lessons = await lessonsService.listForCourse(req.params.courseId!, req.user);
    ok(res, 'Lessons retrieved', lessons);
  },

  // --- admin -------------------------------------------------------------

  async createModule(req: Request, res: Response): Promise<void> {
    const input = moduleInputSchema.parse(req.body);
    const module = await lessonsService.createModule(req.params.id!, input, req.user!);
    created(res, 'Module created', module);
  },

  async updateModule(req: Request, res: Response): Promise<void> {
    const input = moduleUpdateSchema.parse(req.body);
    const module = await lessonsService.updateModule(req.params.id!, input, req.user!);
    ok(res, 'Module updated', module);
  },

  async deleteModule(req: Request, res: Response): Promise<void> {
    await lessonsService.deleteModule(req.params.id!, req.user!);
    noContent(res);
  },

  async createLesson(req: Request, res: Response): Promise<void> {
    const input = lessonInputSchema.parse(req.body);
    const lesson = await lessonsService.createLesson(req.params.id!, input, req.user!);
    created(res, 'Lesson created', lesson);
  },

  async updateLesson(req: Request, res: Response): Promise<void> {
    const input = lessonUpdateSchema.parse(req.body);
    const lesson = await lessonsService.updateLesson(req.params.id!, input, req.user!);
    ok(res, 'Lesson updated', lesson);
  },

  async deleteLesson(req: Request, res: Response): Promise<void> {
    await lessonsService.deleteLesson(req.params.id!, req.user!);
    noContent(res);
  },

  async reorderLessons(req: Request, res: Response): Promise<void> {
    const { lessonIds } = reorderLessonsSchema.parse(req.body);
    const lessons = await lessonsService.reorderLessons(req.params.id!, lessonIds, req.user!);
    ok(res, 'Lessons reordered', lessons);
  },
};
